import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createServer } from '../server/index.mjs';
import {
  AuthManager,
  MAX_LOGIN_FAILURES,
  generatePassword,
  hashPassword,
  parseCookies,
  sessionCookie,
  verifyPassword
} from '../server/auth.mjs';

const tempDirs = [];
const runningServers = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-auth-'));
  tempDirs.push(dir);
  return dir;
}

async function startServer(options = {}) {
  const root = makeTempDir();
  const dataDir = options.dataDir || path.join(root, 'data');
  const publicDir = path.join(root, 'public');
  fs.mkdirSync(publicDir, { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<h1>admin</h1>');
  const server = createServer({
    dataDir,
    publicDir,
    exportPath: path.join(root, 'pois.export.json'),
    llmEnv: {},
    authEnv: options.authEnv || { WA_ADMIN_PASSWORD: 'test1234' },
    ingestCandidates: async () => ({ source: 'wikipedia', items: [] })
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  runningServers.push(server);
  return {
    server,
    dataDir,
    base: 'http://127.0.0.1:' + server.address().port
  };
}

async function stopServer(server) {
  await new Promise((resolve) => server.close(resolve));
  const index = runningServers.indexOf(server);
  if (index >= 0) runningServers.splice(index, 1);
}

test.after(async () => {
  for (const server of runningServers.slice()) {
    await stopServer(server);
  }
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

async function postJson(base, pathname, body, headers = {}) {
  return fetch(base + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    redirect: 'manual'
  });
}

test('auth 单元：scrypt 哈希 / 校验 / 随机密码 / Cookie 解析', () => {
  const hashed = hashPassword('test1234');
  assert.match(hashed.salt, /^[0-9a-f]+$/);
  assert.match(hashed.hash, /^[0-9a-f]+$/);
  assert.equal(verifyPassword('test1234', hashed.salt, hashed.hash), true);
  assert.equal(verifyPassword('wrong', hashed.salt, hashed.hash), false);
  assert.equal(verifyPassword('', hashed.salt, hashed.hash), false);

  const password = generatePassword();
  assert.equal(password.length, 12);
  assert.match(password, /^[A-Za-z0-9]+$/);

  const cookies = parseCookies('wa_session=abc123; other=1');
  assert.equal(cookies.wa_session, 'abc123');
  const header = sessionCookie('tok', 43200);
  assert.ok(header.includes('HttpOnly'));
  assert.ok(header.includes('SameSite=Strict'));
  assert.ok(header.includes('Path=/'));
  assert.ok(header.includes('Max-Age=43200'));
});

test('auth：登录失败 5 次 → 第 6 次 429', async () => {
  const { server, base } = await startServer();
  try {
    for (let i = 0; i < MAX_LOGIN_FAILURES; i += 1) {
      const response = await postJson(base, '/api/auth/login', { password: 'wrong-' + i });
      assert.equal(response.status, 401, '第 ' + (i + 1) + ' 次失败应 401');
    }
    const locked = await postJson(base, '/api/auth/login', { password: 'wrong-again' });
    assert.equal(locked.status, 429);
    const payload = await locked.json();
    assert.equal(payload.code, 'TOO_MANY_ATTEMPTS');

    // 限流中即使密码正确也应 429（保守策略）
    const correctButLocked = await postJson(base, '/api/auth/login', { password: 'test1234' });
    assert.equal(correctButLocked.status, 429);
  } finally {
    await stopServer(server);
  }
});

test('auth：登录成功 / 登出 / 会话重启后仍有效', async () => {
  const root = makeTempDir();
  const dataDir = path.join(root, 'data');
  const first = await startServer({ dataDir, authEnv: { WA_ADMIN_PASSWORD: 'test1234' } });

  const login = await postJson(first.base, '/api/auth/login', { password: 'test1234' });
  assert.equal(login.status, 200);
  const setCookies = login.headers.getSetCookie();
  assert.equal(setCookies.length, 1);
  const cookie = setCookies[0].split(';')[0];
  assert.ok(setCookies[0].includes('HttpOnly'));
  assert.ok(setCookies[0].includes('SameSite=Strict'));

  const list = await fetch(first.base + '/api/pois?limit=2', { headers: { Cookie: cookie } });
  assert.equal(list.status, 200);

  const status = await fetch(first.base + '/api/auth/status', { headers: { Cookie: cookie } });
  assert.equal((await status.json()).authenticated, true);

  // 重启：sessions.json 持久化，Cookie 仍然有效
  await stopServer(first.server);
  assert.ok(fs.existsSync(path.join(dataDir, 'sessions.json')), 'sessions.json 应持久化');
  const second = await startServer({ dataDir, authEnv: { WA_ADMIN_PASSWORD: 'test1234' } });
  const afterRestart = await fetch(second.base + '/api/pois?limit=2', { headers: { Cookie: cookie } });
  assert.equal(afterRestart.status, 200, '重启后会话应仍有效');
  const afterStatus = await fetch(second.base + '/api/auth/status', { headers: { Cookie: cookie } });
  assert.equal((await afterStatus.json()).authenticated, true);

  // 登出：清 Cookie + 会话失效
  const logout = await postJson(second.base, '/api/auth/logout', {}, { Cookie: cookie });
  assert.equal(logout.status, 200);
  const cleared = logout.headers.getSetCookie();
  assert.ok(cleared[0].includes('Max-Age=0'));
  const afterLogout = await fetch(second.base + '/api/pois?limit=2', { headers: { Cookie: cookie } });
  assert.equal(afterLogout.status, 401);
  await stopServer(second.server);
});

test('auth：无 WA_ADMIN_PASSWORD 时生成随机密码，只存 scrypt 哈希、权限 0600', async () => {
  const root = makeTempDir();
  const dataDir = path.join(root, 'data');
  const { server, base } = await startServer({ dataDir, authEnv: {} });
  try {
    const auth = server.auth;
    assert.equal(auth.passwordSource, 'generated');
    assert.equal(auth.passwordSet, true);
    assert.ok(auth.generatedPassword.length >= 6);

    const secretPath = path.join(dataDir, 'admin.secret.json');
    assert.ok(fs.existsSync(secretPath));
    const stat = fs.statSync(secretPath);
    assert.equal(stat.mode & 0o777, 0o600, 'secret 文件权限应为 0600');
    const secretText = fs.readFileSync(secretPath, 'utf8');
    const secret = JSON.parse(secretText);
    assert.match(secret.salt, /^[0-9a-f]+$/);
    assert.match(secret.hash, /^[0-9a-f]+$/);
    assert.equal(secretText.includes(auth.generatedPassword), false, 'secret 文件不能存明文密码');

    const status = await fetch(base + '/api/auth/status');
    assert.equal((await status.json()).passwordSet, true);

    const login = await postJson(base, '/api/auth/login', { password: auth.generatedPassword });
    assert.equal(login.status, 200);

    const wrong = await postJson(base, '/api/auth/login', { password: 'not-it' });
    assert.equal(wrong.status, 401);

    // 重启后沿用同一 secret，原密码继续有效
    await stopServer(server);
    const restarted = await startServer({ dataDir, authEnv: {} });
    assert.equal(restarted.server.auth.passwordSource, 'secret');
    const loginAgain = await postJson(restarted.base, '/api/auth/login', { password: auth.generatedPassword });
    assert.equal(loginAgain.status, 200);
    await stopServer(restarted.server);
  } finally {
    if (runningServers.includes(server)) await stopServer(server);
  }
});

test('auth：连续失败后成功登录应重置限流计数', async () => {
  const { server, base } = await startServer();
  try {
    for (let i = 0; i < 2; i += 1) {
      await postJson(base, '/api/auth/login', { password: 'wrong-' + i });
    }
    const success = await postJson(base, '/api/auth/login', { password: 'test1234' });
    assert.equal(success.status, 200);
    // 成功后计数清零：再失败一次仍应是 401 而不是 429
    const failAgain = await postJson(base, '/api/auth/login', { password: 'wrong-again' });
    assert.equal(failAgain.status, 401);
  } finally {
    await stopServer(server);
  }
});

test('auth：AuthManager 会话 token 生成/过期/删除', () => {
  const dir = makeTempDir();
  let clock = 1000000;
  const auth = new AuthManager({
    dataDir: dir,
    env: { WA_ADMIN_PASSWORD: 'test1234' },
    now: () => clock
  });
  const request = {
    headers: { cookie: '' },
    socket: { remoteAddress: '127.0.0.1' }
  };
  const token = auth.login('test1234', request);
  assert.match(token, /^[0-9a-f]{64}$/);
  request.headers.cookie = 'wa_session=' + token;
  assert.equal(auth.isAuthenticated(request), true);

  // 12 小时后过期
  clock += 12 * 60 * 60 * 1000 + 1;
  assert.equal(auth.isAuthenticated(request), false);
  auth.stopPruneTimer();
  auth.deleteSession(token);
});
