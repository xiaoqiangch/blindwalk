/**
 * 盲走 BlindWalk · HarmonyOS — UI 层与逻辑层的调用契约
 *
 * UI 只允许通过 `getStore()` 拿到唯一的 store 实例，并调用这里声明的方法。
 * 实现文件：core/store.ts（由逻辑层负责）。本文件只有类型声明，不含实现。
 *
 * 数据流（单向）：
 *   UI 交互 → store 方法 → 修改内部状态 → 返回结果
 *   UI 在页面 onPageShow / 交互后调用 store.snapshot() 读取最新状态重绘
 *
 * 这样和苹果版 `@Observable BlindWalkStore` 的语义一致：
 * 每次操作后 UI 重新读 snapshot，不做双向绑定。
 */

import {
  Achievement,
  BuriedSurprise,
  FeedPost,
  GeoPoint,
  LeaderboardEntry,
  Mood,
  Place,
  PlaceCard,
  Profile,
  QuestEvent,
  QuestPhase,
  QuestSession,
  Rarity,
  SurpriseFindResult,
  WalkDuration,
} from './types';

/** UI 读取的只读快照。UI 不得修改其中字段（改状态只能走 store 方法）。 */
export interface AppSnapshot {
  profile: Profile;
  /** 当前/最近一次旅程；undefined 表示没有进行中的盲盒 */
  session?: QuestSession;
  /** 当前旅程对应的地点（到达前 UI 不得展示 name） */
  currentPlace?: Place;
  /** 抽盒设置 */
  selectedMood: Mood;
  selectedDuration: WalkDuration;
  /** 最近一次确认位置（抽盒起点 / 真实定位用） */
  lastKnownOrigin?: GeoPoint;
  /** 附近可探索的惊喜（已按距离排序） */
  explorableSurprises: BuriedSurprise[];
  /** 我埋下的惊喜 */
  mySurprises: BuriedSurprise[];
  /** 圈子动态 */
  feed: FeedPost[];
  /** 排行榜 */
  leaderboard: LeaderboardEntry[];
  /** 是否演示模式（真实定位不可用时为 true，UI 要显式标注「演示」） */
  demoMode: boolean;
}

/** 抽盒结果 */
export interface DrawResult {
  place: Place;
  session: QuestSession;
}

/**
 * 本地持久化：HarmonyOS 用 @ohos.data.preferences 实现。
 * 逻辑层只依赖这个接口，方便在 Node 测试里替换成内存实现。
 */
export interface KeyValueStore {
  getString(key: string): string | undefined;
  putString(key: string, value: string): void;
  delete(key: string): void;
}

export interface BlindWalkStoreApi {
  // ---------- 抽盒 ----------
  /** 选择心情 */
  setMood(mood: Mood): void;
  /** 选择时长 */
  setDuration(duration: WalkDuration): void;
  /**
   * 抽一个盲盒并开始旅程。
   * @param origin 用户真实坐标；不传则用 lastKnownOrigin；都没有则用演示坐标（demoMode = true）
   * @returns 抽到的地点与会话；失败（如地点库为空）返回 undefined
   */
  startQuest(origin?: GeoPoint): DrawResult | undefined;

  // ---------- 旅程 ----------
  /** 用剩余距离推进旅程（演示模式 / 模拟步行） */
  updateLocation(distanceMeters: number, bearingDegrees?: number): QuestEvent[];
  /** 用真实 GPS 推进：内部把「当前位置→目的地」换算成剩余距离 */
  updateGeoLocation(origin: GeoPoint): QuestEvent[];
  /** 「我到了」：立即进入到达态 */
  arriveNow(): QuestEvent[];
  /** 播放完揭晓动画 */
  confirmReveal(): void;
  /** 把当前地点收进图鉴，返回结算信息 */
  collectCurrentPlace(): CollectResult | undefined;
  /** 放弃当前旅程 */
  abandonQuest(): void;

  // ---------- 埋惊喜 ----------
  /**
   * 埋下一颗惊喜。
   * @param photoHash 照片 64 位 dHash（逻辑层提供 computeDHash，UI 传图后调用）
   * @param photoUri 照片在应用沙箱内的 URI
   */
  burySurprise(params: BuryParams): BuriedSurprise | undefined;
  /**
   * 比较「寻到的照片」与作者照片，返回相似度与判定。
   * @param seekerHash 寻到者照片的 64 位 dHash
   */
  compareSurprise(surpriseId: string, seekerHash: string): SurpriseCompareResult | undefined;
  /** 结算一次「寻到」：发放双向探索值、标记已找到 */
  completeSurpriseFind(surpriseId: string, similarity: number): SurpriseFindResult | undefined;

  // ---------- 读状态 ----------
  snapshot(): AppSnapshot;

  // ---------- 定位 ----------
  /** 设置最近已知坐标（抽盒起点用） */
  setLastKnownOrigin(origin: GeoPoint): void;
  /** 设置是否演示模式 */
  setDemoMode(demo: boolean): void;
}

export interface CollectResult {
  place: Place;
  card: PlaceCard;
  xpGained: number;
  newAchievements: Achievement[];
}

export interface BuryParams {
  authorName: string;
  authorEmoji: string;
  location: GeoPoint;
  areaWord: string;
  hints: string[];
  photoHash: string;
  photoUri: string;
}

export interface SurpriseCompareResult {
  similarity: number;
  passed: boolean;
}

/** 逻辑层单例入口（实现见 core/store.ts） */
export interface StoreProvider {
  getStore(): BlindWalkStoreApi;
}

export { QuestPhase, Rarity };
