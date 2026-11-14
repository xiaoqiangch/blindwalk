/**
 * 步迷 Walkaholic · 账号服务（零依赖 Node.js）
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
 * 可用环境变量（`WA_` 与早期的 `BW_` 两个前缀都认，WA_ 优先）：
 *   PORT=8803  HOST=127.0.0.1
 *   WA_DATA_DIR=./data（默认 account/data）
 *   WA_DB_FILENAME=walkaholic-users.db（默认按已存在的库名自动选择）
 *   WA_ALLOWED_ORIGINS=http://a.com,http://b.com（不设 = 回显任意 Origin，便于本地预览）
 *   WA_COOKIE_SECURE=1（部署 HTTPS 时加 Secure；本地 http 不要开）
 *   WA_TRUST_PROXY=1（放在反向代理后时信任 X-Forwarded-For）
 */

import crypto from 'node:crypto';
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
import {
  SurpriseError,
  createSurprise,
  listNearby,
  listMine,
  claimSurprise
} from './surprises.mjs';
import {
  WeChatError,
  exchangeCode as wechatExchangeCode,
  fetchProfile as wechatFetchProfile,
  publicConfig as wechatPublicConfig,
  resolveConfig as resolveWeChatConfig
} from './wechat.mjs';
import { AccountSettings, SettingsError } from './settings.mjs';
import { AppleAuthError, verifyIdentityToken } from './apple.mjs';
import {
  SmsError,
  SmsCodeStore,
  generateCode,
  publicSmsConfig,
  resolveSmsConfig,
  sendAliyunSms,
  validatePhone
} from './sms.mjs';

const __filename = fileURLToPath(import.meta.url);
const SERVER_DIR = path.dirname(__filename);
const ACCOUNT_DIR = path.dirname(SERVER_DIR);
const DEFAULT_DATA_DIR = path.join(ACCOUNT_DIR, 'data');
const DEFAULT_PORT = 8803;
const MAX_BODY_BYTES = 1024 * 1024; // 请求体硬上限 1MB
const MAX_PROFILE_BYTES = 256 * 1024; // profile 整包上限 256KB（契约）
const MAX_PLACE_PHOTO_BYTES = 600 * 1024; // 到达照片上限 600KB（客户端压到 ~150KB）
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

/** 微信昵称 → 合法用户名（保留中英文数字下划线，其余去掉）。
 *  中文名两个字很常见（「小明」），不能按 3 个字符卡。 */
function sanitizeWeChatUsername(nickname) {
  if (typeof nickname !== 'string') return '';
  const cleaned = nickname
    .trim()
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9_]/g, '')
    .slice(0, 20);
  if (cleaned.length === 0) return '';
  const hasCJK = /[\u4e00-\u9fa5]/.test(cleaned);
  return cleaned.length >= (hasCJK ? 2 : 3) ? cleaned : '';
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
  if (error instanceof SurpriseError) {
    sendJson(req, res, error.status, { error: error.message, code: error.code });
    return;
  }
  if (error instanceof WeChatError) {
    sendJson(req, res, error.status, { error: error.message, code: error.code });
    return;
  }
  if (error instanceof SettingsError) {
    sendJson(req, res, error.status, { error: error.message, code: error.code });
    return;
  }
  if (error instanceof AppleAuthError) {
    sendJson(req, res, error.status || 401, { error: error.message, code: error.code });
    return;
  }
  if (error instanceof SmsError) {
    sendJson(req, res, error.status || 400, { error: error.message, code: error.code });
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
/**
 * 读取一个环境变量，两个前缀都认。
 * 早期部署（步谜 / Bumia）用 BW_，现在用 WA_；BW_ 作为兜底，避免改名后老部署静默失效。
 */
function envAny(env, name) {
  const primary = env['WA_' + name];
  if (primary !== undefined && String(primary).trim() !== '') return primary;
  const legacy = env['BW_' + name];
  if (legacy !== undefined && String(legacy).trim() !== '') return legacy;
  return primary;
}

export function createServer(options = {}) {
  const env = options.env || process.env;
  const now = options.now || (() => Date.now());
  const dataDir = path.resolve(options.dataDir || envAny(env, 'DATA_DIR') || DEFAULT_DATA_DIR);
  const store = options.store || new AccountStore({
    dataDir,
    dbFileName: options.dbFileName || envAny(env, 'DB_FILENAME')
  });
  const limiter = options.rateLimiter || new LoginRateLimiter({ now: now });
  const trustProxy = boolEnv(envAny(env, 'TRUST_PROXY'));
  const cookieSecure = boolEnv(envAny(env, 'COOKIE_SECURE'));
  // 前端与账号服务不同域（GitHub Pages 等）时必须开：SameSite=None; Secure
  const cookieCrossSite = boolEnv(envAny(env, 'COOKIE_CROSS_SITE'));
  const cookieOptions = { secure: cookieSecure, crossSite: cookieCrossSite };

  const allowedOrigins = String(envAny(env, 'ALLOWED_ORIGINS') || '').trim();
  // 运行期设置（微信 AppID / Secret 等）：数据库优先，环境变量兜底
  const settings = options.settings || new AccountSettings({ db: store.db, env: env, now: now });

  // 短信验证码：配置来自环境变量（AccessKey 这类运维凭证不放数据库）
  const smsConfig = () => options.smsConfig || resolveSmsConfig(env);
  const smsStore = options.smsStore || new SmsCodeStore({ db: store.db, now: now });
  const smsSendCounters = new Map();  // 同一 IP 的发送计数
  const appleClientId = () => options.appleClientId || envAny(env, 'APPLE_CLIENT_ID') || 'com.walkaholic.app';
  const appleJwksCache = { data: null, at: 0 };

  // 微信登录：AppSecret 只在服务端；未配置时接口明确返回未启用，不假装可用。
  // 配置来源优先级：数据库（后台可在线改） > 环境变量。
  const readWeChatConfig = () => {
    const base = resolveWeChatConfig(env);
    const appid = settings.resolve('wechat.appid') || base.appid;
    const secret = settings.resolve('wechat.secret') || base.secret;
    const missing = [];
    if (!appid) missing.push('WA_WECHAT_APPID');
    if (!secret) missing.push('WA_WECHAT_SECRET');
    return Object.assign({}, base, {
      appid: appid,
      secret: secret,
      enabled: missing.length === 0,
      missing: missing,
      universalLink: settings.resolve('wechat.universalLink') || base.universalLink
    });
  };
  // 测试可以注入固定配置；生产每次请求现算，后台改完立即生效
  const wechatConfig = () => options.wechatConfig || readWeChatConfig();
  const wechatFetch = options.wechatFetch || fetch;
  // /api/auth/providers 里用（避免在路由里重复算 wechat 配置）
  const publicWechatConfigShim = () => wechatPublicConfig(wechatConfig());
  const version = '1';

  function sessionTokenFromRequest(req) {
    const cookies = parseCookies(req.headers ? req.headers.cookie : undefined);
    return cookies.wa_uid || cookies.bw_uid;
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

  async function handleApi(req, res, pathname, searchParams) {
    const method = req.method || 'GET';

    if (pathname === '/api/health' && method === 'GET') {
      sendJson(req, res, 200, { ok: true, version: version, time: now() });
      return;
    }

    // ---------- 后台设置（需要管理令牌；后台 UI 用） ----------
    if (pathname === '/api/admin/settings' && (method === 'GET' || method === 'PUT')) {
      settings.requireAdminToken(req.headers['x-wa-admin-token']);
      if (method === 'GET') {
        sendJson(req, res, 200, settings.adminView());
        return;
      }
      const body = await readBody(req);
      const view = settings.update(body);
      sendJson(req, res, 200, Object.assign({ ok: true, restarted: false }, view));
      return;
    }

    // ---------- 登录方式可用性（客户端启动时问一次） ----------
    if (pathname === '/api/auth/providers' && method === 'GET') {
      sendJson(req, res, 200, {
        ok: true,
        providers: {
          password: { enabled: true },
          apple: { enabled: true, clientId: appleClientId() },
          sms: publicSmsConfig(Object.assign({}, env, options.smsEnv || {})),
          wechat: publicWechatConfigShim()
        }
      });
      return;
    }

    // ---------- Sign in with Apple ----------
    if (pathname === '/api/auth/apple' && method === 'POST') {
      const body = await readBody(req);
      const identity = await verifyIdentityToken({
        clientId: appleClientId(),
        token: body.identityToken,
        nonce: body.nonce,
        now: now,
        fetchImpl: options.appleFetch || fetch,
        jwksCache: appleJwksCache
      });

      const bound = store.findIdentity('apple', identity.sub);
      if (bound) {
        const existing = store.findUserById(bound.userId);
        if (existing) {
          store.bindIdentity('apple', identity.sub, existing.id, {
            nickname: body.fullName || null,
            avatar: null
          }, now());
          createLoginResponse(req, res, existing);
          return;
        }
      }

      // 新用户：优先用 Apple 给的姓名；没有就用「apple_」+ sub 前缀
      const base = sanitizeWeChatUsername(body.fullName) || ('apple_' + identity.sub.slice(0, 8));
      let username = base;
      let attempt = 1;
      while (store.findUserByUsername(username)) {
        attempt += 1;
        username = (base.slice(0, 18) + '_' + attempt).slice(0, 24);
        if (attempt > 50) throw new ApiError('用户名冲突过多，请稍后再试', 'USERNAME_TAKEN', 409);
      }
      const placeholder = generateSessionToken();
      const hashed = hashPassword(placeholder);
      const user = store.createUser(username, hashed.hash, hashed.salt, now());
      store.bindIdentity('apple', identity.sub, user.id, {
        nickname: body.fullName || null,
        avatar: null
      }, now());
      createLoginResponse(req, res, user);
      return;
    }

    // ---------- 短信验证码 ----------
    if (pathname === '/api/auth/sms/send' && method === 'POST') {
      const body = await readBody(req);
      const phone = validatePhone(body.phone);
      const config = smsConfig();
      if (!config.enabled) {
        throw new SmsError(
          '服务端还没配置短信服务（缺 ' + config.missing.join('、') + '）',
          'SMS_NOT_CONFIGURED',
          503
        );
      }
      if (smsStore.recentSendCount(phone) >= 5) {
        throw new SmsError('这个号码 10 分钟内发得太频繁，请稍后再试', 'SMS_TOO_MANY_SENDS', 429);
      }
      const ip = clientIP(req, trustProxy);
      const ipCount = (smsSendCounters.get(ip) || []).filter((t) => now() - t < 10 * 60 * 1000).length;
      if (ipCount >= 20) {
        throw new SmsError('发送太频繁，请稍后再试', 'SMS_TOO_MANY_SENDS', 429);
      }

      const code = generateCode();
      let result;
      if (config.devMode) {
        // 开发模式：不真的发短信，日志里打印（绝不进生产）
        result = { ok: true, requestId: null, error: '' };
        console.log('[sms][dev]', phone, '验证码', code);
      } else {
        result = await sendAliyunSms(
          config, phone, code, options.smsFetch || fetch, now
        );
      }
      if (!result.ok) {
        throw new SmsError('短信发送失败：' + result.error, 'SMS_SEND_FAILED', 502);
      }
      smsStore.save(phone, code);
      smsStore.recordSend(phone);
      const times = smsSendCounters.get(ip) || [];
      times.push(now());
      smsSendCounters.set(ip, times);
      sendJson(req, res, 200, { ok: true, ttlSeconds: 300, devMode: config.devMode });
      return;
    }

    if (pathname === '/api/auth/sms/verify' && method === 'POST') {
      const body = await readBody(req);
      const phone = validatePhone(body.phone);
      const code = String(body.code || '').trim();
      if (!/^\d{6}$/.test(code)) {
        throw new SmsError('验证码是 6 位数字', 'BAD_CODE', 400);
      }
      const checked = smsStore.verify(phone, code);
      if (!checked.ok) {
        const map = {
          SMS_NO_CODE: ['还没发送验证码，或已经用过了', 400],
          SMS_EXPIRED: ['验证码已过期，请重新获取', 400],
          SMS_WRONG_CODE: ['验证码不对', 400],
          SMS_TOO_MANY_ATTEMPTS: ['尝试次数过多，请重新获取', 429]
        };
        const entry = map[checked.code] || ['验证失败', 400];
        throw new SmsError(entry[0], checked.code, entry[1]);
      }

      // 手机号 → 账号：已绑定就登录，没绑就建号（用户名 = 手机号打码形式，避免暴露）
      const externalId = 'phone:' + phone;
      const bound = store.findIdentity('phone', externalId);
      if (bound) {
        const existing = store.findUserById(bound.userId);
        if (existing) {
          createLoginResponse(req, res, existing);
          return;
        }
      }
      const masked = 'u' + phone.slice(-4) + '_' + crypto.randomBytes(2).toString('hex');
      let username = masked;
      let attempt = 1;
      while (store.findUserByUsername(username)) {
        attempt += 1;
        username = (masked + attempt).slice(0, 24);
        if (attempt > 50) throw new ApiError('用户名冲突过多，请稍后再试', 'USERNAME_TAKEN', 409);
      }
      const placeholder = generateSessionToken();
      const hashed = hashPassword(placeholder);
      const user = store.createUser(username, hashed.hash, hashed.salt, now());
      store.bindIdentity('phone', externalId, user.id, { nickname: null, avatar: null }, now());
      createLoginResponse(req, res, user);
      return;
    }

    if (pathname === '/api/auth/wechat/config' && method === 'GET') {
      // 客户端启动时问一次：能不能用微信登录、appid 是多少（不含 secret）
      sendJson(req, res, 200, { ok: true, wechat: wechatPublicConfig(wechatConfig()) });
      return;
    }

    if (pathname === '/api/auth/wechat' && method === 'POST') {
      const body = await readBody(req);
      const config = wechatConfig();
      const auth = await wechatExchangeCode(config, body.code, wechatFetch);
      const profile = await wechatFetchProfile(config, auth, wechatFetch);

      // 已绑定的老用户 → 直接登录
      const bound = store.findIdentity('wechat', auth.openid);
      if (bound) {
        const existing = store.findUserById(bound.userId);
        if (existing) {
          store.bindIdentity('wechat', auth.openid, existing.id, profile, now());
          createLoginResponse(req, res, existing);
          return;
        }
        // 用户被删过：identity 成了孤儿，走下面建新号
      }

      // 新用户：用户名优先用微信昵称（清洗成合法用户名），冲突就加后缀
      const base = sanitizeWeChatUsername(profile.nickname) || ('wx' + auth.openid.slice(-8));
      let username = base;
      let attempt = 1;
      while (store.findUserByUsername(username)) {
        attempt += 1;
        username = (base.slice(0, 18) + '_' + attempt).slice(0, 24);
        if (attempt > 50) throw new ApiError('用户名冲突过多，请稍后再试', 'USERNAME_TAKEN', 409);
      }
      // 微信用户不需要本地密码：写一个随机长串，谁也不知道（也就不能用密码登录）
      const placeholder = generateSessionToken();
      const hashed = hashPassword(placeholder);
      const user = store.createUser(username, hashed.hash, hashed.salt, now());
      store.bindIdentity('wechat', auth.openid, user.id, profile, now());
      createLoginResponse(req, res, user);
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

    // ---------- 到达照片（「到了这里」的一张实拍，按地点存） ----------
    if (pathname === '/api/photos' && method === 'POST') {
      const current = requireUser(req);
      const body = await readBody(req);
      const placeId = String(body.placeId || '').trim();
      const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';
      if (!placeId || placeId.length > 160) {
        throw new ApiError('placeId 不合法', 'BAD_REQUEST', 400);
      }
      const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
      if (!match) {
        throw new ApiError('照片格式不支持（需要 JPEG/PNG data URL）', 'BAD_PHOTO', 400);
      }
      const bytes = Buffer.byteLength(match[2], 'base64');
      if (bytes > MAX_PLACE_PHOTO_BYTES) {
        throw new ApiError('照片太大（上限 600KB）', 'PHOTO_TOO_LARGE', 413, {
          bytes: bytes, maxBytes: MAX_PLACE_PHOTO_BYTES
        });
      }
      store.savePlacePhoto(current.user.id, placeId, dataUrl, now());
      sendJson(req, res, 200, {
        ok: true,
        path: '/api/photos/' + encodeURIComponent(placeId),
        bytes: bytes
      });
      return;
    }

    if (pathname.startsWith('/api/photos/') && method === 'GET') {
      const current = requireUser(req);
      const placeId = decodeURIComponent(pathname.slice('/api/photos/'.length));
      const row = store.getPlacePhoto(current.user.id, placeId);
      if (!row) throw new ApiError('还没有这张照片', 'NOT_FOUND', 404);
      const match = /^data:image\/(jpeg|png);base64,(.+)$/.exec(row.data);
      if (!match) throw new ApiError('照片数据损坏', 'BAD_PHOTO', 500);
      const buffer = Buffer.from(match[2], 'base64');
      res.writeHead(200, {
        'Content-Type': match[1] === 'png' ? 'image/png' : 'image/jpeg',
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, max-age=86400'
      });
      res.end(buffer);
      return;
    }

    // ---------- 惊喜（跨用户共享，「附近的惊喜」的数据来源） ----------
    if (pathname === '/api/surprises' && method === 'GET') {
      let viewer = null;
      try { viewer = requireUser(req).user; } catch (_) { viewer = null; }
      sendJson(req, res, 200, listNearby(store, searchParams, viewer));
      return;
    }

    if (pathname === '/api/surprises' && method === 'POST') {
      // 匿名也能埋（靠设备标识区分作者），未登录不像以前那样直接 401
      let viewer = null;
      try { viewer = requireUser(req).user; } catch (_) { viewer = null; }
      const body = await readBody(req);
      if (!viewer) {
        const device = String(req.headers['x-wa-device'] || '').trim().slice(0, 64);
        if (!device) {
          throw new ApiError('需要登录，或带上设备标识（X-WA-Device）', 'UNAUTHENTICATED', 401);
        }
        body.anonId = 'anon-' + device;
      }
      sendJson(req, res, 200, createSurprise(store, viewer, body, now));
      return;
    }

    if (pathname === '/api/surprises/mine' && method === 'GET') {
      // 登录用户按账号查；匿名用户按设备标识查（他们埋的惊喜也能收到「被找到」回执）
      let current = null;
      try { current = requireUser(req); } catch (_) { current = null; }
      const device = String(req.headers['x-wa-device'] || '').trim().slice(0, 64);
      const userId = current ? current.user.id : (device ? 'anon-' + device : null);
      if (!userId) {
        throw new ApiError('需要登录，或带上设备标识（X-WA-Device）', 'UNAUTHENTICATED', 401);
      }
      sendJson(req, res, 200, listMine(store, { id: userId }));
      return;
    }

    if (pathname.startsWith('/api/surprises/') && pathname.endsWith('/find') && method === 'POST') {
      const current = requireUser(req);
      const id = decodeURIComponent(pathname.slice('/api/surprises/'.length, -'/find'.length));
      sendJson(req, res, 200, claimSurprise(store, current.user, id, now));
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

    handleApi(req, res, parsedUrl.pathname, parsedUrl.searchParams).catch((error) => sendError(req, res, error));
  });

  server.store = store;
  server.settings = settings;
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
    console.log('步迷 Walkaholic · 账号服务');
    console.log('  接口地址  http://' + host + ':' + port + '/api/health');
    console.log('  数据目录  ' + server.options.dataDir);
    console.log('  数据库    ' + (server.store && server.store.dbPath ? server.store.dbPath : '(未创建)'));
    console.log('  Cookie    wa_uid（HttpOnly / SameSite=Lax / 30 天' +
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
