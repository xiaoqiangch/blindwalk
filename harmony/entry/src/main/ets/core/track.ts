/**
 * 步迷 Walkaholic · HarmonyOS 逻辑层 — 走路轨迹（个人城市地图的数据层）
 *
 * 移植自 apple/Shared/Core/WalkTrackStore.swift。
 *
 * 为什么要有它：卡片是「平台给的」，走过的路是「我自己留下的」。
 * 把每天的轨迹累积下来，用户就有一份别人拿不走的资产。
 *
 * 存储策略（与 iOS 一致）：
 *   - 只记「移动超过 25 米」的点（GPS 抖动不会画出毛线团），跨天总是记
 *   - 上限 12000 个点，超过就按天抽样压缩（保留每天首尾与均匀采样）
 *   - 落盘在 KeyValueStore，JSON 数组
 *
 * 纯 TypeScript：不 import 任何 @ohos.*，可在 Node 里单测。
 */

import { KeyValueStore } from './contract';
import { GeoPoint, WalkPoint } from './types';
import { distance } from './geo';

/** 轨迹存储键（与 profile / surprises 分开，互不影响） */
export const TRACK_KEY: string = 'walkaholic.track.v2';

/** 轨迹点上限 */
export const MAX_TRACK_POINTS: number = 12000;
/** 相邻采样点的最小间距（米）：小于它就不记 */
export const MIN_SPACING_METERS: number = 25;
/** 探索格子边长（米）：用于算「走过多少块地方」 */
export const CELL_METERS: number = 200;

const DAY_MS: number = 86400000;

function startOfDay(timestamp: number): number {
  const date: Date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** 按天分组的轨迹 */
export interface TrackDay {
  day: number;
  points: WalkPoint[];
}

/** 轨迹统计（城市地图顶部卡片） */
export interface TrackStats {
  /** 走过多少天 */
  walkedDayCount: number;
  /** 轨迹总长（米，断开 >3km 不计） */
  totalMeters: number;
  /** 走过的格子数（200 米一格） */
  exploredCellCount: number;
  /** 探索面积（平方公里） */
  areaSquareKm: number;
  isEmpty: boolean;
}

/** 轨迹仓库（内存 + KeyValueStore） */
export class WalkTrackStore {
  private kv: KeyValueStore;
  private points: WalkPoint[];

  constructor(kv: KeyValueStore) {
    this.kv = kv;
    this.points = this.load();
  }

  // ---------- 写入 ----------

  /**
   * 追加一个轨迹点；间距太近会被忽略。返回是否真的记下了。
   * 跨天总是记（用来切分「这一天走过哪」）。
   */
  append(point: GeoPoint, at: number): boolean {
    if (!isFinite(point.latitude) || !isFinite(point.longitude)) return false;
    const last: WalkPoint | undefined = this.points.length === 0
      ? undefined
      : this.points[this.points.length - 1];
    if (last !== undefined) {
      const moved: number = distance(
        { latitude: last.latitude, longitude: last.longitude }, point
      );
      const sameDay: boolean = startOfDay(last.time) === startOfDay(at);
      if (moved < MIN_SPACING_METERS && sameDay) return false;
    }
    this.points.push({ latitude: point.latitude, longitude: point.longitude, time: at });
    if (this.points.length > MAX_TRACK_POINTS) this.compress();
    this.persist();
    return true;
  }

  clear(): void {
    this.points = [];
    try {
      this.kv.delete(TRACK_KEY);
    } catch (error) {
      /* 清空失败不影响当前会话 */
    }
  }

  // ---------- 读取 ----------

  /** 按天分组（新的在前），每组内按时间升序 */
  days(): TrackDay[] {
    const buckets: Map<number, WalkPoint[]> = new Map<number, WalkPoint[]>();
    for (let i = 0; i < this.points.length; i += 1) {
      const point: WalkPoint = this.points[i];
      const day: number = startOfDay(point.time);
      const list: WalkPoint[] | undefined = buckets.get(day);
      if (list === undefined) {
        buckets.set(day, [point]);
      } else {
        list.push(point);
      }
    }
    const result: TrackDay[] = [];
    const keys: number[] = Array.from(buckets.keys());
    for (let i = 0; i < keys.length; i += 1) {
      const list: WalkPoint[] = buckets.get(keys[i]) as WalkPoint[];
      list.sort((a: WalkPoint, b: WalkPoint): number => a.time - b.time);
      result.push({ day: keys[i], points: list });
    }
    result.sort((a: TrackDay, b: TrackDay): number => b.day - a.day);
    return result;
  }

  /** 最近 N 天（含今天）的轨迹 */
  recentDays(count: number, now: number): TrackDay[] {
    const cutoff: number = startOfDay(now) - (count - 1) * DAY_MS;
    return this.days().filter((entry: TrackDay): boolean => entry.day >= cutoff);
  }

  /** 全部原始点（只读副本） */
  allPoints(): WalkPoint[] {
    return this.points.slice();
  }

  /** 格子 key：200 米一格 */
  static cellKey(point: GeoPoint): string {
    const latStep: number = CELL_METERS / 110540;
    const cosLat: number = Math.cos(point.latitude * Math.PI / 180);
    const lonStep: number = CELL_METERS / (111320 * Math.max(0.2, cosLat));
    return String(Math.floor(point.latitude / latStep)) + '_' +
      String(Math.floor(point.longitude / lonStep));
  }

  /** 统计（天数 / 里程 / 街区数 / 面积） */
  stats(): TrackStats {
    const cells: Set<string> = new Set<string>();
    const days: Set<number> = new Set<number>();
    let total: number = 0;
    for (let i = 0; i < this.points.length; i += 1) {
      const point: WalkPoint = this.points[i];
      cells.add(WalkTrackStore.cellKey({ latitude: point.latitude, longitude: point.longitude }));
      days.add(startOfDay(point.time));
      if (i > 0) {
        const previous: WalkPoint = this.points[i - 1];
        const gap: number = distance(
          { latitude: previous.latitude, longitude: previous.longitude },
          { latitude: point.latitude, longitude: point.longitude }
        );
        // 断开超过 3 公里视为「换了地点」，不计入里程（否则开车里程会被算进散步）
        if (gap < 3000) total += gap;
      }
    }
    const stats: TrackStats = {
      walkedDayCount: days.size,
      totalMeters: total,
      exploredCellCount: cells.size,
      areaSquareKm: cells.size * (CELL_METERS * CELL_METERS) / 1000000,
      isEmpty: this.points.length === 0
    };
    return stats;
  }

  /**
   * 包围盒（画布归一化用）；没有轨迹返回 undefined。
   * 与 iOS `boundingBox()` 同义。
   */
  boundingBox(): Box | undefined {
    if (this.points.length === 0) return undefined;
    const first: WalkPoint = this.points[0];
    let minLat: number = first.latitude;
    let maxLat: number = first.latitude;
    let minLon: number = first.longitude;
    let maxLon: number = first.longitude;
    for (let i = 1; i < this.points.length; i += 1) {
      const point: WalkPoint = this.points[i];
      if (point.latitude < minLat) minLat = point.latitude;
      if (point.latitude > maxLat) maxLat = point.latitude;
      if (point.longitude < minLon) minLon = point.longitude;
      if (point.longitude > maxLon) maxLon = point.longitude;
    }
    const box: Box = {
      minLat: minLat,
      maxLat: maxLat,
      minLon: minLon,
      maxLon: maxLon
    };
    return box;
  }

  // ---------- 落盘 ----------

  private persist(): void {
    try {
      this.kv.putString(TRACK_KEY, JSON.stringify(this.points));
    } catch (error) {
      /* 持久化失败不影响当前会话 */
    }
  }

  private load(): WalkPoint[] {
    const text: string | undefined = this.kv.getString(TRACK_KEY);
    if (text === undefined || text.length === 0) return [];
    try {
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed)) return [];
      const result: WalkPoint[] = [];
      for (let i = 0; i < parsed.length; i += 1) {
        const item: unknown = parsed[i];
        if (typeof item !== 'object' || item === null) continue;
        const record: Record<string, unknown> = item as Record<string, unknown>;
        const lat: unknown = record['latitude'];
        const lon: unknown = record['longitude'];
        const time: unknown = record['time'];
        if (typeof lat !== 'number' || typeof lon !== 'number') continue;
        if (typeof time !== 'number') continue;
        if (!isFinite(lat) || !isFinite(lon)) continue;
        result.push({ latitude: lat, longitude: lon, time: time });
      }
      return result;
    } catch (error) {
      return [];
    }
  }

  /**
   * 超过上限：按天均匀抽样，保留每天首尾
   * （否则地图上的线会断成一截一截）。
   */
  private compress(): void {
    const buckets: Map<number, WalkPoint[]> = new Map<number, WalkPoint[]>();
    for (let i = 0; i < this.points.length; i += 1) {
      const point: WalkPoint = this.points[i];
      const day: number = startOfDay(point.time);
      const list: WalkPoint[] | undefined = buckets.get(day);
      if (list === undefined) {
        buckets.set(day, [point]);
      } else {
        list.push(point);
      }
    }
    const dayCount: number = Math.max(1, buckets.size);
    const keepPerDay: number = Math.max(40, Math.floor(MAX_TRACK_POINTS / dayCount));
    const kept: WalkPoint[] = [];
    const keys: number[] = Array.from(buckets.keys());
    for (let d = 0; d < keys.length; d += 1) {
      const list: WalkPoint[] = buckets.get(keys[d]) as WalkPoint[];
      if (list.length <= keepPerDay) {
        for (let i = 0; i < list.length; i += 1) kept.push(list[i]);
        continue;
      }
      const stride: number = list.length / keepPerDay;
      for (let i = 0; i < keepPerDay; i += 1) {
        kept.push(list[Math.min(list.length - 1, Math.floor(i * stride))]);
      }
      const last: WalkPoint = list[list.length - 1];
      const tail: WalkPoint = kept[kept.length - 1];
      if (tail.latitude !== last.latitude || tail.longitude !== last.longitude) kept.push(last);
    }
    kept.sort((a: WalkPoint, b: WalkPoint): number => a.time - b.time);
    this.points = kept;
  }
}

/** 经纬度包围盒 */
export interface Box {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/**
 * 抽稀：把点等距采样到 limit 个（画布画几千个点会卡）。
 * 保留首尾，保证线不断。
 */
export function simplifyPoints(points: GeoPoint[], limit: number): GeoPoint[] {
  if (points.length <= limit) return points.slice();
  if (limit <= 1) return points.slice(0, 1);
  const step: number = points.length / limit;
  const out: GeoPoint[] = [];
  for (let i = 0; i < limit; i += 1) {
    const point: GeoPoint = points[Math.min(points.length - 1, Math.floor(i * step))];
    out.push({ latitude: point.latitude, longitude: point.longitude });
  }
  const last: GeoPoint = points[points.length - 1];
  const tail: GeoPoint = out[out.length - 1];
  if (tail.latitude !== last.latitude || tail.longitude !== last.longitude) out.push(last);
  return out;
}

/** 越新的轨迹越亮；最多衰减到 0.22，保证旧轨迹还看得见（与 iOS CityMapView 一致） */
export function trackOpacity(rank: number): number {
  const value: number = 0.9 - rank * 0.06;
  return value < 0.22 ? 0.22 : value;
}
