/**
 * 步迷 Walkaholic · 兴趣点管理后台 v2 — 安全分级 + 夜间可达性
 *
 * 纯函数，零依赖：给 POI 打「白天分 / 夜间分 / 夜间建议」。
 * 语义保守：夜间分不凭想象给高分；没有街灯/人流依据时按类别就低。
 *
 * 契约 §2 safety：
 *   { score(白天, 向后兼容), day, night, nightVerdict: avoid|caution|ok, reasons[],
 *     walkable, crowded, notes }
 *
 * context 可传 { hour, crowded }：hour 仅用于补齐 reasons（当前时段），不改变 day/night 的计算。
 */

/** 白天适合停留、且相对明亮的类别（博物馆 / 演出场所 / 便利店；公园河岸花园是白天更合适） */
const DAY_FRIENDLY = ['museum', 'venue', 'convenience', 'park', 'river', 'garden'];

/** 夜间明显更危险的类别（公园/河岸/老房子/花园/寺庙教堂） */
const NIGHT_RISKY = {
  park: -2,
  river: -2,
  historic: -2,
  garden: -2,
  temple: -2,
  bench: -1,
  art: -1,
  bridge: -1,
  viewpoint: -1,
  market: -1,
  library: -1,
  bookstore: -1,
  museum: -1,
  plaza: 0,
  cafe: 0,
  venue: 1,
  convenience: 1
};

/** 默认人流估计（没有显式 crowded 时用） */
const CROWDED_BY_CATEGORY = {
  plaza: 'high',
  market: 'high',
  venue: 'high',
  museum: 'high',
  park: 'low',
  river: 'low',
  library: 'low',
  garden: 'low',
  bench: 'low'
};

const CROWDED_VALUES = ['low', 'medium', 'high'];
const NIGHT_VERDICTS = ['avoid', 'caution', 'ok'];

const MAIN_ROAD_PATTERN = /(路|街|大道|公路|大街|环岛|枢纽|广场)/;

function clampScore(value) {
  return Math.max(1, Math.min(5, Math.round(value)));
}

export function inferCrowded(category) {
  return CROWDED_BY_CATEGORY[category] || 'medium';
}

function normalizeCrowded(value) {
  return CROWDED_VALUES.includes(value) ? value : '';
}

/**
 * 安全分级（纯函数）。
 *
 * @param {object} poi POI（至少需要 category / photoUrl / address / why / task / hints / name / safety）
 * @param {{ hour?: number, crowded?: string }} context
 * @returns {{ score:number, day:number, night:number, nightVerdict:string,
 *            reasons:string[], walkable:boolean, crowded:string }}
 */
export function scoreSafety(poi, context = {}) {
  const category = String(poi.category || 'plaza');
  const reasons = [];
  let crowded = normalizeCrowded(context.crowded);
  if (!crowded) crowded = normalizeCrowded(poi.safety && poi.safety.crowded);
  if (!crowded) crowded = inferCrowded(category);

  // ---------- 白天分 ----------
  let day = 3;
  const hasPhoto = typeof poi.photoUrl === 'string' && poi.photoUrl.length > 0;
  const dayFriendly = DAY_FRIENDLY.includes(category);
  if (hasPhoto || dayFriendly) {
    day += 1;
    reasons.push(hasPhoto ? '有实景照片（白天 +1）' : '类别：' + category + '（白天适合停留 +1）');
  }

  const address = String(poi.address || '').trim();
  if (address) reasons.push('有地址：' + address);

  const hints = Array.isArray(poi.hints) ? poi.hints : [];
  const leaked = hints.some((hint) => nameLeak(hint, poi.name));
  if (leaked) {
    day -= 3;
    reasons.push('线索含地名（-3）');
  }
  if (!poi.why) {
    day -= 1;
    reasons.push('缺 why（-1）');
  }
  if (!poi.task) {
    day -= 1;
    reasons.push('缺 task（-1）');
  }
  day = clampScore(day);

  // ---------- 夜间分（保守） ----------
  let night = 3;
  const categoryDelta = Object.prototype.hasOwnProperty.call(NIGHT_RISKY, category)
    ? NIGHT_RISKY[category]
    : 0;
  if (categoryDelta !== 0) {
    night += categoryDelta;
    reasons.push('类别：' + category + '（夜间 ' + (categoryDelta > 0 ? '+' : '') + categoryDelta + '）');
  }
  if (crowded === 'high') {
    night += 1;
    reasons.push('人流：high（夜间 +1）');
  } else if (crowded === 'low') {
    night -= 1;
    reasons.push('人流：low（夜间 -1）');
  } else {
    reasons.push('人流：medium（夜间 ±0）');
  }
  if (MAIN_ROAD_PATTERN.test(address)) {
    night += 1;
    reasons.push('地址含主干道（夜间照明 +1）');
  }
  if (leaked) {
    // 备注：线索泄露不影响夜间物理安全，但影响「产品安全」，夜间判断同样按保守处理
    night -= 1;
    reasons.push('线索含地名（夜间 -1）');
  }
  night = clampScore(night);
  // 保守：没有「高人流」依据时，夜间分最多给到 4（不能凭想象给满分）
  if (crowded !== 'high' && night > 4) night = 4;

  let nightVerdict = 'caution';
  if (night >= 4) nightVerdict = 'ok';
  else if (night <= 2) nightVerdict = 'avoid';

  if (context.hour !== undefined && Number.isFinite(Number(context.hour))) {
    const hour = Number(context.hour);
    const isNight = hour >= 19 || hour < 6;
    reasons.push('当前时间：' + (isNight ? '夜间' : '白天') + '（' + hour + ' 时）');
  }

  return {
    score: day,
    day: day,
    night: night,
    nightVerdict: nightVerdict,
    reasons: reasons,
    walkable: day >= 2,
    crowded: crowded
  };
}

/** 生成完整 safety 对象（契约 §2；score 保持为白天分） */
export function buildSafety(poi, context = {}) {
  const scored = scoreSafety(poi, context);
  const safety = {
    score: scored.day,
    walkable: scored.walkable,
    crowded: scored.crowded,
    notes: scored.reasons.join('；'),
    day: scored.day,
    night: scored.night,
    nightVerdict: scored.nightVerdict,
    reasons: scored.reasons
  };
  return safety;
}

/** 校验 safety 里的 day/night/nightVerdict/reasons 是否完整；不完整则用规则补齐 */
export function completeSafety(poi, safety) {
  const base = safety && typeof safety === 'object' ? safety : {};
  const scored = scoreSafety(poi, { crowded: base.crowded });
  // LLM 可能只返回 score（白天口径）；此时把 score 当作 day，而不是用规则覆盖模型判断
  const hasDay = Number.isFinite(Number(base.day));
  const hasScore = Number.isFinite(Number(base.score));
  const day = clampScore(hasDay ? Number(base.day) : (hasScore ? Number(base.score) : scored.day));
  const night = clampScore(Number.isFinite(Number(base.night)) ? Number(base.night) : scored.night);
  let nightVerdict = NIGHT_VERDICTS.includes(base.nightVerdict) ? base.nightVerdict : '';
  if (!nightVerdict) {
    if (night >= 4) nightVerdict = 'ok';
    else if (night <= 2) nightVerdict = 'avoid';
    else nightVerdict = 'caution';
  }
  const merged = {
    score: day, // 契约：score 保持为白天分（向后兼容）
    walkable: typeof base.walkable === 'boolean' ? base.walkable : day >= 2,
    crowded: CROWDED_VALUES.includes(base.crowded) ? base.crowded : scored.crowded,
    notes: typeof base.notes === 'string' && base.notes.length > 0
      ? base.notes
      : scored.reasons.join('；'),
    day: day,
    night: night,
    nightVerdict: nightVerdict,
    reasons: Array.isArray(base.reasons) && base.reasons.length > 0
      ? base.reasons
      : scored.reasons
  };
  return merged;
}

/** 导出用的精简 safety（契约 §4.6） */
export function exportSafety(poi) {
  const source = poi && poi.safety && typeof poi.safety === 'object' ? poi.safety : {};
  const completed = completeSafety(poi, source);
  return {
    day: completed.day,
    night: completed.night,
    nightVerdict: completed.nightVerdict
  };
}

// 局部复制：避免把 poi.mjs 的 leaksName 依赖带进来造成循环依赖
function nameLeak(text, name) {
  const value = String(text || '');
  const target = String(name || '').trim();
  if (!value || !target) return false;
  if (value.includes(target)) return true;
  if (target.length >= 2 && value.includes(target.slice(0, 2))) return true;
  return false;
}
