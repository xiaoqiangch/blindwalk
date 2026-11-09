import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PoiStore, DUPLICATE_DISTANCE_METERS } from '../server/store.mjs';
import { SCHEMA_VERSION } from '../server/db.mjs';

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-store-'));
  tempDirs.push(dir);
  return dir;
}

const silentLogger = { log() {}, warn() {} };

function makeStore(dir) {
  return new PoiStore({ dataDir: dir, logger: silentLogger });
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

test('SQLite：新建 / 读取 / 列表 / 更新 / 删除 + 落库 + 表结构', () => {
  const dir = makeTempDir();
  const store = makeStore(dir);
  assert.equal(store.count(), 0);
  assert.ok(fs.existsSync(store.dbPath), 'blindwalk.db 应存在');
  assert.equal(store.dbPath, path.join(dir, 'blindwalk.db'));

  const tables = store.db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
  ).all().map((row) => row.name);
  assert.ok(tables.includes('pois'));
  assert.ok(tables.includes('meta'));
  assert.ok(tables.includes('sessions'));
  assert.equal(store.db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(store.db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version').value,
    String(SCHEMA_VERSION));

  const created = store.create(input());
  assert.match(created.id, /^poi-/);
  assert.equal(store.count(), 1);
  assert.equal(store.get(created.id).name, '上海音乐厅');
  assert.equal(store.load().items.length, 1);

  const updated = store.update(created.id, { status: 'approved', summary: '改过的简介' });
  assert.equal(updated.status, 'approved');
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(store.get(created.id).summary, '改过的简介');

  store.remove(created.id);
  assert.equal(store.count(), 0);
  assert.equal(store.get(created.id), null);
  assert.throws(() => store.update('poi-缺省', { status: 'draft' }), (error) => {
    assert.equal(error.code, 'NOT_FOUND');
    return true;
  });
  assert.throws(() => store.remove('poi-缺省'), (error) => {
    assert.equal(error.code, 'NOT_FOUND');
    return true;
  });

  // 重新打开：SQLite 持久化生效
  store.close();
  const reopened = makeStore(dir);
  assert.equal(reopened.count(), 0, '删除后重开应为空');
  const second = reopened.create(input({ name: '重开后新建' }));
  reopened.close();
  const again = makeStore(dir);
  assert.equal(again.get(second.id).name, '重开后新建');
  again.close();
});

test('SQLite：列表筛选（status / q / category / hasPhoto / 分页 / updatedAt 倒序）', async () => {
  const store = makeStore(makeTempDir());
  const a = store.create(input({ name: '上海音乐厅', category: 'venue' }));
  await new Promise((resolve) => setTimeout(resolve, 5));
  const b = store.create(input({ name: '人民公园', category: 'park', photoUrl: null, photoCredit: null }));
  await new Promise((resolve) => setTimeout(resolve, 5));
  store.update(a.id, { status: 'approved' });

  const all = store.list({});
  assert.equal(all.total, 2);
  assert.equal(all.items[0].id, a.id, '刚更新的应排在最前');

  assert.equal(store.list({ status: 'approved' }).total, 1);
  assert.equal(store.list({ category: 'park' }).items[0].id, b.id);
  assert.equal(store.list({ q: '音乐' }).total, 1);
  assert.equal(store.list({ q: '音乐' }).items[0].id, a.id);
  assert.equal(store.list({ hasPhoto: false }).total, 1);
  assert.equal(store.list({ hasPhoto: true }).total, 1);

  const paged = store.list({ limit: 1, offset: 1 });
  assert.equal(paged.total, 2);
  assert.equal(paged.items.length, 1);
  store.close();
});

test('SQLite：同名 / 30m 内去重', () => {
  const store = makeStore(makeTempDir());
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
  store.close();
});

test('SQLite：批量导入（库内 + 本批去重）', () => {
  const store = makeStore(makeTempDir());
  store.create(input({ name: '上海音乐厅' }));

  const result = store.addCandidates([
    input({ name: '上海音乐厅', lat: 30, lon: 120 }),
    input({ name: '人民公园', lat: 31.2304, lon: 121.4737, category: 'park', photoUrl: null, photoCredit: null }),
    input({ name: '人民公园二号', lat: 31.23041, lon: 121.47371, category: 'park', photoUrl: null, photoCredit: null }),
    input({ name: '外滩', lat: 31.24, lon: 121.49, category: 'river' }),
    input({ name: '无坐标', lat: undefined, lon: undefined, category: 'park' })
  ]);

  assert.equal(result.added, 2);
  assert.equal(result.skipped, 3);
  assert.equal(store.count(), 3);
  assert.ok(result.items.every((poi) => poi.status === 'draft'));
  store.close();
});

test('迁移：pois.json → SQLite，条数一致，原文件改名 .migrated-<ts>', () => {
  const dir = makeTempDir();
  const legacy = {
    version: 1,
    updatedAt: 123,
    items: [
      {
        id: 'poi-aaaaaa', name: '上海音乐厅', lat: 31.22888889, lon: 121.47333333,
        category: 'venue', emoji: '🎻', rarity: 'epic', area: 'oldtown',
        address: '黄浦区 · 延安东路', photoUrl: 'https://upload.wikimedia.org/x.jpg',
        photoCredit: 'Wikimedia Commons', summary: '原名南京大戏院。',
        why: '第一行\n第二行', task: '找一张海报', hints: ['一条线索', '第二条', '第三条'],
        tags: ['历史建筑'], status: 'approved', source: 'wikipedia',
        createdAt: 111, updatedAt: 222
      },
      {
        id: 'poi-bbbbbb', name: '人民公园', lat: 31.232, lon: 121.472,
        category: 'park', status: 'draft', source: 'wikipedia',
        createdAt: 333, updatedAt: 444
      }
    ]
  };
  fs.writeFileSync(path.join(dir, 'pois.json'), JSON.stringify(legacy, null, 2), 'utf8');

  const store = makeStore(dir);
  assert.equal(store.count(), 2, '迁移前后条数一致');
  assert.equal(store.migration.migrated, true);
  assert.equal(store.migration.count, 2);
  assert.equal(store.get('poi-aaaaaa').name, '上海音乐厅');
  assert.equal(store.get('poi-bbbbbb').status, 'draft');
  assert.ok(fs.existsSync(path.join(dir, 'blindwalk.db')));

  const migratedFiles = fs.readdirSync(dir).filter((name) => name.startsWith('pois.json.migrated-'));
  assert.equal(migratedFiles.length, 1, '原 pois.json 应改名为 .migrated-<ts>');
  assert.equal(fs.existsSync(path.join(dir, 'pois.json')), false);
  store.close();

  // 再次启动：库非空，不应重复迁移
  const reopened = makeStore(dir);
  assert.equal(reopened.count(), 2);
  assert.equal(reopened.migration.migrated, false);
  reopened.close();
});

test('迁移：pois.json 损坏 → 备份 .corrupt-<ts>，从空库启动且可继续写入', () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, 'pois.json'), '{这不是合法 JSON', 'utf8');

  const store = makeStore(dir);
  assert.equal(store.count(), 0);
  assert.equal(store.migration.corrupted, true);
  const backups = fs.readdirSync(dir).filter((name) => name.includes('.corrupt-'));
  assert.equal(backups.length, 1, '应生成 .corrupt-<ts> 备份');
  assert.equal(fs.readFileSync(path.join(dir, backups[0]), 'utf8'), '{这不是合法 JSON');

  const created = store.create(input());
  assert.equal(store.get(created.id).name, '上海音乐厅');
  store.close();
});

test('迁移：坏条目整体回滚、保留原文件、不丢数据', () => {
  const dir = makeTempDir();
  const legacy = {
    version: 1,
    items: [
      { id: 'poi-aaaaaa', name: '好地点', lat: 31.2, lon: 121.4, category: 'park', status: 'draft', source: 'manual' },
      { junk: true }
    ]
  };
  fs.writeFileSync(path.join(dir, 'pois.json'), JSON.stringify(legacy), 'utf8');

  const store = makeStore(dir);
  assert.equal(store.count(), 0, '坏条目导致整体回滚');
  assert.equal(store.migration.migrated, false);
  assert.ok(store.migration.error);
  assert.ok(fs.existsSync(path.join(dir, 'pois.json')), '原文件应保留，便于人工修复');
  const backups = fs.readdirSync(dir).filter((name) => name.includes('.migrated-'));
  assert.equal(backups.length, 0);
  store.close();
});

test('统计与 approved 过滤', () => {
  const store = makeStore(makeTempDir());
  store.create(input({ status: 'approved', hints: ['一条线索'] }));
  store.create(input({ name: '公园', category: 'park', photoUrl: null, photoCredit: null, status: 'draft' }));
  const stats = store.stats();
  assert.equal(stats.total, 2);
  assert.equal(stats.byStatus.approved, 1);
  assert.equal(stats.withPhoto, 1);
  assert.equal(store.approved().length, 1);
  assert.ok(store.approved()[0].safety.day >= 1);
  store.close();
});
