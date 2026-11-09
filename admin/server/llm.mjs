/**
 * 盲走 BlindWalk · 兴趣点管理后台 — 大模型客户端 + 离线规则降级
 *
 * - OpenAI 兼容：POST {BW_LLM_BASE_URL}/chat/completions，Authorization: Bearer
 * - 提示词要求严格 JSON；解析时去掉 ```json 包裹、截取首个 { 到最后一个 }
 * - 超时 30s；失败重试 1 次；仍失败则降级离线规则（mode: "offline"）
 * - 没有 API Key 时**绝不假装 AI**：normalize/analyze 用真实可用的类别模板与规则；
 *   edit 明确返回 400 LLM_UNAVAILABLE（契约 §6）
 *
 * 零依赖：只用 Node 内置 fetch（Node 18+）。测试可注入 fetchImpl。
 */

import {
  PoiError,
  categoryHints,
  categoryMeta,
  categoryTask,
  clipText,
  leaksName,
  normalizeSafety,
  scrubHints
} from './poi.mjs';

export const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
export const DEFAULT_MODEL = 'deepseek-chat';
export const LLM_TIMEOUT_MS = 30000;
export const LLM_RETRIES = 1;
const HINT_TAIL = '就在前面。抬手机，慢慢看。';
const OFFLINE_MODEL = 'offline-rules';

/** 读取环境变量配置（测试可传入 env） */
export function resolveConfig(env = process.env) {
  const baseUrl = String(env.BW_LLM_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  const apiKey = String(env.BW_LLM_API_KEY || '').trim();
  const model = String(env.BW_LLM_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  return { baseUrl, apiKey, model };
}

/** 契约 §4.5 */
export function llmStatus(env = process.env) {
  const config = resolveConfig(env);
  return {
    mode: config.apiKey ? 'llm' : 'offline',
    model: config.apiKey ? config.model : OFFLINE_MODEL,
    baseUrl: config.baseUrl,
    ready: true
  };
}

/** 健壮的 JSON 提取：去 code fence、截取第一个 { 到最后一个 } */
export function extractJson(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('LLM 返回为空');
  }
  let value = text.trim();
  value = value.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '');
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('LLM 返回里没有 JSON 对象');
  const slice = value.slice(start, end + 1);
  const parsed = JSON.parse(slice);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('LLM 返回的 JSON 不是对象');
  }
  return parsed;
}

// ============================================================
// OpenAI 兼容调用
// ============================================================

/**
 * 调一次 chat/completions，返回 message.content 文本。
 * 超时 LLM_TIMEOUT_MS；调用方负责重试。
 */
export async function chatCompletion(messages, options = {}) {
  const config = options.config || resolveConfig(options.env || process.env);
  if (!config.apiKey) {
    throw new PoiError('需要配置 BW_LLM_API_KEY', 'LLM_UNAVAILABLE', 400);
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node 没有可用的 fetch');

  const timeoutMs = options.timeoutMs === undefined ? LLM_TIMEOUT_MS : options.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = {
      model: config.model,
      messages,
      temperature: 0.4
    };
    // 第一次带 JSON mode；重试时去掉，兼容不支持 response_format 的 OpenAI 兼容服务
    if (options.responseFormat !== false) {
      body.response_format = { type: 'json_object' };
    }
    const response = await fetchImpl(config.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + config.apiKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      const detail = await safeText(response);
      throw new Error('LLM HTTP ' + response.status + (detail ? ' · ' + detail : ''));
    }
    const json = await response.json();
    const choice = json && Array.isArray(json.choices) ? json.choices[0] : null;
    const content = choice && choice.message ? choice.message.content : '';
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error('LLM 返回缺少 choices[0].message.content');
    }
    return { content, model: json.model || config.model };
  } finally {
    clearTimeout(timer);
  }
}

async function safeText(response) {
  try {
    const text = await response.text();
    return clipText(text, 200);
  } catch (error) {
    return '';
  }
}

/**
 * 调模型并解析 JSON；失败重试 1 次。
 * @returns {{ data: object, model: string }}
 */
export async function callLlmJson(messages, options = {}) {
  const retries = options.retries === undefined ? LLM_RETRIES : options.retries;
  let lastError = null;
  const attempts = retries + 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const attemptOptions = { ...options, responseFormat: attempt === 0 };
      const result = await chatCompletion(messages, attemptOptions);
      const data = extractJson(result.content);
      return { data, model: result.model };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('LLM 调用失败');
}

// ============================================================
// 提示词
// ============================================================

const SYSTEM_PROMPT = [
  '你是「盲走 BlindWalk」的地点文案编辑。盲走是一个散步盲盒 App：用户抽一个目的地，',
  '出发前只知道距离、方向和随距离解锁的线索；到了才揭晓地点名。',
  '所以：线索（hints）里绝对不能出现地点名称，连名称的前两个字都不行；也不能出现地址、店招。',
  '语气温柔、轻微诗意、有一点点坏笑；短句，不卖萌，不喊口号。',
  '只输出严格 JSON，不要 markdown，不要解释。'
].join('\n');

function poiBrief(poi) {
  return {
    name: poi.name,
    category: poi.category,
    categoryLabel: categoryMeta(poi.category).label,
    summary: poi.summary,
    address: poi.address,
    tags: poi.tags,
    current: { why: poi.why, task: poi.task, hints: poi.hints }
  };
}

export function buildNormalizeMessages(poi) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        '请为下面这个地点补全三段文案，只输出 JSON：',
        '{ "why": "为什么是这里，两行，用 \\n 分隔，不出现名称",',
        '  "task": "1 分钟小任务，具体可做",',
        '  "hints": ["第 1 条（远）", "第 2 条（中）", "第 3 条（近）"] }',
        '要求：',
        '1. why 两行，第一行写适合这个类别的停留方式，第二行写一句城市感受；不要出现地点名。',
        '2. hints 三条按「远 → 中 → 近」递进，只描述声音、光线、气味、地面感觉，',
        '   严禁出现地点名或名称前两个字，也不要出现地址。',
        '3. task 必须是 1 分钟内能完成的小动作。',
        '地点信息：' + JSON.stringify(poiBrief(poi))
      ].join('\n')
    }
  ];
}

export function buildEditMessages(poi, instruction) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        '请在保留事实的前提下，按编辑要求改写这个地点的文案，只输出 JSON：',
        '{ "why": "…", "task": "…", "hints": ["…", "…", "…"] }',
        '编辑要求：' + String(instruction || '').trim(),
        '注意：hints 里绝不能出现地点名（含前两个字）或地址。',
        '地点信息：' + JSON.stringify(poiBrief(poi))
      ].join('\n')
    }
  ];
}

export function buildAnalyzeMessages(poi) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        '请评估这个地点适不适合作为「盲走」的盲盒目的地，只输出 JSON：',
        '{ "safety": { "score": 1-5 的整数（越高越安全）,',
        '              "walkable": true/false（是否适合步行到达）,',
        '              "crowded": "low|medium|high",',
        '              "notes": "一句中文说明" },',
        '  "verdict": "good|risky|reject",',
        '  "suggestion": "一句中文建议" }',
        '评估维度：可达性、夜间安全、人流、独特性、适合停留。',
        '地点信息：' + JSON.stringify(poiBrief(poi))
      ].join('\n')
    }
  ];
}

// ============================================================
// 离线规则（没有 Key / 调用失败时真实可用）
// ============================================================

/** 离线 normalize：按类别模板补齐 why / task / hints（不假装 AI） */
export function offlineNormalize(poi, now = Date.now()) {
  const meta = categoryMeta(poi.category);
  const hints = scrubHints(categoryHints(poi.category).concat([HINT_TAIL]), poi.name).slice(0, 3);
  const why = [
    '「' + meta.label + '」适合不赶时间地待一会儿。',
    '到了才知道是哪里，这个地点只为你亮一次。'
  ].join('\n');
  const task = categoryTask(poi.category);
  const updated = {
    ...poi,
    why,
    task,
    hints,
    llm: {
      normalizedAt: now,
      analyzedAt: poi.llm ? poi.llm.analyzedAt || 0 : 0,
      model: OFFLINE_MODEL,
      mode: 'offline'
    }
  };
  return updated;
}

/** 离线 analyze：规则打分（契约 §6） */
export function offlineAnalyze(poi, now = Date.now()) {
  const meta = categoryMeta(poi.category);
  const reasons = [];
  let score = 3;

  if (poi.photoUrl) {
    score += 1;
    reasons.push('有图片 +1');
  }
  if (['park', 'river', 'garden'].includes(poi.category)) {
    score += 1;
    reasons.push('公园/河岸/花园 +1');
  }
  for (const hint of poi.hints || []) {
    if (leaksName(hint, poi.name)) {
      score -= 3;
      reasons.push('线索含地名 -3');
      break;
    }
  }
  if (!poi.why) {
    score -= 1;
    reasons.push('缺 why -1');
  }
  if (!poi.task) {
    score -= 1;
    reasons.push('缺 task -1');
  }
  const finalScore = Math.max(1, Math.min(5, score));

  let crowded = 'medium';
  if (['market', 'plaza', 'venue', 'museum'].includes(poi.category)) crowded = 'high';
  else if (['park', 'river', 'library', 'garden', 'bench'].includes(poi.category)) crowded = 'low';

  const verdict = finalScore >= 4 ? 'good' : finalScore >= 2 ? 'risky' : 'reject';
  const suggestion = verdict === 'good'
    ? '可以上架：' + meta.label + '，' + (reasons.length ? reasons.join('，') : '无明显风险') + '。'
    : verdict === 'risky'
      ? '建议人工复核：' + (reasons.length ? reasons.join('，') : '信息不足') + '，补充线索与任务后再上架。'
      : '暂不建议上架：' + (reasons.length ? reasons.join('，') : '风险较高') + '，建议换一个地点。';

  return {
    safety: {
      score: finalScore,
      walkable: finalScore >= 2,
      crowded,
      notes: '离线规则：' + (reasons.length ? reasons.join('，') : '无额外风险') + '。'
    },
    verdict,
    suggestion,
    mode: 'offline',
    model: OFFLINE_MODEL
  };
}

// ============================================================
// 对外：normalize / edit / analyze（有 Key 走 LLM，失败降级）
// ============================================================

function hintList(data, poi) {
  const raw = Array.isArray(data.hints) ? data.hints : [];
  let hints = scrubHints(
    raw.filter((hint) => typeof hint === 'string' && hint.trim().length > 0),
    poi.name
  );
  if (hints.length < 3) {
    const fallback = scrubHints(categoryHints(poi.category).concat([HINT_TAIL]), poi.name);
    for (const hint of fallback) {
      if (hints.length >= 3) break;
      if (!hints.includes(hint)) hints.push(hint);
    }
  }
  return hints.slice(0, 3);
}

function changedFields(before, after, fields = ['why', 'task', 'hints']) {
  const changed = [];
  for (const field of fields) {
    const a = JSON.stringify(before[field] === undefined ? null : before[field]);
    const b = JSON.stringify(after[field] === undefined ? null : after[field]);
    if (a !== b) changed.push(field);
  }
  return changed;
}

function applyNormalizeData(poi, data, model, mode, now) {
  const why = clipText(typeof data.why === 'string' ? data.why : poi.why, 300);
  const task = clipText(typeof data.task === 'string' ? data.task : poi.task, 160);
  const hints = hintList(data, poi);
  const next = {
    ...poi,
    why,
    task: task || poi.task,
    hints,
    llm: {
      normalizedAt: now,
      analyzedAt: poi.llm ? poi.llm.analyzedAt || 0 : 0,
      model,
      mode
    }
  };
  return next;
}

/**
 * normalize：整理 why / task / hints。
 * @returns {{ poi: object, changed: string[], mode: 'llm'|'offline', model: string }}
 */
export async function normalizePoi(poi, options = {}) {
  const now = options.now === undefined ? Date.now() : options.now;
  const config = options.config || resolveConfig(options.env || process.env);
  if (!config.apiKey) {
    const next = offlineNormalize(poi, now);
    return { poi: next, changed: changedFields(poi, next), mode: 'offline', model: OFFLINE_MODEL };
  }
  try {
    const result = await callLlmJson(buildNormalizeMessages(poi), { ...options, config });
    const next = applyNormalizeData(poi, result.data, result.model || config.model, 'llm', now);
    if (!next.why || !next.task || next.hints.length < 3) {
      throw new Error('LLM 返回的字段不完整');
    }
    return { poi: next, changed: changedFields(poi, next), mode: 'llm', model: next.llm.model };
  } catch (error) {
    const next = offlineNormalize(poi, now);
    return {
      poi: next,
      changed: changedFields(poi, next),
      mode: 'offline',
      model: OFFLINE_MODEL,
      fallbackReason: clipText(error.message, 120)
    };
  }
}

/** edit：必须有 Key；失败 / 离线 → 400 LLM_UNAVAILABLE（契约 §6） */
export async function editPoi(poi, instruction, options = {}) {
  const now = options.now === undefined ? Date.now() : options.now;
  const text = String(instruction || '').trim();
  if (!text) throw new PoiError('instruction 必填', 'BAD_REQUEST');
  const config = options.config || resolveConfig(options.env || process.env);
  if (!config.apiKey) {
    throw new PoiError(
      'AI 编辑需要配置 BW_LLM_API_KEY（当前为离线规则模式）',
      'LLM_UNAVAILABLE',
      400
    );
  }
  let result;
  try {
    result = await callLlmJson(buildEditMessages(poi, text), { ...options, config });
  } catch (error) {
    throw new PoiError(
      'AI 编辑暂时不可用，请稍后再试',
      'LLM_UNAVAILABLE',
      400,
      { reason: clipText(error.message, 120) }
    );
  }
  const data = result.data || {};
  const why = typeof data.why === 'string' ? clipText(data.why, 300) : poi.why;
  const task = typeof data.task === 'string' ? clipText(data.task, 160) : poi.task;
  const hints = hintList(data, poi);
  const next = {
    ...poi,
    why,
    task,
    hints: hints.length > 0 ? hints : poi.hints,
    llm: {
      normalizedAt: now,
      analyzedAt: poi.llm ? poi.llm.analyzedAt || 0 : 0,
      model: result.model || config.model,
      mode: 'llm'
    }
  };
  return { poi: next, changed: changedFields(poi, next), mode: 'llm', model: next.llm.model };
}

/** analyze 单个地点：返回结算字段 + 需要写回的 patch */
export async function analyzePoi(poi, options = {}) {
  const now = options.now === undefined ? Date.now() : options.now;
  const config = options.config || resolveConfig(options.env || process.env);
  let analysis;
  let mode = 'offline';
  let model = OFFLINE_MODEL;

  if (!config.apiKey) {
    analysis = offlineAnalyze(poi, now);
  } else {
    try {
      const result = await callLlmJson(buildAnalyzeMessages(poi), { ...options, config });
      const data = result.data || {};
      const safety = normalizeSafety(data.safety);
      const verdict = ['good', 'risky', 'reject'].includes(data.verdict) ? data.verdict : 'risky';
      analysis = {
        safety,
        verdict,
        suggestion: clipText(data.suggestion || '', 160),
        mode: 'llm',
        model: result.model || config.model
      };
      mode = 'llm';
      model = analysis.model;
    } catch (error) {
      analysis = offlineAnalyze(poi, now);
      analysis.fallbackReason = clipText(error.message, 120);
    }
  }

  const patch = {
    safety: analysis.safety,
    llm: {
      normalizedAt: poi.llm ? poi.llm.normalizedAt || 0 : 0,
      analyzedAt: now,
      model,
      mode
    }
  };
  const result = {
    item: {
      id: poi.id,
      safety: analysis.safety,
      suggestion: analysis.suggestion,
      verdict: analysis.verdict
    },
    patch,
    mode
  };
  return result;
}

/** 批量 analyze（顺序执行，单条失败降级离线） */
export async function analyzePois(pois, options = {}) {
  const items = [];
  const modes = [];
  for (const poi of pois) {
    const result = await analyzePoi(poi, options);
    items.push(result.item);
    modes.push(result.mode);
    if (options.onApplied) options.onApplied(poi.id, result.patch);
  }
  let mode = 'offline';
  if (modes.length > 0 && modes.every((item) => item === 'llm')) mode = 'llm';
  else if (modes.includes('llm')) mode = 'mixed';
  return { items, mode };
}
