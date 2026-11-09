import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createServer } from '../server/index.mjs';

const tempDirs = [];
const runningServers = [];

const TEST_PASSWORD = 'test1234';
const ALLOWED_GITHUB = 'https://xiaoqiangch.github.io';
const ALLOWED_LOCAL = 'http://127.0.0.1:8799';

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-mapkeys-'));
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
    exportPath: path.join(root, 'export', 'pois.json'),
    llmEnv: {},
    authEnv: { BW_ADMIN_PASSWORD: TEST_PASSWORD },
    mapKeysEnv: options.mapKeysEnv || {},
    mapKeyFetch: options.mapKeyFetch,
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
  if (!server.listening) return;
  await new Promise((resolve) => server.close(resolve));
  const index = runningServers.indexOf(server);
  if (index >= 0) runningServers.splice(index, 1);
}

test.after(async () => {
  for (const server of runningServers.slice()) await stopServer(server);
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

async function request(base, method, pathname, body, headers = {}) {
  const init = { method: method, headers: Object.assign({}, headers), redirect: 'manual' };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(base + pathname, init);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (error) {
    json = null;
  }
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [];
  return {
    status: response.status,
    json: json,
    text: text,
    headers: response.headers,
    setCookies: setCookies
  };
}

async function loginAdmin(base) {
  const response = await request(base, 'POST', '/api/auth/login', { password: TEST_PASSWORD });
  assert.equal(response.status, 200, '管理员登录应成功');
  const cookie = response.setCookies[0].split(';')[0];
  return { Cookie: cookie };
}

test('地图 Key：未登录 GET /api/mapkeys → 401', async () => {
  const { server, base } = await startServer();
  try {
    const result = await request(base, 'GET', '/api/mapkeys');
    assert.equal(result.status, 401);
    assert.equal(result.json.code, 'UNAUTHENTICATED');

    const put = await request(base, 'PUT', '/api/mapkeys', { keys: { amap: 'x' } });
    assert.equal(put.status, 401);
  } finally {
    await stopServer(server);
  }
});

test('地图 Key：PUT 后 GET 只回显掩码，绝不回显明文', async () => {
  const { server, base } = await startServer();
  try {
    const auth = await loginAdmin(base);
    const fakeAmap = 'test-key-1234';
    const fakeBaidu = 'baidu-key-5678';

    const put = await request(base, 'PUT', '/api/mapkeys', {
      keys: { amap: fakeAmap, baidu: fakeBaidu }
    }, auth);
    assert.equal(put.status, 200);
    assert.equal(put.json.ok, true);
    assert.equal(put.json.publicUrl, '/api/public/mapkeys');
    assert.equal(put.json.keys.amap.configured, true);
    assert.equal(put.json.keys.amap.hint, 'test…1234');
    assert.equal(typeof put.json.keys.amap.updatedAt, 'number');
    assert.equal(put.json.keys.baidu.configured, true);
    assert.equal(put.json.keys.baidu.hint, 'baid…5678');

    const get = await request(base, 'GET', '/api/mapkeys', undefined, auth);
    assert.equal(get.status, 200);
    assert.equal(get.json.keys.amap.hint, 'test…1234');
    assert.equal(get.json.keys.baidu.hint, 'baid…5678');

    // 管理端响应里不能出现完整 Key
    assert.equal(get.text.includes(fakeAmap), false, '管理端 GET 不能回显完整 amap key');
    assert.equal(get.text.includes(fakeBaidu), false, '管理端 GET 不能回显完整 baidu key');
    assert.equal(put.text.includes(fakeAmap), false);

    // 未配置的 provider 形状
    await request(base, 'PUT', '/api/mapkeys', { keys: { baidu: '' } }, auth);
    const clearedOne = await request(base, 'GET', '/api/mapkeys', undefined, auth);
    assert.deepEqual(clearedOne.json.keys.baidu, { configured: false });
    assert.equal(clearedOne.json.keys.amap.configured, true);
  } finally {
    await stopServer(server);
  }
});

test('公开端点：白名单来源回显 Origin + 明文 + no-store；非白名单 403', async () => {
  const { server, base } = await startServer();
  try {
    const auth = await loginAdmin(base);
    await request(base, 'PUT', '/api/mapkeys', {
      keys: { amap: 'test-key-1234', baidu: 'baidu-key-5678' }
    }, auth);

    for (const origin of [ALLOWED_GITHUB, ALLOWED_LOCAL, 'http://localhost:5173']) {
      const result = await request(base, 'GET', '/api/public/mapkeys', undefined, { Origin: origin });
      assert.equal(result.status, 200, origin + ' 应允许');
      assert.equal(result.json.ok, true);
      assert.equal(result.json.keys.amap, 'test-key-1234');
      assert.equal(result.json.keys.baidu, 'baidu-key-5678');
      assert.equal(result.headers.get('cache-control'), 'no-store');
      assert.equal(result.headers.get('access-control-allow-origin'), origin);
      assert.notEqual(result.headers.get('access-control-allow-origin'), '*');
      assert.ok(result.headers.get('vary').includes('Origin'));
    }

    const version = (await request(base, 'GET', '/api/public/mapkeys')).json.version;
    assert.match(version, /^\d+$/);
    assert.ok(Number(version) > 0);

    // 非白名单 Origin → 403，且不回显 Key
    const blocked = await request(base, 'GET', '/api/public/mapkeys', undefined, {
      Origin: 'https://evil.example'
    });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.code, 'FORBIDDEN');
    assert.equal(blocked.headers.get('cache-control'), 'no-store');
    assert.equal(blocked.headers.get('access-control-allow-origin'), null);
    assert.equal(blocked.text.includes('test-key-1234'), false);

    // 无 Origin（curl / 同源）→ 允许，不返回 *
    const noOrigin = await request(base, 'GET', '/api/public/mapkeys');
    assert.equal(noOrigin.status, 200);
    assert.equal(noOrigin.headers.get('access-control-allow-origin'), null);

    // OPTIONS 预检
    const preflight = await request(base, 'OPTIONS', '/api/public/mapkeys', undefined, {
      Origin: ALLOWED_GITHUB,
      'Access-Control-Request-Method': 'GET'
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), ALLOWED_GITHUB);
    assert.ok(preflight.headers.get('access-control-allow-methods').includes('GET'));
    assert.equal(preflight.headers.get('cache-control'), 'no-store');

    const blockedPreflight = await request(base, 'OPTIONS', '/api/public/mapkeys', undefined, {
      Origin: 'https://evil.example',
      'Access-Control-Request-Method': 'GET'
    });
    assert.equal(blockedPreflight.status, 403);
    assert.equal(blockedPreflight.headers.get('access-control-allow-origin'), null);
  } finally {
    await stopServer(server);
  }
});

test('公开端点：BW_MAPKEYS_ORIGINS 覆盖默认白名单', async () => {
  const { server, base } = await startServer({
    mapKeysEnv: { BW_MAPKEYS_ORIGINS: 'https://allowed.example,http://127.0.0.1:*' }
  });
  try {
    const allowed = await request(base, 'GET', '/api/public/mapkeys', undefined, {
      Origin: 'https://allowed.example'
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://allowed.example');

    const portAllowed = await request(base, 'GET', '/api/public/mapkeys', undefined, {
      Origin: 'http://127.0.0.1:3000'
    });
    assert.equal(portAllowed.status, 200);

    const githubBlocked = await request(base, 'GET', '/api/public/mapkeys', undefined, {
      Origin: ALLOWED_GITHUB
    });
    assert.equal(githubBlocked.status, 403, '覆盖后默认的 GitHub Pages 来源应被禁用');
  } finally {
    await stopServer(server);
  }
});

test('地图 Key：清除 Key（空串）后公开端点为空白，version 归零', async () => {
  const { server, base } = await startServer();
  try {
    const auth = await loginAdmin(base);
    await request(base, 'PUT', '/api/mapkeys', {
      keys: { amap: 'test-key-1234', baidu: 'baidu-key-5678' }
    }, auth);

    const cleared = await request(base, 'PUT', '/api/mapkeys', {
      keys: { amap: '', baidu: '' }
    }, auth);
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.json.keys.amap, { configured: false });
    assert.deepEqual(cleared.json.keys.baidu, { configured: false });

    const publicView = await request(base, 'GET', '/api/public/mapkeys');
    assert.equal(publicView.status, 200);
    assert.deepEqual(publicView.json.keys, { amap: '', baidu: '' });
    assert.equal(publicView.json.version, '0');
  } finally {
    await stopServer(server);
  }
});

test('地图 Key：PUT 参数校验（缺 keys / 非字符串 / 未配置 test）', async () => {
  const { server, base } = await startServer();
  try {
    const auth = await loginAdmin(base);
    assert.equal((await request(base, 'PUT', '/api/mapkeys', {}, auth)).status, 400);
    assert.equal((await request(base, 'PUT', '/api/mapkeys', { keys: 'nope' }, auth)).status, 400);
    assert.equal((await request(base, 'PUT', '/api/mapkeys', { keys: { amap: 123 } }, auth)).status, 400);
    assert.equal((await request(base, 'PUT', '/api/mapkeys', { keys: { other: 'x' } }, auth)).status, 400);

    // 未配置 Key 时 test 返回 ok:false，不崩、不打外网
    const noKey = await request(base, 'POST', '/api/mapkeys/test', { provider: 'amap' }, auth);
    assert.equal(noKey.status, 200);
    assert.equal(noKey.json.ok, false);
    assert.equal(noKey.json.provider, 'amap');
    assert.equal(noKey.json.count, 0);
    assert.ok(noKey.json.error.length > 0);

    const badProvider = await request(base, 'POST', '/api/mapkeys/test', { provider: 'google' }, auth);
    assert.equal(badProvider.status, 400);
    assert.equal(badProvider.json.code, 'BAD_REQUEST');
  } finally {
    await stopServer(server);
  }
});

test('地图 Key：test 端点用注入的 fetch 验证（不碰外网）', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('restapi.amap.com')) {
      return new Response(JSON.stringify({
        status: '1',
        info: 'OK',
        count: '3',
        pois: [{}, {}, {}]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      status: 0,
      message: 'ok',
      results: [{}, {}]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const { server, base } = await startServer({ mapKeyFetch: fakeFetch });
  try {
    const auth = await loginAdmin(base);
    const fakeKey = 'test-key-1234';
    await request(base, 'PUT', '/api/mapkeys', {
      keys: { amap: fakeKey, baidu: 'baidu-key-5678' }
    }, auth);

    const amap = await request(base, 'POST', '/api/mapkeys/test', { provider: 'amap' }, auth);
    assert.equal(amap.status, 200);
    assert.deepEqual({ ok: amap.json.ok, provider: amap.json.provider, count: amap.json.count },
      { ok: true, provider: 'amap', count: 3 });
    assert.equal(amap.text.includes(fakeKey), false, 'test 响应不能回显完整 Key');
    assert.ok(calls.length >= 1);
    assert.ok(calls[calls.length - 1].includes('restapi.amap.com'));
    assert.ok(calls[calls.length - 1].includes('location=116.397'));

    const baidu = await request(base, 'POST', '/api/mapkeys/test', { provider: 'baidu' }, auth);
    assert.equal(baidu.status, 200);
    assert.equal(baidu.json.ok, true);
    assert.equal(baidu.json.count, 2);
    assert.ok(calls[calls.length - 1].includes('api.map.baidu.com'));
  } finally {
    await stopServer(server);
  }
});

test('地图 Key：test 端点把 Key 错误信息脱敏（不回显明文）', async () => {
  const fakeKey = 'test-key-1234';
  const fakeFetch = async () => {
    throw new Error('connect ECONNREFUSED for ' + fakeKey);
  };
  const { server, base } = await startServer({ mapKeyFetch: fakeFetch });
  try {
    const auth = await loginAdmin(base);
    await request(base, 'PUT', '/api/mapkeys', { keys: { amap: fakeKey } }, auth);
    const result = await request(base, 'POST', '/api/mapkeys/test', { provider: 'amap' }, auth);
    assert.equal(result.status, 200);
    assert.equal(result.json.ok, false);
    assert.equal(result.json.count, 0);
    assert.equal(result.json.error.includes(fakeKey), false, '错误信息里的 Key 应被替换成掩码');
    assert.ok(result.json.error.includes('test…1234'));
  } finally {
    await stopServer(server);
  }
});
