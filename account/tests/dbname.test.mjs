import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveDbFileName, AccountStore, DB_FILENAME } from '../server/db.mjs';

test('库名解析：默认新库名', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-db-'));
  assert.equal(resolveDbFileName(dir), DB_FILENAME);
});

test('库名解析：已有 blindwalk-users.db 时沿用它（不新建空库）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-db-'));
  fs.writeFileSync(path.join(dir, 'blindwalk-users.db'), '');
  assert.equal(resolveDbFileName(dir), 'blindwalk-users.db');
});

test('库名解析：新库已存在时优先新库', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-db-'));
  fs.writeFileSync(path.join(dir, 'blindwalk-users.db'), '');
  fs.writeFileSync(path.join(dir, DB_FILENAME), '');
  assert.equal(resolveDbFileName(dir), DB_FILENAME);
});

test('AccountStore 沿用老库：写进去的用户能读出来', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-db-'));
  fs.writeFileSync(path.join(dir, 'blindwalk-users.db'), '');
  const store = new AccountStore({ dataDir: dir });
  try {
    assert.ok(store.dbPath.endsWith('blindwalk-users.db'));
    store.createUser('alice', 'h', 's', 1);
    assert.equal(store.findUserByUsername('alice').username, 'alice');
  } finally { store.close(); }
  assert.equal(fs.existsSync(path.join(dir, DB_FILENAME)), false, '不能顺手建一个空的新库');
});
