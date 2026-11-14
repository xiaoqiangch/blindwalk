/**
 * 步迷 Walkaholic · 兴趣点后台 — 微信 / 账号侧设置（直接读写账号库）
 *
 * 为什么要直连账号库：
 *   设置项属于账号服务（微信 AppID / Secret 供 /api/auth/wechat 用），
 *   但后台是另一个进程。如果让浏览器跨服务调，就得把管理令牌发到前端 —— 那是把
 *   长期凭证交出去。后台本来就已经直接开账号库做惊喜审核（见 surprises.mjs），
 *   这里沿用同一套做法：后台写库，账号服务每次请求现读，改完立即生效。
 *
 * 安全：读接口只回掩码，绝不回发明文 secret；不建库（库不存在就明确报不可用）。
 */

import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export const WECHAT_SETTING_KEYS = ['wechat.appid', 'wechat.secret', 'wechat.universalLink'];
const SECRET_KEYS = new Set(['wechat.secret']);
const MAX_VALUE_LENGTH = 512;

export class AccountSettingsError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'AccountSettingsError';
    this.code = code;
    this.status = status;
  }
}

/** 与 account/server/mask.mjs 完全一致的掩码规则 */
export function maskValue(value) {
  const text = String(value || '');
  if (text.length === 0) return '';
  if (text.length >= 8) return text.slice(0, 4) + '…' + text.slice(-4);
  if (text.length >= 5) return text.slice(0, 1) + '…' + text.slice(-1);
  return '…';
}

export class AccountSettingsAdmin {
  /**
   * @param {{ dbPath: string, env?: object, now?: () => number }} options
   */
  constructor(options = {}) {
    this.dbPath = options.dbPath;
    this.env = options.env || process.env;
    this.now = options.now || (() => Date.now());
    this.db = null;
    this.error = '';
    this.open();
  }

  open() {
    if (!this.dbPath || !fs.existsSync(this.dbPath)) {
      this.error = '账号库不存在：' + (this.dbPath || '(未配置)');
      return;
    }
    try {
      this.db = new DatabaseSync(this.dbPath);
      this.db.exec('PRAGMA busy_timeout = 3000');
      // 表在账号服务里建；这里只读不建，避免两处 schema 分叉
      const table = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'"
      ).get();
      if (!table) {
        // 账号服务还没跑过新版本 —— 明确报不可用，不在这里偷偷建表
        this.error = '账号服务还没创建 settings 表（重启一次账号服务即可）';
        // 关键：必须把 db 关掉置空，否则后续查询会走到「no such table」变成 500
        try { this.db.close(); } catch (_) { /* 忽略 */ }
        this.db = null;
      }
    } catch (error) {
      this.db = null;
      this.error = '打开账号库失败：' + (error && error.message ? error.message : String(error));
    }
  }

  get available() { return this.db !== null; }

  status() {
    return { available: this.available, dbPath: this.dbPath, error: this.error };
  }

  requireDb() {
    if (!this.db) {
      throw new AccountSettingsError(this.error || '账号库不可用', 'SETTINGS_UNAVAILABLE', 503);
    }
    return this.db;
  }

  getStored(key) {
    const db = this.requireDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (!row || typeof row.value !== 'string') return '';
    return row.value;
  }

  /** 数据库 → 环境变量 → 空串（与账号服务 resolve 的优先级一致） */
  resolve(key) {
    const stored = this.getStored(key);
    if (stored.length > 0) return stored;
    const envKey = 'WA_' + key.toUpperCase().replace(/\./g, '_');
    const legacyKey = 'BW_' + key.toUpperCase().replace(/\./g, '_');
    return String(this.env[envKey] || this.env[legacyKey] || '').trim();
  }

  adminView() {
    const settings = {};
    for (const key of WECHAT_SETTING_KEYS) {
      const value = this.resolve(key);
      if (SECRET_KEYS.has(key)) {
        settings[key] = value.length > 0
          ? { configured: true, value: maskValue(value) }
          : { configured: false, value: '' };
      } else {
        settings[key] = { configured: value.length > 0, value: value };
      }
    }
    const appid = this.resolve('wechat.appid');
    const secret = this.resolve('wechat.secret');
    return {
      ok: true,
      settings: settings,
      wechatEnabled: appid.length > 0 && secret.length > 0,
      missing: [
        appid.length === 0 ? 'WA_WECHAT_APPID' : null,
        secret.length === 0 ? 'WA_WECHAT_SECRET' : null
      ].filter(Boolean),
      dbPath: this.dbPath
    };
  }

  update(body) {
    const db = this.requireDb();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new AccountSettingsError('请求体必须是 JSON 对象', 'BAD_REQUEST', 400);
    }
    const patch = body.settings || body;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new AccountSettingsError('settings 必须是对象', 'BAD_REQUEST', 400);
    }
    const keys = Object.keys(patch).filter((key) => WECHAT_SETTING_KEYS.indexOf(key) >= 0);
    if (keys.length === 0) {
      throw new AccountSettingsError(
        '没有可更新的设置项（可用：' + WECHAT_SETTING_KEYS.join(' / ') + '）',
        'BAD_REQUEST',
        400
      );
    }
    const now = this.now();
    db.exec('BEGIN');
    try {
      for (const key of keys) {
        const value = patch[key];
        if (typeof value !== 'string') {
          throw new AccountSettingsError(key + ' 必须是字符串', 'BAD_REQUEST', 400);
        }
        const trimmed = value.trim();
        if (trimmed.length > MAX_VALUE_LENGTH) {
          throw new AccountSettingsError(key + ' 过长（上限 ' + MAX_VALUE_LENGTH + ' 字符）', 'BAD_REQUEST', 400);
        }
        if (trimmed.length === 0) {
          db.prepare('DELETE FROM settings WHERE key = ?').run(key);
        } else {
          db.prepare(
            'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ' +
              'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
          ).run(key, trimmed, now);
        }
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return this.adminView();
  }

  close() {
    if (this.db) {
      try { this.db.close(); } catch (_) { /* 忽略 */ }
      this.db = null;
    }
  }
}
