import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TEST_ORIGIN,
  cookieFrom,
  register,
  request,
  startTestServer,
  withCookie
} from './helpers.mjs';

test('CORS 预检：OPTIONS 204 + 回显 Origin + 允许凭证/方法/头', async () => {
  const server = await startTestServer();
  try {
    const preflight = await request(server.base, 'OPTIONS', '/api/auth/register', undefined, {
      Origin: TEST_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type'
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), TEST_ORIGIN);
    assert.notEqual(preflight.headers.get('access-control-allow-origin'), '*');
    assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(preflight.headers.get('access-control-allow-headers'), 'content-type');
    assert.ok(preflight.headers.get('access-control-allow-methods').includes('POST'));
    assert.ok(preflight.headers.get('access-control-allow-methods').includes('DELETE'));
    assert.ok(preflight.headers.get('vary').includes('Origin'));
  } finally {
    await server.close();
  }
});

test('CORS 实际请求：GET /api/health 回显 Origin + Allow-Credentials', async () => {
  const server = await startTestServer();
  try {
    const result = await request(server.base, 'GET', '/api/health', undefined, { Origin: TEST_ORIGIN });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('access-control-allow-origin'), TEST_ORIGIN);
    assert.equal(result.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(result.headers.get('access-control-allow-headers'), 'content-type');
    assert.ok(result.headers.get('access-control-allow-methods').includes('PUT'));
  } finally {
    await server.close();
  }
});

test('CORS 错误响应：401 也带 CORS 头（前端才能读到错误）', async () => {
  const server = await startTestServer();
  try {
    const result = await request(server.base, 'GET', '/api/auth/me', undefined, { Origin: TEST_ORIGIN });
    assert.equal(result.status, 401);
    assert.equal(result.json.code, 'UNAUTHENTICATED');
    assert.equal(result.headers.get('access-control-allow-origin'), TEST_ORIGIN);
    assert.equal(result.headers.get('access-control-allow-credentials'), 'true');

    const badJson = await request(server.base, 'POST', '/api/auth/register', '{bad', { Origin: TEST_ORIGIN });
    assert.equal(badJson.status, 400);
    assert.equal(badJson.headers.get('access-control-allow-origin'), TEST_ORIGIN);
  } finally {
    await server.close();
  }
});

test('CORS + Cookie 往返：注册带上 Origin，Cookie 可用于后续跨源请求', async () => {
  const server = await startTestServer();
  try {
    const registered = await register(server.base, 'corsuser', 'secret123', { Origin: TEST_ORIGIN });
    assert.equal(registered.result.status, 200);
    assert.equal(registered.result.headers.get('access-control-allow-origin'), TEST_ORIGIN);
    assert.equal(registered.result.headers.get('access-control-allow-credentials'), 'true');
    assert.ok(cookieFrom(registered.result).startsWith('wa_uid='));

    const me = await request(server.base, 'GET', '/api/auth/me', undefined, {
      Origin: TEST_ORIGIN,
      ...withCookie(registered.cookie)
    });
    assert.equal(me.status, 200);
    assert.equal(me.headers.get('access-control-allow-origin'), TEST_ORIGIN);
    assert.equal(me.json.user.username, 'corsuser');
  } finally {
    await server.close();
  }
});

test('CORS：没有 Origin 时不返回 *（curl/同源场景）', async () => {
  const server = await startTestServer();
  try {
    const result = await request(server.base, 'GET', '/api/health');
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('access-control-allow-origin'), null);
    assert.notEqual(result.headers.get('access-control-allow-origin'), '*');
    const preflight = await request(server.base, 'OPTIONS', '/api/health');
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), null);
  } finally {
    await server.close();
  }
});

test('CORS 白名单：配置 WA_ALLOWED_ORIGINS 后只回显允许的来源', async () => {
  const allowed = 'http://allowed.example';
  const server = await startTestServer({ env: { WA_ALLOWED_ORIGINS: allowed } });
  try {
    const ok = await request(server.base, 'GET', '/api/health', undefined, { Origin: allowed });
    assert.equal(ok.headers.get('access-control-allow-origin'), allowed);

    const blocked = await request(server.base, 'GET', '/api/health', undefined, { Origin: TEST_ORIGIN });
    assert.equal(blocked.status, 200, '服务仍然响应，但浏览器会拦截');
    assert.equal(blocked.headers.get('access-control-allow-origin'), null);
    assert.equal(blocked.headers.get('access-control-allow-credentials'), null);

    const preflightBlocked = await request(server.base, 'OPTIONS', '/api/auth/login', undefined, {
      Origin: TEST_ORIGIN,
      'Access-Control-Request-Method': 'POST'
    });
    assert.equal(preflightBlocked.status, 204);
    assert.equal(preflightBlocked.headers.get('access-control-allow-origin'), null);
  } finally {
    await server.close();
  }
});

test('CORS：预检任意路径都 204（含未知路径）', async () => {
  const server = await startTestServer();
  try {
    const preflight = await request(server.base, 'OPTIONS', '/api/does-not-exist', undefined, {
      Origin: TEST_ORIGIN,
      'Access-Control-Request-Method': 'GET'
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), TEST_ORIGIN);
  } finally {
    await server.close();
  }
});
