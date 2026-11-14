import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { startTestServer, request } from './helpers.mjs';

const CLIENT_ID = 'com.walkaholic.app';

function makeKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'kid-1';
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  return { jwk, privateKey };
}

function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(privateKey, payload, kid = 'kid-1') {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid }));
  const b = b64u(JSON.stringify(payload));
  const s = crypto.sign('RSA-SHA256', Buffer.from(h + '.' + b), privateKey);
  return h + '.' + b + '.' + b64u(s);
}

function fakeFetch(jwk) {
  return async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
}

function tokenFor(privateKey, sub, extra) {
  const nowSec = Math.floor(Date.now() / 1000);
  return sign(privateKey, Object.assign({
    iss: 'https://appleid.apple.com',
    aud: CLIENT_ID,
    sub,
    exp: nowSec + 600,
    iat: nowSec
  }, extra || {}));
}

test('apple 接口：首次登录建号 + 下发 Cookie；再次登录复用同一账号', async () => {
  const { jwk, privateKey } = makeKeypair();
  const t = await startTestServer({
    env: {},
    appleClientId: CLIENT_ID,
    appleFetch: fakeFetch(jwk)
  });
  try {
    const token = tokenFor(privateKey, 'apple-sub-abc', { email: 'u@privaterelay.appleid.com' });
    const first = await request(t.base, 'POST', '/api/auth/apple', {
      identityToken: token,
      fullName: '张小满'
    });
    assert.equal(first.status, 200);
    assert.equal(first.json.ok, true);
    assert.equal(first.json.user.username, '张小满');
    assert.ok(first.setCookies.some((c) => c.startsWith('wa_uid=')));

    const second = await request(t.base, 'POST', '/api/auth/apple', { identityToken: token });
    assert.equal(second.json.user.id, first.json.user.id);
    assert.equal(second.json.user.username, '张小满');
  } finally { await t.close(); }
});

test('apple 接口：没有 fullName 时用 apple_ 前缀兜底', async () => {
  const { jwk, privateKey } = makeKeypair();
  const t = await startTestServer({ env: {}, appleClientId: CLIENT_ID, appleFetch: fakeFetch(jwk) });
  try {
    const r = await request(t.base, 'POST', '/api/auth/apple', {
      identityToken: tokenFor(privateKey, 'abcdef1234567890')
    });
    assert.equal(r.status, 200);
    assert.ok(r.json.user.username.startsWith('apple_'));
    assert.equal(r.json.user.username.length, 'apple_'.length + 8);
  } finally { await t.close(); }
});

test('apple 接口：签名错 → 401，不建账号', async () => {
  const { jwk } = makeKeypair();
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const t = await startTestServer({ env: {}, appleClientId: CLIENT_ID, appleFetch: fakeFetch(jwk) });
  try {
    const forged = tokenFor(other.privateKey, 'evil');
    const r = await request(t.base, 'POST', '/api/auth/apple', { identityToken: forged });
    assert.equal(r.status, 401);
    assert.equal(r.json.code, 'APPLE_BAD_SIGNATURE');
  } finally { await t.close(); }
});

test('providers：一次问清三种登录方式可用性', async () => {
  const t = await startTestServer({ env: {}, appleClientId: CLIENT_ID });
  try {
    const r = await request(t.base, 'GET', '/api/auth/providers');
    assert.equal(r.status, 200);
    assert.equal(r.json.providers.password.enabled, true);
    assert.equal(r.json.providers.apple.enabled, true);
    assert.equal(r.json.providers.apple.clientId, CLIENT_ID);
    assert.equal(r.json.providers.sms.enabled, false);
    assert.ok(r.json.providers.sms.missing.length === 4);
    assert.equal(r.json.providers.wechat.enabled, false);
    // 绝不能把 secret 下发给客户端
    assert.equal(r.json.providers.wechat.secret, undefined);
  } finally { await t.close(); }
});
