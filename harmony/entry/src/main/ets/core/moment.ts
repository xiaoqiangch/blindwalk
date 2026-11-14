/**
 * 步迷 Walkaholic · HarmonyOS 逻辑层 — 时段（环境性盲盒）
 *
 * 移植自 apple/Shared/Core/DayMoment.swift。
 *
 * 为什么要有它：盲盒如果一天 24 小时都长一样，用户上午开一个、晚上开一个，
 * 拿到的其实是同一批地点 —— 「今天」就没有意义。
 *
 * 规则很克制，只做两件事：
 *   1. 文案跟着时段变（清晨的盲盒 / 黄昏的盲盒 …），给出当下去哪儿的理由；
 *   2. 抽点权重跟着时段变（黄昏更偏河边与观景、夜里避开公园和菜市场）。
 *
 * 不做硬排除：城市里的好地方本来就该被走到，权重压到 0.45 已经足够让它退居其次。
 */

/** 一天里的六个时段 */
export enum DayMoment {
  Dawn = 'dawn',
  Morning = 'morning',
  Noon = 'noon',
  Afternoon = 'afternoon',
  Dusk = 'dusk',
  Night = 'night',
}

/** 全部时段（按时间顺序；抽盒页/测试遍历用） */
export const DAY_MOMENTS: DayMoment[] = [
  DayMoment.Dawn,
  DayMoment.Morning,
  DayMoment.Noon,
  DayMoment.Afternoon,
  DayMoment.Dusk,
  DayMoment.Night
];

/** 某个小时（0–23）对应的时段 */
export function momentAtHour(hour: number): DayMoment {
  if (hour >= 5 && hour < 8) return DayMoment.Dawn;
  if (hour >= 8 && hour < 11) return DayMoment.Morning;
  if (hour >= 11 && hour < 14) return DayMoment.Noon;
  if (hour >= 14 && hour < 17) return DayMoment.Afternoon;
  if (hour >= 17 && hour < 20) return DayMoment.Dusk;
  return DayMoment.Night;
}

/** 当前时刻对应的时段（按本地时区） */
export function currentMoment(now?: number): DayMoment {
  const timestamp: number = now === undefined ? Date.now() : now;
  return momentAtHour(new Date(timestamp).getHours());
}

/** 时段标题（清晨 / 上午 / …） */
export function momentTitle(moment: DayMoment): string {
  switch (moment) {
    case DayMoment.Dawn: return '清晨';
    case DayMoment.Morning: return '上午';
    case DayMoment.Noon: return '正午';
    case DayMoment.Afternoon: return '下午';
    case DayMoment.Dusk: return '黄昏';
    default: return '夜里';
  }
}

/** 盲盒卡上的小标题（「黄昏的盲盒」） */
export function momentBoxTitle(moment: DayMoment): string {
  return momentTitle(moment) + '的盲盒';
}

/** 一句「现在出门」的理由（不承诺地点，只承诺氛围） */
export function momentLine(moment: DayMoment): string {
  switch (moment) {
    case DayMoment.Dawn:
      return '城市刚醒，去有晨雾和早摊的地方走走。';
    case DayMoment.Morning:
      return '光还斜着，适合去有树影、有长椅的地方。';
    case DayMoment.Noon:
      return '日头正高，找有屋檐、有阴凉的一段路。';
    case DayMoment.Afternoon:
      return '一天里最宽松的时候，适合进馆、进书店。';
    case DayMoment.Dusk:
      return '天要暗下来，往有水和有光的地方走。';
    default:
      return '夜里的城市只剩灯，去灯最好看的地方。';
  }
}

/** 时段图标（映射到 sys.symbol.* 名称，UI 直接取） */
export function momentSymbol(moment: DayMoment): string {
  switch (moment) {
    case DayMoment.Dawn: return 'sunrise';
    case DayMoment.Morning: return 'sun_max';
    case DayMoment.Noon: return 'sun_max';
    case DayMoment.Afternoon: return 'sun_max';
    case DayMoment.Dusk: return 'sunset';
    default: return 'moon_stars';
  }
}

/** 该时段更值得去的类别（17 类 key，见 core/parity.ts） */
export function momentFavored(moment: DayMoment): string[] {
  switch (moment) {
    case DayMoment.Dawn: return ['park', 'river', 'market', 'garden'];
    case DayMoment.Morning: return ['park', 'cafe', 'market', 'library'];
    case DayMoment.Noon: return ['market', 'plaza', 'cafe', 'library'];
    case DayMoment.Afternoon: return ['museum', 'art', 'library', 'historic', 'bookstore'];
    case DayMoment.Dusk: return ['river', 'viewpoint', 'bridge', 'plaza'];
    default: return ['viewpoint', 'bridge', 'plaza', 'cafe'];
  }
}

/** 该时段不太合适的类别（降权，不排除） */
export function momentAvoided(moment: DayMoment): string[] {
  switch (moment) {
    case DayMoment.Dawn: return ['venue', 'market'];
    case DayMoment.Morning: return [];
    case DayMoment.Noon: return ['viewpoint'];
    case DayMoment.Afternoon: return [];
    case DayMoment.Dusk: return ['library', 'museum'];
    default: return ['park', 'garden', 'market', 'historic'];
  }
}

/**
 * 抽点权重乘数：偏好 ×1.45，避开 ×0.45，其余 ×1。
 * 与苹果版 `DayMoment.affinity(for:)` 逐值一致。
 */
export function momentAffinity(moment: DayMoment, category: string): number {
  const favored: string[] = momentFavored(moment);
  for (let i = 0; i < favored.length; i += 1) {
    if (favored[i] === category) return 1.45;
  }
  const avoided: string[] = momentAvoided(moment);
  for (let i = 0; i < avoided.length; i += 1) {
    if (avoided[i] === category) return 0.45;
  }
  return 1;
}
