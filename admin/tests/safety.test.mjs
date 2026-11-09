import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSafety,
  completeSafety,
  exportSafety,
  inferCrowded,
  scoreSafety
} from '../server/safety.mjs';

function poi(overrides = {}) {
  return {
    name: '测试地点',
    category: 'plaza',
    photoUrl: null,
    address: null,
    why: '为什么',
    task: '做点什么',
    hints: ['线索一', '线索二', '线索三'],
    safety: {},
    ...overrides
  };
}

test('安全分级：公园夜间分 < 白天分，且夜间 verdict 保守', () => {
  const park = poi({
    name: '人民公园',
    category: 'park',
    photoUrl: 'https://upload.wikimedia.org/x.jpg',
    address: '黄浦区 · 南京西路'
  });
  const scored = scoreSafety(park);
  assert.ok(scored.night < scored.day, '公园夜间分应低于白天分');
  assert.equal(scored.score, scored.day, 'score 保持为白天分');
  assert.equal(scored.nightVerdict, 'avoid');
  assert.ok(scored.reasons.some((reason) => reason.includes('park')));
  assert.ok(scored.reasons.some((reason) => reason.includes('人流')));
});

test('安全分级：便利店夜间 verdict 不为 avoid，夜间照明/人流给加分', () => {
  const convenience = poi({
    name: '24 小时便利店',
    category: 'convenience',
    address: '黄浦区 · 南京东路'
  });
  const scored = scoreSafety(convenience);
  assert.notEqual(scored.nightVerdict, 'avoid', '便利店夜间不该是 avoid');
  assert.ok(scored.night >= 3);
  assert.ok(scored.reasons.some((reason) => reason.includes('主干道')));
});

test('安全分级：博物馆/演出场所白天有加分，老房子夜间扣分', () => {
  const museum = poi({ name: '上海博物馆', category: 'museum', photoUrl: null });
  const historic = poi({ name: '老洋房', category: 'historic', photoUrl: null });
  const museumScored = scoreSafety(museum);
  const historicScored = scoreSafety(historic);
  assert.ok(museumScored.day > historicScored.day, '博物馆白天分应高于老房子');
  assert.equal(historicScored.nightVerdict, 'avoid', '老房子夜间应保守判 avoid');
});

test('安全分级：crowded 上下文影响夜间分（low 更危险）', () => {
  const park = poi({ name: '街心公园', category: 'park', photoUrl: null });
  const low = scoreSafety(park, { crowded: 'low' });
  const high = scoreSafety(park, { crowded: 'high' });
  assert.ok(high.night > low.night, '高人流夜间分应高于低人流');
  assert.equal(low.crowded, 'low');
  assert.equal(high.crowded, 'high');
});

test('安全分级：hints 泄露地名会扣分并给出原因', () => {
  const leaked = poi({
    name: '上海音乐厅',
    category: 'venue',
    photoUrl: 'https://upload.wikimedia.org/x.jpg',
    hints: ['去上海音乐厅', '第二条', '第三条']
  });
  const clean = poi({
    name: '上海音乐厅',
    category: 'venue',
    photoUrl: 'https://upload.wikimedia.org/x.jpg'
  });
  const leakedScored = scoreSafety(leaked);
  const cleanScored = scoreSafety(clean);
  assert.ok(leakedScored.day < cleanScored.day);
  assert.ok(leakedScored.reasons.some((reason) => reason.includes('线索含地名')));
});

test('安全分级：缺 why / task 扣分', () => {
  const empty = poi({ why: '', task: '' });
  const scored = scoreSafety(empty);
  assert.ok(scored.day <= 2);
  assert.ok(scored.reasons.some((reason) => reason.includes('缺 why')));
  assert.ok(scored.reasons.some((reason) => reason.includes('缺 task')));
});

test('safety 完整化：补齐 day/night/nightVerdict/reasons，score 等于 day', () => {
  const base = poi({ category: 'park', photoUrl: null, safety: { score: 3, walkable: true, crowded: 'low', notes: '' } });
  const completed = completeSafety(base, base.safety);
  assert.equal(completed.score, completed.day);
  assert.ok(completed.night >= 1 && completed.night <= 5);
  assert.ok(['avoid', 'caution', 'ok'].includes(completed.nightVerdict));
  assert.ok(Array.isArray(completed.reasons) && completed.reasons.length > 0);
  assert.ok(completed.notes.length > 0);

  // LLM 只给 score 时，score 作为白天分保留
  const overridden = completeSafety(base, { score: 5, crowded: 'high', notes: '模型判断' });
  assert.equal(overridden.day, 5);
  assert.equal(overridden.score, 5);
  assert.equal(overridden.notes, '模型判断');
});

test('导出 safety：只含 day / night / nightVerdict', () => {
  const target = poi({ category: 'park', photoUrl: 'https://upload.wikimedia.org/x.jpg' });
  const exported = exportSafety(target);
  assert.deepEqual(Object.keys(exported).sort(), ['day', 'night', 'nightVerdict'].sort());
  assert.ok(exported.day >= 1);
  assert.ok(exported.night < exported.day);
  assert.equal(exported.nightVerdict, 'avoid');
});

test('buildSafety / inferCrowded：完整 safety 与默认人流', () => {
  const target = poi({ category: 'plaza' });
  const safety = buildSafety(target, { crowded: 'high' });
  assert.equal(safety.score, safety.day);
  assert.equal(safety.crowded, 'high');
  assert.equal(typeof safety.notes, 'string');
  assert.equal(inferCrowded('plaza'), 'high');
  assert.equal(inferCrowded('park'), 'low');
  assert.equal(inferCrowded('cafe'), 'medium');
});
