import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { SurpriseAdminService, resolveAccountDbPath, SurpriseAdminError } from '../server/surprises.mjs';

function makeAccountDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-sup-'));
  // 按真实部署布局：<root>/account/blindwalk-users.db + <root>/admin
  fs.mkdirSync(path.join(dir, 'account'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'admin'), { recursive: true });
  const dbPath = path.join(dir, 'account', 'blindwalk-users.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE surprises (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, author_name TEXT NOT NULL, author_emoji TEXT,
      lat REAL NOT NULL, lon REAL NOT NULL, area_label TEXT, message TEXT, clues TEXT NOT NULL,
      radius_meters REAL NOT NULL DEFAULT 60, photo_data TEXT, photo_hash TEXT,
      status TEXT NOT NULL DEFAULT 'waiting', finder_name TEXT, found_at INTEGER, created_at INTEGER NOT NULL
    );`);
  const insert = db.prepare(`INSERT INTO surprises
    (id,user_id,author_name,author_emoji,lat,lon,area_label,message,clues,radius_meters,photo_data,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run('s1','u1','alice','🐱',32.06,118.77,'鼓楼','你好','["a","b"]',60,'data:image/jpeg;base64,AAAA','waiting',1000);
  insert.run('s2','u2','bob','🦊',32.07,118.78,'玄武','已找到','["c"]',80,null,'found',2000);
  insert.run('s3','u1','alice','🐱',32.08,118.79,'秦淮','隐藏的','["d"]',60,null,'hidden',3000);
  db.close();
  return { dir, dbPath };
}

test('resolveAccountDbPath 认 blindwalk-users.db（老部署）', () => {
  const { dir, dbPath } = makeAccountDb();
  assert.equal(resolveAccountDbPath({ adminDataDir: path.join(dir, 'admin') }), dbPath);
  assert.equal(resolveAccountDbPath({ env: { WA_ACCOUNT_DB: dbPath } }), dbPath);
});

test('list：按状态过滤 + counts', () => {
  const { dbPath } = makeAccountDb();
  const svc = new SurpriseAdminService({ env: { WA_ACCOUNT_DB: dbPath } });
  try {
    assert.equal(svc.available, true);
    const waiting = svc.list({ status: 'waiting' });
    assert.equal(waiting.items.length, 1);
    assert.equal(waiting.items[0].id, 's1');
    assert.equal(waiting.counts.found, 1);
    assert.equal(waiting.counts.hidden, 1);
    // 默认按 created_at 倒序
    const all = svc.list({ status: 'all' });
    assert.deepEqual(all.items.map(i => i.id), ['s3', 's2', 's1']);
  } finally { svc.close(); }
});

test('list：q 搜区域/留言/作者/ID', () => {
  const { dbPath } = makeAccountDb();
  const svc = new SurpriseAdminService({ env: { WA_ACCOUNT_DB: dbPath } });
  try {
    assert.equal(svc.list({ q: '鼓楼' }).total, 1);
    assert.equal(svc.list({ q: 'bob' }).total, 1);
    assert.equal(svc.list({ q: 's3' }).total, 1);
  } finally { svc.close(); }
});

test('setStatus：waiting ⇄ hidden；found 拒绝', () => {
  const { dbPath } = makeAccountDb();
  const svc = new SurpriseAdminService({ env: { WA_ACCOUNT_DB: dbPath } });
  try {
    assert.equal(svc.setStatus('s1', 'hidden').status, 'hidden');
    assert.equal(svc.setStatus('s1', 'waiting').status, 'waiting');
    assert.throws(() => svc.setStatus('s2', 'hidden'), (e) => e instanceof SurpriseAdminError && e.code === 'ALREADY_FOUND');
    assert.throws(() => svc.setStatus('s1', 'found'), (e) => e.code === 'BAD_REQUEST');
  } finally { svc.close(); }
});

test('photo：解析 data URL；无图抛 NO_PHOTO', () => {
  const { dbPath } = makeAccountDb();
  const svc = new SurpriseAdminService({ env: { WA_ACCOUNT_DB: dbPath } });
  try {
    const photo = svc.photo('s1');
    assert.equal(photo.contentType, 'image/jpeg');
    assert.equal(photo.buffer.length, 3);
    assert.throws(() => svc.photo('s2'), (e) => e.code === 'NO_PHOTO');
  } finally { svc.close(); }
});

test('remove：删掉后查不到', () => {
  const { dbPath } = makeAccountDb();
  const svc = new SurpriseAdminService({ env: { WA_ACCOUNT_DB: dbPath } });
  try {
    assert.equal(svc.remove('s3').ok, true);
    assert.throws(() => svc.get('s3'), (e) => e.code === 'NOT_FOUND');
  } finally { svc.close(); }
});

test('账号库不存在：available=false 且操作用 503', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-sup-empty-'));
  const svc = new SurpriseAdminService({ env: { WA_ACCOUNT_DB: path.join(dir, 'nope.db') } });
  try {
    assert.equal(svc.available, false);
    assert.equal(svc.status().available, false);
    assert.equal(fs.existsSync(path.join(dir, 'nope.db')), false, '不能偷偷建库');
    assert.throws(() => svc.list({}), (e) => e.code === 'SURPRISES_UNAVAILABLE' && e.status === 503);
  } finally { svc.close(); }
});
