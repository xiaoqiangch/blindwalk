/**
 * 步迷 Walkaholic · 账号服务 — Sign in with Apple 校验
 *
 * Apple 给客户端的 `identityToken` 是 RS256 的 JWT，服务端**必须自己验签名**，
 * 不能只解 base64 就信 —— 那样谁都能伪造一个 sub 登录任意账号。
 *
 * 校验项（Apple 官方要求）：
 *   - 签名：用 https://appleid.apple.com/auth/keys 的公钥验（按 kid 匹配）
 *   - iss === https://appleid.apple.com
 *   - aud === 你的 client_id（iOS 就是 Bundle ID）
 *   - exp > now（允许 60 秒时钟偏差）
 *   - nonce：客户端传了就必须等于 SHA256(rawNonce)
 *
 * 零依赖：node:crypto 的 createPublicKey({ format: 'jwk' }) + verify
 */

import crypto from 'node:crypto';

export const APPLE_ISSUER = 'https://appleid.apple.com';
export const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const JWKS_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;

export class AppleAuthError extends Error {
  constructor(message, code, status = 401) {
    super(message);
    this.name = 'AppleAuthError';
    this.code = code;
    this.status = status;
  }
}

function base64UrlDecode(input) {
  const text = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = text + '='.repeat((4 - (text.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function base64UrlJson(input) {
  try {
    return JSON.parse(base64UrlDecode(input).toString('utf8'));
  } catch (_) {
    return null;
  }
}

/** 拆 JWT（不验签）；格式不对返回 null */
export function decodeJwt(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const header = base64UrlJson(parts[0]);
  const payload = base64UrlJson(parts[1]);
  if (!header || !payload) return null;
  return {
    header,
    payload,
    signature: base64UrlDecode(parts[2]),
    signedPart: parts[0] + '.' + parts[1]
  };
}

/** SHA256(nonce) 的 hex；Apple payload.nonce 就是这个值 */
export function hashNonce(nonce) {
  if (typeof nonce !== 'string' || nonce.length === 0) return '';
  return crypto.createHash('sha256').update(nonce, 'utf8').digest('hex');
}

/** 从 JWKS 里按 kid 找公钥；找不到抛错（key 轮换时会被下一步刷新救回） */
function keyForKid(jwks, kid) {
  const keys = (jwks && Array.isArray(jwks.keys)) ? jwks.keys : [];
  for (const jwk of keys) {
    if (jwk && jwk.kid === kid) return crypto.createPublicKey({ key: jwk, format: 'jwk' });
  }
  return null;
}

/**
 * 校验 identityToken。
 * @param {{ clientId: string, token: string, nonce?: string, now?: () => number,
 *           fetchImpl?: typeof fetch, jwksCache?: { data: object, at: number } }} options
 * @returns {Promise<{ sub: string, email: string|null, emailVerified: boolean,
 *                     isPrivateEmail: boolean, aud: string }>}
 */
export async function verifyIdentityToken(options = {}) {
  const clientId = String(options.clientId || '').trim();
  if (clientId.length === 0) {
    throw new AppleAuthError(
      '服务端没有配置 Apple client_id（WA_APPLE_CLIENT_ID）',
      'APPLE_NOT_CONFIGURED',
      503
    );
  }
  const decoded = decodeJwt(options.token);
  if (!decoded) {
    throw new AppleAuthError('identityToken 格式不对', 'APPLE_BAD_TOKEN', 401);
  }
  const { header, payload, signature, signedPart } = decoded;
  if (header.alg !== 'RS256') {
    throw new AppleAuthError('不支持的签名算法：' + header.alg, 'APPLE_BAD_TOKEN', 401);
  }
  const kid = header.kid;
  if (typeof kid !== 'string' || kid.length === 0) {
    throw new AppleAuthError('identityToken 缺少 kid', 'APPLE_BAD_TOKEN', 401);
  }

  // 1) 拿公钥（1 小时缓存；验签失败且缓存命中时强制刷新一次，处理 Apple 轮换）
  const now = options.now || (() => Date.now());
  const fetchImpl = options.fetchImpl || fetch;
  const cache = options.jwksCache;
  const fetchJwks = async () => {
    const response = await fetchImpl(APPLE_JWKS_URL, { method: 'GET' });
    if (!response || !response.ok) throw new AppleAuthError('取不到 Apple 公钥', 'APPLE_JWKS_FAILED', 502);
    const data = await response.json();
    if (cache) {
      cache.data = data;
      cache.at = now();
    }
    return data;
  };

  let jwks = cache && cache.data && (now() - cache.at) < JWKS_TTL_MS ? cache.data : null;
  if (!jwks) jwks = await fetchJwks();
  let key = keyForKid(jwks, kid);
  if (!key) {
    jwks = await fetchJwks();
    key = keyForKid(jwks, kid);
  }
  if (!key) {
    throw new AppleAuthError('Apple 公钥里没有这个 kid', 'APPLE_BAD_TOKEN', 401);
  }

  // 2) 验签名
  let valid = false;
  try {
    valid = crypto.verify(
      'RSA-SHA256',
      Buffer.from(signedPart, 'utf8'),
      key,
      signature
    );
  } catch (_) {
    valid = false;
  }
  if (!valid) {
    // 缓存过期 / 刚轮换：清缓存再验一次
    const fresh = await fetchJwks();
    const freshKey = keyForKid(fresh, kid);
    if (freshKey) {
      try {
        valid = crypto.verify('RSA-SHA256', Buffer.from(signedPart, 'utf8'), freshKey, signature);
      } catch (_) {
        valid = false;
      }
    }
  }
  if (!valid) {
    throw new AppleAuthError('identityToken 签名不正确', 'APPLE_BAD_SIGNATURE', 401);
  }

  // 3) 声明校验
  if (payload.iss !== APPLE_ISSUER) {
    throw new AppleAuthError('iss 不是 Apple', 'APPLE_BAD_ISSUER', 401);
  }
  if (String(payload.aud || '') !== clientId) {
    throw new AppleAuthError('aud 与 client_id 不匹配', 'APPLE_BAD_AUDIENCE', 401);
  }
  const nowSeconds = Math.floor(now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_SECONDS < nowSeconds) {
    throw new AppleAuthError('identityToken 已过期', 'APPLE_EXPIRED', 401);
  }
  if (typeof payload.iat === 'number' && payload.iat - CLOCK_SKEW_SECONDS > nowSeconds) {
    throw new AppleAuthError('identityToken 签发时间在未来', 'APPLE_BAD_TOKEN', 401);
  }
  if (options.nonce) {
    const expected = hashNonce(String(options.nonce));
    if (!expected || payload.nonce !== expected) {
      throw new AppleAuthError('nonce 不匹配（可能被重放）', 'APPLE_BAD_NONCE', 401);
    }
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new AppleAuthError('identityToken 没有 sub', 'APPLE_BAD_TOKEN', 401);
  }

  return {
    sub: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    isPrivateEmail: payload.is_private_email === true || payload.is_private_email === 'true',
    aud: String(payload.aud)
  };
}
