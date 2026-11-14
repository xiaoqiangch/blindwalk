import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createServer } from '../server/index.mjs';

const PASSWORD = 'test1234';

/** 造一个「账号服务已经跑过」的库：settings 表存在 */
function makeAccountDb(root) {
  const dataDir = path.join(root, 'account');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'walkaholic-users.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);`);
  db.close();
  return dbPath;
}

async function boot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-accset-'));
  const publicDir = path.join(root, 'public');
  fs.mkdirSync(publicDir, { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<h1>x</h1>');
  const accountDbPath = makeAccountDb(root);
  const adminDataDir = path.join(root, 'admin');
  fs.mkdirSync(adminDataDir, { recursive: true });

  const server = createServer({
    dataDir: adminDataDir,
    publicDir,
    exportPath: path.join(root, 'export.json'),
    accountDbPath,
    llmEnv: {},
    authEnv: { WA_ADMIN_PASSWORD: PASSWORD },
    mapKeysEnv: {},
    ingestCandidates: async () => ({ items: [] })
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const login = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD })
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  return {
    base, cookie, server, root, accountDbPath,
    async close() {
      await new Promise((r) => server.close(r));
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function call(t, method, pathname, body) {
  const init = { method, headers: { cookie: t.cookie } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return fetch(t.base + pathname, init).then(async (r) => ({ status: r.status, json: await r.json() }));
}

test('微信设置：初始未配置', async () => {
  const t = await boot();
  try {
    const r = await call(t, 'GET', '/api/account/settings');
    assert.equal(r.status, 200);
    assert.equal(r.json.wechatEnabled, false);
    assert.deepEqual(r.json.missing, ['WA_WECHAT_APPID', 'WA_WECHAT_SECRET']);
  } finally { await t.close(); }
});

test('微信设置：写入 appid/secret → 启用；secret 只回掩码', async () => {
  const t = await boot();
  try {
    const put = await call(t, 'PUT', '/api/account/settings', {
      settings: { 'wechat.appid': 'wx1234567890abcdef', 'wechat.secret': 'secret-value-abcdefgh' }
    });
    assert.equal(put.status, 200);
    assert.equal(put.json.wechatEnabled, true);
    assert.equal(put.json.settings['wechat.appid'].value, 'wx1234567890abcdef');
    assert.equal(put.json.settings['wechat.secret'].value, 'secr…efgh');
    assert.equal(put.json.missing.length, 0);

    // 真的写进了账号库
    const db = new DatabaseSync(t.accountDbPath);
    const row = db.prepare("SELECT value FROM settings WHERE key = 'wechat.secret'").get();
    db.close();
    assert.equal(row.value, 'secret-value-abcdefgh');
  } finally { await t.close(); }
});

test('微信设置：空串 = 清除', async () => {
  const t = await boot();
  try {
    await call(t, 'PUT', '/api/account/settings', {
      settings: { 'wechat.appid': 'wx1', 'wechat.secret': 's1' }
    });
    const cleared = await call(t, 'PUT', '/api/account/settings', {
      settings: { 'wechat.appid': '', 'wechat.secret': '' }
    });
    assert.equal(cleared.json.wechatEnabled, false);
  } finally { await t.close(); }
});

test('微信设置：账号库没有 settings 表时明确报不可用', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-accset2-'));
  const publicDir = path.join(root, 'public');
  fs.mkdirSync(publicDir, { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<h1>x</h1>');
  const accountDir = path.join(root, 'account');
  fs.mkdirSync(accountDir, { recursive: true });
  const dbPath = path.join(accountDir, 'walkaholic-users.db');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE users (id TEXT PRIMARY KEY);');
  db.close();

  const server = createServer({
    dataDir: path.join(root, 'admin'),
    publicDir,
    exportPath: path.join(root, 'e.json'),
    accountDbPath: dbPath,
    llmEnv: {},
    authEnv: { WA_ADMIN_PASSWORD: PASSWORD },
    mapKeysEnv: {},
    ingestCandidates: async () => ({ items: [] })
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const login = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD })
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  try {
    const r = await fetch(base + '/api/account/settings', { headers: { cookie } }).then(async (x) => ({
      status: x.status, json: await x.json()
    }));
    assert.equal(r.status, 503);
    assert.equal(r.json.code, 'SETTINGS_UNAVAILABLE');
    assert.ok(r.json.error.includes('settings 表'));
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
