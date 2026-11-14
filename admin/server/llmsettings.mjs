/**
 * 步迷 Walkaholic · 兴趣点后台 — 大模型设置（在线可改）
 *
 * 背景：原来 AI 配置只能改 systemd 环境变量 + 重启。后台要能「填进去就生效」，
 * 所以放数据库的 app_keys 表（和地图 Key 同一张表，同一套掩码策略）。
 *
 * 优先级：**数据库优先，环境变量兜底**。
 * 这样运维仍然可以只靠环境变量部署，装上后台之后又能在线改。
 *
 * 安全：
 * - 读接口只回掩码，绝不下发明文 Key
 * - 测试连接的错误信息会把 Key 替换成掩码
 */

import { PoiError } from './poi.mjs';
import { maskKey } from './mapkeys.mjs';

export const LLM_SETTING_KEYS = ['llm.baseUrl', 'llm.apiKey', 'llm.model'];
const SECRET_KEYS = new Set(['llm.apiKey']);
const MAX_VALUE_LENGTH = 512;
const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-chat';
const TEST_TIMEOUT_MS = 15000;

function envFirst(env, name) {
  const primary = env['WA_' + name];
  if (primary !== undefined && String(primary).trim() !== '') return String(primary).trim();
  const legacy = env['BW_' + name];
  if (legacy !== undefined && String(legacy).trim() !== '') return String(legacy).trim();
  return '';
}

export class LlmSettings {
  /**
   * @param {{ db: import('node:sqlite').DatabaseSync, env?: object,
   *           fetchImpl?: typeof fetch, now?: () => number }} options
   */
  constructor(options = {}) {
    if (!options.db) throw new Error('LlmSettings 需要 SQLite db');
    this.db = options.db;
    this.env = options.env || process.env;
    this.now = options.now || (() => Date.now());
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS app_keys (' +
        'key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER' +
      ')'
    );
  }

  // ---------- 原始值 ----------

  getStored(key) {
    const row = this.db.prepare('SELECT value FROM app_keys WHERE key = ?').get(key);
    if (!row || typeof row.value !== 'string') return '';
    return row.value;
  }

  /** 数据库 → 环境变量 → 默认值 */
  resolve(key) {
    const stored = this.getStored(key);
    if (stored.length > 0) return stored;
    if (key === 'llm.baseUrl') return envFirst(this.env, 'LLM_BASE_URL') || DEFAULT_BASE_URL;
    if (key === 'llm.apiKey') return envFirst(this.env, 'LLM_API_KEY');
    if (key === 'llm.model') return envFirst(this.env, 'LLM_MODEL') || DEFAULT_MODEL;
    return '';
  }

  /** 拼成 llm.mjs 认的 env 形状（每次现算，后台改完立即生效） */
  asEnv() {
    return {
      WA_LLM_BASE_URL: this.resolve('llm.baseUrl'),
      WA_LLM_API_KEY: this.resolve('llm.apiKey'),
      WA_LLM_MODEL: this.resolve('llm.model')
    };
  }

  get apiKey() { return this.resolve('llm.apiKey'); }
  get baseUrl() { return this.resolve('llm.baseUrl'); }
  get model() { return this.resolve('llm.model'); }
  get enabled() { return this.apiKey.length > 0; }

  // ---------- 管理端 ----------

  adminView() {
    const settings = {};
    for (const key of LLM_SETTING_KEYS) {
      const value = this.resolve(key);
      if (SECRET_KEYS.has(key)) {
        settings[key] = value.length > 0
          ? { configured: true, value: maskKey(value) }
          : { configured: false, value: '' };
      } else {
        settings[key] = { configured: value.length > 0, value: value };
      }
    }
    return {
      ok: true,
      settings: settings,
      llmEnabled: this.enabled,
      source: this.getStored('llm.apiKey').length > 0 ? 'database' : (envFirst(this.env, 'LLM_API_KEY') ? 'env' : 'none')
    };
  }

  update(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new PoiError('请求体必须是 JSON 对象', 'BAD_REQUEST', 400);
    }
    const patch = body.settings || body;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new PoiError('settings 必须是对象', 'BAD_REQUEST', 400);
    }
    const keys = Object.keys(patch).filter((key) => LLM_SETTING_KEYS.indexOf(key) >= 0);
    if (keys.length === 0) {
      throw new PoiError('没有可更新的设置项（可用：' + LLM_SETTING_KEYS.join(' / ') + '）', 'BAD_REQUEST', 400);
    }
    const now = this.now();
    this.db.exec('BEGIN');
    try {
      for (const key of keys) {
        const value = patch[key];
        if (typeof value !== 'string') {
          throw new PoiError(key + ' 必须是字符串', 'BAD_REQUEST', 400);
        }
        const trimmed = value.trim();
        if (trimmed.length > MAX_VALUE_LENGTH) {
          throw new PoiError(key + ' 过长（上限 ' + MAX_VALUE_LENGTH + ' 字符）', 'BAD_REQUEST', 400);
        }
        if (trimmed.length === 0) {
          this.db.prepare('DELETE FROM app_keys WHERE key = ?').run(key);
        } else {
          this.db.prepare(
            'INSERT INTO app_keys (key, value, updated_at) VALUES (?, ?, ?) ' +
              'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
          ).run(key, trimmed, now);
        }
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.adminView();
  }

  /** 真的打一次模型，验证 Key 可用（1 token 级别的请求，不烧钱） */
  async test() {
    if (!this.enabled) {
      return { ok: false, error: '还没配置 API Key', mode: 'offline' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(this.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + this.apiKey
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const safe = String(text).split(this.apiKey).join(maskKey(this.apiKey)).slice(0, 200);
        return { ok: false, error: 'HTTP ' + response.status + '：' + safe, mode: 'llm' };
      }
      const payload = await response.json().catch(() => ({}));
      return {
        ok: true,
        mode: 'llm',
        model: (payload && payload.model) || this.model,
        baseUrl: this.baseUrl
      };
    } catch (error) {
      const message = error && error.name === 'AbortError'
        ? '请求超时（' + TEST_TIMEOUT_MS / 1000 + ' 秒）'
        : (error && error.message ? error.message : String(error));
      return { ok: false, error: message.split(this.apiKey).join(maskKey(this.apiKey)), mode: 'llm' };
    } finally {
      clearTimeout(timer);
    }
  }
}
