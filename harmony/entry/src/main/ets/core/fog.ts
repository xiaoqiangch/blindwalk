/**
 * 盲走 BlindWalk · HarmonyOS 逻辑层 — 迷雾路径几何（parity.md §3）
 *
 * 为什么单独抽一个纯 TS 文件：Canvas 绘制只能在真机/DevEco 里看效果，
 * 但「窗口取哪一段、每段透明度多少、箭头画在哪、指北针转多少度」这些
 * 全部是可计算的几何 —— 放在 core 里就能在 Node 里单测，UI 只负责画。
 *
 * 规格（三端一致）：
 * - 朝向：行进方向朝上（heading-up）
 * - 前方可见 min(260, 剩余-25) 米；后方可见 min(140, 已走-5) 米
 * - 两端各 46 米渐隐（按 3 米插值逐段降透明度）
 * - 已走部分冷灰蓝 #AEB8D6 / 线宽 7；前方靛蓝 #5B6CFF / 线宽 9
 * - 每 55 米一个行进箭头
 * - 「你」白底琥珀圈 + 深色三角；偏离路径 >18m 画红色虚线并提示
 * - 右下角指北针（指针按 -bearing 旋转）
 * - 剩余 < 60 米：整段隐藏，只显示「就在附近 · 抬头看看周围」
 * - 绝对不画终点、不画街道名
 */

import { GeoPoint } from './types';
import { distance } from './geo';

// ============================================================
// 规格常量（改之前先改 docs/parity.md §3）
// ============================================================

/** 前方可见上限（米） */
export const FOG_AHEAD_MAX: number = 260;
/** 前方留白：永远比剩余里程短 25 米，保证看不见终点 */
export const FOG_AHEAD_MARGIN: number = 25;
/** 后方可见上限（米） */
export const FOG_BEHIND_MAX: number = 140;
/** 后方留白 */
export const FOG_BEHIND_MARGIN: number = 5;
/** 两端渐隐过渡长度（米） */
export const FOG_FADE_METERS: number = 46;
/** 插值步长（米） */
export const FOG_STEP_METERS: number = 3;

/** 已走部分颜色 / 线宽 / 不透明度 */
export const PATH_BEHIND_COLOR: string = '#AEB8D6';
export const PATH_BEHIND_WIDTH: number = 7;
export const PATH_BEHIND_OPACITY: number = 0.55;

/** 前方部分颜色 / 线宽 */
export const PATH_AHEAD_COLOR: string = '#5B6CFF';
export const PATH_AHEAD_WIDTH: number = 9;

/** 行进箭头间距（米） */
export const CHEVRON_SPACING_METERS: number = 55;
/** 第一个箭头的位置（米，避免压在「你」的箭头上） */
export const CHEVRON_FIRST_METERS: number = 40;
/** 最后一个箭头与窗口末端的留白（米） */
export const CHEVRON_TAIL_MARGIN: number = 10;

/** 偏离路径多少米算「走偏了」 */
export const OFF_ROUTE_THRESHOLD_METERS: number = 18;
/** 偏离路径提示的上升阈值（带滞回，避免来回闪） */
export const OFF_ROUTE_HYSTERESIS_METERS: number = 4;

/** 剩余多少米时整段隐藏（保密 + 不再需要导航） */
export const FOG_HIDE_REMAINING_METERS: number = 60;

/** 偏离提示文案 */
export const OFF_ROUTE_COLOR: string = '#FF6B6B';

/** 「剩余 < 60m」时的替代文案 */
export const NEARBY_COPY: string = '就在附近 · 抬头看看周围';
/** 路径视图默认说明文案 */
export const FOG_CAPTION: string = '迷雾模式 · 只看见前后一段';

// ============================================================
// 路线折线
// ============================================================

/** 路线折线（点序：[lon, lat]，与 Valhalla / GeoJSON 一致） */
export interface RouteLine {
  points: number[][];
  /** 总长（米），缺省时内部计算 */
  distanceMeters?: number;
}

/** 累计距离表（沿折线每到一个顶点的里程） */
export interface RouteCumulative {
  points: number[][];
  /** cum[i] = 起点到第 i 个顶点的米数 */
  cum: number[];
  total: number;
}

/** 构建累计距离表；点数 < 2 返回 undefined */
export function buildCumulative(line: RouteLine): RouteCumulative | undefined {
  const points: number[][] = line.points;
  if (points === undefined || points.length < 2) return undefined;
  const cum: number[] = [0];
  for (let i = 0; i < points.length - 1; i += 1) {
    const from: GeoPoint = { latitude: points[i][1], longitude: points[i][0] };
    const to: GeoPoint = { latitude: points[i + 1][1], longitude: points[i + 1][0] };
    cum.push(cum[cum.length - 1] + distance(from, to));
  }
  const result: RouteCumulative = {
    points: points,
    cum: cum,
    total: cum[cum.length - 1]
  };
  return result;
}

/** 沿路径取第 sMeters 米处的坐标；s 越界自动夹到 [0, total] */
export function pointAlongPath(cumulative: RouteCumulative, sMeters: number): GeoPoint {
  const cum: number[] = cumulative.cum;
  const points: number[][] = cumulative.points;
  if (sMeters <= 0) {
    const head: GeoPoint = { latitude: points[0][1], longitude: points[0][0] };
    return head;
  }
  for (let i = 0; i < cum.length - 1; i += 1) {
    if (sMeters <= cum[i + 1]) {
      const segment: number = cum[i + 1] - cum[i];
      const ratio: number = segment > 0 ? (sMeters - cum[i]) / segment : 0;
      const point: GeoPoint = {
        latitude: points[i][1] + (points[i + 1][1] - points[i][1]) * ratio,
        longitude: points[i][0] + (points[i + 1][0] - points[i][0]) * ratio
      };
      return point;
    }
  }
  const last: number = points.length - 1;
  const tail: GeoPoint = { latitude: points[last][1], longitude: points[last][0] };
  return tail;
}

// ============================================================
// 沿线投影（把「我」吸附到路径上）
// ============================================================

export interface RouteProgress {
  /** 沿路径已走米数 */
  walked: number;
  /** 偏离路径米数（直线距离） */
  offRoute: number;
  /** 路径总长 */
  total: number;
  /** 吸附点在路径上的坐标 */
  snapped: GeoPoint;
  /** 吸附点所在段的**行进朝向**（度，0 = 正北） */
  bearing: number;
  /** 吸附位置的横向偏移（米，右正左负；相对行进方向） */
  lateral: number;
}

/**
 * 把当前位置投影到路径折线上。
 * 返回 undefined = 路径无效或坐标非法。
 */
export function routeProgressOf(line: RouteLine, here: GeoPoint): RouteProgress | undefined {
  const cumulative: RouteCumulative | undefined = buildCumulative(line);
  if (cumulative === undefined) return undefined;
  if (!isFinite(here.latitude) || !isFinite(here.longitude)) return undefined;

  const points: number[][] = cumulative.points;
  const cum: number[] = cumulative.cum;

  // 本城市尺度下用平面近似（米），足够精确且算得快
  const kx: number = Math.cos(here.latitude * Math.PI / 180) * 111320;
  const ky: number = 110540;
  const px: number = here.longitude * kx;
  const py: number = here.latitude * ky;

  let bestDistance: number = Infinity;
  let bestIndex: number = 0;
  let bestRatio: number = 0;
  let bestWalked: number = 0;
  let bestLateral: number = 0;
  let bestBearing: number = 0;

  for (let i = 0; i < points.length - 1; i += 1) {
    const ax: number = points[i][0];
    const ay: number = points[i][1];
    const bx: number = points[i + 1][0];
    const by: number = points[i + 1][1];

    const axm: number = ax * kx;
    const aym: number = ay * ky;
    const bxm: number = bx * kx;
    const bym: number = by * ky;
    const vx: number = bxm - axm;
    const vy: number = bym - aym;
    const lengthSquared: number = vx * vx + vy * vy;

    let ratio: number = 0;
    if (lengthSquared > 0) {
      ratio = ((px - axm) * vx + (py - aym) * vy) / lengthSquared;
    }
    if (ratio < 0) ratio = 0;
    if (ratio > 1) ratio = 1;

    const cx: number = axm + vx * ratio;
    const cy: number = aym + vy * ratio;
    const dx: number = px - cx;
    const dy: number = py - cy;
    const planar: number = Math.sqrt(dx * dx + dy * dy);

    if (planar < bestDistance) {
      bestDistance = planar;
      bestIndex = i;
      bestRatio = ratio;
      bestWalked = cum[i] + (cum[i + 1] - cum[i]) * ratio;

      // 该段行进朝向
      const bearingDegrees: number = segmentBearing(ay, ax, by, bx);
      bestBearing = bearingDegrees;

      // 横向偏移：相对行进方向，右正左负
      const rad: number = bearingDegrees * Math.PI / 180;
      const east: number = dx;
      const north: number = dy;
      // 行进方向单位向量（东, 北）
      const dirEast: number = Math.sin(rad);
      const dirNorth: number = Math.cos(rad);
      // 右方向 = 行进方向顺时针 90°
      const rightEast: number = Math.cos(rad);
      const rightNorth: number = -Math.sin(rad);
      bestLateral = east * rightEast + north * rightNorth;
      // 让 dirEast / dirNorth 参与计算，避免未来被误删（纵向偏差用于地面吸附）
      const along: number = east * dirEast + north * dirNorth;
      if (!isFinite(along)) bestLateral = 0;
    }
  }

  const segmentStart: GeoPoint = {
    latitude: points[bestIndex][1],
    longitude: points[bestIndex][0]
  };
  const segmentEnd: GeoPoint = {
    latitude: points[bestIndex + 1][1],
    longitude: points[bestIndex + 1][0]
  };
  const snapped: GeoPoint = {
    latitude: segmentStart.latitude + (segmentEnd.latitude - segmentStart.latitude) * bestRatio,
    longitude: segmentStart.longitude + (segmentEnd.longitude - segmentStart.longitude) * bestRatio
  };

  const progress: RouteProgress = {
    walked: bestWalked,
    offRoute: bestDistance,
    total: cumulative.total,
    snapped: snapped,
    bearing: bestBearing,
    lateral: bestLateral
  };
  return progress;
}

/** 两点间的行进朝向（度，0 = 正北，顺时针） */
export function segmentBearing(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const lat1: number = fromLat * Math.PI / 180;
  const lat2: number = toLat * Math.PI / 180;
  const dLon: number = (toLon - fromLon) * Math.PI / 180;
  const y: number = Math.sin(dLon) * Math.cos(lat2);
  const x: number = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const degrees: number = Math.atan2(y, x) * 180 / Math.PI;
  return (degrees + 360) % 360;
}

// ============================================================
// 迷雾窗口
// ============================================================

/** 迷雾窗口参数 */
export interface FogWindow {
  /** 前方可见米数（已含 -25 留白） */
  ahead: number;
  /** 后方可见米数（已含 -5 留白） */
  behind: number;
  /** 窗口起点（沿路径里程） */
  startS: number;
  /** 窗口终点（沿路径里程） */
  endS: number;
  /** 渐隐过渡长度（米） */
  fade: number;
  /** 插值步长（米） */
  step: number;
  /** 剩余里程（= total - walked） */
  remaining: number;
  /** 是否应该整段隐藏（剩余 < 60m） */
  hidden: boolean;
}

/**
 * 按规格计算迷雾窗口。
 * 前方 = min(260, 剩余-25)；后方 = min(140, 已走-5)。
 * 负数夹到 0（刚出发时后方为 0）。
 */
export function fogWindow(walked: number, total: number): FogWindow {
  const safeTotal: number = total > 0 ? total : 0;
  const safeWalked: number = Math.max(0, Math.min(walked, safeTotal));
  const remaining: number = Math.max(0, safeTotal - safeWalked);

  let ahead: number = Math.min(FOG_AHEAD_MAX, remaining - FOG_AHEAD_MARGIN);
  if (ahead < 0) ahead = 0;
  let behind: number = Math.min(FOG_BEHIND_MAX, safeWalked - FOG_BEHIND_MARGIN);
  if (behind < 0) behind = 0;

  const window: FogWindow = {
    ahead: ahead,
    behind: behind,
    startS: Math.max(0, safeWalked - behind),
    endS: Math.min(safeTotal, safeWalked + ahead),
    fade: FOG_FADE_METERS,
    step: FOG_STEP_METERS,
    remaining: remaining,
    hidden: remaining < FOG_HIDE_REMAINING_METERS
  };
  return window;
}

/** 迷雾窗口里的一段线（已换算到画布坐标） */
export interface FogSegment {
  /** 画布坐标（x 向右、y 向下；y 越小越「前」） */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 已走（true）还是前方（false） */
  behind: boolean;
  /** 0…1 */
  opacity: number;
  color: string;
  width: number;
}

/** 画布布局参数 */
export interface FogLayout {
  /** 画布宽 / 高（vp） */
  width: number;
  height: number;
  /** 「你」在画布上的位置（默认水平居中、偏下） */
  centerX: number;
  centerY: number;
  /** 竖向前方可用像素（默认 height * 0.74） */
  aheadPixels: number;
  /** 横向可用半宽（默认 width * 0.36） */
  lateralPixels: number;
}

export function defaultLayout(width: number, height: number): FogLayout {
  const layout: FogLayout = {
    width: width,
    height: height,
    centerX: width / 2,
    centerY: height * 0.86,
    aheadPixels: height * 0.74,
    lateralPixels: width * 0.36
  };
  return layout;
}

/** 迷雾路径的完整绘制数据 */
export interface FogGeometry {
  segments: FogSegment[];
  /** 行进箭头（画布坐标；angle 是屏幕上的朝向角度，0 = 朝上） */
  chevrons: FogChevron[];
  /** 「你」的画布位置 */
  userX: number;
  userY: number;
  /** 偏离路径时的虚线终点（画布坐标）；不偏离为 undefined */
  deviateTo?: FogPoint;
  /** 指北针旋转角度（度；画布上方是行进方向，所以是 -bearing） */
  compassRotation: number;
  /** 「你」的箭头旋转角度（北朝上模式下按你的实际朝向旋转；跟随模式为 0） */
  userRotation: number;
  /** 说明文案 */
  caption: string;
  /** 是否整段隐藏 */
  hidden: boolean;
  /** 剩余里程 */
  remaining: number;
  /** 偏离米数 */
  offRoute: number;
}

export interface FogPoint {
  x: number;
  y: number;
}

export interface FogChevron {
  x: number;
  y: number;
  /** 屏幕上的箭头朝向（度，0 = 朝上；顺时针为正） */
  angle: number;
  opacity: number;
}

/**
 * 计算整块迷雾路径的绘制数据（UI 只负责把 segments/chevrons 画到 Canvas）。
 *
 * @param line 步行路线
 * @param here 当前位置（WGS-84）
 * @param layout 画布布局
 */
/**
 * @param upBearing 地图「朝上」的方向（设备罗盘）。不传则用路线行进方向（旧行为）。
 */
export function fogGeometry(
  line: RouteLine,
  here: GeoPoint,
  layout: FogLayout,
  upBearing?: number,
  deviceHeading?: number
): FogGeometry {
  const empty: FogGeometry = {
    segments: [],
    chevrons: [],
    userX: layout.centerX,
    userY: layout.centerY,
    compassRotation: 0,
    userRotation: 0,
    caption: FOG_CAPTION,
    hidden: false,
    remaining: 0,
    offRoute: 0
  };

  const cumulative: RouteCumulative | undefined = buildCumulative(line);
  if (cumulative === undefined) {
    empty.caption = '正在规划路径…';
    return empty;
  }
  const total: number = line.distanceMeters !== undefined && line.distanceMeters > 0
    ? line.distanceMeters
    : cumulative.total;

  const progress: RouteProgress | undefined = routeProgressOf(line, here);
  if (progress === undefined) {
    empty.caption = '正在规划路径…';
    return empty;
  }

  const up: number = upBearing !== undefined ? upBearing : progress.bearing;
  const userRotation: number = deviceHeading !== undefined && deviceHeading >= 0
    ? deviceHeading - up
    : 0;
  const window: FogWindow = fogWindow(progress.walked, total);
  empty.remaining = Math.round(window.remaining);
  empty.offRoute = Math.round(progress.offRoute);
  empty.compassRotation = -up;
  empty.userRotation = userRotation;

  // 保密：接近终点整段隐藏
  if (window.hidden) {
    empty.hidden = true;
    empty.caption = NEARBY_COPY;
    empty.segments = [];
    empty.chevrons = [];
    empty.userX = layout.centerX;
    empty.userY = layout.centerY;
    return empty;
  }

  // 画布坐标换算：朝上方向 = 设备朝向（有罗盘）或行进方向
  const bearingRad: number = up * Math.PI / 180;
  const sinB: number = Math.sin(bearingRad);
  const cosB: number = Math.cos(bearingRad);
  const kx: number = Math.cos(progress.snapped.latitude * Math.PI / 180) * 111320;
  const ky: number = 110540;
  const aheadMeters: number = Math.max(window.ahead, 1);
  const scaleY: number = layout.aheadPixels / aheadMeters;

  // 先采样，再按横向范围自适应缩放
  interface LocalPoint {
    s: number;
    along: number;
    lateral: number;
  }
  const local: LocalPoint[] = [];
  for (let s = window.startS; s <= window.endS + 0.001; s += window.step) {
    const at: GeoPoint = pointAlongPath(cumulative, s);
    const east: number = (at.longitude - progress.snapped.longitude) * kx;
    const north: number = (at.latitude - progress.snapped.latitude) * ky;
    const along: number = east * sinB + north * cosB;
    const lateral: number = east * cosB - north * sinB;
    local.push({ s: s, along: along, lateral: lateral });
  }

  if (local.length >= 2) {
    let minLateral: number = Infinity;
    let maxLateral: number = -Infinity;
    for (let i = 0; i < local.length; i += 1) {
      if (local[i].lateral < minLateral) minLateral = local[i].lateral;
      if (local[i].lateral > maxLateral) maxLateral = local[i].lateral;
    }
    const halfSpan: number = Math.max(12, Math.max(Math.abs(minLateral), Math.abs(maxLateral)) + 8);
    let scaleX: number = layout.lateralPixels / halfSpan;
    if (scaleX > scaleY) scaleX = scaleY;
    const midLateral: number = (minLateral + maxLateral) / 2;
    const originX: number = layout.centerX - midLateral * scaleX;

    const toScreen: (along: number, lateral: number) => FogPoint =
      (along: number, lateral: number): FogPoint => {
        const point: FogPoint = {
          x: originX + lateral * scaleX,
          y: layout.centerY - along * scaleY
        };
        return point;
      };

    // ---------- 线段（两端渐隐） ----------
    const segments: FogSegment[] = [];
    for (let i = 0; i < local.length - 1; i += 1) {
      const a: LocalPoint = local[i];
      const b: LocalPoint = local[i + 1];
      const from: FogPoint = toScreen(a.along, a.lateral);
      const to: FogPoint = toScreen(b.along, b.lateral);
      const da: number = Math.min(a.s - window.startS, window.endS - a.s);
      const db: number = Math.min(b.s - window.startS, window.endS - b.s);
      const edge: number = Math.min(da, db);
      let opacity: number = edge / window.fade;
      if (opacity > 1) opacity = 1;
      if (opacity < 0) opacity = 0;
      if (opacity <= 0.02) continue;

      const isBehind: boolean = a.s < progress.walked;
      // 两端各延 0.9px，避免 butt 端点留下细缝
      const dx: number = to.x - from.x;
      const dy: number = to.y - from.y;
      const length: number = Math.sqrt(dx * dx + dy * dy);
      const ux: number = length > 0 ? dx / length : 0;
      const uy: number = length > 0 ? dy / length : 0;

      const segment: FogSegment = {
        x1: from.x - ux * 0.9,
        y1: from.y - uy * 0.9,
        x2: to.x + ux * 0.9,
        y2: to.y + uy * 0.9,
        behind: isBehind,
        opacity: isBehind ? opacity * PATH_BEHIND_OPACITY : opacity,
        color: isBehind ? PATH_BEHIND_COLOR : PATH_AHEAD_COLOR,
        width: isBehind ? PATH_BEHIND_WIDTH : PATH_AHEAD_WIDTH
      };
      segments.push(segment);
    }
    empty.segments = segments;

    // ---------- 行进箭头（每 55 米） ----------
    const chevrons: FogChevron[] = [];
    const aheadLimit: number = window.ahead - CHEVRON_TAIL_MARGIN;
    for (let offset = CHEVRON_FIRST_METERS; offset <= aheadLimit; offset += CHEVRON_SPACING_METERS) {
      const s: number = progress.walked + offset;
      if (s > window.endS) continue;
      const at: GeoPoint = pointAlongPath(cumulative, s);
      const before: GeoPoint = pointAlongPath(cumulative, Math.max(0, s - 4));
      const after: GeoPoint = pointAlongPath(cumulative, Math.min(total, s + 4));
      const east: number = (at.longitude - progress.snapped.longitude) * kx;
      const north: number = (at.latitude - progress.snapped.latitude) * ky;
      const screen: FogPoint = toScreen(east * sinB + north * cosB, east * cosB - north * sinB);

      // 该处的行进朝向（相对「画布上方」）
      const localBearing: number = segmentBearing(before.latitude, before.longitude, after.latitude, after.longitude);
      const angle: number = localBearing - up;

      let opacity: number = (window.ahead - offset) / window.fade;
      if (opacity > 1) opacity = 1;
      if (opacity < 0) opacity = 0;

      const chevron: FogChevron = {
        x: screen.x,
        y: screen.y,
        angle: angle,
        opacity: opacity
      };
      chevrons.push(chevron);
    }
    empty.chevrons = chevrons;

    // ---------- 「你」的位置（横向偏移） ----------
    const userX: number = originX + progress.lateral * scaleX;
    empty.userX = Math.max(16, Math.min(layout.width - 16, userX));
    empty.userY = layout.centerY;

    // ---------- 偏离路径：从吸附点画虚线到「你」 ----------
    const deviated: boolean = Math.abs(progress.offRoute) > OFF_ROUTE_THRESHOLD_METERS;
    if (deviated) {
      const snappedScreen: FogPoint = toScreen(0, 0);
      const deviation: FogPoint = {
        x: empty.userX,
        y: empty.userY
      };
      if (Math.abs(snappedScreen.x - deviation.x) > 0.5 ||
          Math.abs(snappedScreen.y - deviation.y) > 0.5) {
        empty.deviateTo = snappedScreen;
      }
    }

    empty.caption = deviated
      ? '你离路径约 ' + String(Math.round(progress.offRoute)) + ' 米 · 前方 ' +
        String(Math.round(window.remaining)) + ' 米'
      : FOG_CAPTION;
  } else {
    empty.caption = '正在规划路径…';
  }

  return empty;
}

/** 是否应该画「偏离路径」提示（带滞回，避免 GPS 抖动来回闪） */
export function shouldShowOffRoute(
  offRoute: number,
  previousVisible: boolean
): boolean {
  if (previousVisible) {
    return offRoute > OFF_ROUTE_THRESHOLD_METERS - OFF_ROUTE_HYSTERESIS_METERS;
  }
  return offRoute > OFF_ROUTE_THRESHOLD_METERS;
}

/** 剩余时间估算：按 75 米/分钟 */
export function estimatedMinutes(remainingMeters: number): number {
  const minutes: number = Math.round(remainingMeters / 75);
  return minutes < 1 ? 1 : minutes;
}