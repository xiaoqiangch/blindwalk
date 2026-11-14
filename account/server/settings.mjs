/**
 * 步迷 Walkaholic · 账号服务 — 运行期可改的设置（微信登录等）
 *
 * 为什么需要：微信 AppID / AppSecret 现在只能改 systemd 环境变量 + 重启。
 * 后台要能「填进去就生效」，所以放数据库。
 *
 * 优先级：**数据库里的值优先**，环境变量作为初始默认值。
 * 这样运维仍然可以只靠环境变量部署，装上后台之后又能在线改。
 *
 * 安全：
 * - 读接口一律返回掩码，绝不下发明文 secret
 * - 写接口要求 `X-WA-Admin-Token` 等于服务端的 WA_ADMIN_TOKEN（未配置则拒绝，绝不放行）
 */

import { maskKey } from './mask.mjs';

export const SETTING_KEYS = [
  'wechat.appid',
  'wechat.secret',
  'wechat.universalLink'
];

/** 哪些 key 是敏感值（读的时候掩码） */
const SECRET_KEYS = new Set(['wechat.secret']);

export class SettingsError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'SettingsError';
    this.code = code;
    this.status = status;
  }
}

export class AccountSettings {
  /**
   * @param {{ db: import('node:sqlite').DatabaseSync, env?: object, now?: () => number }} options
   */
  constructor(options = {}) {
    if (!options.db) throw new Error('AccountSettings 需要 SQLite db');
    this.db = options.db;
    this.env = options.env || process.env;
    this.now = options.now || (() => Date.now());
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS settings (' +
        'key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL' +
      ')'
    );
  }

  // ---------- 鉴权 ----------

  /** 后台管理令牌：WA_ / BW_ 两个前缀都认；没配就一律拒绝 */
  get adminToken() {
    const value = this.env.WA_ADMIN_TOKEN || this.env.BW_ADMIN_TOKEN || '';
    return String(value).trim();
  }

  requireAdminToken(given) {
    const expected = this.adminToken;
    if (expected.length === 0) {
      throw new SettingsError(
        '服务端没有配置管理令牌（WA_ADMIN_TOKEN），拒绝写入',
        'ADMIN_TOKEN_MISSING',
        503
      );
    }
    if (typeof given !== 'string' || given !== expected) {
      throw new SettingsError('管理令牌不正确', 'UNAUTHORIZED', 401);
    }
  }

  // ---------- 读写 ----------

  get(key) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (!row) return '';
    return typeof row.value === 'string' ? row.value : '';
  }

  /** 数据库值 → 环境变量 → 空串 */
  resolve(key) {
    const stored = this.get(key);
    if (stored.length > 0) return stored;
    const envKey = 'WA_' + key.toUpperCase().replace(/\./g, '_');
    const legacyKey = 'BW_' + key.toUpperCase().replace(/\./g, '_');
    const envValue = this.env[envKey] || this.env[legacyKey] || '';
    return String(envValue).trim();
  }

  set(key, value) {
    if (SETTING_KEYS.indexOf(key) < 0) {
      throw new SettingsError('不支持的设置项：' + key, 'BAD_REQUEST', 400);
    }
    if (typeof value !== 'string') {
      throw new SettingsError(key + ' 必须是字符串', 'BAD_REQUEST', 400);
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
      return;
    }
    if (trimmed.length > 512) {
      throw new SettingsError(key + ' 过长（上限 512 字符）', 'BAD_REQUEST', 400);
    }
    this.db.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    ).run(key, trimmed, this.now());
  }

  /** 管理端视图：secret 掩码，其余明文 */
  adminView() {
    const settings = {};
    for (const key of SETTING_KEYS) {
      const value = this.resolve(key);
      if (value.length === 0) {
        settings[key] = { configured: false, value: '' };
      } else if (SECRET_KEYS.has(key)) {
        settings[key] = { configured: true, value: maskKey(value) };
      } else {
        settings[key] = { configured: true, value: value };
      }
    }
    return {
      ok: true,
      settings: settings,
      // 微信登录是否可用，由这里直接算，后台不用自己拼规则
      wechatEnabled: this.resolve('wechat.appid').length > 0 && this.resolve('wechat.secret').length > 0,
      adminTokenConfigured: this.adminToken.length > 0
    };
  }

  /** 批量写入；未出现的 key 保持不动 */
  update(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new SettingsError('请求体必须是 JSON 对象', 'BAD_REQUEST', 400);
    }
    const patch = body.settings || body;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new SettingsError('settings 必须是对象', 'BAD_REQUEST', 400);
    }
    const keys = Object.keys(patch).filter((key) => SETTING_KEYS.indexOf(key) >= 0);
    if (keys.length === 0) {
      throw new SettingsError(
        '没有可更新的设置项（可用：' + SETTING_KEYS.join(' / ') + '）',
        'BAD_REQUEST',
        400
      );
    }
    this.db.exec('BEGIN');
    try {
      for (const key of keys) this.set(key, patch[key]);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.adminView();
  }
}
