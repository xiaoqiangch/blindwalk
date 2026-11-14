import test from 'node:test';
import assert from 'node:assert/strict';

import { startTestServer, request, register, withCookie } from './helpers.mjs';

// 「被找到」回执：作者要能在自己的入口看到，登录和匿名设备标识都要能用。

function surpriseBody() {
  return {
    lat: 32.0601,
    lon: 118.7712,
    areaLabel: '鼓楼 · 巷口',
    message: '这张是我等咖啡时拍的。',
    clues: ['往灯最暖的那扇窗走', '抬头看二楼'],
    radiusMeters: 60,
    authorEmoji: '🫥'
  };
}

test('惊喜回执：匿名作者按设备标识能看到被找到', async () => {
  const server = await startTestServer();
  try {
    const device = { 'X-WA-Device': 'device-abc-123' };
    const created = await request(server.base, 'POST', '/api/surprises', surpriseBody(), device);
    assert.equal(created.status, 200);
    assert.equal(created.json.ok, true);
    const id = created.json.surprise.id;

    // 刚埋下：作者这边是 waiting
    const before = await request(server.base, 'GET', '/api/surprises/mine', undefined, device);
    assert.equal(before.status, 200);
    assert.equal(before.json.items.length, 1);
    assert.equal(before.json.items[0].status, 'waiting');
    assert.equal(before.json.items[0].finderName, null);

    // 另一个登录用户找到它
    const finder = await register(server.base, 'finder1', 'secret123');
    const claimed = await request(
      server.base,
      'POST',
      `/api/surprises/${id}/find`,
      {},
      withCookie(finder.cookie)
    );
    assert.equal(claimed.status, 200);
    assert.equal(claimed.json.ok, true);

    // 作者这边出现回执：found + 寻者名 + 时间
    const after = await request(server.base, 'GET', '/api/surprises/mine', undefined, device);
    assert.equal(after.status, 200);
    const item = after.json.items.find((entry) => entry.id === id);
    assert.ok(item, '作者应该能看到自己那条');
    assert.equal(item.status, 'found');
    assert.equal(item.finderName, 'finder1');
    assert.equal(typeof item.foundAt, 'number');
  } finally {
    await server.close();
  }
});

test('惊喜回执：既没登录也没设备标识 → 401', async () => {
  const server = await startTestServer();
  try {
    const result = await request(server.base, 'GET', '/api/surprises/mine');
    assert.equal(result.status, 401);
  } finally {
    await server.close();
  }
});

test('惊喜回执：登录作者按账号看得到自己的回执', async () => {
  const server = await startTestServer();
  try {
    const author = await register(server.base, 'author1', 'secret123');
    const created = await request(
      server.base,
      'POST',
      '/api/surprises',
      surpriseBody(),
      withCookie(author.cookie)
    );
    assert.equal(created.status, 200);

    const mine = await request(server.base, 'GET', '/api/surprises/mine', undefined, withCookie(author.cookie));
    assert.equal(mine.status, 200);
    assert.equal(mine.json.items.length, 1);
    assert.equal(mine.json.items[0].status, 'waiting');
  } finally {
    await server.close();
  }
});
