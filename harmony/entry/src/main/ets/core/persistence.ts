/**
 * 盲走 BlindWalk · HarmonyOS 逻辑层 — 持久化
 *
 * - 只依赖 contract.KeyValueStore；HarmonyOS 端由 UI 层注入 `@ohos.data.preferences` 的实现
 *   （本文件**不 import 任何 @ohos.***，因此在 Node 里可以直接测试）。
 * - 内存实现 `MemoryKV` 供 Node 测试 / 预览使用。
 * - Profile 存 `blindwalk.profile.v1`；埋惊喜存 `blindwalk.surprises.v1`。
 * - Profile 契约里没有累计里程 / 到达时间 / 动态等运行时字段，
 *   为了成就（km_100）与「本周惊喜值」口径稳定，这里把运行时数据放进同一份 JSON 的 `extras` 字段。
 * - 反序列化全部做 try/catch 容错：坏数据 → 返回 undefined / 空数组，绝不抛给 UI。
 */

import {
  Achievement,
  GeoPoint,
  MapPoint,
  Place,
  PlaceCard,
  Profile,
  QuestPhase,
  QuestSession,
  Rarity,
  Area,
  FeedPost,
  BuriedSurprise
} from './types';
import { KeyValueStore } from './contract';

export const PROFILE_KEY: string = 'blindwalk.profile.v1';
export const SURPRISES_KEY: string = 'blindwalk.surprises.v1';
const SCHEMA_VERSION: number = 1;

/** 契约 Profile 之外的运行时数据（随 profile 一起序列化） */
export interface StoreExtras {
  /** 累计里程 km（成就 km_100） */
  totalKm: number;
  /** 累计开盒数（与 cards.length 同步，保留给后续口径） */
  boxesOpened: number;
  /** 到达时间戳列表（本周惊喜值按自然日窗口） */
  walkArrivalTimes: number[];
  /** 同频散步次数（MVP 无同频功能，恒 0） */
  togetherCount: number;
  lastWalkAt?: number;
  /** 圈子动态（本人置顶 + 好友 mock；含反应计数与已点状态） */
  feed: FeedPost[];
  /** UI 注入过的真实地点（重启后图鉴仍能还原 placeID） */
  realPlaces: Place[];
  /** 已经发过安慰奖的惊喜 id（同一颗只发一次） */
  consolationPaid: string[];
  /** 进行中的旅程（契约外：原型重启后仍能回到旅程页；正式版可只放内存） */
  session?: QuestSession;
  /** 当前旅程地点（契约外：与 session 一起恢复，避免图鉴/揭晓丢地点） */
  currentPlace?: Place;
  /** 揭晓编号（到达后才有值） */
  revealSerial?: string;
  /** 已收录卡片（session 恢复后 UI 可跳图鉴） */
  currentCard?: PlaceCard;
}

/** 读取结果：契约 Profile + 运行时 extras */
export interface LoadedProfile {
  profile: Profile;
  extras: StoreExtras;
}

// ============================================================
// KeyValueStore 内存实现（Node 测试 / 纯预览）
// ============================================================

export class MemoryKV implements KeyValueStore {
  private values: Map<string, string> = new Map<string, string>();

  getString(key: string): string | undefined {
    return this.values.get(key);
  }

  putString(key: string, value: string): void {
    this.values.set(key, value);
  }

  delete(key: string): void {
    this.values.delete(key);
  }

  /** 测试辅助：直接读原始 JSON */
  readRaw(key: string): string | undefined {
    return this.values.get(key);
  }

  /** 测试辅助：是否存过某个 key */
  has(key: string): boolean {
    return this.values.has(key);
  }
}

// ============================================================
// 解码工具（唯一的类型断言边界：JSON → Record）
// ============================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  return !Array.isArray(value);
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  return undefined;
}

function readString(record: Record<string, unknown>, key: string, fallback: string): string {
  const value: unknown = record[key];
  return typeof value === 'string' ? value : fallback;
}

function readNumber(record: Record<string, unknown>, key: string, fallback: number): number {
  const value: unknown = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fallback;
}

function readBoolean(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value: unknown = record[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readArray(record: Record<string, unknown>, key: string): unknown[] {
  const value: unknown = record[key];
  if (Array.isArray(value)) return value;
  return [];
}

function readStringArray(record: Record<string, unknown>, key: string): string[] {
  const values: unknown[] = readArray(record, key);
  const result: string[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const item: unknown = values[i];
    if (typeof item === 'string') result.push(item);
  }
  return result;
}

function readNumberArray(record: Record<string, unknown>, key: string): number[] {
  const values: unknown[] = readArray(record, key);
  const result: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const item: unknown = values[i];
    if (typeof item === 'number') result.push(item);
  }
  return result;
}

function readRarity(value: string, fallback: Rarity): Rarity {
  switch (value) {
    case 'common': return Rarity.Common;
    case 'rare': return Rarity.Rare;
    case 'epic': return Rarity.Epic;
    case 'hidden': return Rarity.Hidden;
    default: return fallback;
  }
}

function readArea(value: string, fallback: Area): Area {
  switch (value) {
    case 'near': return Area.Near;
    case 'river': return Area.River;
    case 'oldtown': return Area.OldTown;
    default: return fallback;
  }
}

function decodeGeoPoint(record: Record<string, unknown>): GeoPoint | undefined {
  const latitude: unknown = record['latitude'];
  const longitude: unknown = record['longitude'];
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return undefined;
  const point: GeoPoint = { latitude: latitude, longitude: longitude };
  return point;
}

function decodeMapPoint(record: Record<string, unknown>): MapPoint {
  const point: MapPoint = {
    x: readNumber(record, 'x', 0.5),
    y: readNumber(record, 'y', 0.5)
  };
  return point;
}

function decodeCard(value: unknown): PlaceCard | undefined {
  const record: Record<string, unknown> | undefined = toRecord(value);
  if (record === undefined) return undefined;
  const placeID: unknown = record['placeID'];
  if (typeof placeID !== 'string' || placeID.length === 0) return undefined;
  const card: PlaceCard = {
    id: readString(record, 'id', 'card-' + placeID),
    placeID: placeID,
    serial: readString(record, 'serial', '0000'),
    collectedAt: readNumber(record, 'collectedAt', 0),
    taskDone: readBoolean(record, 'taskDone', false)
  };
  return card;
}

function decodeCards(record: Record<string, unknown>): PlaceCard[] {
  const values: unknown[] = readArray(record, 'cards');
  const cards: PlaceCard[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const card: PlaceCard | undefined = decodeCard(values[i]);
    if (card !== undefined) cards.push(card);
  }
  return cards;
}

function decodeAchievement(value: unknown): Achievement | undefined {
  const record: Record<string, unknown> | undefined = toRecord(value);
  if (record === undefined) return undefined;
  const id: unknown = record['id'];
  if (typeof id !== 'string' || id.length === 0) return undefined;
  const achievement: Achievement = {
    id: id,
    name: readString(record, 'name', id),
    icon: readString(record, 'icon', '🏅'),
    detail: readString(record, 'detail', ''),
    target: readNumber(record, 'target', 1),
    progress: readNumber(record, 'progress', 0)
  };
  const unlockedAt: unknown = record['unlockedAt'];
  if (typeof unlockedAt === 'number') achievement.unlockedAt = unlockedAt;
  return achievement;
}

function decodeAchievements(record: Record<string, unknown>): Achievement[] {
  const values: unknown[] = readArray(record, 'achievements');
  const achievements: Achievement[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const achievement: Achievement | undefined = decodeAchievement(values[i]);
    if (achievement !== undefined) achievements.push(achievement);
  }
  return achievements;
}

function decodeReactions(record: Record<string, unknown>): Record<string, number> {
  const reactions: Record<string, number> = { eyes: 0, heart: 0, next: 0 };
  const source: Record<string, unknown> | undefined = toRecord(record['reactions']);
  if (source !== undefined) {
    const keys: string[] = Object.keys(source);
    for (let i = 0; i < keys.length; i += 1) {
      const value: unknown = source[keys[i]];
      if (typeof value === 'number') reactions[keys[i]] = value;
    }
  }
  return reactions;
}

function decodeReacted(record: Record<string, unknown>): Record<string, boolean> {
  const reacted: Record<string, boolean> = { eyes: false, heart: false, next: false };
  const source: Record<string, unknown> | undefined = toRecord(record['reacted']);
  if (source !== undefined) {
    const keys: string[] = Object.keys(source);
    for (let i = 0; i < keys.length; i += 1) {
      const value: unknown = source[keys[i]];
      if (typeof value === 'boolean') reacted[keys[i]] = value;
    }
  }
  return reacted;
}

function decodePost(value: unknown): FeedPost | undefined {
  const record: Record<string, unknown> | undefined = toRecord(value);
  if (record === undefined) return undefined;
  const id: unknown = record['id'];
  if (typeof id !== 'string' || id.length === 0) return undefined;
  const post: FeedPost = {
    id: id,
    authorName: readString(record, 'authorName', ''),
    authorEmoji: readString(record, 'authorEmoji', '🙂'),
    placeName: readString(record, 'placeName', ''),
    categoryEmoji: readString(record, 'categoryEmoji', '📍'),
    rarity: readRarity(readString(record, 'rarity', 'common'), Rarity.Common),
    caption: readString(record, 'caption', ''),
    createdAt: readNumber(record, 'createdAt', 0),
    reactions: decodeReactions(record),
    reacted: decodeReacted(record),
    isMine: readBoolean(record, 'isMine', false)
  };
  return post;
}

function decodeFeed(record: Record<string, unknown>, key: string): FeedPost[] {
  const values: unknown[] = readArray(record, key);
  const posts: FeedPost[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const post: FeedPost | undefined = decodePost(values[i]);
    if (post !== undefined) posts.push(post);
  }
  return posts;
}

function decodePlace(value: unknown): Place | undefined {
  const record: Record<string, unknown> | undefined = toRecord(value);
  if (record === undefined) return undefined;
  const id: unknown = record['id'];
  const name: unknown = record['name'];
  if (typeof id !== 'string' || id.length === 0) return undefined;
  if (typeof name !== 'string') return undefined;
  const mapRecord: Record<string, unknown> | undefined = toRecord(record['mapPoint']);
  const place: Place = {
    id: id,
    name: name,
    area: readArea(readString(record, 'area', 'near'), Area.Near),
    category: readString(record, 'category', '街角'),
    emoji: readString(record, 'emoji', '📍'),
    rarity: readRarity(readString(record, 'rarity', 'common'), Rarity.Common),
    why: readString(record, 'why', ''),
    task: readString(record, 'task', ''),
    hints: readStringArray(record, 'hints'),
    mapPoint: mapRecord === undefined ? { x: 0.5, y: 0.5 } : decodeMapPoint(mapRecord),
    radiusMeters: readNumber(record, 'radiusMeters', 800),
    source: readString(record, 'source', 'geo')
  };
  const coordinateRecord: Record<string, unknown> | undefined = toRecord(record['coordinate']);
  if (coordinateRecord !== undefined) {
    const coordinate: GeoPoint | undefined = decodeGeoPoint(coordinateRecord);
    if (coordinate !== undefined) place.coordinate = coordinate;
  }
  const address: unknown = record['address'];
  if (typeof address === 'string') place.address = address;
  return place;
}

function decodePlaces(record: Record<string, unknown>, key: string): Place[] {
  const values: unknown[] = readArray(record, key);
  const places: Place[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const place: Place | undefined = decodePlace(values[i]);
    if (place !== undefined) places.push(place);
  }
  return places;
}

function decodeProfile(record: Record<string, unknown>): Profile {
  const profile: Profile = {
    name: readString(record, 'name', '阿澈'),
    avatarEmoji: readString(record, 'avatarEmoji', '🫥'),
    xp: readNumber(record, 'xp', 0),
    streakDays: readNumber(record, 'streakDays', 0),
    cards: decodeCards(record),
    achievements: decodeAchievements(record),
    weeklySurprise: readNumber(record, 'weeklySurprise', 0),
    weeklyWindowStart: readNumber(record, 'weeklyWindowStart', 0)
  };
  return profile;
}

function decodeSession(value: unknown): QuestSession | undefined {
  const record: Record<string, unknown> | undefined = toRecord(value);
  if (record === undefined) return undefined;
  const placeID: unknown = record['placeID'];
  if (typeof placeID !== 'string' || placeID.length === 0) return undefined;
  const phaseText: string = readString(record, 'phase', 'walking');
  let phase: QuestPhase = QuestPhase.Walking;
  if (phaseText === 'idle') phase = QuestPhase.Idle;
  else if (phaseText === 'arrived') phase = QuestPhase.Arrived;
  else if (phaseText === 'revealed') phase = QuestPhase.Revealed;
  else if (phaseText === 'collected') phase = QuestPhase.Collected;
  const session: QuestSession = {
    id: readString(record, 'id', 'quest-' + placeID),
    placeID: placeID,
    startedAt: readNumber(record, 'startedAt', 0),
    totalMeters: readNumber(record, 'totalMeters', 0),
    remainingMeters: readNumber(record, 'remainingMeters', 0),
    phase: phase,
    unlockedHintCount: readNumber(record, 'unlockedHintCount', 1)
  };
  const targetRecord: Record<string, unknown> | undefined = toRecord(record['target']);
  if (targetRecord !== undefined) {
    const target: GeoPoint | undefined = decodeGeoPoint(targetRecord);
    if (target !== undefined) session.target = target;
  }
  const currentBearing: unknown = record['currentBearing'];
  if (typeof currentBearing === 'number') session.currentBearing = currentBearing;
  return session;
}

function decodeExtras(record: Record<string, unknown>): StoreExtras {
  const extrasRecord: Record<string, unknown> | undefined = toRecord(record['extras']);
  if (extrasRecord === undefined) {
    const empty: StoreExtras = {
      totalKm: 0,
      boxesOpened: 0,
      walkArrivalTimes: [],
      togetherCount: 0,
      feed: [],
      realPlaces: [],
      consolationPaid: []
    };
    return empty;
  }
  const extras: StoreExtras = {
    totalKm: readNumber(extrasRecord, 'totalKm', 0),
    boxesOpened: readNumber(extrasRecord, 'boxesOpened', 0),
    walkArrivalTimes: readNumberArray(extrasRecord, 'walkArrivalTimes'),
    togetherCount: readNumber(extrasRecord, 'togetherCount', 0),
    feed: decodeFeed(extrasRecord, 'feed'),
    realPlaces: decodePlaces(extrasRecord, 'realPlaces'),
    consolationPaid: readStringArray(extrasRecord, 'consolationPaid')
  };
  const lastWalkAt: unknown = extrasRecord['lastWalkAt'];
  if (typeof lastWalkAt === 'number') extras.lastWalkAt = lastWalkAt;
  const session: QuestSession | undefined = decodeSession(extrasRecord['session']);
  if (session !== undefined) extras.session = session;
  const currentPlaceRecord: Record<string, unknown> | undefined = toRecord(extrasRecord['currentPlace']);
  if (currentPlaceRecord !== undefined) {
    const currentPlace: Place | undefined = decodePlace(currentPlaceRecord);
    if (currentPlace !== undefined) extras.currentPlace = currentPlace;
  }
  const revealSerial: unknown = extrasRecord['revealSerial'];
  if (typeof revealSerial === 'string') extras.revealSerial = revealSerial;
  const currentCard: PlaceCard | undefined = decodeCard(extrasRecord['currentCard']);
  if (currentCard !== undefined) extras.currentCard = currentCard;
  return extras;
}

// ============================================================
// 对外 API
// ============================================================

/** 读取 profile + extras；没有存档或数据损坏返回 undefined */
export function loadProfile(kv: KeyValueStore): LoadedProfile | undefined {
  const text: string | undefined = kv.getString(PROFILE_KEY);
  if (text === undefined || text.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    const root: Record<string, unknown> | undefined = toRecord(parsed);
    if (root === undefined) return undefined;
    const loaded: LoadedProfile = {
      profile: decodeProfile(root),
      extras: decodeExtras(root)
    };
    return loaded;
  } catch (error) {
    return undefined;
  }
}

function serializableExtras(extras: StoreExtras): StoreExtras {
  const copy: StoreExtras = {
    totalKm: extras.totalKm,
    boxesOpened: extras.boxesOpened,
    walkArrivalTimes: extras.walkArrivalTimes.slice(),
    togetherCount: extras.togetherCount,
    feed: extras.feed,
    realPlaces: extras.realPlaces,
    consolationPaid: extras.consolationPaid.slice()
  };
  if (extras.lastWalkAt !== undefined) copy.lastWalkAt = extras.lastWalkAt;
  if (extras.session !== undefined) copy.session = extras.session;
  if (extras.currentPlace !== undefined) copy.currentPlace = extras.currentPlace;
  if (extras.revealSerial !== undefined) copy.revealSerial = extras.revealSerial;
  if (extras.currentCard !== undefined) copy.currentCard = extras.currentCard;
  return copy;
}

/** 保存 profile + extras（JSON；写失败静默忽略，不打断 UI） */
export function saveProfile(kv: KeyValueStore, profile: Profile, extras: StoreExtras): void {
  try {
    const root: Record<string, unknown> = {
      version: SCHEMA_VERSION,
      name: profile.name,
      avatarEmoji: profile.avatarEmoji,
      xp: profile.xp,
      streakDays: profile.streakDays,
      cards: profile.cards,
      achievements: profile.achievements,
      weeklySurprise: profile.weeklySurprise,
      weeklyWindowStart: profile.weeklyWindowStart,
      extras: serializableExtras(extras)
    };
    kv.putString(PROFILE_KEY, JSON.stringify(root));
  } catch (error) {
    /* 持久化失败不影响当前会话 */
  }
}

function decodeSurprise(value: unknown): BuriedSurprise | undefined {
  const record: Record<string, unknown> | undefined = toRecord(value);
  if (record === undefined) return undefined;
  const id: unknown = record['id'];
  const authorName: unknown = record['authorName'];
  if (typeof id !== 'string' || id.length === 0) return undefined;
  if (typeof authorName !== 'string') return undefined;
  const locationRecord: Record<string, unknown> | undefined = toRecord(record['location']);
  if (locationRecord === undefined) return undefined;
  const location: GeoPoint | undefined = decodeGeoPoint(locationRecord);
  if (location === undefined) return undefined;

  const surprise: BuriedSurprise = {
    id: id,
    authorName: authorName,
    authorEmoji: readString(record, 'authorEmoji', '🙂'),
    location: location,
    areaWord: readString(record, 'areaWord', '附近 · 街角'),
    hints: readStringArray(record, 'hints'),
    photoHash: readString(record, 'photoHash', '0000000000000000'),
    photoUri: readString(record, 'photoUri', ''),
    buriedAt: readNumber(record, 'buriedAt', 0),
    found: readBoolean(record, 'found', false)
  };
  const myPhotoUri: unknown = record['myPhotoUri'];
  if (typeof myPhotoUri === 'string') surprise.myPhotoUri = myPhotoUri;
  const similarity: unknown = record['similarity'];
  if (typeof similarity === 'number') surprise.similarity = similarity;
  return surprise;
}

/**
 * 从「账号同步的整包」里解析 profile + extras（纯函数，不走 KeyValueStore）。
 * 账号服务存的是 Web 版 syncPayload 结构；鸿蒙这边把 extras 也一起存了，
 * 所以从云端恢复的能力与本地存档完全一致。
 */
export function profileFromJson(text: string): LoadedProfile | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    const root: Record<string, unknown> | undefined = toRecord(parsed);
    if (root === undefined) return undefined;
    const loaded: LoadedProfile = {
      profile: decodeProfile(root),
      extras: decodeExtras(root)
    };
    return loaded;
  } catch (error) {
    return undefined;
  }
}

/** 从 JSON 数组解析埋惊喜（账号恢复用） */
export function surprisesFromJson(text: string): BuriedSurprise[] | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return undefined;
    const result: BuriedSurprise[] = [];
    for (let i = 0; i < parsed.length; i += 1) {
      const surprise: BuriedSurprise | undefined = decodeSurprise(parsed[i]);
      if (surprise !== undefined) result.push(surprise);
    }
    return result;
  } catch (error) {
    return undefined;
  }
}

/** 读取埋惊喜；没有存档或损坏返回 [] */
export function loadSurprises(kv: KeyValueStore): BuriedSurprise[] {
  const text: string | undefined = kv.getString(SURPRISES_KEY);
  if (text === undefined || text.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    const result: BuriedSurprise[] = [];
    for (let i = 0; i < parsed.length; i += 1) {
      const surprise: BuriedSurprise | undefined = decodeSurprise(parsed[i]);
      if (surprise !== undefined) result.push(surprise);
    }
    return result;
  } catch (error) {
    return [];
  }
}

/** 保存埋惊喜（JSON；写失败静默忽略） */
export function saveSurprises(kv: KeyValueStore, surprises: BuriedSurprise[]): void {
  try {
    kv.putString(SURPRISES_KEY, JSON.stringify(surprises));
  } catch (error) {
    /* 持久化失败不影响当前会话 */
  }
}

/** 清空所有本地数据（「清除演示数据」） */
export function clearAll(kv: KeyValueStore): void {
  try {
    kv.delete(PROFILE_KEY);
    kv.delete(SURPRISES_KEY);
  } catch (error) {
    /* ignore */
  }
}
