/**
 * 盲走 BlindWalk · HarmonyOS ArkUI — 文案 / 数字格式化（纯函数）
 *
 * 与 apple/Shared/Core 的格式化口径一致（web prototype 同文案）。
 * 只被 views / components 引用，不依赖 store 状态。
 */

/** 补零：7 -> "07" */
export function pad2(value: number): string {
  const text: string = String(Math.floor(Math.abs(value)));
  return text.length >= 2 ? text : '0' + text;
}

/** 顶栏问候：早上好 / 下午好 / 晚上好（design-system §5.1） */
export function greeting(name: string): string {
  const hour: number = new Date().getHours();
  let prefix: string = '晚上好';
  if (hour < 5) {
    prefix = '夜深了';
  } else if (hour < 12) {
    prefix = '早上好';
  } else if (hour < 18) {
    prefix = '下午好';
  }
  return prefix + '，' + name;
}

/** 计时：00:12:34 */
export function clockHHMMSS(totalSeconds: number): string {
  const total: number = Math.max(0, Math.floor(totalSeconds));
  const hours: number = Math.floor(total / 3600);
  const minutes: number = Math.floor((total % 3600) / 60);
  const seconds: number = total % 60;
  return pad2(hours) + ':' + pad2(minutes) + ':' + pad2(seconds);
}

/** 当前时刻 HH:MM（揭晓页顶栏用） */
export function clockHHMM(): string {
  const now: Date = new Date();
  return pad2(now.getHours()) + ':' + pad2(now.getMinutes());
}

/** 卡片日期：11月8日 */
export function formatShortDate(ms: number): string {
  const date: Date = new Date(ms);
  return (date.getMonth() + 1) + '月' + date.getDate() + '日';
}

/** 自然日差（本地时区） */
export function daysBetween(fromMs: number, toMs: number): number {
  const from: Date = new Date(fromMs);
  const to: Date = new Date(toMs);
  const fromDay: number = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const toDay: number = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.max(0, Math.floor((toDay - fromDay) / 86400000));
}

/** 上一次的惊喜：已是 3 天前 / 就是今天 */
export function relativeDay(ms: number): string {
  const days: number = daysBetween(ms, Date.now());
  return days === 0 ? '就是今天' : '已是 ' + days + ' 天前';
}

/** 动态时间：12 分钟前 */
export function relativeTime(ms: number): string {
  const seconds: number = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) {
    return '刚刚';
  }
  if (seconds < 3600) {
    return Math.floor(seconds / 60) + ' 分钟前';
  }
  if (seconds < 86400) {
    return Math.floor(seconds / 3600) + ' 小时前';
  }
  return Math.floor(seconds / 86400) + ' 天前';
}

/** 抽盒半径展示：1600 -> "1.6 km" */
export function kilometers(meters: number): string {
  return (meters / 1000).toFixed(1) + ' km';
}

/** 惊喜列表距离：320 -> "320 m"；1260 -> "1.3 km" */
export function distanceText(meters: number): string {
  if (meters >= 1000) {
    return (meters / 1000).toFixed(1) + ' km';
  }
  return Math.round(meters) + ' m';
}

/** 一位小数 */
export function decimal1(value: number): string {
  return value.toFixed(1);
}

/** 1 -> 一 */
export function chineseIndex(index: number): string {
  const numerals: string[] = ['一', '二', '三'];
  if (index < 0 || index >= numerals.length) {
    return String(index + 1);
  }
  return numerals[index];
}

// ============================================================
// 方向（演示用 / 真实方位通用）
// ============================================================

/** 方位角 → 八方向文字。0 = 正北，顺时针 */
export function compassLabel(degrees: number): string {
  const normalized: number = ((degrees % 360) + 360) % 360;
  if (normalized >= 337.5 || normalized < 22.5) {
    return '北';
  }
  if (normalized < 67.5) {
    return '东北';
  }
  if (normalized < 112.5) {
    return '东';
  }
  if (normalized < 157.5) {
    return '东南';
  }
  if (normalized < 202.5) {
    return '南';
  }
  if (normalized < 247.5) {
    return '西南';
  }
  if (normalized < 292.5) {
    return '西';
  }
  return '西北';
}

/** 方位角 → 箭头（0 = 正北） */
export function bearingArrow(degrees: number): string {
  const normalized: number = ((degrees % 360) + 360) % 360;
  if (normalized >= 337.5 || normalized < 22.5) {
    return '↑';
  }
  if (normalized < 67.5) {
    return '↗';
  }
  if (normalized < 112.5) {
    return '→';
  }
  if (normalized < 157.5) {
    return '↘';
  }
  if (normalized < 202.5) {
    return '↓';
  }
  if (normalized < 247.5) {
    return '↙';
  }
  if (normalized < 292.5) {
    return '←';
  }
  return '↖';
}

/** 真实方位文案：往北走，别急 */
export function compassCopy(degrees: number): string {
  return '往' + compassLabel(degrees) + '走，别急';
}

/** 演示态箭头（按剩余距离变化，web bearingFor） */
export function demoBearingArrow(remainingMeters: number): string {
  if (remainingMeters >= 361) {
    return '↖';
  }
  if (remainingMeters >= 241) {
    return '↑';
  }
  if (remainingMeters >= 121) {
    return '↗';
  }
  return '→';
}
