/**
 * 盲走 BlindWalk · HarmonyOS 逻辑层 — 地理计算
 *
 * 移植自 apple/Shared/Core/Geo.swift（Haversine 距离 / 方位角 / 按方位偏移 / 八方向 / 箭头）。
 * 全部为纯函数，不依赖 @ohos.*，可在 Node 中直接测试。
 */

import { GeoPoint } from './types';

/** 地球平均半径（米），与苹果版 GeoMath.earthRadius 一致 */
export const EARTH_RADIUS_METERS: number = 6371000;

const PI: number = Math.PI;
const DEG_TO_RAD: number = PI / 180;
const RAD_TO_DEG: number = 180 / PI;

/** 两点间距离（米），Haversine 公式 */
export function distance(from: GeoPoint, to: GeoPoint): number {
  const lat1: number = from.latitude * DEG_TO_RAD;
  const lat2: number = to.latitude * DEG_TO_RAD;
  const dLat: number = (to.latitude - from.latitude) * DEG_TO_RAD;
  const dLon: number = (to.longitude - from.longitude) * DEG_TO_RAD;

  const sinLat: number = Math.sin(dLat / 2);
  const sinLon: number = Math.sin(dLon / 2);
  const a: number = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  const c: number = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return EARTH_RADIUS_METERS * c;
}

/** 把任意角度归一化到 [0, 360) */
export function normalizeDegrees(degrees: number): number {
  const value: number = degrees % 360;
  return value < 0 ? value + 360 : value;
}

/** 从 origin 指向 target 的方位角（度）。0 = 正北，90 = 正东 */
export function bearing(from: GeoPoint, to: GeoPoint): number {
  const lat1: number = from.latitude * DEG_TO_RAD;
  const lat2: number = to.latitude * DEG_TO_RAD;
  const dLon: number = (to.longitude - from.longitude) * DEG_TO_RAD;

  const y: number = Math.sin(dLon) * Math.cos(lat2);
  const x: number = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return normalizeDegrees(Math.atan2(y, x) * RAD_TO_DEG);
}

/** 从 origin 出发、沿 bearingDegrees 走 meters 米后的坐标 */
export function offset(from: GeoPoint, meters: number, bearingDegrees: number): GeoPoint {
  const angular: number = meters / EARTH_RADIUS_METERS;
  const rad: number = bearingDegrees * DEG_TO_RAD;
  const lat1: number = from.latitude * DEG_TO_RAD;
  const lon1: number = from.longitude * DEG_TO_RAD;

  const lat2: number = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(rad)
  );
  const lon2: number = lon1 + Math.atan2(
    Math.sin(rad) * Math.sin(angular) * Math.cos(lat1),
    Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
  );

  const result: GeoPoint = {
    latitude: lat2 * RAD_TO_DEG,
    longitude: lon2 * RAD_TO_DEG
  };
  return result;
}

/** 方位角 → 八方向文字（用于「往北走」这类文案） */
export function compassLabel(degrees: number): string {
  const normalized: number = normalizeDegrees(degrees);
  if (normalized >= 337.5 || normalized < 22.5) return '北';
  if (normalized < 67.5) return '东北';
  if (normalized < 112.5) return '东';
  if (normalized < 157.5) return '东南';
  if (normalized < 202.5) return '南';
  if (normalized < 247.5) return '西南';
  if (normalized < 292.5) return '西';
  return '西北';
}

/** 方位角 → 箭头（绝对方向兜底；相对手机朝向的旋转由 UI 处理） */
export function arrow(degrees: number): string {
  const normalized: number = normalizeDegrees(degrees);
  if (normalized >= 337.5 || normalized < 22.5) return '↑';
  if (normalized < 67.5) return '↗';
  if (normalized < 112.5) return '→';
  if (normalized < 157.5) return '↘';
  if (normalized < 202.5) return '↓';
  if (normalized < 247.5) return '↙';
  if (normalized < 292.5) return '←';
  return '↖';
}

// ============================================================
// 坐标系转换（WGS-84 / GCJ-02 / BD-09）
//
// 为什么必须有：高德只吃 GCJ-02、百度只吃 BD-09，而 GPS / OSM / 维基是 WGS-84。
// 直接混用会偏 300–500 米，30 米到达判定直接失效。
// 算法为业界通用实现（GCJ-02 逆算用 3 次迭代），误差 1–3 米。
// 与 prototype/web/providers.js 同名函数逐行一致。
// ============================================================

const GCJ_A: number = 6378245.0;
const GCJ_EE: number = 0.00669342162296594323;

/** 粗略判断是否在中国境外（境外不做 GCJ 偏移） */
export function outOfChina(latitude: number, longitude: number): boolean {
  if (longitude < 72.004 || longitude > 137.8347) return true;
  if (latitude < 0.8293 || latitude > 55.8271) return true;
  return false;
}

function transformLat(x: number, y: number): number {
  let ret: number = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function transformLon(x: number, y: number): number {
  let ret: number = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
}

/** WGS-84 → GCJ-02（发给高德前必须转） */
export function wgs84ToGcj02(latitude: number, longitude: number): GeoPoint {
  if (outOfChina(latitude, longitude)) {
    return { latitude: latitude, longitude: longitude };
  }
  let dLat: number = transformLat(longitude - 105.0, latitude - 35.0);
  let dLon: number = transformLon(longitude - 105.0, latitude - 35.0);
  const radLat: number = latitude / 180.0 * PI;
  let magic: number = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic: number = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic) * PI);
  dLon = (dLon * 180.0) / (GCJ_A / sqrtMagic * Math.cos(radLat) * PI);
  return { latitude: latitude + dLat, longitude: longitude + dLon };
}

/** GCJ-02 → WGS-84（高德返回坐标必须转回来） */
export function gcj02ToWgs84(latitude: number, longitude: number): GeoPoint {
  if (outOfChina(latitude, longitude)) {
    return { latitude: latitude, longitude: longitude };
  }
  let wgsLat: number = latitude;
  let wgsLon: number = longitude;
  for (let i = 0; i < 3; i += 1) {
    const forward: GeoPoint = wgs84ToGcj02(wgsLat, wgsLon);
    wgsLat += latitude - forward.latitude;
    wgsLon += longitude - forward.longitude;
  }
  return { latitude: wgsLat, longitude: wgsLon };
}

/** GCJ-02 → BD-09 */
export function gcj02ToBd09(latitude: number, longitude: number): GeoPoint {
  const x: number = longitude;
  const y: number = latitude;
  const z: number = Math.sqrt(x * x + y * y) + 0.00002 * Math.sin(y * PI * 3000.0 / 180.0);
  const theta: number = Math.atan2(y, x) + 0.000003 * Math.cos(x * PI * 3000.0 / 180.0);
  return { latitude: z * Math.sin(theta) + 0.006, longitude: z * Math.cos(theta) + 0.0065 };
}

/** BD-09 → GCJ-02 */
export function bd09ToGcj02(latitude: number, longitude: number): GeoPoint {
  const x: number = longitude - 0.0065;
  const y: number = latitude - 0.006;
  const z: number = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * PI * 3000.0 / 180.0);
  const theta: number = Math.atan2(y, x) - 0.000003 * Math.cos(x * PI * 3000.0 / 180.0);
  return { latitude: z * Math.sin(theta), longitude: z * Math.cos(theta) };
}

/** WGS-84 → BD-09（发给百度前必须转） */
export function wgs84ToBd09(latitude: number, longitude: number): GeoPoint {
  const gcj: GeoPoint = wgs84ToGcj02(latitude, longitude);
  return gcj02ToBd09(gcj.latitude, gcj.longitude);
}

/** BD-09 → WGS-84（百度返回坐标必须转回来） */
export function bd09ToWgs84(latitude: number, longitude: number): GeoPoint {
  const gcj: GeoPoint = bd09ToGcj02(latitude, longitude);
  return gcj02ToWgs84(gcj.latitude, gcj.longitude);
}
