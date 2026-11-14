import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { decodeJwt, hashNonce, verifyIdentityToken, AppleAuthError, APPLE_ISSUER } from '../server/apple.mjs';

/** 造一对 RSA 密钥 + 一个 JWKS，模拟 Apple */
function makeKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'test-kid';
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  return { jwk, privateKey };
}

function b64u(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signToken(privateKey, payload, kid = 'test-kid') {
  const header = b64u(JSON.stringify({ alg: 'RS256', kid }));
  const body = b64u(JSON.stringify(payload));
  const signature = crypto.sign('RSA-SHA256', Buffer.from(header + '.' + body), privateKey);
  return header + '.' + body + '.' + b64u(signature);
}

function fakeJwksFetch(jwk) {
  return async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
}

const CLIENT_ID = 'com.walkaholic.app';

test('apple：正常 token 通过校验', async () => {
  const { jwk, privateKey } = makeKeypair();
  const now = () => 1_700_000_000_000;
  const token = signToken(privateKey, {
    iss: APPLE_ISSUER,
    aud: CLIENT_ID,
    sub: 'apple-sub-1',
    exp: Math.floor(now() / 1000) + 600,
    iat: Math.floor(now() / 1000),
    email: 'a@privaterelay.appleid.com',
    email_verified: 'true',
    is_private_email: 'true'
  });
  const result = await verifyIdentityToken({
    clientId: CLIENT_ID,
    token,
    now,
    fetchImpl: fakeJwksFetch(jwk),
    jwksCache: { data: null, at: 0 }
  });
  assert.equal(result.sub, 'apple-sub-1');
  assert.equal(result.email, 'a@privaterelay.appleid.com');
  assert.equal(result.isPrivateEmail, true);
});

test('apple：签名被篡改 → APPLE_BAD_SIGNATURE', async () => {
  const { jwk, privateKey } = makeKeypair();
  const now = () => 1_700_000_000_000;
  const good = signToken(privateKey, {
    iss: APPLE_ISSUER, aud: CLIENT_ID, sub: 'x',
    exp: Math.floor(now() / 1000) + 600
  });
  const parts = good.split('.');
  const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  payload.sub = 'hacker';
  parts[1] = b64u(JSON.stringify(payload));
  const tampered = parts.join('.');

  await assert.rejects(
    () => verifyIdentityToken({
      clientId: CLIENT_ID, token: tampered, now,
      fetchImpl: fakeJwksFetch(jwk), jwksCache: { data: null, at: 0 }
    }),
    (e) => e instanceof AppleAuthError && e.code === 'APPLE_BAD_SIGNATURE'
  );
});

test('apple：aud 不匹配 → APPLE_BAD_AUDIENCE', async () => {
  const { jwk, privateKey } = makeKeypair();
  const now = () => 1_700_000_000_000;
  const token = signToken(privateKey, {
    iss: APPLE_ISSUER, aud: 'com.other.app', sub: 'x',
    exp: Math.floor(now() / 1000) + 600
  });
  await assert.rejects(
    () => verifyIdentityToken({
      clientId: CLIENT_ID, token, now,
      fetchImpl: fakeJwksFetch(jwk), jwksCache: { data: null, at: 0 }
    }),
    (e) => e.code === 'APPLE_BAD_AUDIENCE'
  );
});

test('apple：iss 不对 → APPLE_BAD_ISSUER', async () => {
  const { jwk, privateKey } = makeKeypair();
  const now = () => 1_700_000_000_000;
  const token = signToken(privateKey, {
    iss: 'https://evil.example', aud: CLIENT_ID, sub: 'x',
    exp: Math.floor(now() / 1000) + 600
  });
  await assert.rejects(
    () => verifyIdentityToken({
      clientId: CLIENT_ID, token, now,
      fetchImpl: fakeJwksFetch(jwk), jwksCache: { data: null, at: 0 }
    }),
    (e) => e.code === 'APPLE_BAD_ISSUER'
  );
});

test('apple：过期 → APPLE_EXPIRED', async () => {
  const { jwk, privateKey } = makeKeypair();
  const now = () => 1_700_000_000_000;
  const token = signToken(privateKey, {
    iss: APPLE_ISSUER, aud: CLIENT_ID, sub: 'x',
    exp: Math.floor(now() / 1000) - 120
  });
  await assert.rejects(
    () => verifyIdentityToken({
      clientId: CLIENT_ID, token, now,
      fetchImpl: fakeJwksFetch(jwk), jwksCache: { data: null, at: 0 }
    }),
    (e) => e.code === 'APPLE_EXPIRED'
  );
});

test('apple：nonce 必须等于 SHA256(raw)', async () => {
  const { jwk, privateKey } = makeKeypair();
  const now = () => 1_700_000_000_000;
  const raw = 'raw-nonce-123';
  const token = signToken(privateKey, {
    iss: APPLE_ISSUER, aud: CLIENT_ID, sub: 'x',
    exp: Math.floor(now() / 1000) + 600,
    nonce: hashNonce(raw)
  });
  // 正确的 nonce 通过
  const ok = await verifyIdentityToken({
    clientId: CLIENT_ID, token, nonce: raw, now,
    fetchImpl: fakeJwksFetch(jwk), jwksCache: { data: null, at: 0 }
  });
  assert.equal(ok.sub, 'x');
  // 错的 nonce 拒绝
  await assert.rejects(
    () => verifyIdentityToken({
      clientId: CLIENT_ID, token, nonce: 'other', now,
      fetchImpl: fakeJwksFetch(jwk), jwksCache: { data: null, at: 0 }
    }),
    (e) => e.code === 'APPLE_BAD_NONCE'
  );
});

test('apple：没配 clientId → 503', async () => {
  await assert.rejects(
    () => verifyIdentityToken({ clientId: '', token: 'a.b.c' }),
    (e) => e.code === 'APPLE_NOT_CONFIGURED' && e.status === 503
  );
});

test('apple：非法 JWT 格式 → APPLE_BAD_TOKEN', async () => {
  await assert.rejects(
    () => verifyIdentityToken({ clientId: CLIENT_ID, token: 'not-a-jwt', now: () => 0 }),
    (e) => e.code === 'APPLE_BAD_TOKEN'
  );
});

test('decodeJwt：能拆出 header/payload', () => {
  const token = b64u(JSON.stringify({ alg: 'RS256', kid: 'k' })) + '.' +
    b64u(JSON.stringify({ sub: 's' })) + '.' + b64u('sig');
  const d = decodeJwt(token);
  assert.equal(d.header.alg, 'RS256');
  assert.equal(d.payload.sub, 's');
});
