/**
 * 步迷 Walkaholic · HarmonyOS 逻辑层 — 照片感知哈希与埋惊喜
 *
 * 移植自 apple/Shared/Core/Surprise.swift：
 * - 9×8 灰度 → 64 位 dHash（每行相邻像素比较，左 < 右 记 1）
 * - 汉明距离 → similarity = max(0, 1 - dist / 32)
 * - 判定阈值 0.45；评价文案温柔不打击
 *
 * 哈希在字符串里用 16 位十六进制表示（等价于 UInt64），方便 JSON 持久化与 ArkTS 传输。
 */

import {
  BuriedSurprise,
  GeoPoint,
  PHOTO_PASS_THRESHOLD
} from './types';
import { distance } from './geo';

/** 64 位哈希的十六进制字符数 */
const HASH_HEX_LENGTH: number = 16;

const EMPTY_HASH: string = '0000000000000000';

function hexValue(char: string): number {
  const code: number = char.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;          // 0-9
  if (code >= 97 && code <= 102) return code - 87;         // a-f
  if (code >= 65 && code <= 70) return code - 55;          // A-F
  return 0;
}

function toHexDigit(value: number): string {
  const digits: string = '0123456789abcdef';
  return digits.charAt(value & 0x0F);
}

function bitCount(value: number): number {
  let count: number = 0;
  let current: number = value;
  while (current !== 0) {
    current = current & (current - 1);
    count += 1;
  }
  return count;
}

/**
 * 计算 64 位 dHash（8 行 × 8 次比较）。
 * @param gray 灰度像素值，行优先，默认需要 9×8 = 72 个（0…255）
 * @param width 默认 9
 * @param height 默认 8
 * @returns 16 位十六进制字符串；输入不足时返回全 0（与苹果版 guard 一致）
 */
export function computeDHash(gray: number[], width: number = 9, height: number = 8): string {
  const needed: number = width * height;
  if (gray.length < needed) return EMPTY_HASH;

  const nibbles: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let bitIndex: number = 0;
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width - 1; col += 1) {
      const left: number = gray[row * width + col];
      const right: number = gray[row * width + col + 1];
      if (left < right) {
        const nibbleIndex: number = Math.floor(bitIndex / 4);
        const bitInNibble: number = bitIndex % 4;
        nibbles[nibbleIndex] = nibbles[nibbleIndex] | (1 << bitInNibble);
      }
      bitIndex += 1;
    }
  }

  let result: string = '';
  for (let i = HASH_HEX_LENGTH - 1; i >= 0; i -= 1) {
    result += toHexDigit(nibbles[i]);
  }
  return result;
}

/** 把任意字符串规整成 16 位小写十六进制（容错） */
export function normalizeHash(value: string): string {
  if (value.length === 0) return EMPTY_HASH;
  let normalized: string = value.toLowerCase();
  if (normalized.length > HASH_HEX_LENGTH) {
    normalized = normalized.substring(0, HASH_HEX_LENGTH);
  }
  while (normalized.length < HASH_HEX_LENGTH) {
    normalized = normalized + '0';
  }
  return normalized;
}

/** 汉明距离（0 = 完全一致，64 = 完全不同） */
export function hammingDistance(a: string, b: string): number {
  const left: string = normalizeHash(a);
  const right: string = normalizeHash(b);
  let total: number = 0;
  for (let i = 0; i < HASH_HEX_LENGTH; i += 1) {
    total += bitCount(hexValue(left.charAt(i)) ^ hexValue(right.charAt(i)));
  }
  return total;
}

/** 相似度 0…1：距离越小越像（32 位差异视为完全不像） */
export function similarity(a: string, b: string): number {
  const distanceBits: number = hammingDistance(a, b);
  return Math.max(0, 1 - distanceBits / 32);
}

/** 是否达到「找到」的判定阈值 */
export function passes(a: string, b: string): boolean {
  return similarity(a, b) >= PHOTO_PASS_THRESHOLD;
}

/** 判定文案（温柔，不打击人；与苹果版逐字一致） */
export function verdict(value: number): string {
  if (value >= 0.85) return '几乎一模一样。你找到了 TA 的视角。';
  if (value >= 0.65) return '很像。你站的位置差不多就是那个点。';
  if (value >= 0.45) return '有点像。再往那边挪两步会更接近。';
  return '画面不太一样。不过这张也有你自己的意思。';
}

/** 三阶线索：中间一条用作者提示（没有则用通用句），首尾固定，绝不暴露照片内容 */
export function makeClues(hint?: string): string[] {
  let middle: string = '找到能把眼前的画面装进取景框的位置。';
  if (hint !== undefined && hint.length > 0) {
    middle = hint;
  }
  return [
    '有人在这里放下了一张照片。先走近一点。',
    middle,
    '就是这儿。抬手机，拍一张和 TA 一样的。'
  ];
}

/** 深拷贝一颗惊喜（快照/返回值用） */
export function cloneSurprise(surprise: BuriedSurprise): BuriedSurprise {
  const location: GeoPoint = {
    latitude: surprise.location.latitude,
    longitude: surprise.location.longitude
  };
  const copy: BuriedSurprise = {
    id: surprise.id,
    authorName: surprise.authorName,
    authorEmoji: surprise.authorEmoji,
    location: location,
    areaWord: surprise.areaWord,
    hints: surprise.hints.slice(),
    photoHash: surprise.photoHash,
    photoUri: surprise.photoUri,
    buriedAt: surprise.buriedAt,
    found: surprise.found
  };
  if (surprise.myPhotoUri !== undefined) copy.myPhotoUri = surprise.myPhotoUri;
  if (surprise.similarity !== undefined) copy.similarity = surprise.similarity;
  // 扩展字段（与 iOS BuriedSurprise 对齐）
  if (surprise.message !== undefined) copy.message = surprise.message;
  if (surprise.radiusMeters !== undefined) copy.radiusMeters = surprise.radiusMeters;
  if (surprise.seekerPoints !== undefined) copy.seekerPoints = surprise.seekerPoints;
  if (surprise.authorPoints !== undefined) copy.authorPoints = surprise.authorPoints;
  if (surprise.finderName !== undefined) copy.finderName = surprise.finderName;
  if (surprise.foundAt !== undefined) copy.foundAt = surprise.foundAt;
  if (surprise.finderPhotoUri !== undefined) copy.finderPhotoUri = surprise.finderPhotoUri;
  if (surprise.isMine !== undefined) copy.isMine = surprise.isMine;
  if (surprise.isUploaded !== undefined) copy.isUploaded = surprise.isUploaded;
  if (surprise.isRemote !== undefined) copy.isRemote = surprise.isRemote;
  return copy;
}

/**
 * 是否是我埋的。
 * 优先看 isMine 标记（改名后也认得出来），没有标记时退回作者名比较（老存档）。
 */
export function isMySurprise(surprise: BuriedSurprise, myName: string): boolean {
  if (surprise.isMine === true) return true;
  return surprise.authorName === myName;
}

/**
 * 给 UI 的安全副本：**寻到之前不暴露作者照片 URI**（ADR-007 先拍后看）。
 */
export function publicSurprise(surprise: BuriedSurprise): BuriedSurprise {
  const copy: BuriedSurprise = cloneSurprise(surprise);
  if (!copy.found) {
    copy.photoUri = '';
  }
  return copy;
}

/** 附近可探索的惊喜：未被找到、不是自己埋的，按距离升序 */
export function exploreSurprises(
  surprises: BuriedSurprise[],
  origin: GeoPoint,
  myName: string,
  withinMeters: number
): BuriedSurprise[] {
  const candidates: BuriedSurprise[] = surprises.filter((item: BuriedSurprise): boolean => {
    if (item.found) return false;
    if (isMySurprise(item, myName)) return false;
    return distance(origin, item.location) <= withinMeters;
  });
  candidates.sort((a: BuriedSurprise, b: BuriedSurprise): number => {
    const da: number = distance(origin, a.location);
    const db: number = distance(origin, b.location);
    return da - db;
  });
  return candidates;
}
