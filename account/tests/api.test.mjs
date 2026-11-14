import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  cookieFrom,
  register,
  request,
  startTestServer,
  withCookie
} from './helpers.mjs';

test('健康检查：无鉴权、返回版本与时间', async () => {
  const server = await startTestServer();
  try {
    const result = await request(server.base, 'GET', '/api/health');
    assert.equal(result.status, 200);
    assert.equal(result.json.ok, true);
    assert.equal(result.json.version, '1');
    assert.equal(typeof result.json.time, 'number');
    assert.ok(result.headers.get('content-type').includes('application/json'));
  } finally {
    await server.close();
  }
});

test('注册：成功 + Set-Cookie 属性 + /me 返回 user 与 profile:null', async () => {
  const server = await startTestServer();
  try {
    const registered = await register(server.base, 'testuser', 'secret123');
    assert.equal(registered.result.status, 200);
    assert.equal(registered.result.json.ok, true);
    assert.equal(registered.result.json.user.username, 'testuser');
    assert.match(registered.result.json.user.id, /^user-/);
    assert.equal(typeof registered.result.json.user.createdAt, 'number');

    const setCookie = registered.result.setCookies[0];
    assert.ok(setCookie.includes('wa_uid='));
    assert.ok(setCookie.includes('HttpOnly'));
    assert.ok(setCookie.includes('SameSite=Lax'));
    assert.ok(setCookie.includes('Path=/'));
    assert.ok(setCookie.includes('Max-Age=2592000'));
    assert.equal(setCookie.includes('Secure'), false, '本地 http 不应加 Secure');

    const me = await request(server.base, 'GET', '/api/auth/me', undefined, withCookie(registered.cookie));
    assert.equal(me.status, 200);
    assert.equal(me.json.user.username, 'testuser');
    assert.equal(me.json.profile, null);
  } finally {
    await server.close();
  }
});

test('注册：重复用户名（大小写不敏感）→ 409 USERNAME_TAKEN', async () => {
  const server = await startTestServer();
  try {
    const first = await register(server.base, 'TestUser', 'secret123');
    assert.equal(first.result.status, 200);
    const duplicate = await register(server.base, 'testuser', 'secret123');
    assert.equal(duplicate.result.status, 409);
    assert.equal(duplicate.result.json.code, 'USERNAME_TAKEN');

    // 登录大小写不敏感
    const login = await request(server.base, 'POST', '/api/auth/login', {
      username: 'testuser',
      password: 'secret123'
    });
    assert.equal(login.status, 200);
    assert.equal(login.json.user.username, 'TestUser', '返回注册时的原始用户名');
  } finally {
    await server.close();
  }
});

test('注册：用户名 / 密码 / JSON 校验 → 400 BAD_REQUEST', async () => {
  const server = await startTestServer();
  try {
    const cases = [
      { username: 'ab', password: 'secret123' },
      { username: 'a'.repeat(25), password: 'secret123' },
      { username: 'bad name', password: 'secret123' },
      { username: 'bad-name', password: 'secret123' },
      { password: 'secret123' },
      { username: 'okuser', password: '12345' },
      { username: 'okuser' }
    ];
    for (const body of cases) {
      const result = await request(server.base, 'POST', '/api/auth/register', body);
      assert.equal(result.status, 400, '应拒绝：' + JSON.stringify(body));
      assert.equal(result.json.code, 'BAD_REQUEST');
    }
    const badJson = await request(server.base, 'POST', '/api/auth/register', '{这不是 JSON');
    assert.equal(badJson.status, 400);
    assert.equal(badJson.json.code, 'BAD_REQUEST');

    const arrayBody = await request(server.base, 'POST', '/api/auth/register', []);
    assert.equal(arrayBody.status, 400);

    // 中文用户名合法
    const chinese = await register(server.base, '中文用户', 'secret123');
    assert.equal(chinese.result.status, 200);
  } finally {
    await server.close();
  }
});

test('登录 / 登出：错误密码 401、成功换新 Cookie、登出后 401', async () => {
  const server = await startTestServer();
  try {
    const registered = await register(server.base, 'testuser', 'secret123');

    const wrong = await request(server.base, 'POST', '/api/auth/login', {
      username: 'testuser',
      password: 'wrong-password'
    });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.json.code, 'BAD_CREDENTIALS');

    const noUser = await request(server.base, 'POST', '/api/auth/login', {
      username: 'nobody',
      password: 'secret123'
    });
    assert.equal(noUser.status, 401);
    assert.equal(noUser.json.code, 'BAD_CREDENTIALS');

    const login = await request(server.base, 'POST', '/api/auth/login', {
      username: 'testuser',
      password: 'secret123'
    });
    assert.equal(login.status, 200);
    const newCookie = cookieFrom(login);
    assert.ok(newCookie);

    const me = await request(server.base, 'GET', '/api/auth/me', undefined, withCookie(newCookie));
    assert.equal(me.status, 200);

    // 旧 Cookie 也仍然有效（登录不会踢掉已有会话）
    const meOld = await request(server.base, 'GET', '/api/auth/me', undefined, withCookie(registered.cookie));
    assert.equal(meOld.status, 200);

    const logout = await request(server.base, 'POST', '/api/auth/logout', undefined, withCookie(newCookie));
    assert.equal(logout.status, 200);
    assert.equal(logout.json.ok, true);
    assert.ok(logout.setCookies[0].includes('Max-Age=0'));

    const afterLogout = await request(server.base, 'GET', '/api/auth/me', undefined, withCookie(newCookie));
    assert.equal(afterLogout.status, 401);
    assert.equal(afterLogout.json.code, 'UNAUTHENTICATED');
  } finally {
    await server.close();
  }
});

test('me：未登录 / 无效 Cookie → 401 UNAUTHENTICATED', async () => {
  const server = await startTestServer();
  try {
    const anonymous = await request(server.base, 'GET', '/api/auth/me');
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.json.code, 'UNAUTHENTICATED');

    const invalid = await request(server.base, 'GET', '/api/auth/me', undefined, {
      Cookie: 'wa_uid=deadbeef'
    });
    assert.equal(invalid.status, 401);
    assert.equal(invalid.json.code, 'UNAUTHENTICATED');
  } finally {
    await server.close();
  }
});

test('profile：整包保存 / 读回 / bytes 正确；非对象与超限 400', async () => {
  const server = await startTestServer();
  try {
    const registered = await register(server.base, 'profileuser', 'secret123');
    const cookie = withCookie(registered.cookie);

    const profile = {
      xp: 4240,
      streakDays: 12,
      cards: [{ placeID: 'river-steps', serial: '0247' }],
      settings: { sound: true, haptic: false },
      note: '中文也要正确保存'
    };
    const saved = await request(server.base, 'PUT', '/api/me/profile', { profile: profile }, cookie);
    assert.equal(saved.status, 200);
    assert.equal(saved.json.ok, true);
    assert.equal(saved.json.bytes, Buffer.byteLength(JSON.stringify(profile), 'utf8'));
    assert.equal(typeof saved.json.savedAt, 'number');

    const me = await request(server.base, 'GET', '/api/auth/me', undefined, cookie);
    assert.equal(me.status, 200);
    assert.deepEqual(me.json.profile, profile);

    const notObject = await request(server.base, 'PUT', '/api/me/profile', { profile: [] }, cookie);
    assert.equal(notObject.status, 400);
    assert.equal(notObject.json.code, 'BAD_REQUEST');
    const nullProfile = await request(server.base, 'PUT', '/api/me/profile', { profile: null }, cookie);
    assert.equal(nullProfile.status, 400);

    // 超过 256KB
    const tooBig = { blob: 'x'.repeat(300 * 1024) };
    const oversize = await request(server.base, 'PUT', '/api/me/profile', { profile: tooBig }, cookie);
    assert.equal(oversize.status, 400);
    assert.equal(oversize.json.code, 'BAD_REQUEST');
    assert.equal(oversize.json.details.maxBytes, 256 * 1024);
    assert.ok(oversize.json.details.bytes > 256 * 1024);

    // 超限不能覆盖旧 profile
    const still = await request(server.base, 'GET', '/api/auth/me', undefined, cookie);
    assert.deepEqual(still.json.profile, profile);

    // 未登录不能写
    const anonymous = await request(server.base, 'PUT', '/api/me/profile', { profile: { xp: 1 } });
    assert.equal(anonymous.status, 401);
  } finally {
    await server.close();
  }
});

test('删除账号：密码二次确认、清 Cookie、数据与账号一起删除', async () => {
  const server = await startTestServer();
  try {
    const registered = await register(server.base, 'deleteuser', 'secret123');
    const cookie = withCookie(registered.cookie);
    await request(server.base, 'PUT', '/api/me/profile', { profile: { xp: 42 } }, cookie);

    const missing = await request(server.base, 'DELETE', '/api/me', {}, cookie);
    assert.equal(missing.status, 400);

    const wrong = await request(server.base, 'DELETE', '/api/me', { password: 'wrong' }, cookie);
    assert.equal(wrong.status, 401);
    assert.equal(wrong.json.code, 'BAD_CREDENTIALS');

    const removed = await request(server.base, 'DELETE', '/api/me', { password: 'secret123' }, cookie);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.ok, true);
    assert.ok(removed.setCookies[0].includes('Max-Age=0'));

    const me = await request(server.base, 'GET', '/api/auth/me', undefined, cookie);
    assert.equal(me.status, 401);

    const login = await request(server.base, 'POST', '/api/auth/login', {
      username: 'deleteuser',
      password: 'secret123'
    });
    assert.equal(login.status, 401, '删号后不能再用旧密码登录');

    // 用户名可重新注册，且 profile 是 null（数据已清）
    const again = await register(server.base, 'deleteuser', 'secret123');
    assert.equal(again.result.status, 200);
    const freshMe = await request(server.base, 'GET', '/api/auth/me', undefined, withCookie(again.cookie));
    assert.equal(freshMe.json.profile, null);
  } finally {
    await server.close();
  }
});

test('会话持久化：服务重启后用原 Cookie 仍能访问（sessions 在 SQLite）', async () => {
  const first = await startTestServer();
  const dataDir = first.dataDir;
  let cookie = '';
  try {
    const registered = await register(first.base, 'restartuser', 'secret123');
    cookie = registered.cookie;
    const saved = await request(first.base, 'PUT', '/api/me/profile', { profile: { xp: 7 } }, withCookie(cookie));
    assert.equal(saved.status, 200);
  } finally {
    await first.close({ cleanup: false });
  }

  const second = await startTestServer({ dataDir: dataDir });
  try {
    const me = await request(second.base, 'GET', '/api/auth/me', undefined, withCookie(cookie));
    assert.equal(me.status, 200, '重启后会话应仍有效');
    assert.equal(me.json.user.username, 'restartuser');
    assert.deepEqual(me.json.profile, { xp: 7 });
  } finally {
    await second.close();
    fs.rmSync(first.root, { recursive: true, force: true });
  }
});

test('登录限流：同 IP 10 分钟 8 次失败 → 第 9 次 429', async () => {
  const server = await startTestServer();
  try {
    await register(server.base, 'limiteduser', 'secret123');
    for (let i = 0; i < 8; i += 1) {
      const result = await request(server.base, 'POST', '/api/auth/login', {
        username: 'limiteduser',
        password: 'wrong-' + i
      });
      assert.equal(result.status, 401, '第 ' + (i + 1) + ' 次失败应为 401');
    }
    const blocked = await request(server.base, 'POST', '/api/auth/login', {
      username: 'limiteduser',
      password: 'wrong-again'
    });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json.code, 'TOO_MANY_ATTEMPTS');
    assert.ok(blocked.json.details.retryAfterMs > 0);

    // 限流期间即使密码正确也 429（保守）
    const correct = await request(server.base, 'POST', '/api/auth/login', {
      username: 'limiteduser',
      password: 'secret123'
    });
    assert.equal(correct.status, 429);
  } finally {
    await server.close();
  }
});

test('登录限流：成功登录会清零失败计数', async () => {
  const server = await startTestServer();
  try {
    await register(server.base, 'resetuser', 'secret123');
    await request(server.base, 'POST', '/api/auth/login', { username: 'resetuser', password: 'wrong-1' });
    await request(server.base, 'POST', '/api/auth/login', { username: 'resetuser', password: 'wrong-2' });
    const success = await request(server.base, 'POST', '/api/auth/login', {
      username: 'resetuser',
      password: 'secret123'
    });
    assert.equal(success.status, 200);
    const failAgain = await request(server.base, 'POST', '/api/auth/login', {
      username: 'resetuser',
      password: 'wrong-again'
    });
    assert.equal(failAgain.status, 401, '成功后计数清零，不应立刻 429');
  } finally {
    await server.close();
  }
});

test('未知路径 → 404 NOT_FOUND；方法不匹配也 404', async () => {
  const server = await startTestServer();
  try {
    const unknown = await request(server.base, 'GET', '/api/nope');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.json.code, 'NOT_FOUND');

    const wrongMethod = await request(server.base, 'GET', '/api/auth/register');
    assert.equal(wrongMethod.status, 404);
    assert.equal(wrongMethod.json.code, 'NOT_FOUND');

    const healthPost = await request(server.base, 'POST', '/api/health', {});
    assert.equal(healthPost.status, 404);
  } finally {
    await server.close();
  }
});
