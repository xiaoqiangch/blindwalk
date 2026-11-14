import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createServer } from '../server/index.mjs';

const PASSWORD = 'test1234';

async function boot(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-llmset-'));
  const publicDir = path.join(root, 'public');
  fs.mkdirSync(publicDir, { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<h1>x</h1>');
  const server = createServer({
    dataDir: path.join(root, 'data'),
    publicDir,
    exportPath: path.join(root, 'export.json'),
    llmEnv: options.llmEnv || {},
    authEnv: { WA_ADMIN_PASSWORD: PASSWORD },
    mapKeysEnv: {},
    ingestCandidates: async () => ({ items: [] }),
    fetchImpl: options.fetchImpl
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
    base, cookie, server, root,
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
  // 测试直连后端口（线上由 nginx 把 /admin/api/ 剥前缀转成 /api/）
  return fetch(t.base + pathname, init).then(async (r) => ({ status: r.status, json: await r.json() }));
}

test('AI 设置：初始为空 → 离线模式', async () => {
  const t = await boot({ llmEnv: {} });
  try {
    const view = await call(t, 'GET', '/api/llm/settings');
    assert.equal(view.status, 200);
    assert.equal(view.json.llmEnabled, false);
    assert.equal(view.json.source, 'none');
    assert.equal(view.json.settings['llm.baseUrl'].value, 'https://api.deepseek.com/v1');
    assert.equal(view.json.settings['llm.model'].value, 'deepseek-chat');
  } finally { await t.close(); }
});

test('AI 设置：写入 Key 后立即变成 llm 模式，且只回掩码', async () => {
  const t = await boot({ llmEnv: {} });
  try {
    const put = await call(t, 'PUT', '/api/llm/settings', {
      settings: { 'llm.apiKey': 'sk-abcdefghijklmnop', 'llm.model': 'deepseek-chat' }
    });
    assert.equal(put.status, 200);
    assert.equal(put.json.llmEnabled, true);
    assert.equal(put.json.source, 'database');
    assert.equal(put.json.settings['llm.apiKey'].value, 'sk-a…mnop');

    const status = await call(t, 'GET', '/api/llm/status');
    assert.equal(status.json.mode, 'llm');
    assert.equal(status.json.model, 'deepseek-chat');
  } finally { await t.close(); }
});

test('AI 设置：环境变量可作默认，数据库覆盖', async () => {
  const t = await boot({ llmEnv: { WA_LLM_API_KEY: 'sk-env', WA_LLM_MODEL: 'env-model' } });
  try {
    const before = await call(t, 'GET', '/api/llm/settings');
    assert.equal(before.json.llmEnabled, true);
    assert.equal(before.json.source, 'env');
    assert.equal(before.json.settings['llm.model'].value, 'env-model');

    await call(t, 'PUT', '/api/llm/settings', { settings: { 'llm.model': 'db-model' } });
    const after = await call(t, 'GET', '/api/llm/settings');
    assert.equal(after.json.settings['llm.model'].value, 'db-model');
    assert.equal(after.json.llmEnabled, true, 'key 仍来自 env');
  } finally { await t.close(); }
});

test('AI 测试连接：没配 Key → 明确报未配置', async () => {
  const t = await boot({ llmEnv: {} });
  try {
    const r = await call(t, 'POST', '/api/llm/test');
    assert.equal(r.json.ok, false);
    assert.equal(r.json.mode, 'offline');
  } finally { await t.close(); }
});

test('AI 测试连接：401 时错误信息里不出现完整 Key', async () => {
  const t = await boot({
    llmEnv: {},
    fetchImpl: async (url, init) => {
      const key = String(init.headers.Authorization || '').replace('Bearer ', '');
      return {
        ok: false,
        status: 401,
        text: async () => 'Incorrect API key provided: ' + key
      };
    }
  });
  try {
    await call(t, 'PUT', '/api/llm/settings', { settings: { 'llm.apiKey': 'sk-secret-12345678' } });
    const r = await call(t, 'POST', '/api/llm/test');
    assert.equal(r.json.ok, false);
    assert.ok(!r.json.error.includes('sk-secret-12345678'), '不能回显完整 Key');
    assert.ok(r.json.error.includes('sk-s'), '应该是掩码');
  } finally { await t.close(); }
});

test('AI 测试连接：成功时返回模型名', async () => {
  const t = await boot({
    llmEnv: {},
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ model: 'deepseek-chat' }) })
  });
  try {
    await call(t, 'PUT', '/api/llm/settings', { settings: { 'llm.apiKey': 'sk-test' } });
    const r = await call(t, 'POST', '/api/llm/test');
    assert.equal(r.json.ok, true);
    assert.equal(r.json.model, 'deepseek-chat');
  } finally { await t.close(); }
});
