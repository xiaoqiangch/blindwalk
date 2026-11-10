import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword,
  verifyPassword,
  randomToken,
  parseCookies,
  sessionCookie,
  clearCookie,
  corsHeaders,
  validateUsername,
  validatePassword
} from '../shared.mjs';

test('密码：哈希后可验证，错误密码失败，盐不同哈希不同', async () => {
  const a = await hashPassword('secret123');
  const b = await hashPassword('secret123');
  assert.notEqual(a, b, '每次独立盐');
  assert.equal(await verifyPassword('secret123', a), true);
  assert.equal(await verifyPassword('secret124', a), false);
  assert.equal(a.split('$')[0], 'pbkdf2');
});

test('密码：损坏的 hash 不崩溃', async () => {
  assert.equal(await verifyPassword('x', 'garbage'), false);
  assert.equal(await verifyPassword('x', ''), false);
  assert.equal(await verifyPassword('x', null), false);
});

test('token：32 字节十六进制且不重复', () => {
  const a = randomToken();
  const b = randomToken();
  assert.equal(a.length, 64);
  assert.match(a, /^[0-9a-f]+$/);
  assert.notEqual(a, b);
});

test('cookie：跨站必须 SameSite=None + Secure', () => {
  const c = sessionCookie('tok', 3600);
  assert.match(c, /SameSite=None/);
  assert.match(c, /Secure/);
  assert.match(c, /HttpOnly/);
  assert.match(c, /bw_uid=tok/);
  assert.match(clearCookie(), /Max-Age=0/);
});

test('cookie 解析', () => {
  const parsed = parseCookies('a=1; bw_uid=abc%3D; c=3');
  assert.equal(parsed.bw_uid, 'abc=');
  assert.deepEqual(parseCookies(''), {});
  assert.deepEqual(parseCookies(undefined), {});
});

test('CORS：白名单回显与通配，非白名单拒绝', () => {
  const allowed = 'https://xiaoqiangch.github.io,http://127.0.0.1:*,http://localhost:5173';
  const ok = corsHeaders('https://xiaoqiangch.github.io', allowed);
  assert.equal(ok.ok, true);
  assert.equal(ok.headers['Access-Control-Allow-Origin'], 'https://xiaoqiangch.github.io');
  assert.equal(ok.headers['Access-Control-Allow-Credentials'], 'true');
  assert.equal(ok.headers['Cache-Control'], 'no-store');

  assert.equal(corsHeaders('http://127.0.0.1:8799', allowed).ok, true);
  assert.equal(corsHeaders('http://localhost:5173', allowed).ok, true);
  assert.equal(corsHeaders('https://evil.example', allowed).ok, false);
  // 跨站 cookie 场景下绝不能返回 *
  assert.notEqual(ok.headers['Access-Control-Allow-Origin'], '*');
});

test('用户名 / 密码校验', () => {
  assert.equal(validateUsername('abc'), true);
  assert.equal(validateUsername('用户_123'), true);
  assert.equal(validateUsername('ab'), false);
  assert.equal(validateUsername('a'.repeat(25)), false);
  assert.equal(validateUsername('bad name'), false);
  assert.equal(validatePassword('123456'), true);
  assert.equal(validatePassword('12345'), false);
});
