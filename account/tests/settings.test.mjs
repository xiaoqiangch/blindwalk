import test from 'node:test';
import assert from 'node:assert/strict';

import { startTestServer, request } from './helpers.mjs';

const TOKEN = 'admin-token-123';

test('设置：没有管理令牌时一律拒绝写', async () => {
  const t = await startTestServer({ env: {} });
  try {
    const r = await request(t.base, 'GET', '/api/admin/settings', undefined, { 'x-wa-admin-token': TOKEN });
    assert.equal(r.status, 503);
    assert.equal(r.json.code, 'ADMIN_TOKEN_MISSING');
  } finally { await t.close(); }
});

test('设置：令牌不对 → 401', async () => {
  const t = await startTestServer({ env: { WA_ADMIN_TOKEN: TOKEN } });
  try {
    const r = await request(t.base, 'GET', '/api/admin/settings', undefined, { 'x-wa-admin-token': 'nope' });
    assert.equal(r.status, 401);
    assert.equal(r.json.code, 'UNAUTHORIZED');
  } finally { await t.close(); }
});

test('设置：写入微信 appid/secret 后立即生效（不重启）', async () => {
  const t = await startTestServer({ env: { WA_ADMIN_TOKEN: TOKEN } });
  try {
    const before = await request(t.base, 'GET', '/api/admin/settings', undefined, { 'x-wa-admin-token': TOKEN });
    assert.equal(before.json.wechatEnabled, false);

    const put = await request(t.base, 'PUT', '/api/admin/settings', {
      settings: { 'wechat.appid': 'wxdemo', 'wechat.secret': 'supersecretvalue' }
    }, { 'x-wa-admin-token': TOKEN });
    assert.equal(put.status, 200);
    assert.equal(put.json.wechatEnabled, true);
    // secret 只回掩码
    assert.equal(put.json.settings['wechat.secret'].value, 'supe…alue');
    assert.equal(put.json.settings['wechat.appid'].value, 'wxdemo');

    // 公众号/客户端读到的 config 已经启用
    const cfg = await request(t.base, 'GET', '/api/auth/wechat/config');
    assert.equal(cfg.json.wechat.enabled, true);
    assert.equal(cfg.json.wechat.appid, 'wxdemo');
    assert.equal(cfg.json.wechat.secret, undefined);
  } finally { await t.close(); }
});

test('设置：环境变量仍可作默认，数据库覆盖它', async () => {
  const t = await startTestServer({
    env: { WA_ADMIN_TOKEN: TOKEN, WA_WECHAT_APPID: 'wxenv', WA_WECHAT_SECRET: 'envsecret' }
  });
  try {
    const cfg1 = await request(t.base, 'GET', '/api/auth/wechat/config');
    assert.equal(cfg1.json.wechat.appid, 'wxenv');

    await request(t.base, 'PUT', '/api/admin/settings', {
      settings: { 'wechat.appid': 'wxdb' }
    }, { 'x-wa-admin-token': TOKEN });
    const cfg2 = await request(t.base, 'GET', '/api/auth/wechat/config');
    assert.equal(cfg2.json.wechat.appid, 'wxdb');
    assert.equal(cfg2.json.wechat.enabled, true, 'secret 仍来自环境变量');
  } finally { await t.close(); }
});

test('设置：清空某值 → 回到环境变量/未配置', async () => {
  const t = await startTestServer({ env: { WA_ADMIN_TOKEN: TOKEN } });
  try {
    await request(t.base, 'PUT', '/api/admin/settings', {
      settings: { 'wechat.appid': 'wx1', 'wechat.secret': 's1' }
    }, { 'x-wa-admin-token': TOKEN });
    const cleared = await request(t.base, 'PUT', '/api/admin/settings', {
      settings: { 'wechat.appid': '', 'wechat.secret': '' }
    }, { 'x-wa-admin-token': TOKEN });
    assert.equal(cleared.json.wechatEnabled, false);
  } finally { await t.close(); }
});
