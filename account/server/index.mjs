/**
 * 盲走 BlindWalk · 账号服务（零依赖 Node.js）
 *
 * 启动：node account/server/index.mjs（默认 http://127.0.0.1:8803）
 * 存储：node:sqlite（DatabaseSync）+ WAL；密码 scrypt；会话 HttpOnly Cookie。
 *
 * CORS（契约要求，必须带凭证）：
 *   Access-Control-Allow-Origin: <请求的 Origin>   ← 回显，禁止 *
 *   Access-Control-Allow-Credentials: true
 *   Access-Control-Allow-Headers: content-type
 *   Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
 *   OPTIONS 预检 → 204
 *
 * 可用环境变量：
 *   PORT=8803  HOST=127.0.0.1
 *   BW_DATA_DIR=./data（默认 account/data）
 *   BW_ALLOWED_ORIGINS=http://a.com,http://b.com（不设 = 回显任意 Origin，便于本地预览）
 *   BW_COOKIE_SECURE=1（部署 HTTPS 时加 Secure；本地 http 不要开）
 *   BW_TRUST_PROXY=1（放在反向代理后时信任 X-Forwarded-For）
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { AccountStore } from './db.mjs';
import {
  LoginRateLimiter,
  SESSION_TTL_MS,
  clearSessionCookie,
  clientIP,
  generateSessionToken,
  hashPassword,
  parseCookies,
  sessionCookie,
  verifyPassword
} from './auth.mjs';

const __filename = fileURLToPath(import.meta.url);
const SERVER_DIR = path.dirname(__filename);
const ACCOUNT_DIR = path.dirname(SERVER_DIR);
const DEFAULT_DATA_DIR = path.join(ACCOUNT_DIR, 'data');
const DEFAULT_PORT = 8803;
const MAX_BODY_BYTES = 1024 * 1024; // 请求体硬上限 1MB
const MAX_PROFILE_BYTES = 256 * 1024; // profile 整包上限 256KB（契约）
const USERNAME_PATTERN = /^[A-Za-z0-9_\u4e00-\u9fff]{3,24}$/;
const PASSWORD_MIN_LENGTH = 6;
const PASSWORD_MAX_LENGTH = 128;

class ApiError extends Error {
  constructor(message, code = 'BAD_REQUEST', status = 400, details) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

// ============================================================
// 工具
// ============================================================

function boolEnv(value) {
  const text = String(value === undefined ? '' : value).toLowerCase();
  return text === '1' || text === 'true' || text === 'yes';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ApiError('请求体过大（上限 1MB）', 'BAD_REQUEST', 400));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new ApiError('请求体必须是 JSON 对象', 'BAD_REQUEST', 400));
          return;
        }
        resolve(parsed);
      } catch (error) {
        reject(new ApiError('请求体不是合法 JSON', 'BAD_REQUEST', 400));
      }
    });
    req.on('error', (error) => reject(error));
  });
}

function validateUsername(raw) {
  if (typeof raw !== 'string') {
    throw new ApiError('username 必须是字符串', 'BAD_REQUEST', 400);
  }
  const username = raw.trim();
  if (!USERNAME_PATTERN.test(username)) {
    throw new ApiError('username 需为 3–24 个字母、数字、下划线或中文', 'BAD_REQUEST', 400);
  }
  return username;
}

function validatePassword(raw, field = 'password') {
  if (typeof raw !== 'string') {
    throw new ApiError(field + ' 必须是字符串', 'BAD_REQUEST', 400);
  }
  if (raw.length < PASSWORD_MIN_LENGTH) {
    throw new ApiError(field + ' 至少 ' + PASSWORD_MIN_LENGTH + ' 位', 'BAD_REQUEST', 400);
  }
  if (raw.length > PASSWORD_MAX_LENGTH) {
    throw new ApiError(field + ' 不能超过 ' + PASSWORD_MAX_LENGTH + ' 位', 'BAD_REQUEST', 400);
  }
  return raw;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sendJson(req, res, status, payload, extraHeaders) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const headers = Object.assign({}, corsHeaders(req), {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  const extraKeys = Object.keys(extraHeaders || {});
  for (const key of extraKeys) headers[key] = extraHeaders[key];
  res.writeHead(status, headers);
  res.end(body);
}

function sendError(req, res, error) {
  if (error instanceof ApiError) {
    const payload = { error: error.message, code: error.code };
    if (error.details !== undefined) payload.details = error.details;
    sendJson(req, res, error.status, payload);
    return;
  }
  const message = error && error.message ? String(error.message) : '服务器内部错误';
  sendJson(req, res, 500, { error: message, code: 'INTERNAL' });
}

// ============================================================
// CORS
// ============================================================

function corsHeaders(req) {
  const headers = {
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    Vary: 'Origin'
  };
  const origin = req.headers ? req.headers.origin : undefined;
  if (typeof origin !== 'string' || origin.length === 0) {
    // 没有 Origin（curl / 同源请求）：不回 *，只保留 methods/headers
    return headers;
  }
  const allowList = String((req.corsAllowedOrigins) || '').trim();
  if (allowList) {
    const allowed = allowList.split(',').map((item) => item.trim()).filter(Boolean);
    if (!allowed.includes(origin)) return headers;
  }
  headers['Access-Control-Allow-Origin'] = origin;
  headers['Access-Control-Allow-Credentials'] = 'true';
  return headers;
}

// ============================================================
// HTTP 服务
// ============================================================

/**
 * @param {{ dataDir?: string, store?: AccountStore, rateLimiter?: LoginRateLimiter,
 *           env?: object, now?: () => number }} options
 */
export function createServer(options = {}) {
  const env = options.env || process.env;
  const now = options.now || (() => Date.now());
  const dataDir = path.resolve(options.dataDir || env.BW_DATA_DIR || DEFAULT_DATA_DIR);
  const store = options.store || new AccountStore({ dataDir });
  const limiter = options.rateLimiter || new LoginRateLimiter({ now: now });
  const trustProxy = boolEnv(env.BW_TRUST_PROXY);
  const cookieSecure = boolEnv(env.BW_COOKIE_SECURE);
  // 前端与账号服务不同域（GitHub Pages 等）时必须开：SameSite=None; Secure
  const cookieCrossSite = boolEnv(env.BW_COOKIE_CROSS_SITE);
  const cookieOptions = { secure: cookieSecure, crossSite: cookieCrossSite };

  const allowedOrigins = String(env.BW_ALLOWED_ORIGINS || '').trim();
  const version = '1';

  function sessionTokenFromRequest(req) {
    const cookies = parseCookies(req.headers ? req.headers.cookie : undefined);
    return cookies.bw_uid;
  }

  function requireUser(req) {
    const token = sessionTokenFromRequest(req);
    const user = token === undefined ? null : store.findUserByToken(token, now());
    if (!user) throw new ApiError('未登录或会话已过期', 'UNAUTHENTICATED', 401);
    return { user: user, token: token };
  }

  function createLoginResponse(req, res, user) {
    const token = generateSessionToken();
    const createdAt = now();
    store.createSession(token, user.id, createdAt, createdAt + SESSION_TTL_MS);
    store.pruneExpiredSessions(createdAt);
    sendJson(req, res, 200, {
      ok: true,
      user: { id: user.id, username: user.username, createdAt: user.createdAt }
    }, {
      'Set-Cookie': sessionCookie(token, cookieOptions)
    });
  }

  async function handleApi(req, res, pathname) {
    const method = req.method || 'GET';

    if (pathname === '/api/health' && method === 'GET') {
      sendJson(req, res, 200, { ok: true, version: version, time: now() });
      return;
    }

    if (pathname === '/api/auth/register' && method === 'POST') {
      const body = await readBody(req);
      const username = validateUsername(body.username);
      const password = validatePassword(body.password);
      if (store.findUserByUsername(username)) {
        throw new ApiError('用户名已被占用', 'USERNAME_TAKEN', 409);
      }
      const hashed = hashPassword(password);
      let user;
      try {
        user = store.createUser(username, hashed.hash, hashed.salt, now());
      } catch (error) {
        if (String(error.message || '').includes('UNIQUE')) {
          throw new ApiError('用户名已被占用', 'USERNAME_TAKEN', 409);
        }
        throw error;
      }
      createLoginResponse(req, res, user);
      return;
    }

    if (pathname === '/api/auth/login' && method === 'POST') {
      const ip = clientIP(req, trustProxy);
      const blocked = limiter.blocked(ip);
      if (blocked) {
        throw new ApiError('登录尝试次数过多，请稍后再试', 'TOO_MANY_ATTEMPTS', 429, blocked);
      }
      const body = await readBody(req);
      if (typeof body.username !== 'string' || body.username.trim().length === 0) {
        throw new ApiError('username 必填', 'BAD_REQUEST', 400);
      }
      if (typeof body.password !== 'string' || body.password.length === 0) {
        throw new ApiError('password 必填', 'BAD_REQUEST', 400);
      }
      const lookup = store.findUserByUsername(body.username.trim());
      const valid = lookup !== null &&
        verifyPassword(body.password, lookup.passwordSalt, lookup.passwordHash);
      if (!valid) {
        limiter.recordFailure(ip);
        throw new ApiError('用户名或密码错误', 'BAD_CREDENTIALS', 401);
      }
      limiter.reset(ip);
      createLoginResponse(req, res, lookup);
      return;
    }

    if (pathname === '/api/auth/logout' && method === 'POST') {
      const token = sessionTokenFromRequest(req);
      if (token !== undefined) store.deleteSession(token);
      sendJson(req, res, 200, { ok: true }, {
        'Set-Cookie': clearSessionCookie(cookieOptions)
      });
      return;
    }

    if (pathname === '/api/auth/me' && method === 'GET') {
      const current = requireUser(req);
      sendJson(req, res, 200, {
        user: current.user,
        profile: store.getProfile(current.user.id)
      });
      return;
    }

    if (pathname === '/api/me/profile' && method === 'PUT') {
      const current = requireUser(req);
      const body = await readBody(req);
      if (!isPlainObject(body.profile)) {
        throw new ApiError('profile 必须是 JSON 对象', 'BAD_REQUEST', 400);
      }
      const serialized = JSON.stringify(body.profile);
      const bytes = Buffer.byteLength(serialized, 'utf8');
      if (bytes > MAX_PROFILE_BYTES) {
        throw new ApiError(
          'profile 超过大小上限（256KB）',
          'BAD_REQUEST',
          400,
          { bytes: bytes, maxBytes: MAX_PROFILE_BYTES }
        );
      }
      const saved = store.saveProfile(current.user.id, body.profile, now());
      sendJson(req, res, 200, { ok: true, savedAt: saved.savedAt, bytes: saved.bytes });
      return;
    }

    if (pathname === '/api/me' && method === 'DELETE') {
      const current = requireUser(req);
      const body = await readBody(req);
      if (typeof body.password !== 'string' || body.password.length === 0) {
        throw new ApiError('删除账号需要 password 二次确认', 'BAD_REQUEST', 400);
      }
      const lookup = store.findUserById(current.user.id);
      if (!lookup || !verifyPassword(body.password, lookup.passwordSalt, lookup.passwordHash)) {
        throw new ApiError('密码错误', 'BAD_CREDENTIALS', 401);
      }
      store.deleteUserCascade(current.user.id);
      sendJson(req, res, 200, { ok: true }, {
        'Set-Cookie': clearSessionCookie(cookieOptions)
      });
      return;
    }

    throw new ApiError('接口不存在：' + method + ' ' + pathname, 'NOT_FOUND', 404);
  }

  const server = http.createServer((req, res) => {
    // 让 CORS 逻辑能读到允许来源配置
    req.corsAllowedOrigins = allowedOrigins;

    if ((req.method || 'GET') === 'OPTIONS') {
      // 预检：直接 204（CORS 头已由 corsHeaders 提供）
      const headers = corsHeaders(req);
      headers['Access-Control-Max-Age'] = '600';
      res.writeHead(204, headers);
      res.end();
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
    } catch (error) {
      sendJson(req, res, 400, { error: 'URL 不合法', code: 'BAD_REQUEST' });
      return;
    }

    handleApi(req, res, parsedUrl.pathname).catch((error) => sendError(req, res, error));
  });

  server.store = store;
  server.limiter = limiter;
  server.options = { dataDir, cookieSecure, trustProxy, allowedOrigins };
  server.on('close', () => {
    store.close();
  });
  return server;
}

// ============================================================
// 启动
// ============================================================

function loadDotEnv(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index <= 0) continue;
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    // account/.env 可选
  }
}

export function startServer(options = {}) {
  const env = options.env || process.env;
  const port = Number(options.port || env.PORT || DEFAULT_PORT);
  const host = options.host || env.HOST || '127.0.0.1';
  const server = createServer(options);
  server.listen(port, host, () => {
    console.log('盲走 BlindWalk · 账号服务');
    console.log('  接口地址  http://' + host + ':' + port + '/api/health');
    console.log('  数据目录  ' + server.options.dataDir);
    console.log('  Cookie    bw_uid（HttpOnly / SameSite=Lax / 30 天' +
      (server.options.cookieSecure ? ' / Secure' : ' / 本地 http 不加 Secure') + '）');
    console.log('  CORS      ' + (server.options.allowedOrigins
      ? '仅允许 ' + server.options.allowedOrigins
      : '回显请求 Origin（带 Allow-Credentials）'));
  });
  server.on('error', (error) => {
    console.error('账号服务启动失败：' + error.message);
    process.exitCode = 1;
  });
  return server;
}

const isMain = process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  loadDotEnv(path.join(ACCOUNT_DIR, '.env'));
  startServer();
}
