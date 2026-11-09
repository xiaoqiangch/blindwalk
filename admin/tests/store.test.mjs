import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PoiStore, DUPLICATE_DISTANCE_METERS } from '../server/store.mjs';

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-store-'));
  tempDirs.push(dir);
  return dir;
}

test.after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function input(overrides = {}) {
  return {
    name: '上海音乐厅',
    lat: 31.22888889,
    lon: 121.47333333,
    category: 'venue',
    photoUrl: 'https://upload.wikimedia.org/x.jpg',
    photoCredit: 'Wikimedia Commons',
    summary: '原名南京大戏院。',
    ...overrides
  };
}

test('存储：新建 / 读取 / 列表 / 更新 / 删除 + 原子写文件', () => {
  const store = new PoiStore({ dataDir: makeTempDir() });
  assert.equal(store.all().length, 0);

  const created = store.create(input());
  assert.match(created.id, /^poi-/);
  assert.equal(store.all().length, 1);
  assert.equal(store.get(created.id).name, '上海音乐厅');

  const file = store.filePath;
  assert.ok(fs.existsSync(file), 'pois.json 应存在');
  assert.equal(fs.existsSync(file + '.tmp'), false, '临时文件应被 rename 掉');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(parsed.version, 1);
  assert.equal(parsed.items.length, 1);

  const updated = store.update(created.id, { status: 'approved', summary: '改过的简介' });
  assert.equal(updated.status, 'approved');
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(store.get(created.id).summary, '改过的简介');

  store.remove(created.id);
  assert.equal(store.all().length, 0);
  assert.equal(store.get(created.id), null);

  assert.throws(() => store.update('poi-缺省', { status: 'draft' }), (error) => {
    assert.equal(error.code, 'NOT_FOUND');
    return true;
  });
  assert.throws(() => store.remove('poi-缺省'), (error) => {
    assert.equal(error.code, 'NOT_FOUND');
    return true;
  });
});

test('存储：列表筛选（status / q / category / 分页 / updatedAt 倒序）', async () => {
  const store = new PoiStore({ dataDir: makeTempDir() });
  const a = store.create(input({ name: '上海音乐厅', category: 'venue' }));
  await new Promise((resolve) => setTimeout(resolve, 5));
  const b = store.create(input({ name: '人民公园', category: 'park', photoUrl: null, photoCredit: null }));
  await new Promise((resolve) => setTimeout(resolve, 5));
  store.update(a.id, { status: 'approved' });

  const all = store.list({});
  assert.equal(all.total, 2);
  assert.equal(all.items[0].id, a.id, '刚更新的应排在最前');

  const approved = store.list({ status: 'approved' });
  assert.equal(approved.total, 1);
  assert.equal(approved.items[0].id, a.id);

  const parks = store.list({ category: 'park' });
  assert.equal(parks.total, 1);
  assert.equal(parks.items[0].id, b.id);

  const query = store.list({ q: '音乐' });
  assert.equal(query.total, 1);
  assert.equal(query.items[0].id, a.id);

  const noPhoto = store.list({ hasPhoto: false });
  assert.equal(noPhoto.total, 1);

  const paged = store.list({ limit: 1, offset: 1 });
  assert.equal(paged.total, 2);
  assert.equal(paged.items.length, 1);
});

test('去重：同名（忽略大小写/空白）或距离 < 30m', () => {
  const store = new PoiStore({ dataDir: makeTempDir() });
  const base = store.create(input());
  assert.equal(store.findDuplicate({ name: ' 上海音乐厅 ', lat: 0, lon: 0 }).id, base.id);
  assert.equal(store.findDuplicate({ name: '上海音乐厅', lat: 1, lon: 1 }).id, base.id);

  const near = store.findDuplicate({
    name: '另一个名字',
    lat: base.lat + 0.0001, // 约 11m
    lon: base.lon
  });
  assert.equal(near.id, base.id);

  const far = store.findDuplicate({
    name: '另一个名字',
    lat: base.lat + 0.001,
    lon: base.lon
  });
  assert.equal(far, null);
  assert.equal(DUPLICATE_DISTANCE_METERS, 30);
});

test('批量导入：库内去重 + 本批去重，返回 added / skipped', () => {
  const store = new PoiStore({ dataDir: makeTempDir() });
  store.create(input({ name: '上海音乐厅' }));

  const result = store.addCandidates([
    input({ name: '上海音乐厅', lat: 30, lon: 120 }), // 与库内同名
    input({ name: '人民公园', lat: 31.2304, lon: 121.4737, category: 'park', photoUrl: null, photoCredit: null }),
    input({ name: '人民公园二号', lat: 31.23041, lon: 121.47371, category: 'park', photoUrl: null, photoCredit: null }), // 本批 <30m
    input({ name: '外滩', lat: 31.24, lon: 121.49, category: 'river' }),
    input({ name: '无坐标', lat: undefined, lon: undefined, category: 'park' }) // 不合格
  ]);

  assert.equal(result.added, 2);
  assert.equal(result.skipped, 3);
  assert.equal(store.all().length, 3);
  assert.ok(result.items.every((poi) => poi.status === 'draft'));
});

test('损坏容错：坏 JSON → 备份 .corrupt-*，从空库启动且可继续写入', () => {
  const dir = makeTempDir();
  const file = path.join(dir, 'pois.json');
  fs.writeFileSync(file, '{这不是合法 JSON', 'utf8');

  const store = new PoiStore({ dataDir: dir });
  assert.deepEqual(store.all(), []);

  const backups = fs.readdirSync(dir).filter((name) => name.includes('.corrupt-'));
  assert.equal(backups.length, 1, '应生成 .corrupt-<ts> 备份');
  assert.equal(fs.readFileSync(path.join(dir, backups[0]), 'utf8'), '{这不是合法 JSON');

  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(parsed.items, []);
  const created = store.create(input());
  assert.equal(store.get(created.id).name, '上海音乐厅');
});

test('部分损坏：保留合法条目并写回', () => {
  const dir = makeTempDir();
  const file = path.join(dir, 'pois.json');
  const good = {
    id: 'poi-aaaaaa', name: '好地点', lat: 31.2, lon: 121.4, category: 'park',
    status: 'draft', source: 'manual', createdAt: 1, updatedAt: 1
  };
  fs.writeFileSync(file, JSON.stringify({ version: 1, items: [good, { junk: true }, null] }), 'utf8');

  const store = new PoiStore({ dataDir: dir });
  assert.equal(store.all().length, 1);
  assert.equal(store.all()[0].id, 'poi-aaaaaa');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(parsed.items.length, 1, '坏条目应从文件里清掉');
});

test('统计与 approved 过滤', () => {
  const store = new PoiStore({ dataDir: makeTempDir() });
  store.create(input({ status: 'approved', hints: ['一条线索'] }));
  store.create(input({ name: '公园', category: 'park', photoUrl: null, photoCredit: null, status: 'draft' }));
  const stats = store.stats();
  assert.equal(stats.total, 2);
  assert.equal(stats.byStatus.approved, 1);
  assert.equal(stats.withPhoto, 1);
  assert.equal(store.approved().length, 1);
});
