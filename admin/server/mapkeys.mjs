/**
 * 步迷 Walkaholic · 后台 — 地图 Key 统一管理
 *
 * 背景：地图 Key 不应由每个终端用户自己填。后台统一存（SQLite app_keys 表），
 * 管理界面只返回掩码；PWA 通过公开端点 `/api/public/mapkeys` 自动取。
 *
 * 安全约定：
 * - 管理端 GET 只回显前 4 + 后 4 位（如 52da…f425），绝不回显完整 Key
 * - 公开端点限制来源白名单（默认 https://xiaoqiangch.github.io + localhost/127.0.0.1），
 *   非白名单 Origin → 403；响应 Cache-Control: no-store
 * - 不做任何日志打印 Key；test 端点的错误信息也会把 Key 替换成掩码
 *
 * 零依赖：SQLite 的 DatabaseSync 由 db.mjs 传入。
 */

import { PoiError } from './poi.mjs';

export const PROVIDERS = ['amap', 'baidu'];
const PROVIDER_LABELS = { amap: '高德 Web 服务 Key', baidu: '百度地图服务端 AK' };
const MAX_KEY_LENGTH = 512;
const TEST_TIMEOUT_MS = 8000;

/** 默认允许来源：GitHub Pages + 本机（含任意端口） */
const DEFAULT_ORIGIN_PATTERNS = [
  'https://xiaoqiangch.github.io',
  'http://127.0.0.1',
  'http://127.0.0.1:*',
  'http://localhost',
  'http://localhost:*'
];

const AMAP_TEST_BASE = 'https://restapi.amap.com/v3/place/around';
const BAIDU_TEST_BASE = 'https://api.map.baidu.com/place/v2/search';

/** 前 4 + 后 4 掩码；短 Key 更严格 */
export function maskKey(value) {
  const text = String(value || '');
  if (text.length === 0) return '';
  if (text.length >= 8) return text.slice(0, 4) + '…' + text.slice(-4);
  if (text.length >= 5) return text.slice(0, 1) + '…' + text.slice(-1);
  return '…';
}

/** 把形如 http://127.0.0.1:* 的模式编译成正则（* → 任意字符） */
export function compileOriginPatterns(raw) {
  const text = raw === undefined || raw === null ? '' : String(raw).trim();
  const list = text.length > 0
    ? text.split(',').map((item) => item.trim()).filter(Boolean)
    : DEFAULT_ORIGIN_PATTERNS.slice();
  return list.map((pattern) => {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + escaped + '$');
  });
}

function nowOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export class MapKeysService {
  /**
   * @param {{ db: import('node:sqlite').DatabaseSync, env?: object,
   *           fetchImpl?: typeof fetch, now?: () => number, logger?: object }} options
   */
  constructor(options = {}) {
    if (!options.db) throw new Error('MapKeysService 需要 SQLite db');
    this.db = options.db;
    this.env = options.env || process.env;
    this.now = options.now || (() => Date.now());
    this.logger = options.logger || console;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.originPatterns = compileOriginPatterns(this.env.WA_MAPKEYS_ORIGINS || this.env.BW_MAPKEYS_ORIGINS);
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS app_keys (' +
        'key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER' +
      ')'
    );
  }

  // ---------- 读写原始 Key（仅服务端内部使用） ----------

  getRaw(provider) {
    const row = this.db.prepare('SELECT value FROM app_keys WHERE key = ?').get(provider);
    if (!row || typeof row.value !== 'string' || row.value.length === 0) return '';
    return row.value;
  }

  getRow(provider) {
    const row = this.db.prepare('SELECT key, value, updated_at FROM app_keys WHERE key = ?').get(provider);
    if (!row || typeof row.value !== 'string' || row.value.length === 0) return null;
    return { provider: String(row.key), value: String(row.value), updatedAt: Number(row.updated_at) };
  }

  setRaw(provider, value, updatedAt) {
    if (value.length === 0) {
      this.db.prepare('DELETE FROM app_keys WHERE key = ?').run(provider);
      return;
    }
    this.db.prepare(
      'INSERT INTO app_keys (key, value, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    ).run(provider, value, updatedAt);
  }

  allRows() {
    const rows = this.db.prepare('SELECT key, value, updated_at FROM app_keys ORDER BY key ASC').all();
    const map = {};
    for (const row of rows) {
      if (typeof row.value === 'string' && row.value.length > 0) {
        map[String(row.key)] = { value: String(row.value), updatedAt: Number(row.updated_at) };
      }
    }
    return map;
  }

  version() {
    const map = this.allRows();
    let latest = 0;
    for (const provider of Object.keys(map)) {
      latest = Math.max(latest, nowOr(map[provider].updatedAt, 0));
    }
    return String(latest);
  }

  // ---------- 管理端 ----------

  /** GET /api/mapkeys：只回显掩码，绝不回显完整 Key */
  adminView() {
    const keys = {};
    for (const provider of PROVIDERS) {
      const row = this.getRow(provider);
      if (row === null) {
        keys[provider] = { configured: false };
      } else {
        keys[provider] = {
          configured: true,
          hint: maskKey(row.value),
          updatedAt: row.updatedAt
        };
      }
    }
    return { ok: true, keys: keys, publicUrl: '/api/public/mapkeys' };
  }

  /** PUT /api/mapkeys：空字符串表示清除；未出现的 provider 保持不变 */
  updateKeys(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new PoiError('请求体必须是 JSON 对象', 'BAD_REQUEST', 400);
    }
    const keys = body.keys;
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
      throw new PoiError('keys 必须是对象（含 amap / baidu）', 'BAD_REQUEST', 400);
    }
    const updates = [];
    for (const provider of PROVIDERS) {
      if (!Object.prototype.hasOwnProperty.call(keys, provider)) continue;
      const value = keys[provider];
      if (typeof value !== 'string') {
        throw new PoiError('keys.' + provider + ' 必须是字符串（空串表示清除）', 'BAD_REQUEST', 400);
      }
      const trimmed = value.trim();
      if (trimmed.length > MAX_KEY_LENGTH) {
        throw new PoiError('keys.' + provider + ' 过长（上限 ' + MAX_KEY_LENGTH + ' 字符）', 'BAD_REQUEST', 400);
      }
      updates.push({ provider: provider, value: trimmed });
    }
    if (updates.length === 0) {
      throw new PoiError('没有可更新的 Key（可用 keys.amap / keys.baidu）', 'BAD_REQUEST', 400);
    }
    const now = this.now();
    this.db.exec('BEGIN');
    try {
      for (const update of updates) {
        this.setRaw(update.provider, update.value, now);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.adminView();
  }

  // ---------- 公开端点 ----------

  allowsOrigin(origin) {
    if (typeof origin !== 'string' || origin.length === 0) return false;
    return this.originPatterns.some((pattern) => pattern.test(origin));
  }

  /** 公开视图：给 PWA 的明文 Key（空串表示未配置） */
  publicView() {
    const keys = {};
    for (const provider of PROVIDERS) {
      keys[provider] = this.getRaw(provider);
    }
    return { ok: true, keys: keys, version: this.version() };
  }

  // ---------- 测试连接 ----------

  buildTestUrl(provider, key) {
    if (provider === 'amap') {
      return AMAP_TEST_BASE + '?key=' + encodeURIComponent(key) +
        '&location=116.397,39.909&radius=500&offset=1';
    }
    return BAIDU_TEST_BASE + '?query=' + encodeURIComponent('咖啡') +
      '&location=39.915,116.404&radius=500&output=json&ak=' + encodeURIComponent(key);
  }

  parseTestResponse(provider, json) {
    if (!json || typeof json !== 'object') {
      return { ok: false, count: 0, error: '返回不是 JSON 对象' };
    }
    if (provider === 'amap') {
      if (String(json.status) !== '1') {
        return {
          ok: false,
          count: 0,
          error: '高德返回错误：' + String(json.info || json.infocode || '未知错误')
        };
      }
      const count = Number(json.count);
      if (Number.isFinite(count)) return { ok: true, count: count };
      const pois = Array.isArray(json.pois) ? json.pois.length : 0;
      return { ok: true, count: pois };
    }
    // baidu
    if (Number(json.status) !== 0) {
      return {
        ok: false,
        count: 0,
        error: '百度返回错误：' + String(json.message || json.status || '未知错误')
      };
    }
    const results = Array.isArray(json.results) ? json.results.length : 0;
    return { ok: true, count: results };
  }

  sanitizeError(provider, message, key) {
    let text = String(message || '未知错误');
    if (key && key.length > 0) {
      text = text.split(key).join(maskKey(key));
    }
    return text.length > 160 ? text.slice(0, 160) : text;
  }

  /**
   * POST /api/mapkeys/test
   * 服务端用已存的 Key 调一次真实接口；测试可注入 fetchImpl，不碰外网。
   */
  async testProvider(provider) {
    if (!PROVIDERS.includes(provider)) {
      throw new PoiError('provider 必须是 amap 或 baidu', 'BAD_REQUEST', 400);
    }
    const row = this.getRow(provider);
    if (row === null) {
      return {
        ok: false,
        provider: provider,
        count: 0,
        error: '未配置 Key（先保存 ' + PROVIDER_LABELS[provider] + '）'
      };
    }
    const fetchImpl = this.fetchImpl;
    if (typeof fetchImpl !== 'function') {
      return { ok: false, provider: provider, count: 0, error: '当前 Node 没有可用的 fetch' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(this.buildTestUrl(provider, row.value), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) {
        return {
          ok: false,
          provider: provider,
          count: 0,
          error: 'HTTP ' + String(response.status)
        };
      }
      const json = await response.json();
      const parsed = this.parseTestResponse(provider, json);
      return {
        ok: parsed.ok,
        provider: provider,
        count: parsed.count,
        error: parsed.ok ? undefined : this.sanitizeError(provider, parsed.error, row.value)
      };
    } catch (error) {
      const message = error && error.name === 'AbortError'
        ? '请求超时（8 秒）'
        : this.sanitizeError(provider, error && error.message, row.value);
      return { ok: false, provider: provider, count: 0, error: message };
    } finally {
      clearTimeout(timer);
    }
  }
}
