/**
 * 盲走 BlindWalk · HarmonyOS 逻辑层 — 抽盒引擎
 *
 * 移植自 apple/Shared/Core/BlindBoxEngine.swift：
 * - SplitMix64 种子随机（用 hi/lo 两个 32 位整数模拟 UInt64，避免 ArkTS 不支持 BigInt）
 * - 抽盒权重：常见 70 / 稀有 22 / 史诗 6 / 隐藏 2；隐藏款只在 60 分钟档
 * - 候选逐步放宽：区域 + 避开最近 → 区域 → 不限区域
 * - 心情亲和：命中类别的权重 ×3
 * - 起始距离：15 分钟 300m / 30 分钟 480m / 60 分钟 900m
 * - 卡片编号：seed % 9999 + 1，补足 4 位
 *
 * 说明：RNG 的 64 位状态与 SplitMix64 常量与苹果版一致；
 * 边界采样用「拒绝采样」保证均匀（苹果版用 Swift stdlib 的 Int.random，二者不会逐位相同，
 * 但同一个 seed 在本实现里完全可复现）。
 */

import {
  Area,
  Mood,
  Place,
  Rarity,
  WalkDuration
} from './types';
import {
  durationStartMeters,
  rarityAvailableIn,
  rarityWeight,
  durationRadiusMeters
} from './catalog';

/** 64 位无符号整数（拆成两个 32 位，避免 BigInt） */
interface U64 {
  hi: number;
  lo: number;
}

const GOLDEN_HI: number = 0x9E3779B9;
const GOLDEN_LO: number = 0x7F4A7C15;
const MIX1_HI: number = 0xBF58476D;
const MIX1_LO: number = 0x1CE4E5B9;
const MIX2_HI: number = 0x94D049BB;
const MIX2_LO: number = 0x133111EB;

function add64(a: U64, b: U64): U64 {
  const loSum: number = (a.lo >>> 0) + (b.lo >>> 0);
  const lo: number = loSum >>> 0;
  const carry: number = loSum >= 4294967296 ? 1 : 0;
  const hi: number = ((a.hi >>> 0) + (b.hi >>> 0) + carry) >>> 0;
  const result: U64 = { hi: hi, lo: lo };
  return result;
}

/** 64 位乘法 mod 2^64（16 位分肢，避免浮点精度问题） */
function mul64(x: U64, y: U64): U64 {
  const x0: number = x.lo & 0xFFFF;
  const x1: number = (x.lo >>> 16) & 0xFFFF;
  const x2: number = x.hi & 0xFFFF;
  const x3: number = (x.hi >>> 16) & 0xFFFF;
  const y0: number = y.lo & 0xFFFF;
  const y1: number = (y.lo >>> 16) & 0xFFFF;
  const y2: number = y.hi & 0xFFFF;
  const y3: number = (y.hi >>> 16) & 0xFFFF;

  const p0: number = x0 * y0;
  const p1: number = x0 * y1 + x1 * y0;
  const p2: number = x0 * y2 + x1 * y1 + x2 * y0;
  const p3: number = x0 * y3 + x1 * y2 + x2 * y1 + x3 * y0;

  const r0: number = p0 & 0xFFFF;
  let carry: number = Math.floor(p0 / 65536);
  let acc: number = p1 + carry;
  const r1: number = acc & 0xFFFF;
  carry = Math.floor(acc / 65536);
  acc = p2 + carry;
  const r2: number = acc & 0xFFFF;
  carry = Math.floor(acc / 65536);
  acc = p3 + carry;
  const r3: number = acc & 0xFFFF;

  const result: U64 = {
    hi: ((r3 << 16) | r2) >>> 0,
    lo: ((r1 << 16) | r0) >>> 0
  };
  return result;
}

function xor64(a: U64, b: U64): U64 {
  const result: U64 = {
    hi: (a.hi ^ b.hi) >>> 0,
    lo: (a.lo ^ b.lo) >>> 0
  };
  return result;
}

/** 无符号 64 位右移（仅用于 0…31 位） */
function shr64(x: U64, bits: number): U64 {
  if (bits <= 0) {
    const same: U64 = { hi: x.hi >>> 0, lo: x.lo >>> 0 };
    return same;
  }
  const hi: number = x.hi >>> bits;
  const lo: number = ((x.lo >>> bits) | (x.hi << (32 - bits))) >>> 0;
  const result: U64 = { hi: hi >>> 0, lo: lo };
  return result;
}

/** 种子 → 64 位状态（与 Swift SeededGenerator.init 一致：seed &+ 常量） */
function seedState(seed: number): U64 {
  const safe: number = Math.max(0, Math.floor(seed)) % 9007199254740992;
  const hi: number = Math.floor(safe / 4294967296) >>> 0;
  const lo: number = safe >>> 0;
  const raw: U64 = { hi: hi, lo: lo };
  const golden: U64 = { hi: GOLDEN_HI, lo: GOLDEN_LO };
  return add64(raw, golden);
}

/** 可复现的 SplitMix64 随机数发生器 */
export class SeededGenerator {
  private stateHi: number;
  private stateLo: number;

  constructor(seed: number) {
    const state: U64 = seedState(seed);
    this.stateHi = state.hi;
    this.stateLo = state.lo;
  }

  /** 返回 64 位随机数的低 32 位 */
  nextUint32(): number {
    const golden: U64 = { hi: GOLDEN_HI, lo: GOLDEN_LO };
    const current: U64 = { hi: this.stateHi, lo: this.stateLo };
    const nextState: U64 = add64(current, golden);
    this.stateHi = nextState.hi;
    this.stateLo = nextState.lo;

    let z: U64 = nextState;
    z = xor64(z, shr64(z, 30));
    const mix1: U64 = { hi: MIX1_HI, lo: MIX1_LO };
    z = mul64(z, mix1);
    z = xor64(z, shr64(z, 27));
    const mix2: U64 = { hi: MIX2_HI, lo: MIX2_LO };
    z = mul64(z, mix2);
    z = xor64(z, shr64(z, 31));
    return z.lo >>> 0;
  }

  /** 均匀整数 [0, bound)；拒绝采样避免取模偏差 */
  nextInt(bound: number): number {
    if (bound <= 0) return 0;
    const limit: number = Math.floor(4294967296 / bound) * bound;
    let value: number = this.nextUint32();
    while (value >= limit) {
      value = this.nextUint32();
    }
    return value % bound;
  }
}

// ============================================================
// 心情亲和（BlindBoxEngine.moodAffinity 逐条镜像）
// ============================================================

const MOOD_AFFINITY: Map<string, Mood[]> = new Map<string, Mood[]>();
MOOD_AFFINITY.set('长椅', [Mood.Drift]);
MOOD_AFFINITY.set('石阶', [Mood.Drift]);
MOOD_AFFINITY.set('栈道', [Mood.Drift]);
MOOD_AFFINITY.set('棋盘', [Mood.Drift]);
MOOD_AFFINITY.set('秋千', [Mood.Drift]);
MOOD_AFFINITY.set('台阶', [Mood.Drift]);
MOOD_AFFINITY.set('书店', [Mood.Drift, Mood.Discover]);
MOOD_AFFINITY.set('涂鸦墙', [Mood.Discover]);
MOOD_AFFINITY.set('灯塔', [Mood.Discover]);
MOOD_AFFINITY.set('唱片店', [Mood.Drift, Mood.Discover]);
MOOD_AFFINITY.set('修表摊', [Mood.Discover]);
MOOD_AFFINITY.set('阳台', [Mood.Discover]);
MOOD_AFFINITY.set('邮筒', [Mood.Discover]);
MOOD_AFFINITY.set('水塔', [Mood.Discover]);
MOOD_AFFINITY.set('咖啡窗口', [Mood.Drift]);
MOOD_AFFINITY.set('风筝', [Mood.Lively]);
MOOD_AFFINITY.set('洗车房', [Mood.Lively]);
MOOD_AFFINITY.set('便利店', [Mood.Lively]);
MOOD_AFFINITY.set('篮球场', [Mood.Lively]);
MOOD_AFFINITY.set('三轮车', [Mood.Lively]);
MOOD_AFFINITY.set('花店', [Mood.Lively]);
MOOD_AFFINITY.set('馄饨摊', [Mood.Lively]);
MOOD_AFFINITY.set('裁缝铺', [Mood.Drift]);
MOOD_AFFINITY.set('洗衣店', [Mood.Lively]);

/** 该类地点是否被这个心情偏好 */
export function moodAffinityFor(category: string, mood: Mood): boolean {
  const moods: Mood[] | undefined = MOOD_AFFINITY.get(category);
  if (moods === undefined) return false;
  return moods.indexOf(mood) >= 0;
}

/** 单个地点的抽中权重：稀有度基础权重 ×（心情命中 ? 3 : 1） */
export function placeWeight(place: Place, mood: Mood): number {
  const base: number = Math.max(1, rarityWeight(place.rarity));
  return moodAffinityFor(place.category, mood) ? base * 3 : base;
}

/** 抽盒入参 */
export interface DrawParams {
  catalog: Place[];
  mood: Mood;
  duration: WalkDuration;
  /** 指定区域；undefined = 不限 */
  area?: Area;
  /** 最近 7 天去过的地点，抽盒时避开 */
  recentPlaceIDs: Set<string>;
  /** 种子；同一个 seed 结果可复现 */
  seed: number;
}

/** 抽盒结果（对应 Swift DrawResult） */
export interface BlindBoxDrawResult {
  place: Place;
  startMeters: number;
  seed: number;
}

function eligible(
  catalog: Place[],
  duration: WalkDuration,
  area: Area | undefined,
  excludeRecent: boolean,
  recentPlaceIDs: Set<string>
): Place[] {
  return catalog.filter((place: Place): boolean => {
    if (!rarityAvailableIn(place.rarity, duration)) return false;
    if (place.radiusMeters > durationRadiusMeters(duration)) return false;
    if (area !== undefined && place.area !== area) return false;
    if (excludeRecent && recentPlaceIDs.has(place.id)) return false;
    return true;
  });
}

/**
 * 按心情 / 时长 / 区域抽一个盲盒。候选不足时依次放宽：
 * 区域 + 避开最近 → 区域（允许最近）→ 不限区域。
 */
export function draw(params: DrawParams): BlindBoxDrawResult | undefined {
  let candidates: Place[] = eligible(
    params.catalog, params.duration, params.area, true, params.recentPlaceIDs
  );
  if (candidates.length === 0) {
    candidates = eligible(params.catalog, params.duration, params.area, false, params.recentPlaceIDs);
  }
  if (candidates.length === 0) {
    candidates = eligible(params.catalog, params.duration, undefined, false, params.recentPlaceIDs);
  }
  if (candidates.length === 0) return undefined;

  const generator: SeededGenerator = new SeededGenerator(params.seed);
  const weights: number[] = candidates.map((place: Place): number => placeWeight(place, params.mood));
  let total: number = 0;
  for (let i = 0; i < weights.length; i += 1) {
    total += weights[i];
  }
  const ticket: number = generator.nextInt(Math.max(1, total));
  let running: number = 0;
  let picked: Place = candidates[candidates.length - 1];
  for (let i = 0; i < candidates.length; i += 1) {
    running += weights[i];
    if (ticket < running) {
      picked = candidates[i];
      break;
    }
  }

  const result: BlindBoxDrawResult = {
    place: picked,
    startMeters: durationStartMeters(params.duration),
    seed: params.seed
  };
  return result;
}

/** 起始距离（米）：15 → 300 / 30 → 480 / 60 → 900 */
export function startMetersFor(duration: WalkDuration): number {
  return durationStartMeters(duration);
}

/** 卡片编号：4 位数字字符串，如 seed 246 → "0247"（BlindBoxEngine.serial） */
export function serial(seed: number): string {
  const safe: number = Math.max(0, Math.floor(seed));
  const number: number = (safe % 9999) + 1;
  let text: string = String(number);
  while (text.length < 4) {
    text = '0' + text;
  }
  return text;
}

/** 稀有度权重表（导出给测试/UI 展示用，避免直接依赖 catalog 的 switch） */
export function weightOf(rarity: Rarity): number {
  return rarityWeight(rarity);
}
