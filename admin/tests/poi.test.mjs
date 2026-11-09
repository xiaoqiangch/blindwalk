import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORIES,
  CATEGORY_KEYS,
  PoiError,
  assertHintsSafe,
  buildExportDocument,
  buildPoi,
  buildStats,
  clipText,
  leaksName,
  mergePoi,
  normalizePoiPatch,
  scrubHints,
  scrubText,
  toExportPoi
} from '../server/poi.mjs';

function throwsCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof PoiError, '应抛出 PoiError');
    assert.equal(error.code, code);
    return true;
  });
}

function sampleInput(overrides = {}) {
  return {
    name: '上海音乐厅',
    lat: 31.22888889,
    lon: 121.47333333,
    category: 'venue',
    summary: '原名南京大戏院，1930 年建成。',
    address: '黄浦区 · 延安东路',
    photoUrl: 'https://upload.wikimedia.org/x.jpg',
    photoCredit: 'Wikimedia Commons',
    ...overrides
  };
}

test('类别表与契约 §3 一致（17 个，emoji / rarity 抽查）', () => {
  assert.equal(CATEGORY_KEYS.length, 17);
  assert.equal(CATEGORIES.venue.label, '演出场所');
  assert.equal(CATEGORIES.venue.emoji, '🎻');
  assert.equal(CATEGORIES.venue.rarity, 'epic');
  assert.equal(CATEGORIES.temple.emoji, '⛩️');
  assert.equal(CATEGORIES.temple.rarity, 'rare');
  assert.equal(CATEGORIES.museum.emoji, '🏛️');
  assert.equal(CATEGORIES.market.emoji, '🛒');
  assert.equal(CATEGORIES.cafe.rarity, 'common');
});

test('buildPoi：默认值 / id / 时间戳 / 必填校验', () => {
  const poi = buildPoi(sampleInput(), { now: 1000 });
  assert.match(poi.id, /^poi-[0-9a-f]{6}$/);
  assert.equal(poi.status, 'draft');
  assert.equal(poi.source, 'manual');
  assert.equal(poi.emoji, '🎻');
  assert.equal(poi.rarity, 'epic');
  assert.equal(poi.area, 'oldtown');
  assert.equal(poi.createdAt, 1000);
  assert.equal(poi.updatedAt, 1000);
  assert.deepEqual(poi.hints, []);
  assert.deepEqual(poi.safety, { score: 3, walkable: true, crowded: 'medium', notes: '' });
  assert.equal(poi.llm.mode, 'offline');

  throwsCode(() => buildPoi(sampleInput({ name: '' })), 'BAD_REQUEST');
  throwsCode(() => buildPoi(sampleInput({ lat: undefined })), 'BAD_REQUEST');
  throwsCode(() => buildPoi(sampleInput({ category: 'unknown' })), 'BAD_REQUEST');
  throwsCode(() => buildPoi(sampleInput({ lat: 91 })), 'BAD_REQUEST');
  throwsCode(() => buildPoi(sampleInput({ photoCredit: undefined })), 'BAD_REQUEST');
});

test('保密：hints 含完整地名 / 前 2 字都被拒绝（NAME_LEAK）', () => {
  throwsCode(() => assertHintsSafe(['去上海音乐厅听一场'], '上海音乐厅'), 'NAME_LEAK');
  throwsCode(() => assertHintsSafe(['往上海的方向走'], '上海音乐厅'), 'NAME_LEAK');
  assert.doesNotThrow(() => assertHintsSafe(['风里有一点烘焙的味道。'], '上海音乐厅'));
  assert.equal(leaksName('去上海音乐厅', '上海音乐厅'), true);
  assert.equal(leaksName('从上海出发', '上海音乐厅'), true);
  assert.equal(leaksName('过两个路口就到了', '上海音乐厅'), false);

  // buildPoi 也会校验 hints
  throwsCode(() => buildPoi(sampleInput({ hints: ['去上海音乐厅'] })), 'NAME_LEAK');
});

test('scrubHints / scrubText：自动替换为「那里」', () => {
  assert.equal(scrubText('去上海音乐厅看看', '上海音乐厅'), '去那里看看');
  assert.equal(scrubText('从上海出发', '上海音乐厅'), '从那里出发');
  assert.deepEqual(
    scrubHints(['去上海音乐厅', '从上海出发', '过两个路口'], '上海音乐厅'),
    ['去那里', '从那里出发', '过两个路口']
  );
});

test('mergePoi：保留 id / createdAt，合并且重新做保密校验', () => {
  const poi = buildPoi(sampleInput(), { now: 1000 });
  const merged = mergePoi(poi, { status: 'approved', summary: '新简介' }, { now: 2000 });
  assert.equal(merged.id, poi.id);
  assert.equal(merged.createdAt, 1000);
  assert.equal(merged.updatedAt, 2000);
  assert.equal(merged.status, 'approved');
  assert.equal(merged.summary, '新简介');
  throwsCode(() => mergePoi(poi, { hints: ['上海音乐厅在这里'] }, { now: 3000 }), 'NAME_LEAK');
  throwsCode(() => mergePoi(poi, { status: 'whatever' }), 'BAD_REQUEST');
});

test('normalizePoiPatch：字段裁剪与类型校验', () => {
  const patch = normalizePoiPatch({
    name: ' 测试地点 ',
    lat: '31.2',
    lon: 121.4,
    category: 'park',
    hints: ['一条线索'],
    tags: ['历史建筑', '音乐'],
    summary: 'x'.repeat(200)
  });
  assert.equal(patch.name, '测试地点');
  assert.equal(patch.lat, 31.2);
  assert.equal(patch.summary.length, 120);
  assert.deepEqual(patch.tags, ['历史建筑', '音乐']);
  throwsCode(() => normalizePoiPatch({ lat: 'abc' }), 'BAD_REQUEST');
  throwsCode(() => normalizePoiPatch({ hints: 'not-array' }), 'BAD_REQUEST');
  throwsCode(() => normalizePoiPatch({ hints: ['1', '2', '3', '4'] }), 'BAD_REQUEST');
});

test('导出：只含 approved、字段裁剪正确、count/version 正确', () => {
  const approved = buildPoi(sampleInput({ status: 'approved' }), { now: 1 });
  const draft = buildPoi(sampleInput({ name: '草稿地点', status: 'draft' }), { now: 2 });
  const rejected = buildPoi(sampleInput({ name: '拒绝地点', status: 'rejected' }), { now: 3 });
  const doc = buildExportDocument([approved, draft, rejected], 999);
  assert.equal(doc.version, 1);
  assert.equal(doc.exportedAt, 999);
  assert.equal(doc.count, 1);
  assert.equal(doc.pois.length, 1);
  const exported = doc.pois[0];
  const expectedKeys = [
    'id', 'name', 'lat', 'lon', 'category', 'emoji', 'rarity', 'area',
    'address', 'photoUrl', 'photoCredit', 'summary', 'why', 'task', 'hints'
  ];
  assert.deepEqual(Object.keys(exported).sort(), expectedKeys.slice().sort());
  assert.equal(exported.name, '上海音乐厅');
  assert.equal(exported.status, undefined);
  assert.equal(exported.source, undefined);
  assert.equal(exported.safety, undefined);
  assert.equal(exported.llm, undefined);
  assert.equal(toExportPoi(draft).status, undefined);
});

test('导出：空库也生成合法文档', () => {
  const doc = buildExportDocument([], 123);
  assert.deepEqual(doc, { version: 1, exportedAt: 123, count: 0, pois: [] });
});

test('统计：byStatus / byCategory / withPhoto / withHints', () => {
  const a = buildPoi(sampleInput({ status: 'approved', hints: ['一条线索'] }), { now: 1 });
  const b = buildPoi(sampleInput({ name: '公园', category: 'park', photoUrl: null, photoCredit: null, status: 'draft' }), { now: 2 });
  const stats = buildStats([a, b]);
  assert.equal(stats.total, 2);
  assert.equal(stats.byStatus.approved, 1);
  assert.equal(stats.byStatus.draft, 1);
  assert.equal(stats.byCategory.venue, 1);
  assert.equal(stats.byCategory.park, 1);
  assert.equal(stats.withPhoto, 1);
  assert.equal(stats.withHints, 1);
});

test('clipText：按长度裁剪并去空白', () => {
  assert.equal(clipText('  abc  ', 10), 'abc');
  assert.equal(clipText('abcdef', 3), 'abc');
});
