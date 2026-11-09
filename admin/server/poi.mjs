/**
 * 盲走 BlindWalk · 兴趣点管理后台 — POI 规范化 / 校验 / 保密过滤 / 导出
 *
 * 契约：admin/docs/CONTRACT.md（字段名与类别表不得改）
 * 零依赖：只用 Node 内置能力（这里只用到 crypto）。
 */

import { randomBytes } from 'node:crypto';

// ============================================================
// 类别表（与契约 §3 一致，勿自造）
// ============================================================

export const CATEGORIES = {
  cafe: { label: '咖啡窗口', emoji: '☕️', rarity: 'common', area: 'near' },
  bookstore: { label: '书店', emoji: '📚', rarity: 'rare', area: 'oldtown' },
  library: { label: '图书馆', emoji: '📖', rarity: 'rare', area: 'oldtown' },
  park: { label: '公园', emoji: '🌳', rarity: 'common', area: 'near' },
  bench: { label: '长椅', emoji: '🪑', rarity: 'common', area: 'near' },
  bridge: { label: '桥', emoji: '🌉', rarity: 'rare', area: 'river' },
  art: { label: '涂鸦墙', emoji: '🎨', rarity: 'epic', area: 'oldtown' },
  river: { label: '河岸', emoji: '🌊', rarity: 'epic', area: 'river' },
  convenience: { label: '便利店', emoji: '🥫', rarity: 'common', area: 'near' },
  viewpoint: { label: '观景点', emoji: '🔭', rarity: 'epic', area: 'near' },
  garden: { label: '花园', emoji: '🌷', rarity: 'rare', area: 'near' },
  plaza: { label: '广场', emoji: '⛲️', rarity: 'common', area: 'near' },
  museum: { label: '博物馆', emoji: '🏛️', rarity: 'rare', area: 'oldtown' },
  historic: { label: '老房子', emoji: '🏮', rarity: 'rare', area: 'oldtown' },
  venue: { label: '演出场所', emoji: '🎻', rarity: 'epic', area: 'oldtown' },
  temple: { label: '寺庙教堂', emoji: '⛩️', rarity: 'rare', area: 'oldtown' },
  market: { label: '市集', emoji: '🛒', rarity: 'common', area: 'oldtown' }
};

export const CATEGORY_KEYS = Object.keys(CATEGORIES);
export const STATUSES = ['draft', 'review', 'approved', 'rejected'];
export const RARITIES = ['common', 'rare', 'epic', 'hidden'];
export const AREAS = ['near', 'river', 'oldtown'];
export const SOURCES = ['wikipedia', 'osm', 'manual'];

/** 类别任务模板（离线 normalize 用） */
const CATEGORY_TASKS = {
  cafe: '点一杯最便宜的，问老板今天的豆子是哪里的。',
  bookstore: '找一本封面是蓝色的书，翻开第 7 页读三行。',
  library: '坐下，看十分钟别人进进出出。',
  park: '找一张能看见最多树的长椅，坐三分钟。',
  bench: '数一数这张长椅能坐几个人。',
  bridge: '在桥上站满 60 秒，看一次水流的方向。',
  art: '拍一张只有一个颜色的照片。',
  river: '数一数河面上有几艘船。',
  convenience: '买一样不超过 5 块钱的东西。',
  viewpoint: '找一盏你能看见的最远的灯。',
  garden: '找一盆你觉得活得最好的植物。',
  plaza: '观察 30 秒，找出走得最慢的那个人。',
  museum: '找一个你愿意再看第二眼的展品，记住它的位置。',
  historic: '摸一摸门框或墙砖，找一处最旧的地方。',
  venue: '找一张你愿意看的演出海报，拍下来。',
  temple: '找一处你觉得最旧的痕迹。',
  market: '挑一样你不认识的东西，问老板是什么。'
};

/** 三阶线索模板（前 2 条按类别，第 3 条通用；绝不含地名） */
const CATEGORY_HINTS = {
  cafe: ['风里有一点烘焙的味道。', '跟着这个味道走，会经过一扇开着的窗。'],
  bookstore: ['前面会安静下来。', '找一扇窗很大、里面堆着纸的地方。'],
  library: ['往更安静的方向走。', '会看到很多台阶，很多人坐在上面。'],
  park: ['树会变多，声音会变少。', '找一片能听见叶子的地方。'],
  bench: ['适合坐下来。往有阴影的地方走。', '会看到一张面朝开阔处的长椅。'],
  bridge: ['脚下的声音会变。', '找一段水面在脚下经过的地方。'],
  art: ['颜色会突然变多。', '找一面不太平整的墙。'],
  river: ['空气会变凉，风会变大。', '往低处走，会听到水声。'],
  convenience: ['往灯最亮的地方走。', '会听到「欢迎光临」的电子音。'],
  viewpoint: ['往高处走。', '找一个能看见很远的地方。'],
  garden: ['空气会有一点甜。', '找一片被人照料过的绿。'],
  plaza: ['人会变多。', '找一块空着的石头或台阶。'],
  museum: ['会看到很多人排着队，也会突然安静。', '找一栋有很长台阶、门很高的建筑。'],
  historic: ['会有一点旧木头和雨的味道。', '找一栋比周围都老的两层小楼。'],
  venue: ['傍晚会亮起一串灯。', '找一处门口贴着演出海报的地方。'],
  temple: ['会突然安静，也会突然古老。', '找一处门框比周围都旧的地方。'],
  market: ['声音会变杂。', '找一个人挤人、但没人赶时间的地方。']
};

const HINT_TAIL = '就在前面。抬手机，慢慢看。';

export function categoryMeta(category) {
  return CATEGORIES[category] || CATEGORIES.plaza;
}

export function defaultEmoji(category) {
  return categoryMeta(category).emoji;
}

export function defaultRarity(category) {
  return categoryMeta(category).rarity;
}

export function defaultArea(category) {
  return categoryMeta(category).area;
}

export function categoryHints(category) {
  return CATEGORY_HINTS[category] || CATEGORY_HINTS.plaza;
}

export function categoryTask(category) {
  return CATEGORY_TASKS[category] || CATEGORY_TASKS.plaza;
}

// ============================================================
// 错误类型（index.mjs 统一转成契约错误 JSON）
// ============================================================

export class PoiError extends Error {
  constructor(message, code = 'BAD_REQUEST', status = 400, details) {
    super(message);
    this.name = 'PoiError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

// ============================================================
// 基础工具
// ============================================================

export function makePoiId() {
  return 'poi-' + randomBytes(3).toString('hex');
}

export function nowMs() {
  return Date.now();
}

export function haversineMeters(a, b) {
  const R = 6371000;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}

export function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 是否泄露地名：包含完整名称，或名称前 2 字（契约硬性规则） */
export function leaksName(text, name) {
  const value = String(text || '');
  const target = String(name || '').trim();
  if (!target || !value) return false;
  if (value.includes(target)) return true;
  if (target.length >= 2 && value.includes(target.slice(0, 2))) return true;
  return false;
}

/** 把泄露的文本替换成「那里」（LLM 产出自动过滤用） */
export function scrubText(text, name) {
  let value = String(text || '');
  const target = String(name || '').trim();
  if (!target) return value;
  value = value.split(target).join('那里');
  if (target.length >= 2) value = value.split(target.slice(0, 2)).join('那里');
  return value;
}

/** 校验用户/前端写入的 hints：命中地名直接拒绝（不能悄悄放过） */
export function assertHintsSafe(hints, name) {
  if (!Array.isArray(hints)) {
    throw new PoiError('hints 必须是字符串数组', 'BAD_REQUEST');
  }
  for (let i = 0; i < hints.length; i += 1) {
    if (typeof hints[i] !== 'string') {
      throw new PoiError('hints[' + i + '] 必须是字符串', 'BAD_REQUEST');
    }
    if (leaksName(hints[i], name)) {
      throw new PoiError(
        'hints[' + i + '] 含地名（或地名前 2 字），会剧透目的地',
        'NAME_LEAK',
        400,
        { index: i, hint: hints[i] }
      );
    }
  }
}

/** 给 LLM 产出兜底：静默替换成「那里」（契约 §4.4） */
export function scrubHints(hints, name) {
  const list = Array.isArray(hints) ? hints : [];
  return list.map((hint) => scrubText(hint, name).trim()).filter((hint) => hint.length > 0);
}

export function clipText(value, maxLength) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength);
}

function assertFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// ============================================================
// 输入规范化 / 校验
// ============================================================

/**
 * 把前端/LLM 传进来的部分字段规范化。
 * @param {object} input 原始对象
 * @param {{ partial?: boolean, now?: number }} options partial=true 表示 PUT 合并
 * @returns {object} 只含契约字段的补丁
 */
export function normalizePoiPatch(input, options = {}) {
  const partial = options.partial === true;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new PoiError('请求体必须是 JSON 对象', 'BAD_REQUEST');
  }
  const patch = {};

  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw new PoiError('name 不能为空', 'BAD_REQUEST');
    if (name.length > 80) throw new PoiError('name 不能超过 80 字', 'BAD_REQUEST');
    patch.name = name;
  }

  if (input.lat !== undefined) {
    const lat = Number(input.lat);
    if (!assertFiniteNumber(lat) || lat < -90 || lat > 90) {
      throw new PoiError('lat 必须是 -90…90 的数字', 'BAD_REQUEST');
    }
    patch.lat = lat;
  }
  if (input.lon !== undefined) {
    const lon = Number(input.lon);
    if (!assertFiniteNumber(lon) || lon < -180 || lon > 180) {
      throw new PoiError('lon 必须是 -180…180 的数字', 'BAD_REQUEST');
    }
    patch.lon = lon;
  }

  if (input.category !== undefined) {
    if (!CATEGORY_KEYS.includes(input.category)) {
      throw new PoiError('category 不在契约类别表里：' + String(input.category), 'BAD_REQUEST');
    }
    patch.category = input.category;
  }
  if (input.emoji !== undefined) patch.emoji = clipText(input.emoji, 8);
  if (input.rarity !== undefined) {
    if (!RARITIES.includes(input.rarity)) {
      throw new PoiError('rarity 必须是 common | rare | epic | hidden', 'BAD_REQUEST');
    }
    patch.rarity = input.rarity;
  }
  if (input.area !== undefined) {
    if (!AREAS.includes(input.area)) {
      throw new PoiError('area 必须是 near | river | oldtown', 'BAD_REQUEST');
    }
    patch.area = input.area;
  }
  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status)) {
      throw new PoiError('status 必须是 draft | review | approved | rejected', 'BAD_REQUEST');
    }
    patch.status = input.status;
  }
  if (input.source !== undefined) {
    if (!SOURCES.includes(input.source)) {
      throw new PoiError('source 必须是 wikipedia | osm | manual', 'BAD_REQUEST');
    }
    patch.source = input.source;
  }

  if (input.address !== undefined) {
    patch.address = input.address === null || input.address === '' ? null : clipText(input.address, 120);
  }
  if (input.photoUrl !== undefined) {
    patch.photoUrl = input.photoUrl === null || input.photoUrl === '' ? null : clipText(input.photoUrl, 500);
  }
  if (input.photoCredit !== undefined) {
    patch.photoCredit = input.photoCredit === null || input.photoCredit === ''
      ? null
      : clipText(input.photoCredit, 80);
  }
  if (input.summary !== undefined) patch.summary = clipText(input.summary, 120);
  if (input.why !== undefined) patch.why = clipText(input.why, 300);
  if (input.task !== undefined) patch.task = clipText(input.task, 160);

  if (input.hints !== undefined) {
    if (!Array.isArray(input.hints)) throw new PoiError('hints 必须是字符串数组', 'BAD_REQUEST');
    if (input.hints.length > 3) throw new PoiError('hints 最多 3 条', 'BAD_REQUEST');
    patch.hints = input.hints.map((hint) => clipText(hint, 160));
  }

  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags)) throw new PoiError('tags 必须是字符串数组', 'BAD_REQUEST');
    patch.tags = input.tags
      .map((tag) => clipText(tag, 24))
      .filter((tag) => tag.length > 0)
      .slice(0, 12);
  }

  if (input.safety !== undefined) {
    patch.safety = normalizeSafety(input.safety);
  }

  if (input.llm !== undefined) {
    patch.llm = normalizeLlm(input.llm);
  }

  // 合并 PUT 时，hints 的保密校验要用「合并后的 name」，由 validateMergedPoi 负责
  if (partial) return patch;

  // 新建：必填字段
  if (!patch.name) throw new PoiError('name 必填', 'BAD_REQUEST');
  if (patch.lat === undefined) throw new PoiError('lat 必填', 'BAD_REQUEST');
  if (patch.lon === undefined) throw new PoiError('lon 必填', 'BAD_REQUEST');
  if (!patch.category) throw new PoiError('category 必填', 'BAD_REQUEST');
  if (patch.photoUrl && !patch.photoCredit) {
    throw new PoiError('有 photoUrl 时 photoCredit 必填（如 Wikimedia Commons）', 'BAD_REQUEST');
  }
  return patch;
}

export function normalizeSafety(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new PoiError('safety 必须是对象', 'BAD_REQUEST');
  }
  const score = Number(input.score);
  if (!assertFiniteNumber(score) || score < 1 || score > 5) {
    throw new PoiError('safety.score 必须是 1–5 的数字', 'BAD_REQUEST');
  }
  const crowded = input.crowded === undefined ? 'medium' : String(input.crowded);
  if (!['low', 'medium', 'high'].includes(crowded)) {
    throw new PoiError("safety.crowded 必须是 low | medium | high", 'BAD_REQUEST');
  }
  return {
    score: Math.round(score),
    walkable: input.walkable === undefined ? true : Boolean(input.walkable),
    crowded,
    notes: clipText(input.notes, 160)
  };
}

export function normalizeLlm(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new PoiError('llm 必须是对象', 'BAD_REQUEST');
  }
  const mode = input.mode === 'offline' ? 'offline' : 'llm';
  return {
    normalizedAt: Number.isFinite(Number(input.normalizedAt)) ? Number(input.normalizedAt) : 0,
    analyzedAt: Number.isFinite(Number(input.analyzedAt)) ? Number(input.analyzedAt) : 0,
    model: clipText(input.model, 60),
    mode
  };
}

/**
 * 创建一个完整的 POI（服务端生成 id / 时间戳 / 默认值）。
 */
export function buildPoi(input, options = {}) {
  const now = options.now === undefined ? nowMs() : options.now;
  const patch = normalizePoiPatch(input, { partial: false });
  const category = patch.category;
  const safety = patch.safety === undefined
    ? { score: 3, walkable: true, crowded: 'medium', notes: '' }
    : patch.safety;
  const poi = {
    id: options.id || makePoiId(),
    name: patch.name,
    lat: patch.lat,
    lon: patch.lon,
    category,
    emoji: patch.emoji || defaultEmoji(category),
    rarity: patch.rarity || defaultRarity(category),
    area: patch.area || defaultArea(category),
    address: patch.address === undefined ? null : patch.address,
    photoUrl: patch.photoUrl === undefined ? null : patch.photoUrl,
    photoCredit: patch.photoCredit === undefined ? null : patch.photoCredit,
    summary: patch.summary === undefined ? '' : patch.summary,
    why: patch.why === undefined ? '' : patch.why,
    task: patch.task === undefined ? '' : patch.task,
    hints: patch.hints === undefined ? [] : patch.hints,
    tags: patch.tags === undefined ? [] : patch.tags,
    safety,
    llm: patch.llm === undefined
      ? { normalizedAt: 0, analyzedAt: 0, model: '', mode: 'offline' }
      : patch.llm,
    status: patch.status === undefined ? 'draft' : patch.status,
    source: patch.source === undefined ? 'manual' : patch.source,
    createdAt: now,
    updatedAt: now
  };
  assertHintsSafe(poi.hints, poi.name);
  if (poi.photoUrl && !poi.photoCredit) {
    throw new PoiError('有 photoUrl 时 photoCredit 必填', 'BAD_REQUEST');
  }
  return poi;
}

/**
 * PUT 合并：保留 id / createdAt，其余按契约字段合并，并重新做保密校验。
 */
export function mergePoi(existing, patch, options = {}) {
  const now = options.now === undefined ? nowMs() : options.now;
  const merged = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt, updatedAt: now };

  if (!merged.name) throw new PoiError('name 不能为空', 'BAD_REQUEST');
  if (!CATEGORY_KEYS.includes(merged.category)) {
    throw new PoiError('category 不在契约类别表里', 'BAD_REQUEST');
  }
  if (!STATUSES.includes(merged.status)) {
    throw new PoiError('status 不合法', 'BAD_REQUEST');
  }
  if (!RARITIES.includes(merged.rarity)) {
    throw new PoiError('rarity 不合法', 'BAD_REQUEST');
  }
  if (!AREAS.includes(merged.area)) {
    throw new PoiError('area 不合法', 'BAD_REQUEST');
  }
  if (!SOURCES.includes(merged.source)) {
    throw new PoiError('source 不合法', 'BAD_REQUEST');
  }
  if (merged.photoUrl && !merged.photoCredit) {
    throw new PoiError('有 photoUrl 时 photoCredit 必填', 'BAD_REQUEST');
  }
  merged.hints = Array.isArray(merged.hints) ? merged.hints : [];
  assertHintsSafe(merged.hints, merged.name);
  return merged;
}

/** 校验读取到的存储数据是否像一条 POI（损坏容错时用） */
export function isPoiShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.lat === 'number' &&
    typeof value.lon === 'number' &&
    typeof value.category === 'string'
  );
}

// ============================================================
// 导出（契约 §4.6）
// ============================================================

const EXPORT_FIELDS = [
  'id', 'name', 'lat', 'lon', 'category', 'emoji', 'rarity', 'area',
  'address', 'photoUrl', 'photoCredit', 'summary', 'why', 'task', 'hints'
];

/** 导出字段裁剪：只保留 App 消费的字段 */
export function toExportPoi(poi) {
  const out = {};
  for (const field of EXPORT_FIELDS) {
    out[field] = poi[field] === undefined ? null : poi[field];
  }
  if (!Array.isArray(out.hints)) out.hints = [];
  return out;
}

/** 构造导出文件内容（只含 approved） */
export function buildExportDocument(pois, now = nowMs()) {
  const approved = (Array.isArray(pois) ? pois : [])
    .filter((poi) => poi.status === 'approved')
    .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
  return {
    version: 1,
    exportedAt: now,
    count: approved.length,
    pois: approved.map(toExportPoi)
  };
}

/** 统计（契约 §4.7） */
export function buildStats(pois) {
  const list = Array.isArray(pois) ? pois : [];
  const byStatus = { draft: 0, review: 0, approved: 0, rejected: 0 };
  const byCategory = {};
  let withPhoto = 0;
  let withHints = 0;
  for (const poi of list) {
    if (byStatus[poi.status] !== undefined) byStatus[poi.status] += 1;
    byCategory[poi.category] = (byCategory[poi.category] || 0) + 1;
    if (poi.photoUrl) withPhoto += 1;
    if (Array.isArray(poi.hints) && poi.hints.length > 0) withHints += 1;
  }
  return { total: list.length, byStatus, byCategory, withPhoto, withHints };
}
