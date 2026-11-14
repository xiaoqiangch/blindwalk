/**
 * 步迷 Walkaholic · HarmonyOS 逻辑层 — 三端对齐规格（docs/parity.md）
 *
 * 本文件是 parity.md §1 / §2 的**唯一实现**，三端常量以这里为准：
 * - 17 类 POI 类别元数据（label / emoji / rarity / 区域 / 是否「值得走」）
 * - 硬排除 / 软降权黑名单
 * - 三档放宽参数（relax 0/1/2）+ 距离硬帽
 * - 质量门槛（scoreWalkworthy）
 * - 去重 30m / 距离排序 / 类别多样性（每类最多 5）
 * - 加权择优（按权重降序取前 40%，至少 3 个）
 *
 * 纯函数、零依赖（只 import types/geo），可在 Node 里单测。
 * 不做任何网络请求：数据源见 core/providers.ts，编排见 core/search.ts。
 */

import { Area, GeoPoint, Mood, Rarity, WalkDuration } from './types';
import { distance } from './geo';

// ============================================================
// 常量（parity.md §2）
// ============================================================

/**
 * 地标关键字（parity.md §2）。
 *
 * `|` 是**规格里的分隔符**，不是能直接丢给高德的关键字串：
 * 实测把整串（含 `|`）当 keywords 传给高德，接口返回 status=1 但 count=0 —— 静默空结果。
 * 所以这里存规格原文（便于与文档对照），真正查询时用 `landmarkKeywordList()` 拆成单个词。
 */
export const LANDMARK_KEYWORDS: string =
  '公园|风景名胜|博物馆|展览馆|广场|图书馆|书店|体育馆|寺|教堂|古镇';

/** 拆成单个关键字（高德/百度逐词查询用） */
export function landmarkKeywordList(): string[] {
  return LANDMARK_KEYWORDS.split('|');
}

/**
 * 每轮最多查几个关键字。
 * 高德 Web 服务有 QPS 限制（实测密集查询会返回 `CUQPS_HAS_EXCEEDED_THE_LIMIT`），
 * 所以只查最能体现「值得走」的前几个，且失败不重试（继续普通搜索即可）。
 */
export const LANDMARK_KEYWORD_LIMIT: number = 3;

/** 硬排除：绝对不适合步迷的地方（去了也尴尬）→ 直接淘汰 */
export const POI_NEVER_WORDS: RegExp =
  /公厕|厕所|垃圾|污水|变电|加油站|停车场|停车库|ATM|自助取款|售楼|工业园|物流|工厂|仓库|暂停开放|已关闭|停止营业|暂停营业|装修中|施工中/;

/** 软降权：没有「地点感」的商业 POI → 权重 ×0.22，不淘汰 */
export const POI_SOFT_BAD_WORDS: RegExp =
  /快递|丰巢|菜鸟|驿站|充电站|小区|公寓|宿舍|苑|号楼|包子|面馆|小吃|快餐|麻辣烫|烧饼|米线|律师事务所|事务所|旅行社|旅游|携程|营业厅|专卖店|旗舰店|培训|教育|诊所|门诊|医院|中介|地产|售楼|大厦|写字楼|美容|美发|理发|足浴|按摩|足疗|养生|汗蒸|银行|药房|大药房|超市|便利店|菜市场|农贸|五金|建材|汽修|洗车|驾校|打印|复印|网吧|棋牌|麻将|KTV|酒吧|夜总会/;

/** 软降权系数 */
export const POI_SOFT_PENALTY: number = 0.22;

/** 与「三档放宽」对应的搜索半径倍数 */
export const RELAX_RADIUS_SCALE: number[] = [1, 1.8, 3.2];

/** 三档最小距离系数与下限（米）：max(下限, 系数 × 时长米) */
const RELAX_MIN_FACTOR: number[] = [0.35, 0.25, 0.18];
const RELAX_MIN_FLOOR: number[] = [168, 120, 86];

/** 三档最大距离倍数 */
const RELAX_MAX_SCALE: number[] = [1.7, 2.2, 2.7];

/** 距离硬帽：min(3500, 3.4 × 时长米)，任何档位都不得突破 */
export const HARD_MAX_METERS: number = 3500;
export const HARD_MAX_SCALE: number = 3.4;

/** 去重半径（米） */
export const DEDUPE_METERS: number = 30;

/** 类别多样性：每类最多保留几个 */
export const PER_CATEGORY_LIMIT: number = 5;

/** OSM / 维基来源加权（比商业 POI 更有「地点感」） */
export const SOURCE_WEIGHT_FREE: number = 1.25;
/** 有照片加权 */
export const PHOTO_WEIGHT: number = 1.15;

/** 非良好类别的基础惩罚（relax 逐步拉平） */
const DULL_CATEGORY_PENALTY: number[] = [0.35, 0.6, 0.85];

// ============================================================
// 类别元数据（17 类，key 与 prototype/web/providers.js 一致）
// ============================================================

export interface CategoryMeta {
  key: string;
  label: string;
  emoji: string;
  rarity: Rarity;
  area: Area;
  /** parity.md 的 distinctive 权重；0 表示非良好类别 */
  distinctive: number;
  /** 心情亲和（Mood 的字符串值） */
  moods: string[];
}

export const CATEGORY_METAS: CategoryMeta[] = [
  { key: 'cafe', label: '咖啡窗口', emoji: '☕️', rarity: Rarity.Common, area: Area.Near, distinctive: 1, moods: ['lively'] },
  { key: 'bookstore', label: '书店', emoji: '📚', rarity: Rarity.Rare, area: Area.OldTown, distinctive: 1.4, moods: ['discover'] },
  { key: 'library', label: '图书馆', emoji: '📖', rarity: Rarity.Rare, area: Area.OldTown, distinctive: 1.5, moods: ['discover'] },
  { key: 'park', label: '公园', emoji: '🌳', rarity: Rarity.Common, area: Area.Near, distinctive: 1.7, moods: ['drift'] },
  { key: 'bench', label: '长椅', emoji: '🪑', rarity: Rarity.Common, area: Area.Near, distinctive: 1, moods: ['drift'] },
  { key: 'bridge', label: '桥', emoji: '🌉', rarity: Rarity.Rare, area: Area.River, distinctive: 1.2, moods: [] },
  { key: 'art', label: '涂鸦墙', emoji: '🎨', rarity: Rarity.Epic, area: Area.OldTown, distinctive: 1.5, moods: ['discover'] },
  { key: 'river', label: '河岸', emoji: '🌊', rarity: Rarity.Epic, area: Area.River, distinctive: 1.2, moods: ['drift'] },
  { key: 'convenience', label: '便利店', emoji: '🥫', rarity: Rarity.Common, area: Area.Near, distinctive: 0, moods: ['lively'] },
  { key: 'viewpoint', label: '观景点', emoji: '🔭', rarity: Rarity.Epic, area: Area.Near, distinctive: 1.5, moods: ['discover'] },
  { key: 'garden', label: '花园', emoji: '🌷', rarity: Rarity.Rare, area: Area.Near, distinctive: 1.5, moods: ['drift'] },
  { key: 'plaza', label: '广场', emoji: '⛲️', rarity: Rarity.Common, area: Area.Near, distinctive: 1, moods: ['lively'] },
  { key: 'museum', label: '博物馆', emoji: '🏛️', rarity: Rarity.Rare, area: Area.OldTown, distinctive: 1.7, moods: ['discover'] },
  { key: 'historic', label: '老建筑', emoji: '🏚️', rarity: Rarity.Epic, area: Area.OldTown, distinctive: 1.6, moods: ['drift', 'discover'] },
  { key: 'venue', label: '剧场', emoji: '🎭', rarity: Rarity.Rare, area: Area.Near, distinctive: 1.4, moods: ['lively'] },
  { key: 'temple', label: '寺观', emoji: '🛕', rarity: Rarity.Hidden, area: Area.OldTown, distinctive: 1.6, moods: ['drift'] },
  { key: 'market', label: '市集', emoji: '🧺', rarity: Rarity.Rare, area: Area.Near, distinctive: 1.2, moods: ['lively'] }
];

const FALLBACK_CATEGORY: CategoryMeta = CATEGORY_METAS[11]; // plaza

/** 类别 key → 元数据；未知类别统一按 plaza */
export function categoryMeta(key: string): CategoryMeta {
  for (let i = 0; i < CATEGORY_METAS.length; i += 1) {
    if (CATEGORY_METAS[i].key === key) return CATEGORY_METAS[i];
  }
  return FALLBACK_CATEGORY;
}

/** 是否「良好类别」（distinctive > 0） */
export function isGoodCategory(key: string): boolean {
  return categoryMeta(key).distinctive > 0;
}

// ============================================================
// 三档放宽参数（parity.md §2）
// ============================================================

export interface TierParams {
  /** 0 严格 / 1 放宽 / 2 很宽 */
  relax: number;
  /** 搜索半径倍数 */
  radiusScale: number;
  /** 最小距离（米） */
  minDistance: number;
  /** 最大距离（米，已受硬帽约束） */
  maxDistance: number;
  /** 搜索半径（米） */
  radius: number;
}

/** 时长 → 步行米数（parity.md §2：15/30/60 分钟 = 240/480/960m） */
export function durationMeters(duration: WalkDuration): number {
  switch (duration) {
    case WalkDuration.M15: return 240;
    case WalkDuration.M30: return 480;
    case WalkDuration.M60: return 960;
    default: return 480;
  }
}

/** 取第 relax 档参数；relax 越界自动夹到 [0, 2] */
export function tierParams(relax: number, duration: WalkDuration): TierParams {
  let index: number = Math.floor(relax);
  if (index < 0) index = 0;
  if (index > 2) index = 2;
  const meters: number = durationMeters(duration);
  const hardMax: number = Math.min(HARD_MAX_METERS, meters * HARD_MAX_SCALE);
  const minDistance: number = Math.max(RELAX_MIN_FLOOR[index], meters * RELAX_MIN_FACTOR[index]);
  const maxDistance: number = Math.min(hardMax, meters * RELAX_MAX_SCALE[index]);
  const radius: number = Math.max(600, Math.round(meters * 1.8 * RELAX_RADIUS_SCALE[index]));
  const params: TierParams = {
    relax: index,
    radiusScale: RELAX_RADIUS_SCALE[index],
    minDistance: minDistance,
    maxDistance: maxDistance,
    radius: radius
  };
  return params;
}

// ============================================================
// 质量门槛 / 权重
// ============================================================

export interface Walkworthy {
  ok: boolean;
  /** 1 = 不降权；0.22 = 软黑名单；0 = 淘汰 */
  penalty: number;
}

/** 判断一个 POI 名字值不值得走过去（parity.md §2 硬排除 + 软降权） */
export function scoreWalkworthy(name: string): Walkworthy {
  const trimmed: string = name.trim();
  if (trimmed.length < 2) return { ok: false, penalty: 0 };
  if (POI_NEVER_WORDS.test(trimmed)) return { ok: false, penalty: 0 };
  // 纯数字/编号命名（「3号楼」「A座」）——去了也没东西看
  if (/^[0-9A-Za-z\-\s]+$/.test(trimmed)) return { ok: false, penalty: 0 };
  if (POI_SOFT_BAD_WORDS.test(trimmed)) return { ok: true, penalty: POI_SOFT_PENALTY };
  return { ok: true, penalty: 1 };
}

/** 某个候选点的综合权重（心情 + 类别 + 来源 + 照片 + relax 拉平） */
export function candidateWeight(
  candidate: PoiCandidate,
  mood: Mood,
  relax: number
): number {
  let index: number = Math.floor(relax);
  if (index < 0) index = 0;
  if (index > 2) index = 2;

  const meta: CategoryMeta = categoryMeta(candidate.category);
  let weight: number = 1;

  // 心情亲和（温和加权，不淘汰）
  for (let i = 0; i < meta.moods.length; i += 1) {
    if (meta.moods[i] === mood) {
      weight *= 1.5;
      break;
    }
  }

  // 类别权重：distinctive × 心情；非良好类别按档位拉平
  const distinctive: number = meta.distinctive > 0 ? meta.distinctive : DULL_CATEGORY_PENALTY[index];
  weight *= distinctive;

  // 软黑名单降权
  weight *= scoreWalkworthy(candidate.name).penalty;

  // 免费源 / 有照片加权
  if (candidate.source === 'wiki' || candidate.source === 'osm') weight *= SOURCE_WEIGHT_FREE;
  if (candidate.photoUrl !== undefined && candidate.photoUrl.length > 0) weight *= PHOTO_WEIGHT;

  return weight;
}

// ============================================================
// 候选点数据
// ============================================================

/** 多数据源统一候选点（坐标一律 WGS-84） */
export interface PoiCandidate {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** 17 类之一 */
  category: string;
  address?: string;
  photoUrl?: string;
  photoCredit?: string;
  /** amap / baidu / osm / wiki / curated */
  source: string;
  /** 到起点的距离（米），由 rankCandidates 填 */
  distance?: number;
}

/** 克隆候选点（快照/排序用，避免共享可变对象） */
export function cloneCandidate(candidate: PoiCandidate): PoiCandidate {
  const copy: PoiCandidate = {
    id: candidate.id,
    name: candidate.name,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    category: candidate.category,
    source: candidate.source
  };
  if (candidate.address !== undefined) copy.address = candidate.address;
  if (candidate.photoUrl !== undefined) copy.photoUrl = candidate.photoUrl;
  if (candidate.photoCredit !== undefined) copy.photoCredit = candidate.photoCredit;
  if (candidate.distance !== undefined) copy.distance = candidate.distance;
  return copy;
}

/** 候选点到起点的距离（米） */
export function candidateDistance(origin: GeoPoint, candidate: PoiCandidate): number {
  const point: GeoPoint = {
    latitude: candidate.latitude,
    longitude: candidate.longitude
  };
  return distance(origin, point);
}

// ============================================================
// 去重 / 排序 / 多样性
// ============================================================

function nameKey(name: string): string {
  return name.replace(/\s+/g, '').toLowerCase();
}

/** 质量分：有图 > 有地址 > 高德/百度 */
function qualityScore(candidate: PoiCandidate): number {
  let score: number = 0;
  if (candidate.photoUrl !== undefined && candidate.photoUrl.length > 0) score += 4;
  if (candidate.address !== undefined && candidate.address.length > 0) score += 2;
  if (candidate.source === 'amap' || candidate.source === 'baidu') score += 1;
  return score;
}

function mergeMissing(target: PoiCandidate, other: PoiCandidate): void {
  if ((target.photoUrl === undefined || target.photoUrl.length === 0) &&
      other.photoUrl !== undefined && other.photoUrl.length > 0) {
    target.photoUrl = other.photoUrl;
    if (other.photoCredit !== undefined) target.photoCredit = other.photoCredit;
  }
  if ((target.address === undefined || target.address.length === 0) &&
      other.address !== undefined && other.address.length > 0) {
    target.address = other.address;
  }
  // 类别只在「同名」时互补：
  // 30 米内的不同 POI（餐厅 / 隔壁的寺庙）不能互相借用类别，
  // 否则会出现「鲜得来 → temple」这种荒唐分类（实测踩过）。
  if (nameKey(target.name) !== nameKey(other.name)) return;
  if ((target.category === 'plaza' || target.category.length === 0) &&
      other.category.length > 0 && other.category !== 'plaza') {
    target.category = other.category;
  }
}

/**
 * 同名（忽略空白/大小写）或距离 < radiusMeters 合并。
 * 保留质量更高的那条（有图 > 有地址 > 高德/百度），并补齐缺失字段。
 */
export function dedupe(candidates: PoiCandidate[], radiusMeters: number): PoiCandidate[] {
  const threshold: number = radiusMeters > 0 ? radiusMeters : DEDUPE_METERS;
  const out: PoiCandidate[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const item: PoiCandidate = candidates[i];
    if (item.name.trim().length === 0) continue;
    if (!isFinite(item.latitude) || !isFinite(item.longitude)) continue;
    if (Math.abs(item.latitude) > 90 || Math.abs(item.longitude) > 180) continue;

    let duplicateIndex: number = -1;
    for (let j = 0; j < out.length; j += 1) {
      const kept: PoiCandidate = out[j];
      const sameName: boolean = nameKey(kept.name) === nameKey(item.name);
      const near: boolean = distance(
        { latitude: kept.latitude, longitude: kept.longitude },
        { latitude: item.latitude, longitude: item.longitude }
      ) < threshold;
      if (sameName || near) {
        duplicateIndex = j;
        break;
      }
    }

    if (duplicateIndex < 0) {
      out.push(cloneCandidate(item));
    } else {
      const existing: PoiCandidate = out[duplicateIndex];
      if (qualityScore(item) > qualityScore(existing)) {
        const replacement: PoiCandidate = cloneCandidate(item);
        mergeMissing(replacement, existing);
        out[duplicateIndex] = replacement;
      } else {
        mergeMissing(existing, item);
      }
    }
  }
  return out;
}

/**
 * 计算 distance 并升序排序；传 radius 时温和过滤远点（×1.1 容差）。
 */
export function sortByDistance(
  candidates: PoiCandidate[],
  origin: GeoPoint,
  radiusMeters: number
): PoiCandidate[] {
  const out: PoiCandidate[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const copy: PoiCandidate = cloneCandidate(candidates[i]);
    copy.distance = Math.round(candidateDistance(origin, copy) * 10) / 10;
    out.push(copy);
  }
  out.sort((a: PoiCandidate, b: PoiCandidate): number => {
    const left: number = a.distance === undefined ? 0 : a.distance;
    const right: number = b.distance === undefined ? 0 : b.distance;
    return left - right;
  });
  if (radiusMeters > 0) {
    const limit: number = radiusMeters * 1.1;
    const filtered: PoiCandidate[] = [];
    for (let i = 0; i < out.length; i += 1) {
      const sampled: number | undefined = out[i].distance;
      const value: number = sampled === undefined ? 0 : sampled;
      if (value <= limit) filtered.push(out[i]);
    }
    return filtered;
  }
  return out;
}

/**
 * 截断时保留类别多样性：最近的全是店铺时，别把稍远的公园/博物馆挤掉。
 * 第一轮每类最多 perCategory 个，第二轮按距离补齐。
 */
export function trimDiverse(
  sorted: PoiCandidate[],
  limit: number,
  perCategory: number = PER_CATEGORY_LIMIT
): PoiCandidate[] {
  if (sorted.length <= limit) return sorted;
  const out: PoiCandidate[] = [];
  const picked: string[] = [];
  const perCat: Map<string, number> = new Map<string, number>();
  const keyOf: (item: PoiCandidate) => string = (item: PoiCandidate): string => {
    if (item.id.length > 0) return item.id;
    return item.name + '@' + String(item.latitude) + ',' + String(item.longitude);
  };

  for (let i = 0; i < sorted.length && out.length < limit; i += 1) {
    const item: PoiCandidate = sorted[i];
    const cat: string = item.category.length > 0 ? item.category : 'plaza';
    const current: number = perCat.get(cat) === undefined ? 0 : (perCat.get(cat) as number);
    if (current >= perCategory) continue;
    const key: string = keyOf(item);
    if (picked.indexOf(key) >= 0) continue;
    picked.push(key);
    perCat.set(cat, current + 1);
    out.push(item);
  }
  for (let i = 0; i < sorted.length && out.length < limit; i += 1) {
    const key: string = keyOf(sorted[i]);
    if (picked.indexOf(key) >= 0) continue;
    picked.push(key);
    out.push(sorted[i]);
  }
  out.sort((a: PoiCandidate, b: PoiCandidate): number => {
    const left: number = a.distance === undefined ? 0 : a.distance;
    const right: number = b.distance === undefined ? 0 : b.distance;
    return left - right;
  });
  return out;
}

// ============================================================
// 择优：按权重降序取前 40%（至少 3 个）做加权随机
// ============================================================

export interface RankedCandidate {
  candidate: PoiCandidate;
  weight: number;
  distance: number;
}

export interface PickOptions {
  origin: GeoPoint;
  mood: Mood;
  relax: number;
  minDistance: number;
  maxDistance: number;
  /** 可复现随机种子（0…1 之间的小数） */
  random: number;
}

/**
 * 从候选里挑一个。
 * 步骤：距离窗口过滤 → 硬排除 → 计权重 → 权重降序取前 40%（≥3）→ 加权随机。
 * 返回 undefined 表示这一档没有可用候选（调用方继续下一档）。
 */
export function pickCandidate(
  candidates: PoiCandidate[],
  options: PickOptions
): RankedCandidate | undefined {
  const pool: RankedCandidate[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate: PoiCandidate = candidates[i];
    if (!isFinite(candidate.latitude) || !isFinite(candidate.longitude)) continue;
    if (!scoreWalkworthy(candidate.name).ok) continue;
    const meters: number = candidate.distance === undefined
      ? candidateDistance(options.origin, candidate)
      : candidate.distance;
    if (meters < options.minDistance || meters > options.maxDistance) continue;
    const weight: number = candidateWeight(candidate, options.mood, options.relax);
    if (weight <= 0) continue;
    pool.push({ candidate: candidate, weight: weight, distance: meters });
  }
  if (pool.length === 0) return undefined;

  pool.sort((a: RankedCandidate, b: RankedCandidate): number => b.weight - a.weight);
  let keep: number = Math.ceil(pool.length * 0.4);
  if (keep < 3) keep = 3;
  if (keep > pool.length) keep = pool.length;
  const best: RankedCandidate[] = pool.slice(0, keep);

  let total: number = 0;
  for (let i = 0; i < best.length; i += 1) total += best[i].weight;
  let roll: number = options.random * total;
  for (let i = 0; i < best.length; i += 1) {
    roll -= best[i].weight;
    if (roll <= 0) return best[i];
  }
  return best[best.length - 1];
}

/** 判断「够真实但不够格」（软黑名单）——先记下，继续往更宽档位找更好的 */
export function isDullCandidate(candidate: PoiCandidate): boolean {
  return scoreWalkworthy(candidate.name).penalty < 0.5;
}

// ============================================================
// 失败原因（parity.md §2：明确面板，绝不虚构兜底）
// ============================================================

export const SEARCH_FAIL_TITLE: string = '没找到真实地点，这次不抽了';
export const SEARCH_FAIL_SUBTITLE: string = '不会用虚构地点糊弄你';

export type SearchFailReason = 'no-origin' | 'no-real-place' | 'network' | 'not-real';

/** 失败面板副文案 */
export function searchFailText(reason: string): string {
  if (reason === 'network') {
    return '网络不给力，地图数据没取到（高德/百度/OSM/维基都没能返回）。试试换个网络，或者走演示模式。';
  }
  if (reason === 'no-origin') {
    return '没拿到你的位置。真实盲盒必须知道你在哪。';
  }
  return '这一带暂时没有适合走过去的真实地点。换「60 分钟」把范围放大，或换个位置再找。';
}