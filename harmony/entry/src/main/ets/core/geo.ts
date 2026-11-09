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
