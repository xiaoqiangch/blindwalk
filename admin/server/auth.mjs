/**
 * 步迷 Walkaholic · 兴趣点管理后台 v2 — 登录鉴权
 *
 * - 密码：环境变量 WA_ADMIN_PASSWORD 优先；否则首次启动生成随机密码，
 *   scrypt（每密码独立 salt）哈希后写入 admin/data/admin.secret.json（0600），启动日志打印一次
 * - 会话：32 字节随机 token，HttpOnly + SameSite=Strict + Path=/，12 小时；
 *   持久化到 admin/data/sessions.json（重启不丢）
 * - 登录失败限流：同一 IP 10 分钟内失败 5 次 → 429 TOO_MANY_ATTEMPTS
 *
 * 零依赖：node:crypto / node:fs / node:path
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { PoiError } from './poi.mjs';

export const SESSION_COOKIE = 'wa_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const MAX_LOGIN_FAILURES = 5;
export const LOGIN_FAILURE_WINDOW_MS = 10 * 60 * 1000;
export const PASSWORD_MIN_LENGTH = 6;
export const SCRYPT_KEYLEN = 64;

const SECRET_FILE = 'admin.secret.json';
const SESSIONS_FILE = 'sessions.json';

export function hashPassword(password, saltHex) {
  const salt = saltHex === undefined ? crypto.randomBytes(16) : Buffer.from(saltHex, 'hex');
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  const result = {
    salt: salt.toString('hex'),
    hash: hash.toString('hex')
  };
  return result;
}

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

/** 生成 12 位随机密码（去掉易混字符） */
export function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  let password = '';
  for (let i = 0; i < bytes.length; i += 1) {
    password += alphabet.charAt(bytes[i] % alphabet.length);
  }
  return password;
}

export function parseCookies(header) {
  const cookies = {};
  if (typeof header !== 'string' || header.length === 0) return cookies;
  const parts = header.split(';');
  for (const part of parts) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

export function sessionCookie(token, maxAgeSeconds) {
  return SESSION_COOKIE + '=' + encodeURIComponent(token) +
    '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + String(maxAgeSeconds);
}

export function clearSessionCookie() {
  return SESSION_COOKIE + '=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
}

function writeFile0600(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (error) {
    // 某些文件系统不支持 chmod，不影响功能
  }
}

export class AuthManager {
  /**
   * @param {{ dataDir: string, env?: object, now?: () => number }} options
   */
  constructor(options = {}) {
    if (!options.dataDir) throw new Error('AuthManager 需要 dataDir');
    this.dataDir = path.resolve(options.dataDir);
    this.env = options.env || process.env;
    this.now = options.now || (() => Date.now());
    this.secretPath = path.join(this.dataDir, SECRET_FILE);
    this.sessionsPath = path.join(this.dataDir, SESSIONS_FILE);
    this.failures = new Map();
    this.sessions = new Map();
    this.sessionPruneTimer = null;

    this.passwordSalt = '';
    this.passwordHash = '';
    this.passwordSet = false;
    this.passwordSource = 'none';
    this.generatedPassword = '';

    this.initializePassword();
    this.loadSessions();
  }

  // ---------- 密码 ----------

  initializePassword() {
    // WA_ 优先，BW_ 兜底（线上单元用 BW_ADMIN_PASSWORD）
    const envPassword = String(this.env.WA_ADMIN_PASSWORD || this.env.BW_ADMIN_PASSWORD || '').trim();
    if (envPassword.length > 0) {
      const hashed = hashPassword(envPassword);
      this.passwordSalt = hashed.salt;
      this.passwordHash = hashed.hash;
      this.passwordSet = true;
      this.passwordSource = 'env';
      return;
    }

    if (fs.existsSync(this.secretPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.secretPath, 'utf8'));
        if (raw && typeof raw.salt === 'string' && typeof raw.hash === 'string') {
          this.passwordSalt = raw.salt;
          this.passwordHash = raw.hash;
          this.passwordSet = true;
          this.passwordSource = 'secret';
          return;
        }
      } catch (error) {
        // 坏 secret 文件：重新生成
      }
    }

    const password = generatePassword();
    const hashed = hashPassword(password);
    this.passwordSalt = hashed.salt;
    this.passwordHash = hashed.hash;
    this.passwordSet = true;
    this.passwordSource = 'generated';
    this.generatedPassword = password;
    writeFile0600(this.secretPath, JSON.stringify({
      version: 1,
      algorithm: 'scrypt',
      salt: hashed.salt,
      hash: hashed.hash,
      createdAt: this.now()
    }, null, 2));
  }

  verify(password) {
    return verifyPassword(password, this.passwordSalt, this.passwordHash);
  }

  // ---------- 会话 ----------

  loadSessions() {
    let raw;
    try {
      raw = fs.readFileSync(this.sessionsPath, 'utf8');
    } catch (error) {
      this.sessions = new Map();
      return;
    }
    let list = [];
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.sessions)) list = parsed.sessions;
    } catch (error) {
      list = [];
    }
    const now = this.now();
    const sessions = new Map();
    for (const item of list) {
      if (!item || typeof item.token !== 'string') continue;
      const expiresAt = Number(item.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= now) continue;
      sessions.set(item.token, {
        createdAt: Number(item.createdAt) || now,
        expiresAt: expiresAt
      });
    }
    this.sessions = sessions;
    // 清掉过期项后立刻落盘，避免 sessions.json 一直膨胀
    this.saveSessions();
  }

  saveSessions() {
    const list = [];
    for (const entry of this.sessions.entries()) {
      list.push({ token: entry[0], createdAt: entry[1].createdAt, expiresAt: entry[1].expiresAt });
    }
    writeFile0600(this.sessionsPath, JSON.stringify({
      version: 1,
      updatedAt: this.now(),
      sessions: list
    }, null, 2));
  }

  createSession() {
    const token = crypto.randomBytes(32).toString('hex');
    const now = this.now();
    this.sessions.set(token, { createdAt: now, expiresAt: now + SESSION_TTL_MS });
    this.saveSessions();
    return token;
  }

  getSession(token) {
    if (typeof token !== 'string' || token.length === 0) return undefined;
    const session = this.sessions.get(token);
    if (!session) return undefined;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(token);
      this.saveSessions();
      return undefined;
    }
    return session;
  }

  deleteSession(token) {
    if (typeof token !== 'string') return false;
    const existed = this.sessions.delete(token);
    if (existed) this.saveSessions();
    return existed;
  }

  tokenFromRequest(req) {
    const cookies = parseCookies(req.headers ? req.headers.cookie : undefined);
    const token = cookies[SESSION_COOKIE];
    return token === undefined ? undefined : token;
  }

  isAuthenticated(req) {
    return this.getSession(this.tokenFromRequest(req)) !== undefined;
  }

  status(req) {
    return {
      authenticated: this.isAuthenticated(req),
      passwordSet: this.passwordSet
    };
  }

  // ---------- 登录 / 登出 / 限流 ----------

  clientIP(req) {
    const forwarded = req.headers && req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
    const address = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
    return address.replace(/^::ffff:/, '');
  }

  checkRateLimit(ip) {
    const entry = this.failures.get(ip);
    if (!entry) return;
    const now = this.now();
    if (now - entry.startedAt >= LOGIN_FAILURE_WINDOW_MS) {
      this.failures.delete(ip);
      return;
    }
    if (entry.count >= MAX_LOGIN_FAILURES) {
      throw new PoiError(
        '登录尝试次数过多，请 10 分钟后再试',
        'TOO_MANY_ATTEMPTS',
        429,
        { retryAfterMs: LOGIN_FAILURE_WINDOW_MS - (now - entry.startedAt) }
      );
    }
  }

  recordFailure(ip) {
    const now = this.now();
    const entry = this.failures.get(ip);
    if (!entry || now - entry.startedAt >= LOGIN_FAILURE_WINDOW_MS) {
      this.failures.set(ip, { count: 1, startedAt: now });
      return;
    }
    entry.count += 1;
  }

  resetFailures(ip) {
    this.failures.delete(ip);
  }

  /**
   * 登录：成功返回 token。
   * @throws PoiError BAD_PASSWORD 401 / TOO_MANY_ATTEMPTS 429
   */
  login(password, req) {
    const ip = this.clientIP(req);
    this.checkRateLimit(ip);
    if (typeof password !== 'string' || password.length === 0) {
      throw new PoiError('密码不能为空', 'BAD_REQUEST', 400);
    }
    if (!this.verify(password)) {
      this.recordFailure(ip);
      throw new PoiError('密码错误', 'BAD_PASSWORD', 401);
    }
    this.resetFailures(ip);
    return this.createSession();
  }

  logout(req) {
    const token = this.tokenFromRequest(req);
    if (token !== undefined) this.deleteSession(token);
  }

  getExitWarning() {
    if (this.passwordSource === 'generated' && this.generatedPassword) {
      return '首次启动已生成管理密码：' + this.generatedPassword +
        '（只显示这一次；已保存到 admin/data/admin.secret.json）';
    }
    return '';
  }

  startPruneTimer(intervalMs = 60 * 60 * 1000) {
    if (this.sessionPruneTimer) return this.sessionPruneTimer;
    this.sessionPruneTimer = setInterval(() => {
      const now = this.now();
      let changed = false;
      for (const entry of Array.from(this.sessions.entries())) {
        if (entry[1].expiresAt <= now) {
          this.sessions.delete(entry[0]);
          changed = true;
        }
      }
      if (changed) this.saveSessions();
    }, intervalMs);
    if (typeof this.sessionPruneTimer.unref === 'function') this.sessionPruneTimer.unref();
    return this.sessionPruneTimer;
  }

  stopPruneTimer() {
    if (this.sessionPruneTimer) {
      clearInterval(this.sessionPruneTimer);
      this.sessionPruneTimer = null;
    }
  }
}
