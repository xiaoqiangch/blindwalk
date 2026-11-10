// 纯函数（Node 与 Worker 共用）：密码哈希、token、cookie、CORS
// PBKDF2-SHA256（WebCrypto 不支持 scrypt，PBKDF2 是 Workers 原生能力）

const ITERATIONS = 120000;

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

export async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${toHex(bits)}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const saltHex = parts[2];
  const expected = parts[3];
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(saltHex), iterations, hash: 'SHA-256' },
    key,
    256
  );
  const actual = toHex(bits);
  // 常量时间比较
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) {
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export function randomToken(bytes = 32) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return toHex(arr);
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  String(header).split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx < 0) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

export function sessionCookie(token, maxAgeSeconds) {
  // 跨站（github.io → workers.dev）必须 SameSite=None + Secure
  return `bw_uid=${token}; HttpOnly; SameSite=None; Secure; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function clearCookie() {
  return 'bw_uid=; HttpOnly; SameSite=None; Secure; Path=/; Max-Age=0';
}

export function corsHeaders(origin, allowed) {
  const list = String(allowed || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const ok = list.some((rule) => {
    if (rule === '*') return true;
    if (rule === origin) return true;
    if (rule.endsWith('*')) return origin.startsWith(rule.slice(0, -1));
    return false;
  });
  const headers = { Vary: 'Origin', 'Cache-Control': 'no-store' };
  if (ok) {
    headers['Access-Control-Allow-Origin'] = origin || list[0] || '*';
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers['Access-Control-Allow-Headers'] = 'content-type';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    headers['Access-Control-Max-Age'] = '600';
  }
  return { ok, headers };
}

export function validateUsername(name) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  return trimmed.length >= 3 && trimmed.length <= 24 && /^[\w\u4e00-\u9fa5]+$/.test(trimmed);
}

export function validatePassword(pw) {
  return typeof pw === 'string' && pw.length >= 6 && pw.length <= 128;
}

export function maskKey(value) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= 8) return '***';
  return s.slice(0, 4) + '…' + s.slice(-4);
}
