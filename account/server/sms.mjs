/**
 * 步迷 Walkaholic · 账号服务 — 短信验证码登录
 *
 * 流程：
 *   1. POST /api/auth/sms/send   { phone }        → 下发验证码（6 位，5 分钟有效）
 *   2. POST /api/auth/sms/verify { phone, code }  → 校验后建号 / 登录，下发会话 Cookie
 *
 * 为什么手机号要单独建账号：
 *   用户只输手机号时没有密码。我们给这个账号写一个随机长串密码占位，
 *   于是它**只能用短信登录**，无法被人用密码撞库。
 *
 * 安全：
 *   - 验证码只存 SHA256，不存明文；校验成功即删除（一次性）
 *   - 同一手机号 10 分钟内最多 5 次发送；同一 IP 10 分钟内最多 20 次
 *   - 同一验证码最多试 5 次，超过即作废
 *   - 未配置短信服务商时**不假装成功**：返回 503 并说清缺什么
 *
 * 短信服务商：目前接阿里云「短信服务」的 SendSms（国内最常用，个人/个体户可开）。
 * 需要：AccessKeyId / AccessKeySecret / 签名（SignName）/ 模板号（TemplateCode）。
 */

import crypto from 'node:crypto';

export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 5 * 60 * 1000;
export const MAX_SENDS_PER_PHONE = 5;
export const SEND_WINDOW_MS = 10 * 60 * 1000;
export const MAX_VERIFY_ATTEMPTS = 5;
export const PHONE_PATTERN = /^1[3-9]\d{9}$/;

export class SmsError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'SmsError';
    this.code = code;
    this.status = status;
  }
}

function envAny(env, name) {
  const primary = env['WA_' + name];
  if (primary !== undefined && String(primary).trim() !== '') return String(primary).trim();
  const legacy = env['BW_' + name];
  if (legacy !== undefined && String(legacy).trim() !== '') return String(legacy).trim();
  return '';
}

/** 短信服务商配置；未配置时 enabled=false（不假装可用） */
export function resolveSmsConfig(env = process.env) {
  const accessKeyId = envAny(env, 'SMS_ACCESS_KEY_ID');
  const accessKeySecret = envAny(env, 'SMS_ACCESS_KEY_SECRET');
  const signName = envAny(env, 'SMS_SIGN_NAME');
  const templateCode = envAny(env, 'SMS_TEMPLATE_CODE');
  const missing = [];
  if (!accessKeyId) missing.push('WA_SMS_ACCESS_KEY_ID');
  if (!accessKeySecret) missing.push('WA_SMS_ACCESS_KEY_SECRET');
  if (!signName) missing.push('WA_SMS_SIGN_NAME');
  if (!templateCode) missing.push('WA_SMS_TEMPLATE_CODE');
  return {
    enabled: missing.length === 0,
    accessKeyId,
    accessKeySecret,
    signName,
    templateCode,
    missing,
    // 开发模式：只在日志里打印验证码，不真的发短信
    devMode: envAny(env, 'SMS_DEV_MODE') === '1'
  };
}

export function publicSmsConfig(env = process.env) {
  const config = resolveSmsConfig(env);
  return { enabled: config.enabled, missing: config.missing };
}

export function validatePhone(raw) {
  const phone = String(raw || '').trim();
  if (!PHONE_PATTERN.test(phone)) {
    throw new SmsError('手机号格式不对（需要 11 位中国大陆号码）', 'BAD_PHONE', 400);
  }
  return phone;
}

export function hashCode(code) {
  return crypto.createHash('sha256').update(String(code), 'utf8').digest('hex');
}

/** 6 位数字验证码（用随机字节，不用 Math.random） */
export function generateCode() {
  const value = crypto.randomInt(0, 10 ** CODE_LENGTH);
  return String(value).padStart(CODE_LENGTH, '0');
}

// ------------------------------------------------------------
// 阿里云短信（SendSms，RPC 风格签名 v1）
// ------------------------------------------------------------

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

/** 阿里云 RPC 签名：Sort → 拼接 → HMAC-SHA1(SignatureMethod) → Base64 */
export function signAliyunRpc(params, accessKeySecret) {
  const sorted = Object.keys(params).sort();
  const canonical = sorted.map((key) => percentEncode(key) + '=' + percentEncode(params[key])).join('&');
  const stringToSign = 'GET&' + percentEncode('/') + '&' + percentEncode(canonical);
  return crypto
    .createHmac('sha1', accessKeySecret + '&')
    .update(stringToSign, 'utf8')
    .digest('base64');
}

/** 调阿里云 SendSms；返回 { ok, requestId, error } */
export async function sendAliyunSms(config, phone, code, fetchImpl = fetch, now = () => Date.now()) {
  const params = {
    AccessKeyId: config.accessKeyId,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phone,
    RegionId: 'cn-hangzhou',
    SignName: config.signName,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: '1.0',
    TemplateCode: config.templateCode,
    TemplateParam: JSON.stringify({ code: code }),
    Timestamp: new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25'
  };
  params.Signature = signAliyunRpc(params, config.accessKeySecret);

  const query = Object.keys(params)
    .map((key) => percentEncode(key) + '=' + percentEncode(params[key]))
    .join('&');
  try {
    const response = await fetchImpl('https://dysmsapi.aliyuncs.com/?' + query, { method: 'GET' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || (payload && payload.Code && payload.Code !== 'OK')) {
      return {
        ok: false,
        requestId: payload && payload.RequestId ? String(payload.RequestId) : null,
        error: (payload && (payload.Message || payload.Code)) || ('HTTP ' + response.status)
      };
    }
    return { ok: true, requestId: payload && payload.RequestId ? String(payload.RequestId) : null, error: '' };
  } catch (error) {
    return { ok: false, requestId: null, error: error && error.message ? error.message : String(error) };
  }
}

// ------------------------------------------------------------
// 验证码存储（内存 + 落盘可选；单机部署够用）
// ------------------------------------------------------------

export class SmsCodeStore {
  /**
   * @param {{ db?: import('node:sqlite').DatabaseSync, now?: () => number }} options
   * 传 db 就落库（重启不丢），不传就纯内存（测试用）
   */
  constructor(options = {}) {
    this.db = options.db || null;
    this.now = options.now || (() => Date.now());
    this.codes = new Map();
    this.sends = new Map();
    if (this.db) {
      this.db.exec(
        'CREATE TABLE IF NOT EXISTS sms_codes (' +
          'phone TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, ' +
          'attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL' +
        ')'
      );
    }
  }

  _cleanup() {
    const now = this.now();
    for (const [phone, entry] of this.codes) {
      if (entry.expiresAt <= now) this.codes.delete(phone);
    }
    for (const [phone, times] of this.sends) {
      const fresh = times.filter((t) => now - t < SEND_WINDOW_MS);
      if (fresh.length === 0) this.sends.delete(phone);
      else this.sends.set(phone, fresh);
    }
  }

  /** 最近窗口内发了几次 */
  recentSendCount(phone) {
    this._cleanup();
    const times = this.sends.get(phone) || [];
    return times.filter((t) => this.now() - t < SEND_WINDOW_MS).length;
  }

  recordSend(phone) {
    const times = this.sends.get(phone) || [];
    times.push(this.now());
    this.sends.set(phone, times);
  }

  save(phone, code) {
    const now = this.now();
    const entry = { codeHash: hashCode(code), expiresAt: now + CODE_TTL_MS, attempts: 0 };
    if (this.db) {
      this.db.prepare(
        'INSERT INTO sms_codes (phone, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?) ' +
          'ON CONFLICT(phone) DO UPDATE SET code_hash = excluded.code_hash, ' +
          'expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at'
      ).run(phone, entry.codeHash, entry.expiresAt, now);
    } else {
      this.codes.set(phone, entry);
    }
  }

  /** 校验；成功即删除（一次性）。返回 { ok, code } */
  verify(phone, code) {
    const now = this.now();
    let entry = null;
    if (this.db) {
      const row = this.db.prepare('SELECT * FROM sms_codes WHERE phone = ?').get(phone);
      if (row) {
        entry = {
          codeHash: String(row.code_hash),
          expiresAt: Number(row.expires_at),
          attempts: Number(row.attempts)
        };
      }
    } else {
      // 注意：这里不能先 _cleanup()。过期的条目要留着才能回「已过期」而不是「没发过」，
      // 否则用户永远只会看到「还没发送验证码」这种误导性提示。
      entry = this.codes.get(phone) || null;
    }
    if (!entry) return { ok: false, code: 'SMS_NO_CODE' };
    if (entry.expiresAt <= now) {
      this.delete(phone);
      return { ok: false, code: 'SMS_EXPIRED' };
    }
    if (entry.attempts >= MAX_VERIFY_ATTEMPTS) {
      this.delete(phone);
      return { ok: false, code: 'SMS_TOO_MANY_ATTEMPTS' };
    }
    if (hashCode(code) !== entry.codeHash) {
      if (this.db) {
        this.db.prepare('UPDATE sms_codes SET attempts = attempts + 1 WHERE phone = ?').run(phone);
      } else {
        entry.attempts += 1;
        this.codes.set(phone, entry);
      }
      return { ok: false, code: 'SMS_WRONG_CODE' };
    }
    this.delete(phone);
    return { ok: true, code: '' };
  }

  delete(phone) {
    if (this.db) this.db.prepare('DELETE FROM sms_codes WHERE phone = ?').run(phone);
    else this.codes.delete(phone);
  }
}
