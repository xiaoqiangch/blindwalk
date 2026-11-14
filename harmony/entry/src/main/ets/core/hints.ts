/**
 * 步迷 Walkaholic · HarmonyOS 逻辑层 — 图鉴「附近惊喜」的隐晦提示
 *
 * 对齐 Web v46 的 `distanceBucket` / `HINT_ATMOSPHERE` / `nearbySurpriseHints`
 * 与 iOS `CardsView.nearbyHintsSection`。三端文案必须逐字一致。
 *
 * ## 产品定位
 * 图鉴页是「回忆册」，但也要让人知道**附近还有没被找到的惊喜**。
 * 提示必须隐晦：只说「大概多远 + 那地方什么气氛」，
 * 绝不告诉你在哪、长什么样、谁埋的（作者 emoji 是唯一的社交信息，三端都保留）。
 *
 * ## 保密铁律（单测有断言守着）
 * `NearHint` 只能由三类东西拼成：
 *   1. 固定文案（距离分档 + 7 条氛围池）
 *   2. 作者 emoji（`authorEmoji`，三端一致允许）
 *   3. 一个取整后的距离数字（只用于**选分档**，不直接出现在文案里）
 *
 * **绝不能**出现：`areaWord`（区域名，会缩小范围）、`hints`（作者的提示，留给
 * 走近后逐级解锁）、`photoUri` / `photoHash`（照片 = 答案）、`location` 坐标数值、
 * 作者昵称（`authorName` 会暴露「谁埋的」，寻到后才知道）。
 *
 * 纯函数、零 `@ohos.*` 依赖，可在 Node 里直接测。
 */

import { BuriedSurprise, GeoPoint } from './types';
import { distance } from './geo';

// ============================================================
// 常量
// ============================================================

/**
 * 惊喜的「找到半径」（米）。
 * 苹果版 `BuriedSurprise.radiusMeters` 默认 60；鸿蒙契约里没有这个字段，
 * 所以在此集中定义，三端保持同一个数。
 */
export const SURPRISE_RADIUS_METERS: number = 60;

/** 图鉴页最多展示几条隐晦提示（与 Web/iOS 的 3 一致） */
export const NEARBY_HINT_LIMIT: number = 3;

/**
 * 氛围提示池（7 条，逐字对齐 Web `HINT_ATMOSPHERE` / iOS `atmosphere`）。
 *
 * 为什么是这些句子：都在描述**光、风、声音、人多不多**这种「到了才知道」的体感，
 * 不含任何可以搜地图的名词。读的人会觉得「好像去过」，但没法定位。
 */
export const HINT_ATMOSPHERE: string[] = [
  '那儿光线不错，适合停下来喘口气。',
  '有人在那儿等到过一次意外的好天气。',
  '那个角落平时没什么人经过。',
  '声音会变小，风会变大一点。',
  '走到那儿大概会想掏出手机拍点什么。',
  '那里有一小块能坐下来的地方。',
  '路过的人都很赶，只有你可能会停。'
];

/** 「位置未知」文案（没定位权限 / 还没拿到 fix） */
export const DISTANCE_UNKNOWN_TEXT: string = '位置未知';

/** 卡片标题的后半句（三端一致） */
export const HINT_TITLE_SUFFIX: string = '有人留下一张照片';

/** 卡片底部提示（三端一致） */
export const HINT_FOOTER: string = '线索要靠走近才会解锁 · 点这里开始找';

/** 空状态 CTA 文案 */
export const HINT_EMPTY_CTA: string = '有人在这儿留下第一张？埋一个 →';

// ============================================================
// 距离分档
// ============================================================

/**
 * 距离 → 模糊分档文案。
 *
 * 只给「大概」：≤120 米说「几步」，≤350 米说「一两百米」……
 * 用户在附近转一圈就能碰上，但拿这个数字去地图上圈点是不行的。
 *
 * @param meters 距离（米）；undefined / NaN / Infinity → 「位置未知」
 */
export function distanceBucket(meters?: number): string {
  if (meters === undefined || meters === null) return DISTANCE_UNKNOWN_TEXT;
  if (!isFinite(meters)) return DISTANCE_UNKNOWN_TEXT;
  if (meters <= 120) return '就在附近几步';
  if (meters <= 350) return '大概一两百米';
  if (meters <= 800) return '走过去几分钟';
  if (meters <= 2000) return '要走一段路';
  if (meters <= 8000) return '在比较远的地方';
  return '不在附近，需要专程去';
}

/** 这一档算不算「远」（UI 可以弱化显示，不影响保密） */
export function isFarBucket(meters?: number): boolean {
  if (meters === undefined || meters === null) return true;
  if (!isFinite(meters)) return true;
  return meters > 800;
}

// ============================================================
// 氛围提示：按 id 稳定选择
// ============================================================

/**
 * 稳定哈希（与 Web `hintForSurprise` 逐字同算法）：
 * `seed = (seed * 31 + charCode) % 9973`。
 *
 * 为什么用哈希而不是随机：同一个惊喜每次进图鉴要显示**同一句**氛围提示，
 * 否则刷新一下就换一句，用户会觉得这提示是假的。
 */
function hashID(id: string): number {
  let seed: number = 0;
  for (let i = 0; i < id.length; i += 1) {
    seed = (seed * 31 + id.charCodeAt(i)) % 9973;
  }
  return seed;
}

/**
 * 给某个惊喜挑一句氛围提示。
 * @param index 该惊喜在列表里的位置（让同屏几条尽量不重复）
 */
export function hintForSurprise(id: string, index: number): string {
  const safeIndex: number = index < 0 ? 0 : index;
  return HINT_ATMOSPHERE[(hashID(id) + safeIndex) % HINT_ATMOSPHERE.length];
}

// ============================================================
// 卡片数据
// ============================================================

/**
 * 图鉴页「附近的惊喜」一行 = 这个结构。
 *
 * 字段就是全部能说的东西：id 用于跳转、emoji 是作者标识、
 * distanceText 是模糊分档、atmosphere 是氛围句。
 * **没有** areaWord / hints / photoUri / location / authorName —— 这不是遗漏，是设计。
 */
export interface NearHint {
  id: string;
  emoji: string;
  /** 距离分档文案（「就在附近几步」这类） */
  distanceText: string;
  /** 隐晦氛围提示 */
  atmosphere: string;
  /** 精确距离（米）：**只给 UI 判断远近用，不直接展示** */
  distanceMeters?: number;
}

/** 组装一条 NearHint（唯一的生产入口，保密由这里保证） */
export function makeNearHint(
  surprise: BuriedSurprise,
  index: number,
  distanceMeters?: number
): NearHint {
  const hint: NearHint = {
    id: surprise.id,
    emoji: surprise.authorEmoji.length > 0 ? surprise.authorEmoji : '🎁',
    distanceText: distanceBucket(distanceMeters),
    atmosphere: hintForSurprise(surprise.id, index)
  };
  if (distanceMeters !== undefined && isFinite(distanceMeters)) {
    hint.distanceMeters = Math.round(distanceMeters);
  }
  return hint;
}

/**
 * 附近还没被找到的惊喜 → 隐晦提示列表（按距离升序，取前 limit 条）。
 *
 * 规则（与 Web `nearbySurpriseHints` 一致）：
 * - 过滤掉 `found === true` 和**自己埋的**（自己埋的等别人来找，不该出现在寻宝列表）
 * - 有定位：按距离升序
 * - 没定位：距离未知，排在最后，文案显示「位置未知」（不是不显示）
 * - **不做距离过滤**：远的也提示（写「在比较远的地方」），让用户自己决定去不去
 *
 * @param surprises 候选惊喜（通常传 `snapshot.explorableSurprises`）
 * @param origin 最近一次定位；undefined = 没定位
 * @param myName 当前用户名（用来排除自己埋的）
 * @param limit 最多几条，默认 3
 */
export function nearbyHints(
  surprises: BuriedSurprise[],
  origin: GeoPoint | undefined,
  myName: string,
  limit?: number
): NearHint[] {
  const cap: number = limit === undefined || limit <= 0 ? NEARBY_HINT_LIMIT : limit;

  interface Entry {
    surprise: BuriedSurprise;
    meters?: number;
  }
  const entries: Entry[] = [];
  for (let i = 0; i < surprises.length; i += 1) {
    const item: BuriedSurprise = surprises[i];
    if (item.found) continue;
    if (item.authorName === myName) continue;
    const entry: Entry = { surprise: item };
    if (origin !== undefined) {
      entry.meters = distance(origin, item.location);
    }
    entries.push(entry);
  }

  // 有距离的按升序；没距离的（未定位）一律排后面
  entries.sort((a: Entry, b: Entry): number => {
    if (a.meters === undefined && b.meters === undefined) return 0;
    if (a.meters === undefined) return 1;
    if (b.meters === undefined) return -1;
    return a.meters - b.meters;
  });

  const out: NearHint[] = [];
  const total: number = entries.length < cap ? entries.length : cap;
  for (let i = 0; i < total; i += 1) {
    out.push(makeNearHint(entries[i].surprise, i, entries[i].meters));
  }
  return out;
}

/** 标题右侧小字：「N 个还没被找到」/「这一带暂时没有」 */
export function nearbyHintCountText(count: number): string {
  return count === 0 ? '这一带暂时没有' : String(count) + ' 个还没被找到';
}

// ============================================================
// 探寻页：三阶线索按距离解锁
// ============================================================

/** 探寻页某一刻的线索状态 */
export interface SeekClueState {
  /** 已解锁到第几条（0…3） */
  unlockedCount: number;
  /** 逐条文案（未解锁位置给「再走近一点…」） */
  lines: string[];
  /** 是否已进入拍照半径 */
  inRange: boolean;
  /** 距离（米）；undefined = 没定位 */
  distanceMeters?: number;
  /** 本轮是否是「当作到了」演示 */
  demoArrived: boolean;
  /** 距离分档文案（给顶部摘要用） */
  distanceText: string;
}

/** 未解锁线索的占位文案（**不能**用作者的提示内容，那是解锁后才给看的） */
export const LOCKED_CLUE_TEXT: string = '再走近一点…';

/**
 * 按距离解锁三阶线索（与 Web `seekDetailHTML` 一致）：
 * - 起点即解锁第 1 条
 * - `≤ 3×半径`（默认 180m）解锁第 2 条
 * - `≤ 半径`（默认 60m）解锁第 3 条 → 进入拍照阶段
 * - 点「当作到了（演示）」直接全解锁（仅演示，UI 要标注）
 * - 没定位：只有第 1 条（其余锁着，并提示拿不到定位）
 *
 * **前提（由 `surprise.makeClues()` 保证）**：`hints[0]` 永远是通用句
 * 「有人在这里放下了一张照片。先走近一点。」，不含作者提示；
 * 作者的提示只放在 `hints[1]`。所以「起点即解锁第 1 条」在任何距离都安全 ——
 * 单测里有断言守着这个不变量。
 *
 * @param surprise 目标惊喜（只读它的 hints / 位置，不读 areaWord）
 * @param origin 当前位置；undefined = 没定位
 * @param demoArrived 是否点了「当作到了」
 * @param radiusMeters 找到半径，默认 SURPRISE_RADIUS_METERS
 */
export function seekClueState(
  surprise: BuriedSurprise,
  origin: GeoPoint | undefined,
  demoArrived: boolean,
  radiusMeters?: number
): SeekClueState {
  const radius: number = radiusMeters === undefined || radiusMeters <= 0
    ? SURPRISE_RADIUS_METERS
    : radiusMeters;

  let meters: number | undefined = undefined;
  if (origin !== undefined) {
    meters = distance(origin, surprise.location);
  }

  let unlocked: number = 1;
  if (meters !== undefined) {
    if (meters <= radius * 3) unlocked = 2;
    if (meters <= radius) unlocked = 3;
  }
  if (demoArrived) unlocked = 3;

  const lines: string[] = [];
  const total: number = surprise.hints.length;
  for (let i = 0; i < total; i += 1) {
    lines.push(i < unlocked ? surprise.hints[i] : LOCKED_CLUE_TEXT);
  }

  const inRange: boolean = demoArrived || (meters !== undefined && meters <= radius);
  const state: SeekClueState = {
    unlockedCount: unlocked,
    lines: lines,
    inRange: inRange,
    demoArrived: demoArrived,
    distanceText: distanceBucket(meters)
  };
  if (meters !== undefined) state.distanceMeters = Math.round(meters);
  return state;
}

/** 探寻页顶部的下一步文案 */
export function seekLeadText(state: SeekClueState, radiusMeters?: number): string {
  const radius: number = radiusMeters === undefined || radiusMeters <= 0
    ? SURPRISE_RADIUS_METERS
    : radiusMeters;
  if (state.demoArrived) return '演示：已当作你走到了这里。';
  if (state.distanceMeters === undefined) return SEEK_NO_LOCATION_TEXT;
  if (state.inRange) return '你到了。抬手机，找到 TA 的角度。';
  const gap: number = Math.max(0, state.distanceMeters - radius);
  return '再走近 ' + String(Math.round(gap)) + ' 米。';
}

/** 找不可用时的明确说明（不假装解锁） */
export const SEEK_NO_LOCATION_TEXT: string = '拿不到定位，线索暂时解锁不了';