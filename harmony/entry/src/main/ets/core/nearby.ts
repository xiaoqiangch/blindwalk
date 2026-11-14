/**
 * 步迷 Walkaholic · HarmonyOS 逻辑层 — 附近兴趣点发现
 *
 * 用途：图鉴「附近的兴趣点」区块。把多数据源 POI 列表转成 Place，
 * 供 UI 展示「未知用 ? + 类别 + 距离」并支持点击开始探索。
 *
 * 产品红线（与 parity.md 一致）：
 *   1. 只用真实数据源（amap/baidu/osm/wiki），**绝不虚构**；
 *   2. 名称在到达前不得出现在 UI 上 —— 由 UI 用 maskPlaceForWalking 的语义处理，
 *      本模块只负责「提供脏数据之外的合法 Place」；
 *   3. 坐标必须真实可用，否则不进列表。
 */

import { KeyValueStore } from './contract';
import { GeoPoint, Mood, Place, WalkDuration } from './types';
import { SourceReport } from './http';
import { makeRealPlace, realCategoryFromKey, durationStartMeters } from './catalog';
import { nearby } from './providers';
import { loadMapKeys } from './mapkeys';
import { PoiCandidate } from './parity';

/** 一次「附近兴趣点」检索结果 */
export interface NearbyDiscovery {
  places: Place[];
  reports: SourceReport[];
  /** Key 下发来源（上报/调试用） */
  keySource: string;
  /** 是否因为没有任何数据源可用而失败 */
  failed: boolean;
}

export interface NearbyDiscoveryDeps {
  kv: KeyValueStore;
  readBundledKeys: () => string | undefined;
  adminBase: string;
  now: () => number;
  /** 平台 HTTP 客户端（与 QuestFlowDeps.http 同类型） */
  http: import('./http').HttpClient;
}

/** 默认扫描半径（米）与条数上限 */
export const NEARBY_SCAN_RADIUS: number = 1800;
export const NEARBY_SCAN_LIMIT: number = 24;

/**
 * 检索附近的真实兴趣点，转成 Place 列表。
 *
 * 失败时返回 failed = true 且 places 为空 —— 调用方必须显式展示失败，
 * 不允许用演示地点填充（这就是「绝不虚构兜底」）。
 */
export async function discoverNearbyPlaces(
  deps: NearbyDiscoveryDeps,
  origin: GeoPoint,
  options?: { radiusMeters?: number; limit?: number; mood?: Mood; duration?: WalkDuration }
): Promise<NearbyDiscovery> {
  const nowValue: number = deps.now();
  const radius: number = options?.radiusMeters === undefined
    ? NEARBY_SCAN_RADIUS
    : options.radiusMeters;
  const limit: number = options?.limit === undefined ? NEARBY_SCAN_LIMIT : options.limit;
  const mood: Mood = options?.mood === undefined ? Mood.Drift : options.mood;
  const duration: WalkDuration = options?.duration === undefined
    ? WalkDuration.M30
    : options.duration;

  const empty: NearbyDiscovery = {
    places: [],
    reports: [],
    keySource: 'none',
    failed: true
  };

  if (!isFinite(origin.latitude) || !isFinite(origin.longitude)) {
    return empty;
  }

  // ① 地图 Key（包内 → Pages → 后台 → 免费源）
  let keys = undefined;
  let keySource: string = 'none';
  try {
    const keyResult = await loadMapKeys(
      deps.http, deps.kv, deps.readBundledKeys, deps.adminBase, nowValue
    );
    keys = keyResult.keys;
    keySource = keyResult.source;
  } catch (err) {
    // Key 全失败也别放弃：osm / wiki 是免 Key 源，还能给出真实地点
    return empty;
  }
  if (keys === undefined) {
    return empty;
  }

  // ② 多源并发检索
  let candidates: PoiCandidate[] = [];
  let reports: SourceReport[] = [];
  try {
    const result = await nearby(deps.http, keys, {
      latitude: origin.latitude,
      longitude: origin.longitude,
      radiusMeters: radius,
      limit: limit
    });
    candidates = result.candidates;
    reports = result.reports;
  } catch (err) {
    const failed: NearbyDiscovery = {
      places: [],
      reports: reports,
      keySource: keySource,
      failed: true
    };
    return failed;
  }

  // ③ 候选 → Place（只接受有真实坐标的）
  const startMeters: number = durationStartMeters(duration);
  const places: Place[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate: PoiCandidate = candidates[i];
    if (!isFinite(candidate.latitude) || !isFinite(candidate.longitude)) {
      continue;
    }
    if (candidate.name === undefined || candidate.name.length === 0) {
      continue;
    }
    try {
      const place: Place = makeRealPlace(
        {
          id: candidate.id,
          name: candidate.name,
          coordinate: {
            latitude: candidate.latitude,
            longitude: candidate.longitude
          },
          category: realCategoryFromKey(candidate.category),
          source: candidate.source,
          address: candidate.address
        },
        origin,
        mood,
        new Date(nowValue).getHours(),
        startMeters
      );
      if (candidate.photoUrl !== undefined) place.photoUrl = candidate.photoUrl;
      if (candidate.photoCredit !== undefined) place.photoCredit = candidate.photoCredit;
      places.push(place);
    } catch (err) {
      // 单条转换失败不影响其余
    }
  }

  const outcome: NearbyDiscovery = {
    places: places,
    reports: reports,
    keySource: keySource,
    failed: places.length === 0
  };
  return outcome;
}
