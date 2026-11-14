/**
 * 盲走 BlindWalk · HarmonyOS ArkUI 设计 token
 *
 * 严格对齐 HarmonyOS 官方设计规范（HarmonyOS NEXT 通用设计基础 · 视觉风格）：
 *   - 色彩：宇宙蓝（Brand）/ 雪域灰（背景）/ 三级文本透明度
 *   - 圆角：官方组件规格（卡片 16vp、面板 24vp、按钮全圆角胶囊）
 *   - 图标：统一走 SymbolGlyph 单色符号（见 components/BwSymbol.ets）
 *   - 字体：与系统一致的字号阶梯
 *   - 动效：官方标准曲线与时长
 *
 * 注意：本文件是 ArkTS（.ets），只放常量与纯函数；不要引入 UI 组件。
 */

import { curves } from '@kit.ArkUI';
import { Area, Rarity } from '../core/types';

// ============================================================
// 颜色 —— HarmonyOS 官方色彩体系
//
// 官方 token 对应关系（浅色模式）：
//   font_primary    90%  #E5000000  → 用 #182431（宇宙蓝调和的黑，官方正文色）
//   font_secondary  60%  #99000000  → #66182431
//   font_tertiary   40%  #66000000  → #40182431
//   font_fourth     20%  #33000000  → #33182431
//   comp_background         #FFFFFF（卡片 / 弹层）
//   sub_background          #F1F3F5（页面背景，雪域灰）
//   brand                   #0A59F7（宇宙蓝，HarmonyOS NEXT 品牌色）
//   warning / danger        #E84026 / #FA2A2D
//   confirm                 #64BB5C
//   interactive_pressed     品牌色 10% 叠加
// ============================================================

export class BWColor {
  // 文本与图标（四级，官方透明度阶梯）
  static readonly ink: string = '#182431';
  static readonly ink2: string = '#66182431';
  static readonly ink3: string = '#40182431';
  static readonly ink4: string = '#33182431';

  // 背景与容器
  static readonly cream: string = '#F1F3F5';   // 页面底色（雪域灰）
  static readonly paper: string = '#FFFFFF';   // 卡片 / 弹层
  static readonly paper2: string = '#F1F3F5';  // 次级填充（输入框 / 选中态底）
  static readonly line: string = '#33182431';  // 分割线（官方 divider 20%）
  static readonly lineSoft: string = '#1A182431';

  // 品牌色（宇宙蓝）
  static readonly amber: string = '#0A59F7';
  static readonly amberDeep: string = '#0A59F7';
  static readonly amberSoft: string = '#1A0A59F7';      // 10% 品牌色（选中底 / 标签底）
  static readonly amberSoftStrong: string = '#290A59F7'; // 16%
  static readonly amberBorder: string = '#330A59F7';
  static readonly tealSoft: string = '#1A64BB5C';

  // 语义色（官方）
  static readonly ember: string = '#FA2A2D';   // danger
  static readonly teal: string = '#64BB5C';    // confirm
  static readonly plum: string = '#0A59F7';    // 强调（统一收进品牌蓝，避免杂色）
  static readonly gold: string = '#E84026';    // warning
  static readonly common: string = '#99182431';

  // 深色舞台（揭晓页全屏）
  static readonly stage: string = '#0D0D0D';
  static readonly stageBar: string = '#1AFFFFFF';
  static readonly stageClose: string = '#14FFFFFF';
  static readonly stageCloseBorder: string = '#24FFFFFF';
  static readonly creamOnStage: string = '#E5FFFFFF';
  static readonly creamOnStageDim: string = '#66FFFFFF';

  // 兼容旧引用：牛皮纸系列统一收敛为中性容器色
  static readonly kraftTop: string = '#F1F3F5';
  static readonly kraftMid: string = '#FFFFFF';
  static readonly kraftBottom: string = '#E5E8EB';
  static readonly kraftLid: string = '#E5E8EB';
  static readonly kraftBody: string = '#F1F3F5';
  static readonly kraftLine: string = '#33182431';
  static readonly kraftAmberLight: string = '#4D0A59F7';

  // 阴影：官方风格极轻，用低透明度中性色
  static readonly shadow: string = '#14000000';
  static readonly shadowSoft: string = '#0A000000';
  static readonly shadowLift: string = '#1F000000';
  static readonly scrim: string = '#66000000';

  // 半透明容器（浮层）
  static readonly paperTranslucent: string = '#FFFFFFFF';
  static readonly paperHalf: string = '#FFFFFFFF';
  static readonly creamTranslucent: string = '#F1F3F5';
  static readonly inkSoft: string = '#1A182431';

  // 图标默认色（单色符号统一取这个）
  static readonly icon: string = '#182431';
  static readonly iconOnBrand: string = '#FFFFFF';
}

// ============================================================
// 尺寸 —— 官方组件规格
// ============================================================

export class BWSize {
  static readonly pagePadding: number = 16;    // 官方页面边距 16vp
  static readonly cardRadius: number = 16;     // 官方卡片圆角
  static readonly panelRadius: number = 24;    // 官方弹层 / 半模态圆角
  static readonly cardRadiusSm: number = 12;
  static readonly cardRadiusXs: number = 8;
  static readonly chipRadius: number = 999;    // 胶囊

  // 控件高度（官方标准）
  static readonly buttonHeight: number = 40;
  static readonly buttonHeightLg: number = 48;
  static readonly iconSize: number = 24;       // 官方图标标准尺寸 24vp
  static readonly iconSizeSm: number = 20;
  static readonly touchTarget: number = 40;    // 最小点击区

  // 折叠屏断点
  static readonly wideBreakpoint: number = 600;
  static readonly shortHeightBreakpoint: number = 720;
  static readonly contentMaxWidth: number = 620;
}

// ============================================================
// 字号 —— 与 HarmonyOS 系统字号阶梯一致
// ============================================================

export class BWFont {
  static readonly display: number = 36;
  static readonly digits: number = 40;
  static readonly hero: number = 24;
  static readonly title: number = 20;
  static readonly titleMd: number = 18;
  static readonly titleSm: number = 16;
  static readonly body: number = 16;      // 官方正文 16vp
  static readonly bodySm: number = 14;    // 官方次要正文 14vp
  static readonly caption: number = 12;
  static readonly captionSm: number = 12;
  static readonly micro: number = 10;
  static readonly microSm: number = 10;
}

// ============================================================
// 动效 —— 官方标准曲线（fastOutSlowIn / friction）
// ============================================================

export const BW_EASE = curves.cubicBezierCurve(0.2, 0, 0.2, 1);
export const BW_DUR_QUICK: number = 150;
export const BW_DUR_REGULAR: number = 250;
export const BW_DUR_SLOW: number = 350;
export const BW_DUR_OPEN_BOX: number = 600;

// ============================================================
// 稀有度 / 区域
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
      return '#0A59F7';
    case Rarity.Epic:
      return '#6A5AE0';
    case Rarity.Hidden:
      return '#E84026';
    default:
      return BWColor.common;
  }
}

export function raritySoft(rarity: Rarity): string {
  switch (rarity) {
    case Rarity.Common:
      return '#0D182431';
    case Rarity.Rare:
      return '#1A0A59F7';
    case Rarity.Epic:
      return '#1A6A5AE0';
    case Rarity.Hidden:
      return '#1AE84026';
    default:
      return '#0D182431';
  }
}

export function rarityBorder(rarity: Rarity): string {
  switch (rarity) {
    case Rarity.Common:
      return '#33182431';
    case Rarity.Rare:
      return '#330A59F7';
    case Rarity.Epic:
      return '#336A5AE0';
    case Rarity.Hidden:
      return '#33E84026';
    default:
      return '#33182431';
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
// 等级
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