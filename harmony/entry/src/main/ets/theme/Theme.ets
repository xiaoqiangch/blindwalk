/**
 * 盲走 BlindWalk · HarmonyOS ArkUI 设计 token
 *
 * 唯一来源：docs/design-system.md §3（与 apple/Shared/Design/Theme.swift 一一对应）。
 * 所有颜色/圆角/间距只从这里取，页面里不要写裸色值（阴影带 alpha 的 8 位 hex 也在这里）。
 *
 * 注意：本文件是 ArkTS（.ets），只放常量与纯函数；不要引入 UI 组件。
 */

import { curves } from '@kit.ArkUI';
import { Area, Rarity } from '../core/types';

// ============================================================
// 颜色（design-system §3）
// ============================================================

export class BWColor {
  static readonly ink: string = '#111827';
  static readonly ink2: string = '#4B5563';
  static readonly ink3: string = '#9CA3AF';
  static readonly cream: string = '#F3F5FB';
  static readonly paper: string = '#FFFFFF';
  static readonly paper2: string = '#EEF1F9';
  static readonly line: string = '#E2E7F2';
  static readonly amber: string = '#5B6CFF';
  static readonly amberDeep: string = '#3D4FE0';
  static readonly ember: string = '#FF6B6B';
  static readonly teal: string = '#14B8A6';
  static readonly plum: string = '#8B5CF6';
  static readonly gold: string = '#F59E0B';
  static readonly common: string = '#94A3B8';

  // 带 alpha 的常用变体（ArkUI 的 string 颜色支持 #AARRGGBB）
  static readonly inkSoft: string = '#14171410';
  static readonly lineSoft: string = '#80E8DECC';
  static readonly amberSoft: string = '#24E89B4C';
  static readonly amberSoftStrong: string = '#3DE89B4C';
  static readonly amberBorder: string = '#99E89B4C';
  static readonly tealSoft: string = '#242E7D78';
  static readonly paperTranslucent: string = '#CCFFFBF3';
  static readonly paperHalf: string = '#80FFFBF3';
  static readonly creamTranslucent: string = '#E6F5EEE2';
  static readonly shadow: string = '#1A171410';
  static readonly shadowSoft: string = '#0D171410';
  static readonly shadowLift: string = '#29171410';
  static readonly scrim: string = '#59171410';
  static readonly stage: string = '#111827';
  static readonly stageBar: string = '#14FFFBF3';
  static readonly stageClose: string = '#14FFFBF3';
  static readonly stageCloseBorder: string = '#24FFFBF3';
  static readonly creamOnStage: string = '#EBF5EEE2';
  static readonly creamOnStageDim: string = '#6BF5EEE2';

  // 牛皮纸（盲盒主卡 / 盒体插画）
  static readonly kraftTop: string = '#EEF1F9';
  static readonly kraftMid: string = '#FFFFFF';
  static readonly kraftBottom: string = '#D6DDF3';
  static readonly kraftLid: string = '#D6DDF3';
  static readonly kraftBody: string = '#E8ECFB';
  static readonly kraftLine: string = '#CC171410';
  static readonly kraftAmberLight: string = '#BFE89B4C';
}

// ============================================================
// 尺寸（design-system §3 / docs/foldable.md）
// ============================================================

export class BWSize {
  static readonly pagePadding: number = 20;
  static readonly cardRadius: number = 24;
  static readonly panelRadius: number = 28;
  static readonly chipRadius: number = 999;
  static readonly cardRadiusSm: number = 16;
  static readonly cardRadiusXs: number = 12;

  // 折叠屏断点（docs/foldable.md §3.1）：Duo 展开 669 / 折叠 678
  static readonly wideBreakpoint: number = 600;
  static readonly shortHeightBreakpoint: number = 720;
  static readonly contentMaxWidth: number = 620;
}

// ============================================================
// 字号（docs/parity.md §5 — 对齐 Web v32）
//
// 三端统一口径：
//   - 正文 14–16（body 15.5 / bodySm 14.5）
//   - 次要 12–13.5（caption 13 / captionSm 12）
//   - 标签 10–12.5（micro 11.5 / microSm 10.5）
//   - 大数字 22–30 起（title 22 / hero 26 / digits 46）
// **不再使用 <10pt 的字号**（旧版 microSm=9 / 页面里写死 7 都改掉了）。
// ============================================================

export class BWFont {
  static readonly display: number = 40;
  static readonly digits: number = 46;
  static readonly hero: number = 26;
  static readonly title: number = 22;
  static readonly titleMd: number = 18;
  static readonly titleSm: number = 16;
  static readonly body: number = 15.5;
  static readonly bodySm: number = 14.5;
  static readonly caption: number = 13;
  static readonly captionSm: number = 12;
  static readonly micro: number = 11.5;
  static readonly microSm: number = 10.5;
}

// ============================================================
// 动效（design-system §3：主缓动 cubic-bezier(.22,1,.36,1)）
// ============================================================

export const BW_EASE = curves.cubicBezierCurve(0.22, 1, 0.36, 1);
export const BW_DUR_QUICK: number = 180;
export const BW_DUR_REGULAR: number = 320;
export const BW_DUR_SLOW: number = 520;
export const BW_DUR_OPEN_BOX: number = 900;

// ============================================================
// 稀有度 / 区域（design-system §3、§5.4）
// ============================================================

export function rarityLabel(rarity: Rarity): string {
  switch (rarity) {
    case Rarity.Common:
      return '常见';
    case Rarity.Rare:
      return '稀有';
    case Rarity.Epic:
      return '史诗';
    case Rarity.Hidden:
      return '隐藏';
    default:
      return '常见';
  }
}

export function rarityColor(rarity: Rarity): string {
  switch (rarity) {
    case Rarity.Common:
      return BWColor.common;
    case Rarity.Rare:
      return BWColor.teal;
    case Rarity.Epic:
      return BWColor.plum;
    case Rarity.Hidden:
      return BWColor.gold;
    default:
      return BWColor.common;
  }
}

export function raritySoft(rarity: Rarity): string {
  switch (rarity) {
    case Rarity.Common:
      return '#248B9484';
    case Rarity.Rare:
      return '#242E7D78';
    case Rarity.Epic:
      return '#246B5B9E';
    case Rarity.Hidden:
      return '#24B98A1F';
    default:
      return '#248B9484';
  }
}

export function rarityBorder(rarity: Rarity): string {
  switch (rarity) {
    case Rarity.Common:
      return '#598B9484';
    case Rarity.Rare:
      return '#592E7D78';
    case Rarity.Epic:
      return '#596B5B9E';
    case Rarity.Hidden:
      return '#59B98A1F';
    default:
      return '#598B9484';
  }
}

/** 设置页 / 筛选 chip 用的「河边」 */
export function areaLabel(area: Area): string {
  switch (area) {
    case Area.Near:
      return '附近';
    case Area.River:
      return '河边';
    case Area.OldTown:
      return '老城区';
    default:
      return '附近';
  }
}

/** 揭晓页小字用的「河岸」 */
export function areaWord(area: Area): string {
  switch (area) {
    case Area.Near:
      return '附近';
    case Area.River:
      return '河岸';
    case Area.OldTown:
      return '老城区';
    default:
      return '附近';
  }
}

/** 旅程方向副文案（web D.WALK_COPY） */
export function walkCopy(area: Area): string {
  switch (area) {
    case Area.River:
      return '沿河往北走，别急';
    case Area.OldTown:
      return '往巷子深处走，别急';
    case Area.Near:
      return '跟着最近的灯走，别急';
    default:
      return '顺着灯走，别急';
  }
}

// ============================================================
// 等级（与 apple/Shared/Core/Models.swift Profile.levelName 一致）
// ============================================================

export const LEVEL_NAMES: string[] = [
  '出门新手',
  '街角观察员',
  '城市漫游者',
  '惊喜收藏家',
  '迷雾探险家',
  '黄昏猎人',
  '夜路诗人',
  '盲走大师',
  '城市传说',
  '盲盒之神'
];

export class LevelInfo {
  level: number = 1;
  name: string = LEVEL_NAMES[0];
  into: number = 0;
  progress: number = 0;
}

export function levelInfo(xp: number): LevelInfo {
  const info = new LevelInfo();
  const safeXP: number = Math.max(0, xp);
  const level: number = Math.floor(safeXP / 800) + 1;
  info.level = level;
  const nameIndex: number = Math.min(level - 1, LEVEL_NAMES.length - 1);
  info.name = LEVEL_NAMES[nameIndex];
  info.into = safeXP - (level - 1) * 800;
  info.progress = Math.min(1, info.into / 800);
  return info;
}
