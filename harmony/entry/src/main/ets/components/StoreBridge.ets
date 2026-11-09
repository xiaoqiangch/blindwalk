/**
 * 盲走 BlindWalk · HarmonyOS ArkUI — 读取 store 快照的小工具
 *
 * 约定（core/contract.ts）：
 * - UI 只能通过 getStore() 调用 BlindWalkStoreApi 方法；
 * - 状态只在交互后 / 页面显示时用 snapshot() 重读；
 * - UI 不修改 snapshot 字段。
 *
 * 这里不做任何缓存，只负责「安全读取 + 派生展示数据」。
 */

import { AppSnapshot } from '../core/contract';
import {
  Achievement,
  Area,
  FeedPost,
  Mood,
  Place,
  PlaceCard,
  Profile,
  QuestPhase,
  QuestSession,
  Rarity,
  ReactionKey,
  WalkDuration
} from '../core/types';
import { getStore, getStoreInstance } from '../core/store';
import { Profile } from '../core/types';

/** 空快照：仅用于 @State 初始值，页面 aboutToAppear 会立刻换成真实快照 */
export function emptySnapshot(): AppSnapshot {
  const profile: Profile = {
    name: '阿澈',
    avatarEmoji: '🫥',
    xp: 0,
    streakDays: 0,
    cards: [],
    achievements: [],
    weeklySurprise: 0,
    weeklyWindowStart: 0
  };
  const snapshot: AppSnapshot = {
    profile: profile,
    places: [],
    togetherCode: '',
    selectedMood: Mood.Drift,
    selectedDuration: WalkDuration.M30,
    feed: [],
    leaderboard: [],
    explorableSurprises: [],
    mySurprises: [],
    demoMode: true
  };
  return snapshot;
}

/** 安全重读：store 未就绪 / 抛错时保留旧快照 */
export function readSnapshot(fallback: AppSnapshot): AppSnapshot {
  try {
    return getStore().snapshot();
  } catch (err) {
    return fallback;
  }
}

// ============================================================
// 地点 / 卡片
// ============================================================

/** 兜底地点（只在极端情况下用于渲染占位；正常流程不会走到） */
export function emptyPlace(): Place {
  return {
    id: '',
    name: '',
    area: Area.Near,
    category: '',
    emoji: '🃏',
    rarity: Rarity.Common,
    why: '',
    task: '',
    hints: [],
    mapPoint: { x: 0.5, y: 0.5 },
    radiusMeters: 0,
    source: 'catalog'
  };
}

/** 按 placeID 在 places 库里还原完整地点 */
export function placeOf(snapshot: AppSnapshot, placeID: string): Place | undefined {
  for (let i = 0; i < snapshot.places.length; i++) {
    if (snapshot.places[i].id === placeID) {
      return snapshot.places[i];
    }
  }
  return undefined;
}

/** 已收集卡片，按收录时间倒序（最新在前） */
export function sortedCards(profile: Profile): PlaceCard[] {
  const cards: PlaceCard[] = [];
  for (let i = 0; i < profile.cards.length; i++) {
    cards.push(profile.cards[i]);
  }
  cards.sort((a: PlaceCard, b: PlaceCard): number => b.collectedAt - a.collectedAt);
  return cards;
}

/** 最近收录的一张卡 */
export function latestCard(profile: Profile): PlaceCard | undefined {
  const cards: PlaceCard[] = sortedCards(profile);
  return cards.length > 0 ? cards[0] : undefined;
}

/** 稀有卡数量（非 common；与 web rareCount 一致：rare + epic + hidden） */
export function rareCardCount(snapshot: AppSnapshot): number {
  let count: number = 0;
  for (let i = 0; i < snapshot.profile.cards.length; i++) {
    const place: Place | undefined = placeOf(snapshot, snapshot.profile.cards[i].placeID);
    if (place !== undefined && place.rarity !== Rarity.Common) {
      count = count + 1;
    }
  }
  return count;
}

/** 隐藏款数量 */
export function hiddenCardCount(snapshot: AppSnapshot): number {
  let count: number = 0;
  for (let i = 0; i < snapshot.profile.cards.length; i++) {
    const place: Place | undefined = placeOf(snapshot, snapshot.profile.cards[i].placeID);
    if (place !== undefined && place.rarity === Rarity.Hidden) {
      count = count + 1;
    }
  }
  return count;
}

/** 本区：取最近一张卡所在区域，没有卡时按「附近」 */
export function localArea(snapshot: AppSnapshot): Area {
  const card: PlaceCard | undefined = latestCard(snapshot.profile);
  if (card !== undefined) {
    const place: Place | undefined = placeOf(snapshot, card.placeID);
    if (place !== undefined) {
      return place.area;
    }
  }
  return Area.Near;
}

/** 已收集 vs 地点库总数（图鉴统计条） */
export function collectedCount(snapshot: AppSnapshot): number {
  return snapshot.profile.cards.length;
}

export function catalogCount(snapshot: AppSnapshot): number {
  return snapshot.places.length;
}

// ============================================================
// 旅程
// ============================================================

/** 进行中的旅程（walking / arrived / revealed） */
export function activeSession(snapshot: AppSnapshot): QuestSession | undefined {
  const session: QuestSession | undefined = snapshot.session;
  if (session === undefined) {
    return undefined;
  }
  if (
    session.phase === QuestPhase.Walking ||
    session.phase === QuestPhase.Arrived ||
    session.phase === QuestPhase.Revealed
  ) {
    return session;
  }
  return undefined;
}

/** 是否已到达（可展示地点信息） */
export function hasArrived(session: QuestSession | undefined): boolean {
  if (session === undefined) {
    return false;
  }
  return (
    session.phase === QuestPhase.Arrived ||
    session.phase === QuestPhase.Revealed ||
    session.phase === QuestPhase.Collected
  );
}

// ============================================================
// 社交
// ============================================================

/** 动态流：本人发布置顶，其余按时间倒序（与 web/iOS 一致） */
export function sortedFeed(snapshot: AppSnapshot): FeedPost[] {
  const posts: FeedPost[] = [];
  for (let i = 0; i < snapshot.feed.length; i++) {
    posts.push(snapshot.feed[i]);
  }
  posts.sort((a: FeedPost, b: FeedPost): number => {
    if (a.isMine !== b.isMine) {
      return a.isMine ? -1 : 1;
    }
    return b.createdAt - a.createdAt;
  });
  return posts;
}

/** 反应计数（键：eyes / heart / next） */
export function reactionCount(post: FeedPost, key: ReactionKey): number {
  const value: number | undefined = post.reactions[key];
  return value === undefined ? 0 : value;
}

/** 我是否已经点过这个反应 */
export function hasReacted(post: FeedPost, key: ReactionKey): boolean {
  if (post.reacted === undefined) {
    return false;
  }
  return post.reacted[key] === true;
}

/** 反应键 → 展示（👀 / 🫶 / 下次带我） */
export interface ReactionMeta {
  key: ReactionKey;
  icon: string;
  label: string;
}

export function reactionMetas(): ReactionMeta[] {
  const metas: ReactionMeta[] = [
    { key: 'eyes' as ReactionKey, icon: '👀', label: '羡慕' },
    { key: 'heart' as ReactionKey, icon: '🫶', label: '一起' },
    { key: 'next' as ReactionKey, icon: '', label: '下次带我' }
  ];
  return metas;
}

// ============================================================
// 成就
// ============================================================

export function achievementsOf(snapshot: AppSnapshot): Achievement[] {
  const list: Achievement[] = [];
  for (let i = 0; i < snapshot.profile.achievements.length; i++) {
    list.push(snapshot.profile.achievements[i]);
  }
  return list;
}

export function unlockedAchievementCount(snapshot: AppSnapshot): number {
  let count: number = 0;
  const list: Achievement[] = achievementsOf(snapshot);
  for (let i = 0; i < list.length; i++) {
    if (list[i].unlockedAt !== undefined) {
      count = count + 1;
    }
  }
  return count;
}

// ============================================================
// 埋惊喜 / 寻惊喜（本轮只在首页放入口，详情「即将开放」）
// ============================================================

export function explorableSurpriseCount(snapshot: AppSnapshot): number {
  return snapshot.explorableSurprises.length;
}

export function mySurpriseCount(snapshot: AppSnapshot): number {
  return snapshot.mySurprises.length;
}

/**
 * 组装「同步到账号」的整包数据。
 *
 * 结构对齐 Web 版 syncPayload：
 *   { app, version, savedAt, profile, surprises, settings }
 * 其中 profile 是契约 Profile + extras（里程/到达时间/动态/真实地点），
 * 这样「从账号恢复」才能真正把本机状态还原回去。
 */
export function buildSyncPayload(): Record<string, unknown> {
  const snapshot: AppSnapshot = getStore().snapshot();
  const extras: Record<string, unknown> = {};
  try {
    const instance = getStoreInstance();
    const raw = instance.rawExtras();
    extras['totalKm'] = raw.totalKm;
    extras['boxesOpened'] = raw.boxesOpened;
    extras['walkArrivalTimes'] = raw.walkArrivalTimes;
    extras['togetherCount'] = raw.togetherCount;
    extras['realPlaces'] = raw.realPlaces;
    extras['feed'] = raw.feed;
    extras['consolationPaid'] = raw.consolationPaid;
  } catch (err) {
    // 拿不到 extras 也能同步（只同步契约字段）
  }

  // 云端信封的**顶层就是 Profile 字段**（与本地存档同构），
  // 这样 core/persistence.profileFromJson 能直接解回来，不必两套结构。
  const envelope: Record<string, unknown> = profileToJson(snapshot.profile);
  envelope['extras'] = extras;
  envelope['surprises'] = snapshot.explorableSurprises.concat(snapshot.mySurprises);
  envelope['settings'] = {};

  const payload: Record<string, unknown> = {
    app: 'blindwalk',
    version: 1,
    savedAt: Date.now(),
    profile: envelope
  };
  return payload;
}

/** 契约 Profile → 可序列化 JSON（字段名与 persistence.decodeProfile 一致） */
function profileToJson(profile: Profile): Record<string, unknown> {
  const json: Record<string, unknown> = {
    version: 1,
    name: profile.name,
    avatarEmoji: profile.avatarEmoji,
    xp: profile.xp,
    streakDays: profile.streakDays,
    weeklySurprise: profile.weeklySurprise,
    weeklyWindowStart: profile.weeklyWindowStart,
    cards: profile.cards,
    achievements: profile.achievements
  };
  return json;
}

/**
 * 「从账号恢复」：把云端整包写回本机。
 * 只接受结构正确的数据，缺字段一律忽略（不覆盖本机已有内容）。
 */
export function applySyncedPayload(payload: Record<string, unknown>): boolean {
  try {
    const instance = getStoreInstance();
    return instance.applyRemotePayload(payload);
  } catch (err) {
    return false;
  }
}

export function myFoundSurpriseCount(snapshot: AppSnapshot): number {
  let count: number = 0;
  for (let i = 0; i < snapshot.mySurprises.length; i++) {
    if (snapshot.mySurprises[i].found) {
      count = count + 1;
    }
  }
  return count;
}
