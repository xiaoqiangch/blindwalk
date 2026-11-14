// 步迷 · 账号服务（Cloudflare Worker + D1）
// 部署后 PWA 用 https://<worker>.workers.dev 作为账号地址即可，无需自己的服务器。

import {
  hashPassword,
  verifyPassword,
  randomToken,
  parseCookies,
  sessionCookie,
  clearCookie,
  corsHeaders,
  validateUsername,
  validatePassword
} from './shared.mjs';

const MAX_PROFILE_BYTES = 256 * 1024;
const SESSION_SECONDS = 30 * 24 * 3600;

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra }
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (err) {
    return null;
  }
}

async function userFromSession(env, request) {
  const token = parseCookies(request.headers.get('cookie')).wa_uid;
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT u.id, u.username, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?'
  ).bind(token, Date.now()).first();
  if (!row) return null;
  return { id: row.id, username: row.username, createdAt: row.created_at, token };
}

function publicUser(user) {
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin') || '';
    const { ok: originOk, headers: cors } = corsHeaders(origin, env.ALLOWED_ORIGINS);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: originOk ? 204 : 403, headers: cors });
    }
    if (!originOk && origin) {
      return json({ ok: false, error: '来源不被允许', code: 'FORBIDDEN' }, 403, { 'Cache-Control': 'no-store' });
    }

    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/api/health' && request.method === 'GET') {
      return json({ ok: true, version: '1', time: Date.now() }, 200, cors);
    }

    if (path === '/api/auth/register' && request.method === 'POST') {
      const body = await readJson(request);
      const username = body && body.username ? String(body.username).trim() : '';
      const password = body && body.password ? String(body.password) : '';
      if (!validateUsername(username) || !validatePassword(password)) {
        return json({ ok: false, code: 'BAD_REQUEST', error: '用户名 3-24 字符，密码至少 6 位' }, 400, cors);
      }
      const exists = await env.DB.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').bind(username).first();
      if (exists) {
        return json({ ok: false, code: 'USERNAME_TAKEN', error: '用户名已被注册' }, 409, cors);
      }
      const id = 'user-' + randomToken(8);
      const hash = await hashPassword(password);
      const now = Date.now();
      await env.DB.prepare('INSERT INTO users (id, username, pass_hash, created_at) VALUES (?, ?, ?, ?)')
        .bind(id, username, hash, now).run();
      const token = randomToken();
      await env.DB.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .bind(token, id, now, now + SESSION_SECONDS * 1000).run();
      return json(
        { ok: true, user: { id, username, createdAt: now } },
        200,
        { ...cors, 'Set-Cookie': sessionCookie(token, SESSION_SECONDS) }
      );
    }

    if (path === '/api/auth/login' && request.method === 'POST') {
      const body = await readJson(request);
      const username = body && body.username ? String(body.username).trim() : '';
      const password = body && body.password ? String(body.password) : '';
      const row = await env.DB.prepare('SELECT id, username, pass_hash, created_at FROM users WHERE username = ? COLLATE NOCASE').bind(username).first();
      if (!row || !(await verifyPassword(password, row.pass_hash))) {
        return json({ ok: false, code: 'BAD_CREDENTIALS', error: '用户名或密码不对' }, 401, cors);
      }
      const token = randomToken();
      const now = Date.now();
      await env.DB.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .bind(token, row.id, now, now + SESSION_SECONDS * 1000).run();
      return json(
        { ok: true, user: { id: row.id, username: row.username, createdAt: row.created_at } },
        200,
        { ...cors, 'Set-Cookie': sessionCookie(token, SESSION_SECONDS) }
      );
    }

    if (path === '/api/auth/logout' && request.method === 'POST') {
      const user = await userFromSession(env, request);
      if (user) {
        await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(user.token).run();
      }
      return json({ ok: true }, 200, { ...cors, 'Set-Cookie': clearCookie() });
    }

    if (path === '/api/auth/me' && request.method === 'GET') {
      const user = await userFromSession(env, request);
      if (!user) return json({ ok: false, code: 'UNAUTHENTICATED', error: '未登录' }, 401, cors);
      const profileRow = await env.DB.prepare('SELECT data FROM profiles WHERE user_id = ?').bind(user.id).first();
      return json(
        { user: publicUser(user), profile: profileRow ? JSON.parse(profileRow.data) : null },
        200,
        cors
      );
    }

    if (path === '/api/me/profile' && request.method === 'PUT') {
      const user = await userFromSession(env, request);
      if (!user) return json({ ok: false, code: 'UNAUTHENTICATED', error: '未登录' }, 401, cors);
      const body = await readJson(request);
      if (!body || typeof body !== 'object' || !body.profile) {
        return json({ ok: false, code: 'BAD_REQUEST', error: '缺少 profile' }, 400, cors);
      }
      const data = JSON.stringify(body);
      const bytes = new TextEncoder().encode(data).length;
      if (bytes > MAX_PROFILE_BYTES) {
        return json({ ok: false, code: 'TOO_LARGE', error: '数据超过 256KB', maxBytes: MAX_PROFILE_BYTES }, 400, cors);
      }
      const now = Date.now();
      await env.DB.prepare(
        'INSERT INTO profiles (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
      ).bind(user.id, data, now).run();
      return json({ ok: true, savedAt: now, bytes }, 200, cors);
    }

    if (path === '/api/me' && request.method === 'DELETE') {
      const user = await userFromSession(env, request);
      if (!user) return json({ ok: false, code: 'UNAUTHENTICATED', error: '未登录' }, 401, cors);
      const body = await readJson(request);
      const password = body && body.password ? String(body.password) : '';
      const row = await env.DB.prepare('SELECT pass_hash FROM users WHERE id = ?').bind(user.id).first();
      if (!row || !(await verifyPassword(password, row.pass_hash))) {
        return json({ ok: false, code: 'BAD_CREDENTIALS', error: '密码不对' }, 401, cors);
      }
      await env.DB.batch([
        env.DB.prepare('DELETE FROM profiles WHERE user_id = ?').bind(user.id),
        env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
        env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id)
      ]);
      return json({ ok: true }, 200, { ...cors, 'Set-Cookie': clearCookie() });
    }

    return json({ ok: false, code: 'NOT_FOUND', error: '接口不存在' }, 404, cors);
  }
};
