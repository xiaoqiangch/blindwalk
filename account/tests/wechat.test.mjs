import test from 'node:test';
import assert from 'node:assert/strict';

import { startTestServer, request } from './helpers.mjs';

const ENV = {
  WA_WECHAT_APPID: 'wxtestappid',
  WA_WECHAT_SECRET: 'test-secret'
};

/** 假微信：按 code 返回固定 openid，并在第二次调用时返回 errcode */
function fakeWeChat(state) {
  return async (url) => {
    const s = String(url);
    if (s.includes('/sns/oauth2/access_token')) {
      const code = new URL(s).searchParams.get('code');
      if (code === 'bad-code') {
        return { json: async () => ({ errcode: 40029, errmsg: 'invalid code' }) };
      }
      state.tokenCalls = (state.tokenCalls || 0) + 1;
      return {
        json: async () => ({
          access_token: 'at', openid: 'oid-' + code, unionid: 'uid-' + code, expires_in: 7200
        })
      };
    }
    if (s.includes('/sns/userinfo')) {
      return { json: async () => ({ nickname: '小明', headimgurl: 'https://x/y.jpg' }) };
    }
    throw new Error('unexpected url ' + s);
  };
}

test('未配置微信：config 明确说不可用，登录返回 503', async () => {
  const t = await startTestServer({ env: {} });
  try {
    const cfg = await request(t.base, 'GET', '/api/auth/wechat/config');
    assert.equal(cfg.status, 200);
    assert.equal(cfg.json.wechat.enabled, false);
    assert.deepEqual(cfg.json.wechat.missing, ['WA_WECHAT_APPID', 'WA_WECHAT_SECRET']);
    assert.equal(cfg.json.wechat.appid, null);

    const login = await request(t.base, 'POST', '/api/auth/wechat', { code: 'abc' });
    assert.equal(login.status, 503);
    assert.equal(login.json.code, 'WECHAT_NOT_CONFIGURED');
  } finally { await t.close(); }
});

test('已配置：code 换 openid，自动建号并下发会话 Cookie', async () => {
  const state = {};
  const t = await startTestServer({ env: ENV, wechatFetch: fakeWeChat(state) });
  try {
    const cfg = await request(t.base, 'GET', '/api/auth/wechat/config');
    assert.equal(cfg.json.wechat.enabled, true);
    assert.equal(cfg.json.wechat.appid, 'wxtestappid');
    assert.equal(cfg.json.wechat.secret, undefined, '不能把 secret 下发');

    const login = await request(t.base, 'POST', '/api/auth/wechat', { code: 'c1' });
    assert.equal(login.status, 200);
    assert.equal(login.json.ok, true);
    assert.equal(login.json.user.username, '小明');
    assert.ok(login.setCookies.some((c) => c.startsWith('wa_uid=')));

    // 同一个 openid 再来一次 → 复用同一个账号，不会重复建号
    const again = await request(t.base, 'POST', '/api/auth/wechat', { code: 'c1' });
    assert.equal(again.json.user.id, login.json.user.id);
    assert.equal(again.json.user.username, '小明');
  } finally { await t.close(); }
});

test('微信返回 invalid code → 400 且提示重新授权', async () => {
  const t = await startTestServer({ env: ENV, wechatFetch: fakeWeChat({}) });
  try {
    const r = await request(t.base, 'POST', '/api/auth/wechat', { code: 'bad-code' });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, 'WECHAT_CODE_INVALID');
  } finally { await t.close(); }
});

test('昵称带特殊字符 → 用户名被清洗成合法值', async () => {
  const t = await startTestServer({
    env: ENV,
    wechatFetch: async (url) => {
      const s = String(url);
      if (s.includes('/sns/oauth2/access_token')) {
        return { json: async () => ({ access_token: 'at', openid: 'oid-x' }) };
      }
      return { json: async () => ({ nickname: 'A/B/C 丶测试🎉' }) };
    }
  });
  try {
    const r = await request(t.base, 'POST', '/api/auth/wechat', { code: 'c9' });
    assert.equal(r.status, 200);
    // 斜杠、空格、emoji 被清掉；「丶」是 U+4E36（CJK），属于合法用户名字符
    assert.equal(r.json.user.username, 'ABC丶测试');
  } finally { await t.close(); }
});
