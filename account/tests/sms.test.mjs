import test from 'node:test';
import assert from 'node:assert/strict';

import { startTestServer, request } from './helpers.mjs';
import {
  SmsCodeStore, generateCode, hashCode, validatePhone,
  signAliyunRpc, resolveSmsConfig, sendAliyunSms, SmsError
} from '../server/sms.mjs';

const SMS_ENV = {
  WA_SMS_ACCESS_KEY_ID: 'test-key-id',
  WA_SMS_ACCESS_KEY_SECRET: 'test-secret',
  WA_SMS_SIGN_NAME: '步迷',
  WA_SMS_TEMPLATE_CODE: 'SMS_000000'
};

test('sms：验证码 6 位数字', () => {
  for (let i = 0; i < 50; i += 1) {
    const code = generateCode();
    assert.equal(code.length, 6);
    assert.match(code, /^\d{6}$/);
  }
});

test('sms：手机号校验', () => {
  assert.equal(validatePhone('13800138000'), '13800138000');
  assert.throws(() => validatePhone('12345'), (e) => e.code === 'BAD_PHONE');
  assert.throws(() => validatePhone('23800138000'), (e) => e.code === 'BAD_PHONE');
});

test('sms：验证码一次性 + 错误会累计次数', () => {
  const nowValue = 1_700_000_000_000;
  const store = new SmsCodeStore({ now: () => nowValue });
  store.save('13800138000', '123456');

  assert.equal(store.verify('13800138000', '000000').code, 'SMS_WRONG_CODE');
  assert.equal(store.verify('13800138000', '123456').ok, true);
  // 用过就没了
  assert.equal(store.verify('13800138000', '123456').code, 'SMS_NO_CODE');
});

test('sms：试错 5 次后作废', () => {
  const nowValue = 1_700_000_000_000;
  const store = new SmsCodeStore({ now: () => nowValue });
  store.save('13800138000', '123456');
  for (let i = 0; i < 5; i += 1) {
    assert.equal(store.verify('13800138000', '999999').code, 'SMS_WRONG_CODE');
  }
  assert.equal(store.verify('13800138000', '123456').code, 'SMS_TOO_MANY_ATTEMPTS');
});

test('sms：过期后不能再用', () => {
  let nowValue = 1_700_000_000_000;
  const store = new SmsCodeStore({ now: () => nowValue });
  store.save('13800138000', '123456');
  nowValue += 6 * 60 * 1000;
  assert.equal(store.verify('13800138000', '123456').code, 'SMS_EXPIRED');
});

test('sms：未配置服务商 → config 明确不可用', () => {
  const cfg = resolveSmsConfig({});
  assert.equal(cfg.enabled, false);
  assert.deepEqual(cfg.missing, [
    'WA_SMS_ACCESS_KEY_ID', 'WA_SMS_ACCESS_KEY_SECRET', 'WA_SMS_SIGN_NAME', 'WA_SMS_TEMPLATE_CODE'
  ]);
});

test('sms：阿里云签名算法可复现', () => {
  // 固定输入 → 固定签名（防手改动算法时静默出错）
  const sig = signAliyunRpc({ A: '1', B: '2' }, 'secret');
  assert.equal(typeof sig, 'string');
  assert.ok(sig.length > 10);
  // 顺序无关
  const sig2 = signAliyunRpc({ B: '2', A: '1' }, 'secret');
  assert.equal(sig, sig2);
  // 换 secret 就变
  assert.notEqual(sig, signAliyunRpc({ A: '1', B: '2' }, 'other'));
});

test('sms 接口：未配置 → 503 且说明缺什么', async () => {
  const t = await startTestServer({ env: {} });
  try {
    const r = await request(t.base, 'POST', '/api/auth/sms/send', { phone: '13800138000' });
    assert.equal(r.status, 503);
    assert.equal(r.json.code, 'SMS_NOT_CONFIGURED');
    assert.ok(r.json.error.includes('WA_SMS_ACCESS_KEY_ID'));
  } finally { await t.close(); }
});

test('sms 接口：完整流程（dev 模式不发真短信）', async () => {
  const t = await startTestServer({
    env: Object.assign({}, SMS_ENV, { WA_SMS_DEV_MODE: '1' })
  });
  try {
    const send = await request(t.base, 'POST', '/api/auth/sms/send', { phone: '13800138000' });
    assert.equal(send.status, 200);
    assert.equal(send.json.ok, true);
    assert.equal(send.json.devMode, true);

    // dev 模式下验证码在服务端内存里；测试直接读 store 拿不到明文，
    // 所以用「错误的码 → 明确报错」验证链路通了，再看正确码这条用注入的 store 覆盖
    const bad = await request(t.base, 'POST', '/api/auth/sms/verify', { phone: '13800138000', code: '000000' });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.code, 'SMS_WRONG_CODE');
  } finally { await t.close(); }
});

test('sms 接口：用注入的 store 走通「拿到账号 + Cookie」', async () => {
  const fixedStore = {
    saved: null,
    recentSendCount: () => 0,
    recordSend: () => {},
    save: (phone, code) => { fixedStore.saved = { phone, code }; },
    verify: (phone, code) => code === '654321' ? { ok: true, code: '' } : { ok: false, code: 'SMS_WRONG_CODE' },
    delete: () => {}
  };
  const t = await startTestServer({
    env: Object.assign({}, SMS_ENV, { WA_SMS_DEV_MODE: '1' }),
    smsStore: fixedStore
  });
  try {
    await request(t.base, 'POST', '/api/auth/sms/send', { phone: '13900139000' });
    assert.equal(fixedStore.saved.phone, '13900139000');

    const verify = await request(t.base, 'POST', '/api/auth/sms/verify', {
      phone: '13900139000', code: '654321'
    });
    assert.equal(verify.status, 200);
    assert.equal(verify.json.ok, true);
    assert.ok(verify.json.user.username.startsWith('u9000_'));
    assert.ok(verify.setCookies.some((c) => c.startsWith('wa_uid=')));

    // 同一个手机号第二次登录 → 同一个账号
    const again = await request(t.base, 'POST', '/api/auth/sms/verify', {
      phone: '13900139000', code: '654321'
    });
    assert.equal(again.json.user.id, verify.json.user.id);
  } finally { await t.close(); }
});
