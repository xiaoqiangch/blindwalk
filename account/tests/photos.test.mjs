import test from 'node:test';
import assert from 'node:assert/strict';

import { startTestServer, request, register, withCookie } from './helpers.mjs';

// 到达实拍：按地点存、只有本人能取、超过大小上限明确拒绝。

const TINY_JPEG = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-bytes').toString('base64');

test('到达照片：登录后可上传/取回，未登录 401', async () => {
  const server = await startTestServer();
  try {
    const user = await register(server.base, 'photouser', 'secret123');

    const upload = await request(
      server.base,
      'POST',
      '/api/photos',
      { placeId: 'curated-abc', dataUrl: TINY_JPEG },
      withCookie(user.cookie)
    );
    assert.equal(upload.status, 200);
    assert.equal(upload.json.ok, true);
    assert.equal(upload.json.path, '/api/photos/curated-abc');

    const fetched = await fetch(server.base + '/api/photos/curated-abc', {
      headers: withCookie(user.cookie)
    });
    assert.equal(fetched.status, 200);
    assert.equal(fetched.headers.get('content-type'), 'image/jpeg');
    const bytes = Buffer.from(await fetched.arrayBuffer());
    assert.equal(bytes.toString('utf8'), 'fake-jpeg-bytes');

    const anonymous = await fetch(server.base + '/api/photos/curated-abc');
    assert.equal(anonymous.status, 401);
  } finally {
    await server.close();
  }
});

test('到达照片：别的账号看不到我的照片', async () => {
  const server = await startTestServer();
  try {
    const mine = await register(server.base, 'photoa', 'secret123');
    const other = await register(server.base, 'photob', 'secret123');
    await request(
      server.base,
      'POST',
      '/api/photos',
      { placeId: 'curated-xyz', dataUrl: TINY_JPEG },
      withCookie(mine.cookie)
    );

    const fetched = await fetch(server.base + '/api/photos/curated-xyz', {
      headers: withCookie(other.cookie)
    });
    assert.equal(fetched.status, 404);
  } finally {
    await server.close();
  }
});

test('到达照片：非图片 data URL 与超限都被拒绝', async () => {
  const server = await startTestServer();
  try {
    const user = await register(server.base, 'photoc', 'secret123');

    const bad = await request(
      server.base,
      'POST',
      '/api/photos',
      { placeId: 'p1', dataUrl: 'data:text/plain;base64,aGk=' },
      withCookie(user.cookie)
    );
    assert.equal(bad.status, 400);
    assert.equal(bad.json.code, 'BAD_PHOTO');

    const huge = 'data:image/jpeg;base64,' + Buffer.alloc(700 * 1024, 1).toString('base64');
    const tooLarge = await request(
      server.base,
      'POST',
      '/api/photos',
      { placeId: 'p1', dataUrl: huge },
      withCookie(user.cookie)
    );
    assert.equal(tooLarge.status, 413);
    assert.equal(tooLarge.json.code, 'PHOTO_TOO_LARGE');
  } finally {
    await server.close();
  }
});

test('到达照片：二次上传覆盖同一张（每个地点一张）', async () => {
  const server = await startTestServer();
  try {
    const user = await register(server.base, 'photod', 'secret123');
    const first = 'data:image/jpeg;base64,' + Buffer.from('first').toString('base64');
    const second = 'data:image/jpeg;base64,' + Buffer.from('second').toString('base64');

    await request(server.base, 'POST', '/api/photos',
      { placeId: 'p2', dataUrl: first }, withCookie(user.cookie));
    const overwrite = await request(server.base, 'POST', '/api/photos',
      { placeId: 'p2', dataUrl: second }, withCookie(user.cookie));
    assert.equal(overwrite.status, 200);

    const fetched = await fetch(server.base + '/api/photos/p2', {
      headers: withCookie(user.cookie)
    });
    const bytes = Buffer.from(await fetched.arrayBuffer());
    assert.equal(bytes.toString('utf8'), 'second');
  } finally {
    await server.close();
  }
});
