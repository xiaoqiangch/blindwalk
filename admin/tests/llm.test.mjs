import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPoi, PoiError } from '../server/poi.mjs';
import {
  analyzePoi,
  analyzePois,
  buildAnalyzeMessages,
  buildNormalizeMessages,
  editPoi,
  extractJson,
  llmStatus,
  normalizePoi,
  offlineAnalyze,
  offlineNormalize,
  resolveConfig
} from '../server/llm.mjs';

const ENV_KEY = {
  BW_LLM_BASE_URL: 'https://api.example.com/v1/',
  BW_LLM_API_KEY: 'sk-test',
  BW_LLM_MODEL: 'fake-model'
};

function samplePoi(overrides = {}) {
  return buildPoi({
    name: '上海音乐厅',
    lat: 31.22888889,
    lon: 121.47333333,
    category: 'venue',
    summary: '原名南京大戏院。',
    photoUrl: 'https://upload.wikimedia.org/x.jpg',
    photoCredit: 'Wikimedia Commons',
    ...overrides
  }, { now: 1000 });
}

function fakeSuccess(payload) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: 'fake-model',
      choices: [{ message: { content: '```json\n' + JSON.stringify(payload) + '\n```' } }]
    })
  });
}

function fakeFailure(tracker) {
  return async () => {
    if (tracker) tracker.calls += 1;
    throw new Error('network down');
  };
}

test('llm 状态：无 Key 时 offline，有 Key 时 llm；baseUrl 去尾斜杠', () => {
  assert.equal(llmStatus({}).mode, 'offline');
  assert.equal(llmStatus({}).model, 'offline-rules');
  assert.equal(llmStatus({}).ready, true);
  assert.equal(llmStatus({}).baseUrl, 'https://api.deepseek.com/v1');

  const online = llmStatus(ENV_KEY);
  assert.equal(online.mode, 'llm');
  assert.equal(online.model, 'fake-model');
  assert.equal(online.baseUrl, 'https://api.example.com/v1');

  const config = resolveConfig(ENV_KEY);
  assert.equal(config.baseUrl, 'https://api.example.com/v1');
  assert.equal(config.apiKey, 'sk-test');
});

test('extractJson：裸 JSON / ```json 包裹 / 前后混文本 / 非法输入', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJson('好的，结果如下：\n{"a":3}\n以上。'), { a: 3 });
  assert.throws(() => extractJson('前言 {"a":4} 后记 {"b":5}'), '首个 { 到最后一个 } 不是合法 JSON 应抛错');
  assert.throws(() => extractJson('没有 JSON'));
  assert.throws(() => extractJson(''));
  assert.throws(() => extractJson('{坏掉的}'));
});

test('离线 normalize：真实可用的 why / task / 3 条 hints，且不泄露地名', async () => {
  const poi = samplePoi();
  const result = await normalizePoi(poi, { env: {}, now: 2000 });
  assert.equal(result.mode, 'offline');
  assert.equal(result.model, 'offline-rules');
  assert.ok(result.poi.why.includes('\n'), 'why 应为两行');
  assert.ok(result.poi.task.length > 0);
  assert.equal(result.poi.hints.length, 3);
  for (const hint of result.poi.hints) {
    assert.ok(!hint.includes('上海音乐厅'));
    assert.ok(!hint.includes('上海'));
  }
  assert.equal(result.poi.llm.mode, 'offline');
  assert.equal(result.poi.llm.normalizedAt, 2000);
  assert.deepEqual(result.changed, ['why', 'task', 'hints']);
});

test('离线 edit：明确 400 LLM_UNAVAILABLE（不假装 AI）', async () => {
  const poi = samplePoi();
  await assert.rejects(
    () => editPoi(poi, '写得更口语一点', { env: {} }),
    (error) => {
      assert.ok(error instanceof PoiError);
      assert.equal(error.code, 'LLM_UNAVAILABLE');
      assert.equal(error.status, 400);
      return true;
    }
  );
});

test('离线 analyze：规则打分产出 safety / verdict / suggestion', () => {
  const poi = samplePoi({ why: '两行\n文案', task: '做点小事', hints: ['线索一', '线索二', '线索三'] });
  const analysis = offlineAnalyze(poi, 3000);
  assert.equal(typeof analysis.safety.score, 'number');
  assert.ok(analysis.safety.score >= 1 && analysis.safety.score <= 5);
  assert.equal(typeof analysis.safety.walkable, 'boolean');
  assert.ok(['low', 'medium', 'high'].includes(analysis.safety.crowded));
  assert.ok(analysis.safety.notes.length > 0);
  assert.ok(['good', 'risky', 'reject'].includes(analysis.verdict));
  assert.ok(analysis.suggestion.length > 0);
  assert.equal(analysis.mode, 'offline');
  // 有图片 +1：基础 3 → 4
  assert.equal(analysis.safety.score, 4);
});

test('离线 analyze：hints 含地名扣分 / 缺 why task 扣分', () => {
  const bad = samplePoi({ why: '', task: '' });
  bad.hints = ['去上海音乐厅'];
  const analysis = offlineAnalyze(bad, 3000);
  assert.equal(analysis.safety.score, 1);
  assert.equal(analysis.verdict, 'reject');
  assert.equal(analysis.safety.walkable, false);
  assert.ok(analysis.safety.notes.includes('线索含地名'));
});

test('LLM normalize：成功时 mode=llm、model 来自响应、hints 自动脱敏', async () => {
  const poi = samplePoi();
  const fetchImpl = fakeSuccess({
    why: '第一行\n第二行',
    task: '找一张海报',
    hints: ['上海音乐厅的灯', '从上海过来', '就在前面']
  });
  const result = await normalizePoi(poi, { env: ENV_KEY, fetchImpl, now: 4000 });
  assert.equal(result.mode, 'llm');
  assert.equal(result.model, 'fake-model');
  assert.equal(result.poi.why, '第一行\n第二行');
  assert.equal(result.poi.task, '找一张海报');
  for (const hint of result.poi.hints) {
    assert.ok(!hint.includes('上海音乐厅'));
    assert.ok(!hint.includes('上海'));
  }
  assert.equal(result.poi.llm.mode, 'llm');
  assert.equal(result.poi.llm.model, 'fake-model');
});

test('LLM normalize：两次失败后降级 offline，并带 fallbackReason', async () => {
  const poi = samplePoi();
  const tracker = { calls: 0 };
  const result = await normalizePoi(poi, { env: ENV_KEY, fetchImpl: fakeFailure(tracker), now: 5000 });
  assert.equal(result.mode, 'offline');
  assert.equal(tracker.calls, 2, '应重试 1 次（共 2 次请求）');
  assert.ok(result.fallbackReason.includes('network down'));
  assert.equal(result.poi.hints.length, 3);
});

test('LLM normalize：返回字段不完整时也降级 offline', async () => {
  const poi = samplePoi();
  const result = await normalizePoi(poi, { env: ENV_KEY, fetchImpl: fakeSuccess({ why: '只有一行' }), now: 6000 });
  assert.equal(result.mode, 'offline');
  assert.equal(result.poi.llm.mode, 'offline');
});

test('LLM edit：成功时返回新文案（mode=llm）', async () => {
  const poi = samplePoi({ why: '旧\n旧', task: '旧任务', hints: ['旧一', '旧二', '旧三'] });
  const fetchImpl = fakeSuccess({
    why: '新的第一行\n新的第二行',
    task: '新的小任务',
    hints: ['新一', '新二', '新三']
  });
  const result = await editPoi(poi, '更口语一点', { env: ENV_KEY, fetchImpl, now: 7000 });
  assert.equal(result.mode, 'llm');
  assert.equal(result.poi.why, '新的第一行\n新的第二行');
  assert.equal(result.poi.task, '新的小任务');
  assert.deepEqual(result.poi.hints, ['新一', '新二', '新三']);
  assert.ok(result.changed.includes('why'));
});

test('LLM analyze：成功时解析 safety / verdict / suggestion 并给出 patch', async () => {
  const poi = samplePoi();
  const fetchImpl = fakeSuccess({
    safety: { score: 5, walkable: true, crowded: 'low', notes: '主干道旁，人行道宽' },
    verdict: 'good',
    suggestion: '可以上架，适合傍晚来。'
  });
  const result = await analyzePoi(poi, { env: ENV_KEY, fetchImpl, now: 8000 });
  assert.equal(result.mode, 'llm');
  assert.equal(result.item.id, poi.id);
  assert.equal(result.item.safety.score, 5);
  assert.equal(result.item.verdict, 'good');
  assert.equal(result.item.suggestion, '可以上架，适合傍晚来。');
  assert.equal(result.patch.safety.crowded, 'low');
  assert.equal(result.patch.llm.mode, 'llm');
  assert.equal(result.patch.llm.analyzedAt, 8000);
});

test('LLM analyze：失败时降级离线规则（mode=offline）', async () => {
  const poi = samplePoi();
  const result = await analyzePoi(poi, { env: ENV_KEY, fetchImpl: fakeFailure(), now: 9000 });
  assert.equal(result.mode, 'offline');
  assert.equal(result.patch.llm.mode, 'offline');
  assert.equal(result.item.safety.score >= 1, true);
});

test('批量 analyze：逐条执行并汇报整体 mode', async () => {
  const a = samplePoi({ name: '地点甲' });
  const b = samplePoi({ name: '地点乙' });
  const applied = [];
  const result = await analyzePois([a, b], {
    env: {},
    now: 10000,
    onApplied: (id, patch) => applied.push({ id, patch })
  });
  assert.equal(result.items.length, 2);
  assert.equal(result.mode, 'offline');
  assert.equal(applied.length, 2);
});

test('提示词：包含严格 JSON 要求与「不得出现地名」约束', () => {
  const normalizeMessages = buildNormalizeMessages(samplePoi());
  assert.equal(normalizeMessages.length, 2);
  assert.ok(normalizeMessages[0].content.includes('严格 JSON'));
  assert.ok(normalizeMessages[0].content.includes('前两个字'));
  assert.ok(normalizeMessages[1].content.includes('上海音乐厅'));

  const analyzeMessages = buildAnalyzeMessages(samplePoi());
  assert.ok(analyzeMessages[1].content.includes('safety'));
  assert.ok(analyzeMessages[1].content.includes('verdict'));
});
