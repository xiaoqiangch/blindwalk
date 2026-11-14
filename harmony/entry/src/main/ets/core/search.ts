/**
 * 步迷 Walkaholic · HarmonyOS 逻辑层 — 真实地点搜索编排（三档放宽）
 *
 * 移植自 prototype/web/app.js 的 `searchAttempt` / `finishReal` / `failSearch`，
 * 严格按 docs/parity.md §1 + §2：
 *
 *   优先：后台策展 pois.json（人工审核过）
 *   其次：多数据源（高德/百度/OSM/维基）
 *   最后：**明确失败面板** —— 绝不虚构兜底
 *
 * 三档放宽只影响「同一批真实数据里挑哪个 / 搜索半径多大」，不改变「是否真实」。
 * 档位越高：半径更大、允许更近、商业 POI 不再被大幅降权。
 *
 * 「够真实但不够格」（软黑名单）的点会先记下，继续往更宽的档位找更好的；
 * 三档都没有更好的，才用它（绝不编造）。
 */

import { GeoPoint, Mood, Place, ExploreScope, WalkDuration } from './types';
import { HttpClient, MapKeys, SourceReport, errorText } from './http';
import { PoiCandidate, isDullCandidate, pickCandidate, roamRange, tierParams } from './parity';
import { nearby, roamNearby } from './providers';
import { makeRealPlace, realCategoryFromKey } from './catalog';
import { DayMoment, currentMoment } from './moment';

/** 公网策展数据地址（后台导出 → GitHub Pages；与 Web/iOS 三端同源） */
export const CURATED_URL: string = 'https://xiaoqiangch.github.io/walkaholic/pois.json';
export const CURATED_TIMEOUT_MS: number = 3500;
/** 策展数据缓存有效期：6 小时（人工审核过的数据变化慢） */
export const CURATED_CACHE_TTL_MS: number = 6 * 3600 * 1000;

/** 策展 POI（后台导出 pois.json；字段见 admin/docs/CONTRACT.md §4.6） */
export interface CuratedPoi {
  id: string;
  name: string;
  lat: number;
  lon: number;
  category: string;
  area?: string;
  address?: string;
  photoUrl?: string;
  photoCredit?: string;
  summary?: string;
  why?: string;
  task?: string;
  hints?: string[];
  rarity?: string;
  emoji?: string;
}

/** 一次搜索的结果 */
export interface SearchOutcome {
  /** 找到的真实地点；undefined = 失败 */
  place?: Place;
  /** 命中的档位 0/1/2（失败时为最后尝试的档位） */
  tier: number;
  /** 这次一共拿到多少真实候选 */
  poolSize: number;
  /** 数据源回报（失败面板逐条显示） */
  reports: SourceReport[];
  /** curated / amap / baidu / osm / wiki */
  source: string;
  /** 失败原因：no-origin / no-real-place / network / not-real */
  failReason: string;
}

/** 编译期保证 SearchOutcome 至少有一个明确状态 */
export function searchSucceeded(outcome: SearchOutcome): boolean {
  return outcome.place !== undefined;
}

/** 真实来源白名单（任何不在其中的都是 bug，必须拒绝） */
export function isRealSource(source: string): boolean {
  return source === 'curated' || source === 'amap' || source === 'baidu' ||
    source === 'osm' || source === 'wiki';
}

/**
 * 解析后台导出的 pois.json（纯函数）。
 * 结构：{ version, exportedAt, count, pois: [...] }
 * 容错：任何字段缺失都不崩，坐标非法的条目直接丢弃。
 */
export function parseCuratedPois(json: Record<string, unknown>): CuratedPoi[] {
  const list: CuratedPoi[] = [];
  const raw: unknown = json['pois'];
  if (!Array.isArray(raw)) return list;

  for (let i = 0; i < raw.length; i += 1) {
    const item: unknown = raw[i];
    if (typeof item !== 'object' || item === null) continue;
    const record: Record<string, unknown> = item as Record<string, unknown>;

    const idValue: unknown = record['id'];
    const nameValue: unknown = record['name'];
    const latValue: unknown = record['lat'];
    const lonValue: unknown = record['lon'];
    if (typeof nameValue !== 'string' || nameValue.trim().length === 0) continue;
    if (typeof latValue !== 'number' || !isFinite(latValue)) continue;
    if (typeof lonValue !== 'number' || !isFinite(lonValue)) continue;
    if (Math.abs(latValue) > 90 || Math.abs(lonValue) > 180) continue;

    const poi: CuratedPoi = {
      id: typeof idValue === 'string' && idValue.length > 0 ? idValue : 'poi-' + String(i),
      name: nameValue.trim(),
      lat: latValue,
      lon: lonValue,
      category: typeof record['category'] === 'string' ? (record['category'] as string) : 'plaza'
    };
    if (typeof record['area'] === 'string') poi.area = record['area'] as string;
    if (typeof record['address'] === 'string') poi.address = record['address'] as string;
    if (typeof record['photoUrl'] === 'string') poi.photoUrl = record['photoUrl'] as string;
    if (typeof record['photoCredit'] === 'string') poi.photoCredit = record['photoCredit'] as string;
    if (typeof record['summary'] === 'string') poi.summary = record['summary'] as string;
    if (typeof record['why'] === 'string') poi.why = record['why'] as string;
    if (typeof record['task'] === 'string') poi.task = record['task'] as string;
    if (typeof record['emoji'] === 'string') poi.emoji = record['emoji'] as string;
    if (typeof record['rarity'] === 'string') poi.rarity = record['rarity'] as string;
    const hintsValue: unknown = record['hints'];
    if (Array.isArray(hintsValue)) {
      const hints: string[] = [];
      for (let h = 0; h < hintsValue.length; h += 1) {
        if (typeof hintsValue[h] === 'string') hints.push(hintsValue[h] as string);
      }
      if (hints.length > 0) poi.hints = hints;
    }
    list.push(poi);
  }
  return list;
}

/** 策展 POI → 候选点（坐标已是 WGS-84，由后台导出时保证） */
export function curatedToCandidate(poi: CuratedPoi): PoiCandidate {
  const candidate: PoiCandidate = {
    id: 'curated-' + poi.id,
    name: poi.name,
    latitude: poi.lat,
    longitude: poi.lon,
    category: poi.category.length > 0 ? poi.category : 'plaza',
    source: 'curated'
  };
  if (poi.address !== undefined) candidate.address = poi.address;
  if (poi.photoUrl !== undefined) candidate.photoUrl = poi.photoUrl;
  if (poi.photoCredit !== undefined) candidate.photoCredit = poi.photoCredit;
  return candidate;
}

/**
 * 策展 POI 优先：在距离窗口内按心情加权挑一个。
 * 策展点已经带 why/task/hints/图片，不需要再生成。
 */
export function pickCurated(
  curated: CuratedPoi[],
  origin: GeoPoint,
  mood: Mood,
  relax: number,
  minDistance: number,
  maxDistance: number,
  random: number
): CuratedPoi | undefined {
  const candidates: PoiCandidate[] = [];
  for (let i = 0; i < curated.length; i += 1) {
    const poi: CuratedPoi = curated[i];
    if (!isFinite(poi.lat) || !isFinite(poi.lon)) continue;
    if (poi.name.trim().length === 0) continue;
    candidates.push(curatedToCandidate(poi));
  }
  if (candidates.length === 0) return undefined;
  const picked = pickCandidate(candidates, {
    origin: origin,
    mood: mood,
    relax: relax,
    minDistance: minDistance,
    maxDistance: maxDistance,
    random: random
  });
  if (picked === undefined) return undefined;
  // 找回原始策展对象（保留 why/task/hints 等扩展字段）
  const targetID: string = picked.candidate.id;
  for (let i = 0; i < curated.length; i += 1) {
    if ('curated-' + curated[i].id === targetID) return curated[i];
  }
  return undefined;
}

/** 策展 POI → Place（用后台写的文案，缺字段回退到类别模板） */
export function makeCuratedPlace(poi: CuratedPoi, origin: GeoPoint, mood: Mood, startMeters: number): Place {
  const category: string = poi.category.length > 0 ? poi.category : 'plaza';
  const base: Place = makeRealPlace(
    {
      id: poi.id,
      name: poi.name,
      coordinate: { latitude: poi.lat, longitude: poi.lon },
      category: realCategoryFromKey(category),
      source: 'curated',
      address: poi.address
    },
    origin,
    mood,
    new Date().getHours(),
    startMeters
  );
  // 后台策展数据优先级最高：人工写的 why / task / hints 覆盖模板
  if (poi.why !== undefined && poi.why.length > 0) base.why = poi.why;
  if (poi.task !== undefined && poi.task.length > 0) base.task = poi.task;
  if (poi.hints !== undefined && poi.hints.length >= 3) {
    base.hints = [poi.hints[0], poi.hints[1], poi.hints[2]];
  }
  if (poi.emoji !== undefined && poi.emoji.length > 0) base.emoji = poi.emoji;
  if (poi.photoUrl !== undefined) base.photoUrl = poi.photoUrl;
  if (poi.photoCredit !== undefined) base.photoCredit = poi.photoCredit;
  if (poi.summary !== undefined) base.summary = poi.summary;
  base.source = 'curated';
  if (poi.address !== undefined && poi.address.length > 0) base.address = poi.address;
  return base;
}

/** 一次档位的中间结果 */
interface TierAttempt {
  place?: Place;
  poolSize: number;
  reports: SourceReport[];
  source: string;
  dull?: Place;
}

/** 搜索参数（三档放宽 + 漫游 + 时段 + 排除已探索） */
export interface FindOptions {
  /** 走路去（默认）/ 远程漫游 */
  scope?: ExploreScope;
  /** 已经探索过的地点 id（抽盒避开） */
  excludedPlaceIDs?: string[];
  /** 时段（不传按当前时刻） */
  moment?: DayMoment;
  /** 候选条数上限（默认按档位 40 / 60） */
  limit?: number;
}

/** 远程漫游时撒点用的可复现随机数（8 个 0…1） */
function roamRandom(seed: number): number[] {
  const values: number[] = [];
  let state: number = Math.max(1, Math.floor(seed) % 2147483647);
  for (let i = 0; i < 8; i += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    values.push(state / 2147483648);
  }
  return values;
}

/**
 * 跑一档：策展优先 → 多数据源 → 挑一个。
 */
async function attemptTier(
  client: HttpClient,
  keys: MapKeys,
  curated: CuratedPoi[],
  origin: GeoPoint,
  mood: Mood,
  duration: WalkDuration,
  relax: number,
  random: number,
  limit: number,
  options: FindOptions
): Promise<TierAttempt> {
  const params = tierParams(relax, duration);
  const startMeters: number = walkMeters(duration);
  const scope: ExploreScope = options.scope === undefined ? ExploreScope.Walk : options.scope;
  const moment: DayMoment = options.moment === undefined ? currentMoment() : options.moment;
  const excluded: string[] = options.excludedPlaceIDs === undefined ? [] : options.excludedPlaceIDs;
  // 漫游的距离窗口来自环带，不来自时长
  const roam: number[] = roamRange(relax);
  const minDistance: number = scope === ExploreScope.Roam ? roam[0] : params.minDistance;
  const maxDistance: number = scope === ExploreScope.Roam ? roam[1] : params.maxDistance;

  // ① 策展数据优先（人工审核过的最可靠）
  const curatedPick: CuratedPoi | undefined = pickCurated(
    curated, origin, mood, relax, minDistance, maxDistance, random
  );
  if (curatedPick !== undefined) {
    const attempt: TierAttempt = {
      place: makeCuratedPlace(curatedPick, origin, mood, startMeters),
      poolSize: curated.length,
      reports: [],
      source: 'curated'
    };
    return attempt;
  }

  // ② 多数据源（漫游走环带撒点）
  let candidates: PoiCandidate[];
  let reports: SourceReport[];
  if (scope === ExploreScope.Roam) {
    const roamResult = await roamNearby(client, keys, origin, relax, 9000, roamRandom(Math.floor(random * 1000000)));
    candidates = roamResult.candidates;
    reports = roamResult.reports;
  } else {
    const result = await nearby(client, keys, {
      latitude: origin.latitude,
      longitude: origin.longitude,
      radiusMeters: params.radius,
      limit: limit
    });
    candidates = result.candidates;
    reports = result.reports;
  }

  const picked = pickCandidate(candidates, {
    origin: origin,
    mood: mood,
    relax: relax,
    minDistance: minDistance,
    maxDistance: maxDistance,
    random: random,
    excludedIDs: excluded,
    moment: moment
  });

  if (picked === undefined) {
    const empty: TierAttempt = {
      poolSize: candidates.length,
      reports: reports,
      source: ''
    };
    return empty;
  }

  const candidate: PoiCandidate = picked.candidate;
  const coordinate: GeoPoint = {
    latitude: candidate.latitude,
    longitude: candidate.longitude
  };
  const place: Place = makeRealPlace(
    {
      id: candidate.id,
      name: candidate.name,
      coordinate: coordinate,
      category: realCategoryFromKey(candidate.category),
      source: candidate.source,
      address: candidate.address
    },
    origin,
    mood,
    new Date().getHours(),
    startMeters
  );
  if (candidate.address !== undefined) place.address = candidate.address;
  if (candidate.photoUrl !== undefined) place.photoUrl = candidate.photoUrl;
  if (candidate.photoCredit !== undefined) place.photoCredit = candidate.photoCredit;

  const attempt: TierAttempt = {
    place: place,
    poolSize: candidates.length,
    reports: reports,
    source: candidate.source
  };
  if (isDullCandidate(candidate)) attempt.dull = place;
  return attempt;
}

/** 时长 → 步行米数（与 parity 一致） */
function walkMeters(duration: WalkDuration): number {
  if (duration === WalkDuration.M15) return 240;
  if (duration === WalkDuration.M60) return 960;
  return 480;
}

/**
 * 主入口：三档放宽地找一个真实地点。
 * @param random 可复现随机数 0…1（测试传固定值）
 * @param options 漫游 / 时段 / 排除已探索 / 候选上限
 */
export async function findRealPlace(
  client: HttpClient,
  keys: MapKeys,
  curated: CuratedPoi[],
  origin: GeoPoint,
  mood: Mood,
  duration: WalkDuration,
  random: number,
  limit: number,
  options?: FindOptions
): Promise<SearchOutcome> {
  const activeOptions: FindOptions = options === undefined ? {} : options;
  if (!isFinite(origin.latitude) || !isFinite(origin.longitude)) {
    const invalid: SearchOutcome = {
      tier: 0,
      poolSize: 0,
      reports: [],
      source: '',
      failReason: 'no-origin'
    };
    return invalid;
  }

  // 漫游每次要撒 4 个点 × 多个源，代价比附近搜索高，
  // 只跑两档（45 公里 → 55 公里），第三档收益很小、等待翻倍。
  // （与苹果版 BoxSetupSheet 的 tierIndices 一致）
  const roam: boolean = activeOptions.scope === ExploreScope.Roam;
  const tierCount: number = roam ? 2 : 3;

  let dullFallback: Place | undefined = undefined;
  let lastReports: SourceReport[] = [];
  let poolSize: number = 0;
  let networkFailed: boolean = false;

  for (let tier = 0; tier < tierCount; tier += 1) {
    let attempt: TierAttempt;
    try {
      attempt = await attemptTier(
        client, keys, curated, origin, mood, duration, tier, random, limit, activeOptions
      );
    } catch (error) {
      // 单档网络异常：记下来，继续下一档（范围更大，可能换到能用的源）
      networkFailed = true;
      continue;
    }
    if (attempt.reports.length > 0) lastReports = attempt.reports;
    poolSize = Math.max(poolSize, attempt.poolSize);

    if (attempt.place !== undefined) {
      // 真实且「够格」→ 直接用
      if (attempt.dull === undefined) {
        const success: SearchOutcome = {
          place: attempt.place,
          tier: tier,
          poolSize: attempt.poolSize,
          reports: attempt.reports,
          source: attempt.source,
          failReason: ''
        };
        return success;
      }
      // 真实但不够格：先记下，继续往更宽的档位找更好的
      if (dullFallback === undefined) dullFallback = attempt.place;
    }
  }

  // 三档都试过：有真实但普通的地点就用它（绝不编造）
  if (dullFallback !== undefined) {
    const fallback: SearchOutcome = {
      place: dullFallback,
      tier: tierCount - 1,
      poolSize: poolSize,
      reports: lastReports,
      source: dullFallback.source,
      failReason: ''
    };
    return fallback;
  }

  // 明确失败：不虚构
  const failed: SearchOutcome = {
    tier: tierCount - 1,
    poolSize: poolSize,
    reports: lastReports,
    source: '',
    failReason: networkFailed && poolSize === 0 ? 'network' : 'no-real-place'
  };
  return failed;
}

/** 失败面板的「每个源失败原因」列表文案 */
export function sourceReportLines(reports: SourceReport[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < reports.length; i += 1) {
    const report: SourceReport = reports[i];
    if (report.ok) {
      lines.push(report.label + '：找到 ' + String(report.count) + ' 个');
    } else {
      const reason: string = report.error.length > 0 ? report.error : '没返回结果';
      lines.push(report.label + '：' + reason);
    }
  }
  return lines;
}

/** 搜索异常的统一包装（UI 层 catch 用） */
export function searchErrorText(error: unknown): string {
  return '找真实地点时出错：' + errorText(error);
}