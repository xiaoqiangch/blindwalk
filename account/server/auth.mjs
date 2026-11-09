/**
 * 盲走 BlindWalk · 账号服务 — 密码 / 会话 / 限流 / Cookie
 *
 * - 密码：crypto.scryptSync + 每用户独立 salt（hex），不存明文
 * - 会话：随机 32 字节 token（hex），SQLite sessions 表；Cookie 30 天
 * - Cookie：bw_uid=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000
 *   本地 http 不加 Secure；部署 HTTPS 时把 BW_COOKIE_SECURE 设为 1（见 cookieHeader）。
 * - 限流：同一 IP 10 分钟内失败 8 次 → 429
 */

import crypto from 'node:crypto';

export const SESSION_COOKIE = 'bw_uid';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天
export const SESSION_MAX_AGE_SECONDS = Math.floor(SESSION_TTL_MS / 1000); // 2592000
export const SCRYPT_KEYLEN = 64;
export const MAX_LOGIN_FAILURES = 8;
export const LOGIN_FAILURE_WINDOW_MS = 10 * 60 * 1000;

/** 生成 scrypt 哈希与 salt（hex） */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  return { hash: hash.toString('hex'), salt: salt.toString('hex') };
}

/** 校验密码（timingSafeEqual） */
export function verifyPassword(password, saltHex, hashHex) {
  if (typeof password !== 'string' || password.length === 0) return false;
  if (typeof saltHex !== 'string' || typeof hashHex !== 'string') return false;
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length || SCRYPT_KEYLEN);
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch (error) {
    return false;
  }
}

/** 32 字节随机会话 token（64 位 hex） */
export function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function parseCookies(header) {
  const cookies = {};
  if (typeof header !== 'string' || header.length === 0) return cookies;
  const parts = header.split(';');
  for (const part of parts) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    const value = part.slice(index + 1).trim();
    try {
      cookies[key] = decodeURIComponent(value);
    } catch (error) {
      cookies[key] = value;
    }
  }
  return cookies;
}

/**
 * 会话 Cookie。
 * 注意：本地开发是 http，不能加 Secure；部署到 HTTPS 时设置 BW_COOKIE_SECURE=1，
 * 否则浏览器不会在跨站/HTTPS 请求里回传 Secure Cookie。
 */
export function sessionCookie(token, options = {}) {
  const secure = options.secure === true ? '; Secure' : '';
  return SESSION_COOKIE + '=' + encodeURIComponent(token) +
    '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + String(SESSION_MAX_AGE_SECONDS) + secure;
}

export function clearSessionCookie(options = {}) {
  const secure = options.secure === true ? '; Secure' : '';
  return SESSION_COOKIE + '=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' + secure;
}

/** 请求来源 IP（默认取 socket；BW_TRUST_PROXY=1 时才信 X-Forwarded-For） */
export function clientIP(req, trustProxy = false) {
  if (trustProxy && req.headers && typeof req.headers['x-forwarded-for'] === 'string') {
    const first = req.headers['x-forwarded-for'].split(',')[0].trim();
    if (first) return first;
  }
  const address = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
  return address.replace(/^::ffff:/, '');
}

/** 登录失败限流（进程内存；重启清零） */
export class LoginRateLimiter {
  /**
   * @param {{ max?: number, windowMs?: number, now?: () => number }} options
   */
  constructor(options = {}) {
    this.max = Number.isFinite(Number(options.max)) ? Number(options.max) : MAX_LOGIN_FAILURES;
    this.windowMs = Number.isFinite(Number(options.windowMs))
      ? Number(options.windowMs)
      : LOGIN_FAILURE_WINDOW_MS;
    this.now = options.now || (() => Date.now());
    this.failures = new Map();
  }

  /** @returns {{ retryAfterMs:number } | null} */
  blocked(ip) {
    const entry = this.failures.get(ip);
    if (!entry) return null;
    const now = this.now();
    if (now - entry.startedAt >= this.windowMs) {
      this.failures.delete(ip);
      return null;
    }
    if (entry.count < this.max) return null;
    return { retryAfterMs: Math.max(0, this.windowMs - (now - entry.startedAt)) };
  }

  recordFailure(ip) {
    const now = this.now();
    const entry = this.failures.get(ip);
    if (!entry || now - entry.startedAt >= this.windowMs) {
      this.failures.set(ip, { count: 1, startedAt: now });
      return;
    }
    entry.count += 1;
  }

  reset(ip) {
    this.failures.delete(ip);
  }

  clear() {
    this.failures.clear();
  }
}
