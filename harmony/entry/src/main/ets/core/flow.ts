/**
 * 盲走 BlindWalk · HarmonyOS 逻辑层 — 「开一个盲盒」的完整编排
 *
 * 把这条链路固定在 core 里（而不是散在 UI 里），原因：
 *   1. 「Key 下发 → 策展优先 → 三档真实搜索 → 明确失败」是产品红线，
 *      放在纯 TS 里能用 Node 测试守住，UI 只负责展示；
 *   2. 三端（Web / iOS / HarmonyOS）行为必须一致，规则只有一份。
 *
 * 流程：
 *   mapkeys（包内 → Pages → 后台 → 免费源）
 *     → curated pois.json（人工审核，优先）
 *     → 三档放宽真实搜索
 *     → 成功：返回 Place（真实来源 + 真实坐标）
 *     → 失败：返回 SearchOutcome.failReason（**绝不虚构兜底**）
 */

import { KeyValueStore } from './contract';
import { HttpClient, MapKeys, SourceReport, emptyKeys } from './http';
import { RoutePolyline } from './contract';
import { GeoPoint, Mood, Place, WalkDuration } from './types';
import {
  CuratedPoi,
  SearchOutcome,
  findRealPlace,
  parseCuratedPois
} from './search';
import { ADMIN_BASE_DEFAULT, MapKeysResult, loadMapKeys, maskKey } from './mapkeys';
import { CURATED_TIMEOUT_MS, CURATED_URL } from './search';
import { DataSourceStatus } from './contract';
import {
  WalkingRoute,
  fetchWalkingRoute,
  toRoutePolyline
} from './route';
import { parseJson, requestText } from './http';

/** 依赖注入（UI 提供平台实现，测试提供 Fake） */
export interface QuestFlowDeps {
  http: HttpClient;
  kv: KeyValueStore;
  /** 读包内 rawfile 的 mapkeys.json（没有返回 undefined） */
  readBundledKeys: () => string | undefined;
  /** 后台地址（设置里可改） */
  adminBase: string;
  /** 当前时间（测试可注入固定值） */
  now: () => number;
}

/** 一次抽盒的入参 */
export interface QuestStartInput {
  origin: GeoPoint;
  mood: Mood;
  duration: WalkDuration;
  /** 手动「扩大范围再找」时从最宽档开始 */
  startTier?: number;
}

/** 抽盒准备结果 */
export interface QuestStartResult {
  /** 成功时的真实地点（失败为 undefined） */
  place?: Place;
  /** 失败原因（成功为空串） */
  failReason: string;
  /** 每个数据源的回报（失败面板逐条展示） */
  reports: SourceReport[];
  /** 命中的档位 */
  tier: number;
  /** 候选池大小 */
  poolSize: number;
  /** 策展数据条数 */
  curatedCount: number;
  /** Key 下发结果（设置页展示） */
  keys: MapKeys;
  keySource: string;
}

/** 策展数据缓存（内存；6 小时由上层控制刷新频率） */
interface CuratedCache {
  pois: CuratedPoi[];
  at: number;
}

let curatedCache: CuratedCache | undefined = undefined;

/** 测试辅助：清掉策展缓存 */
export function resetCuratedCache(): void {
  curatedCache = undefined;
}

/**
 * 拉取策展数据（pois.json）。失败返回空数组（静默降级，不影响自动抓取）。
 * 6 小时内复用内存缓存。
 */
export async function loadCuratedPois(
  client: HttpClient,
  now: number
): Promise<CuratedPoi[]> {
  if (curatedCache !== undefined && now - curatedCache.at < 6 * 3600 * 1000) {
    return curatedCache.pois;
  }
  try {
    const text: string = await requestText(client, {
      url: CURATED_URL + '?t=' + String(Math.floor(now / 3600000)),
      method: 'GET',
      timeoutMs: CURATED_TIMEOUT_MS
    });
    const pois: CuratedPoi[] = parseCuratedPois(parseJson(text));
    curatedCache = { pois: pois, at: now };
    return pois;
  } catch (error) {
    curatedCache = { pois: [], at: now };
    return [];
  }
}

/**
 * 抽盒第一步：备好 Key + 策展数据 + 真实地点。
 *
 * 注意：成功时 `place.source` 一定属于 curated/amap/baidu/osm/wiki，
 * 且 `place.coordinate` 一定有值 —— 这是「绝不虚构」的最后一道闸门。
 */
export async function prepareQuest(
  deps: QuestFlowDeps,
  input: QuestStartInput,
  random: number
): Promise<QuestStartResult> {
  const nowValue: number = deps.now();

  // ① 地图 Key（包内 → Pages → 后台 → 免费源）
  const keyResult: MapKeysResult = await loadMapKeys(
    deps.http, deps.kv, deps.readBundledKeys, deps.adminBase, nowValue
  );

  // ② 策展数据（人工审核过的最可靠）
  const curated: CuratedPoi[] = await loadCuratedPois(deps.http, nowValue);

  // ③ 三档真实搜索（没有初始档位时从 0 开始）
  const startTier: number = input.startTier === undefined ? 0 : input.startTier;
  let outcome: SearchOutcome;
  if (startTier >= 1) {
    // 「扩大范围再找」：直接用最宽档重试一次
    outcome = await findRealPlace(
      deps.http, keyResult.keys, curated, input.origin,
      input.mood, input.duration, random, 60
    );
  } else {
    outcome = await findRealPlace(
      deps.http, keyResult.keys, curated, input.origin,
      input.mood, input.duration, random, 40
    );
  }

  const result: QuestStartResult = {
    failReason: outcome.failReason,
    reports: outcome.reports,
    tier: outcome.tier,
    poolSize: outcome.poolSize,
    curatedCount: curated.length,
    keys: keyResult.keys,
    keySource: keyResult.source
  };
  if (outcome.place !== undefined) result.place = outcome.place;
  return result;
}

/** 把 Key 下发结果转成 UI 展示用的数据源状态 */
export function toDataSourceStatus(
  keySource: string,
  keys: MapKeys,
  reports: SourceReport[],
  now: number,
  curatedCount: number
): DataSourceStatus {
  const status: DataSourceStatus = {
    keySource: keySource,
    amapReady: keys.amap.length > 0,
    baiduReady: keys.baidu.length > 0,
    amapMask: maskKey(keys.amap),
    baiduMask: maskKey(keys.baidu),
    reports: reports,
    checkedAt: now,
    curatedCount: curatedCount
  };
  return status;
}

/** 空的数据源状态 */
export function emptyStatus(now: number): DataSourceStatus {
  const status: DataSourceStatus = {
    keySource: 'none',
    amapReady: false,
    baiduReady: false,
    amapMask: '',
    baiduMask: '',
    reports: [],
    checkedAt: now,
    curatedCount: 0
  };
  return status;
}

/**
 * 规划步行路线（迷雾路径用）。失败返回 undefined，UI 退回「直线距离 + 方向」。
 */
export async function planRoute(
  deps: QuestFlowDeps,
  from: GeoPoint,
  to: GeoPoint
): Promise<RoutePolyline | undefined> {
  const route: WalkingRoute | undefined = await fetchWalkingRoute(deps.http, from, to, deps.now());
  if (route === undefined) return undefined;
  return toRoutePolyline(route, deps.now());
}

/** 默认依赖里的后台地址（与 mapkeys 保持一致） */
export function defaultAdminBase(): string {
  return ADMIN_BASE_DEFAULT;
}

/** 空 Key（测试/降级用） */
export function noKeys(): MapKeys {
  return emptyKeys();
}