import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createServer } from '../server/index.mjs';
import { resolveStaticPath } from '../server/static.mjs';

const tempDirs = [];
let server;
let base;
let dataDir;
let publicDir;
let exportPath;

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-server-'));
  tempDirs.push(dir);
  return dir;
}

before(async () => {
  const root = makeTempDir();
  dataDir = path.join(root, 'data');
  publicDir = path.join(root, 'public');
  exportPath = path.join(root, 'export', 'pois.json');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(publicDir, { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><h1>POI 管理后台</h1>');
  fs.writeFileSync(path.join(publicDir, 'app.js'), 'export const answer = 42;');

  server = createServer({
    dataDir,
    publicDir,
    exportPath,
    llmEnv: {},
    ingestCandidates: async () => ({
      source: 'wikipedia',
      items: [
        {
          name: '人民公园',
          lat: 31.232,
          lon: 121.472,
          category: 'park',
          photoUrl: 'https://upload.wikimedia.org/a.jpg',
          photoCredit: 'Wikimedia Commons',
          summary: '上海市中心的一座公园。',
          source: 'wikipedia'
        },
        {
          name: '人民公园',
          lat: 31.24,
          lon: 121.49,
          category: 'park',
          photoUrl: 'https://upload.wikimedia.org/b.jpg',
          photoCredit: 'Wikimedia Commons',
          summary: '同名重复项。',
          source: 'wikipedia'
        },
        {
          name: '外滩',
          lat: 31.24,
          lon: 121.49,
          category: 'river',
          photoUrl: 'https://upload.wikimedia.org/c.jpg',
          photoCredit: 'Wikimedia Commons',
          summary: '黄浦江畔的历史建筑群。',
          source: 'wikipedia'
        }
      ]
    })
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

async function api(method, pathname, body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    if (typeof body === 'string') {
      options.headers['Content-Type'] = 'application/json';
      options.body = body;
    } else {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
  }
  const response = await fetch(base + pathname, { ...options, redirect: 'manual' });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (error) {
    json = null;
  }
  return {
    status: response.status,
    json,
    text,
    contentType: response.headers.get('content-type') || '',
    location: response.headers.get('location')
  };
}

function sampleBody(overrides = {}) {
  return {
    name: '上海音乐厅',
    lat: 31.22888889,
    lon: 121.47333333,
    category: 'venue',
    summary: '原名南京大戏院，1930 年建成。',
    address: '黄浦区 · 延安东路',
    photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/x.jpg',
    photoCredit: 'Wikimedia Commons',
    ...overrides
  };
}

let createdId = '';
let approvedId = '';

test('状态 / 静态文件 / 404', async () => {
  const status = await api('GET', '/api/llm/status');
  assert.equal(status.status, 200);
  assert.equal(status.json.mode, 'offline');
  assert.equal(status.json.ready, true);
  assert.ok(status.contentType.includes('application/json'));

  const index = await api('GET', '/admin/');
  assert.equal(index.status, 200);
  assert.ok(index.contentType.includes('text/html'));
  assert.ok(index.text.includes('POI 管理后台'));

  const js = await api('GET', '/admin/app.js');
  assert.equal(js.status, 200);
  assert.ok(js.contentType.includes('javascript'));

  const root = await api('GET', '/');
  assert.equal(root.status, 302);
  assert.equal(root.location, '/admin/');

  const traversal = await api('GET', '/admin/%2e%2e/package.json');
  assert.ok([400, 404].includes(traversal.status), '目录穿越必须被拒绝，实际 ' + traversal.status);
  assert.equal(resolveStaticPath(publicDir, '/../package.json'), null);
  assert.equal(resolveStaticPath(publicDir, '/%2e%2e/package.json'), null);
  assert.equal(resolveStaticPath(publicDir, '/index.html').endsWith('index.html'), true);

  const missing = await api('GET', '/admin/nope.html');
  assert.equal(missing.status, 404);

  const unknownApi = await api('GET', '/api/nope');
  assert.equal(unknownApi.status, 404);
  assert.equal(unknownApi.json.code, 'NOT_FOUND');
});

test('CRUD：新建 / 列表筛选 / 单条 / 更新 / 参数错误 / 删除', async () => {
  const created = await api('POST', '/api/pois', sampleBody());
  assert.equal(created.status, 200);
  assert.match(created.json.id, /^poi-[0-9a-f]{6}$/);
  assert.equal(created.json.status, 'draft');
  assert.equal(created.json.emoji, '🎻');
  assert.equal(created.json.rarity, 'epic');
  assert.equal(created.json.area, 'oldtown');
  createdId = created.json.id;

  const list = await api('GET', '/api/pois?q=' + encodeURIComponent('音乐'));
  assert.equal(list.status, 200);
  assert.equal(list.json.total, 1);
  assert.equal(list.json.items[0].id, createdId);

  const byCategory = await api('GET', '/api/pois?category=venue');
  assert.equal(byCategory.json.total, 1);
  const byStatus = await api('GET', '/api/pois?status=draft');
  assert.equal(byStatus.json.total, 1);

  assert.equal((await api('GET', '/api/pois?status=bad')).status, 400);
  assert.equal((await api('GET', '/api/pois?limit=abc')).status, 400);
  assert.equal((await api('GET', '/api/pois?category=unknown')).status, 400);

  const single = await api('GET', '/api/pois/' + createdId);
  assert.equal(single.status, 200);
  assert.equal(single.json.name, '上海音乐厅');
  const notFound = await api('GET', '/api/pois/poi-000000');
  assert.equal(notFound.status, 404);
  assert.equal(notFound.json.code, 'NOT_FOUND');

  const updated = await api('PUT', '/api/pois/' + createdId, {
    status: 'approved',
    summary: '更新后的简介',
    tags: ['历史建筑']
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.status, 'approved');
  assert.equal(updated.json.createdAt, created.json.createdAt);
  assert.equal(updated.json.summary, '更新后的简介');
  assert.deepEqual(updated.json.tags, ['历史建筑']);
  approvedId = createdId;
});

test('校验：坏 JSON / 缺字段 / 类别错误 / 保密 NAME_LEAK', async () => {
  const badJson = await api('POST', '/api/pois', '{这不是 JSON');
  assert.equal(badJson.status, 400);
  assert.equal(badJson.json.code, 'BAD_REQUEST');

  const missing = await api('POST', '/api/pois', { lat: 31.2, lon: 121.4, category: 'park' });
  assert.equal(missing.status, 400);

  const badCategory = await api('POST', '/api/pois', sampleBody({ name: '类别错误', category: 'nope' }));
  assert.equal(badCategory.status, 400);
  assert.equal(badCategory.json.code, 'BAD_REQUEST');

  const leaked = await api('POST', '/api/pois', sampleBody({ name: '静安寺', hints: ['去静安寺看看'] }));
  assert.equal(leaked.status, 400);
  assert.equal(leaked.json.code, 'NAME_LEAK');
  assert.equal(leaked.json.details.index, 0);

  const leakedShort = await api('POST', '/api/pois', sampleBody({ name: '静安寺', hints: ['从静安区过来'] }));
  assert.equal(leakedShort.status, 400);
  assert.equal(leakedShort.json.code, 'NAME_LEAK');

  const updateLeak = await api('PUT', '/api/pois/' + createdId, { hints: ['去上海音乐厅'] });
  assert.equal(updateLeak.status, 400);
  assert.equal(updateLeak.json.code, 'NAME_LEAK');

  const photoNoCredit = await api('POST', '/api/pois', sampleBody({
    name: '没署名',
    photoUrl: 'https://upload.wikimedia.org/x.jpg',
    photoCredit: null
  }));
  assert.equal(photoNoCredit.status, 400);
});

test('抓取 ingest：去重计数 / 新建 draft / 参数校验', async () => {
  const first = await api('POST', '/api/ingest', { lat: 31.2304, lon: 121.4737, radius: 1200, limit: 10 });
  assert.equal(first.status, 200);
  assert.equal(first.json.added, 2);
  assert.equal(first.json.skipped, 1, '同名项应在批内去重');
  assert.equal(first.json.source, 'wikipedia');
  assert.ok(first.json.items.every((poi) => poi.status === 'draft'));
  assert.ok(first.json.items.every((poi) => poi.source === 'wikipedia'));

  const second = await api('POST', '/api/ingest', { lat: 31.2304, lon: 121.4737, radius: 1200, limit: 10 });
  assert.equal(second.status, 200);
  assert.equal(second.json.added, 0);
  assert.equal(second.json.skipped, 3, '全部与库内重复');

  const badLat = await api('POST', '/api/ingest', { lat: 999, lon: 121.4 });
  assert.equal(badLat.status, 400);
  const badRadius = await api('POST', '/api/ingest', { lat: 31.2, lon: 121.4, radius: 10 });
  assert.equal(badRadius.status, 400);
  const badLimit = await api('POST', '/api/ingest', { lat: 31.2, lon: 121.4, limit: 999 });
  assert.equal(badLimit.status, 400);
});

test('LLM 离线：normalize 可用 / edit 400 / analyze 可用', async () => {
  const created = await api('POST', '/api/pois', sampleBody({ name: '上海大剧院', summary: '一座剧院。' }));
  assert.equal(created.status, 200);
  const id = created.json.id;

  const normalized = await api('POST', '/api/llm/normalize', { id });
  assert.equal(normalized.status, 200);
  assert.equal(normalized.json.mode, 'offline');
  assert.ok(normalized.json.poi.why.length > 0);
  assert.ok(normalized.json.poi.task.length > 0);
  assert.equal(normalized.json.poi.hints.length, 3);
  assert.ok(normalized.json.poi.hints.every((hint) => !hint.includes('上海大剧院')));
  assert.deepEqual(normalized.json.changed.sort(), ['hints', 'task', 'why']);

  const edit = await api('POST', '/api/llm/edit', { id, instruction: '更口语一点' });
  assert.equal(edit.status, 400);
  assert.equal(edit.json.code, 'LLM_UNAVAILABLE');
  assert.ok(edit.json.error.includes('BW_LLM_API_KEY'));

  const analyzed = await api('POST', '/api/llm/analyze', { ids: [id] });
  assert.equal(analyzed.status, 200);
  assert.equal(analyzed.json.items.length, 1);
  assert.equal(analyzed.json.items[0].id, id);
  assert.ok(analyzed.json.items[0].safety.score >= 1);
  assert.ok(['good', 'risky', 'reject'].includes(analyzed.json.items[0].verdict));
  assert.ok(analyzed.json.items[0].suggestion.length > 0);
  assert.equal(analyzed.json.mode, 'offline');

  const stored = await api('GET', '/api/pois/' + id);
  assert.ok(stored.json.safety !== undefined);

  const analyzeAll = await api('POST', '/api/llm/analyze-all', { status: 'draft' });
  assert.equal(analyzeAll.status, 200);
  assert.ok(analyzeAll.json.analyzed >= 1);

  assert.equal((await api('POST', '/api/llm/normalize', { id: 'poi-nope' })).status, 404);
  assert.equal((await api('POST', '/api/llm/analyze', { ids: [] })).status, 400);
  assert.equal((await api('POST', '/api/llm/edit', { id: 'poi-nope', instruction: 'x' })).status, 404);
});

test('导出：只含 approved、字段裁剪、写入文件 + 备份', async () => {
  const draft = await api('POST', '/api/pois', sampleBody({
    name: '草稿地点',
    lat: 31.3,
    lon: 121.5,
    photoUrl: null,
    photoCredit: null
  }));
  assert.equal(draft.status, 200);
  assert.equal(draft.json.status, 'draft');

  const exported = await api('POST', '/api/export');
  assert.equal(exported.status, 200);
  assert.equal(exported.json.ok, true);
  assert.equal(exported.json.path, '../prototype/web/pois.json');
  assert.equal(exported.json.count, 1, '只应导出 1 条 approved');

  const file = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
  assert.equal(file.version, 1);
  assert.equal(file.count, 1);
  assert.equal(file.pois.length, 1);
  assert.equal(file.pois[0].id, approvedId);
  assert.equal(file.pois[0].status, undefined);
  assert.equal(file.pois[0].source, undefined);
  assert.equal(file.pois[0].safety, undefined);
  const expectedKeys = [
    'address', 'area', 'category', 'emoji', 'hints', 'id', 'lat', 'lon',
    'name', 'photoCredit', 'photoUrl', 'rarity', 'summary', 'task', 'why'
  ];
  assert.deepEqual(Object.keys(file.pois[0]).sort(), expectedKeys.sort());

  const backupPath = path.join(dataDir, 'pois.export.json');
  assert.ok(fs.existsSync(backupPath), '应有 data/pois.export.json 备份');
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  assert.equal(backup.count, 1);
});

test('统计：总数 / 状态 / 类别 / 图片 / 线索', async () => {
  const stats = await api('GET', '/api/stats');
  assert.equal(stats.status, 200);
  assert.ok(stats.json.total >= 4);
  assert.ok(stats.json.byStatus.draft >= 2);
  assert.equal(stats.json.byStatus.approved, 1);
  assert.ok(stats.json.byCategory.venue >= 1);
  assert.ok(stats.json.withPhoto >= 1);
  assert.ok(stats.json.withHints >= 1);
});

test('删除：ok + 之后 404 + 不能重复删除', async () => {
  const created = await api('POST', '/api/pois', sampleBody({ name: '待删除的地点', lat: 31.4, lon: 121.6 }));
  const id = created.json.id;
  const removed = await api('DELETE', '/api/pois/' + id);
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.json, { ok: true });
  assert.equal((await api('GET', '/api/pois/' + id)).status, 404);
  assert.equal((await api('DELETE', '/api/pois/' + id)).status, 404);
});
