/**
 * 步迷 Walkaholic · HarmonyOS 逻辑层 — 步行路线（Valhalla）
 *
 * 移植自 prototype/web/geo.js 的 fetchRoute / decodePolyline6 / routeProgress。
 * 用途：迷雾路径视图需要「沿路线的折线」，而不是直线。
 *
 * 端点：https://valhalla1.openstreetmap.de/route（公开、无需 Key）
 * 失败返回 undefined，由 UI 退回「只显示直线距离 + 方向」。
 *
 * 注意：Valhalla 即使传 shape_format: geojson 也可能返回 polyline6 字符串，
 * 所以这里自己解码，并对两种格式都做兼容。
 */

import { HttpClient, errorText, parseJson, requestText } from './http';
import { GeoPoint } from './types';
import { RoutePolyline } from './contract';

export const ROUTE_ENDPOINT: string = 'https://valhalla1.openstreetmap.de/route';
export const ROUTE_TIMEOUT_MS: number = 6000;
/** 路线缓存有效期：10 分钟 */
export const ROUTE_CACHE_TTL_MS: number = 10 * 60 * 1000;

/** Valhalla maneuver.type → 简化转向语义（与 Web 版一致） */
export const MANEUVER_DIRECTIONS: Record<string, string> = {
  '1': 'start', '2': 'start', '3': 'start',
  '4': 'arrive', '5': 'arrive', '6': 'arrive',
  '7': 'straight', '8': 'straight',
  '9': 'slight-right', '10': 'right', '11': 'sharp-right',
  '12': 'uturn', '13': 'uturn',
  '14': 'sharp-left', '15': 'left', '16': 'slight-left',
  '18': 'right', '19': 'left',
  '20': 'right', '21': 'left',
  '22': 'straight', '23': 'slight-right', '24': 'slight-left',
  '25': 'straight', '26': 'roundabout', '27': 'roundabout',
  '37': 'straight', '38': 'straight', '39': 'straight', '40': 'straight'
};

/** 方向 → 中文（「30 米后左拐」） */
export const DIRECTION_LABELS: Record<string, string> = {
  start: '出发',
  straight: '直行',
  'slight-right': '向右前方',
  right: '右拐',
  'sharp-right': '向右大拐',
  'slight-left': '向左前方',
  left: '左拐',
  'sharp-left': '向左大拐',
  uturn: '掉头',
  roundabout: '走环岛',
  arrive: '到达'
};

/** 一个转向点 */
export interface RouteManeuver {
  direction: string;
  label: string;
  /** 这一段多长（米） */
  distance: number;
  /** 从起点到这个转向点的累计米数 */
  cumulative: number;
}

/** 路线（折线 + 转向序列） */
export interface WalkingRoute {
  distanceMeters: number;
  maneuvers: RouteManeuver[];
  /** [lon, lat] */
  points: number[][];
}

/** polyline6 解码 → [lon, lat] 数组 */
export function decodePolyline6(encoded: string): number[][] {
  const points: number[][] = [];
  if (encoded.length === 0) return points;
  let index: number = 0;
  let lat: number = 0;
  let lon: number = 0;
  const length: number = encoded.length;

  while (index < length) {
    let shift: number = 0;
    let result: number = 0;
    let byte: number = 0;
    do {
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < length);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0;
    result = 0;
    byte = 0;
    do {
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < length);
    lon += (result & 1) ? ~(result >> 1) : (result >> 1);

    points.push([lon / 1e6, lat / 1e6]);
  }
  return points;
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value: unknown = record[key];
  if (typeof value === 'number' && isFinite(value)) return value;
  return NaN;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value: unknown = record[key];
  return typeof value === 'string' ? value : '';
}

/** 解析 Valhalla 响应（纯函数，fixture 可测） */
export function parseValhalla(json: Record<string, unknown>): WalkingRoute | undefined {
  const trip: unknown = json['trip'];
  if (typeof trip !== 'object' || trip === null) return undefined;
  const legs: unknown = (trip as Record<string, unknown>)['legs'];
  if (!Array.isArray(legs) || legs.length === 0) return undefined;
  const first: unknown = legs[0];
  if (typeof first !== 'object' || first === null) return undefined;
  const leg: Record<string, unknown> = first as Record<string, unknown>;

  const maneuversRaw: unknown = leg['maneuvers'];
  if (!Array.isArray(maneuversRaw) || maneuversRaw.length === 0) return undefined;

  const points: number[][] = decodePolyline6(readString(leg, 'shape'));
  const maneuvers: RouteManeuver[] = [];
  let cumulative: number = 0;

  for (let i = 0; i < maneuversRaw.length; i += 1) {
    const raw: unknown = maneuversRaw[i];
    if (typeof raw !== 'object' || raw === null) continue;
    const maneuver: Record<string, unknown> = raw as Record<string, unknown>;
    const typeValue: unknown = maneuver['type'];
    const typeText: string = typeof typeValue === 'number' ? String(typeValue) : readString(maneuver, 'type');
    const direction: string = MANEUVER_DIRECTIONS[typeText] === undefined
      ? 'straight'
      : MANEUVER_DIRECTIONS[typeText];
    const kilometers: number = readNumber(maneuver, 'length');
    const meters: number = isFinite(kilometers) ? Math.max(0, Math.round(kilometers * 1000)) : 0;
    const label: string = DIRECTION_LABELS[direction] === undefined ? '直行' : DIRECTION_LABELS[direction];
    maneuvers.push({
      direction: direction,
      label: label,
      distance: meters,
      cumulative: cumulative
    });
    cumulative += meters;
  }

  const summaryValue: unknown = leg['summary'];
  let totalMeters: number = cumulative;
  if (typeof summaryValue === 'object' && summaryValue !== null) {
    const summary: Record<string, unknown> = summaryValue as Record<string, unknown>;
    const length: number = readNumber(summary, 'length');
    if (isFinite(length) && length > 0) totalMeters = Math.round(length * 1000);
  }

  const route: WalkingRoute = {
    distanceMeters: totalMeters,
    maneuvers: maneuvers,
    points: points
  };
  return route;
}

/** 路线缓存（key = 起点网格 + 终点） */
interface CachedRoute {
  route: WalkingRoute;
  at: number;
}

const routeCache: Map<string, CachedRoute> = new Map<string, CachedRoute>();

function cacheKey(from: GeoPoint, to: GeoPoint): string {
  return from.latitude.toFixed(3) + ',' + from.longitude.toFixed(3) + '->' +
    to.latitude.toFixed(4) + ',' + to.longitude.toFixed(4);
}

/**
 * 取一条步行路线（带 10 分钟缓存）。
 * 失败返回 undefined（调用方退回直线距离 + 方向，不阻塞用户）。
 */
export async function fetchWalkingRoute(
  client: HttpClient,
  from: GeoPoint,
  to: GeoPoint,
  now: number
): Promise<WalkingRoute | undefined> {
  if (!isFinite(from.latitude) || !isFinite(to.latitude)) return undefined;
  const key: string = cacheKey(from, to);
  const cached: CachedRoute | undefined = routeCache.get(key);
  if (cached !== undefined && now - cached.at < ROUTE_CACHE_TTL_MS) {
    return cached.route;
  }

  const body: Record<string, unknown> = {
    locations: [
      { lat: from.latitude, lon: from.longitude },
      { lat: to.latitude, lon: to.longitude }
    ],
    costing: 'pedestrian',
    units: 'kilometers',
    shape_format: 'polyline6'
  };

  try {
    const text: string = await requestText(client, {
      url: ROUTE_ENDPOINT,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Walkaholic-Harmony/0.7 (https://github.com/xiaoqiangch/walkaholic)',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body),
      timeoutMs: ROUTE_TIMEOUT_MS
    });
    const route: WalkingRoute | undefined = parseValhalla(parseJson(text));
    if (route === undefined) return undefined;
    routeCache.set(key, { route: route, at: now });
    return route;
  } catch (error) {
    return undefined;
  }
}

/** 转成契约里的 RoutePolyline（store.setRoute 用） */
export function toRoutePolyline(route: WalkingRoute, now: number): RoutePolyline {
  const polyline: RoutePolyline = {
    points: route.points,
    distanceMeters: route.distanceMeters,
    fetchedAt: now
  };
  return polyline;
}

/** 路线失败时给用户看的说明 */
export function routeErrorText(error: unknown): string {
  return '没规划到步行路线（只显示直线距离）：' + errorText(error);
}