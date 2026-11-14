/**
 * 步迷 Walkaholic · HarmonyOS — UI 层与逻辑层的调用契约
 *
 * UI 只允许通过 `getStore()` 拿到唯一的 store 实例，并调用这里声明的方法。
 * 实现文件：core/store.ts（由逻辑层负责）。本文件只有类型声明，不含实现。
 *
 * 数据流（单向）：
 *   UI 交互 → store 方法 → 修改内部状态 → 返回结果
 *   UI 在页面 onPageShow / 交互后调用 store.snapshot() 读取最新状态重绘
 *
 * 这样和苹果版 `@Observable WalkaholicStore` 的语义一致：
 * 每次操作后 UI 重新读 snapshot，不做双向绑定。
 */

import { SourceReport } from './http';
import {
  Achievement,
  Area,
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
  PlaceCard as PlaceCardType,
  Rarity,
  ReactionKey,
  SurpriseFindResult,
  WalkDuration,
} from './types';

/**
 * 步行路线折线（真实模式用于「迷雾路径」视图）。
 * points 是 [lon, lat] 数组（与 GeoJSON / Valhalla shape 一致）；
 * 只在内存里，不持久化（重启后重新规划）。
 */
export interface RoutePolyline {
  points: number[][];
  distanceMeters: number;
  /** 抓取时间戳（超过 10 分钟重新规划） */
  fetchedAt: number;
}

/** UI 读取的只读快照。UI 不得修改其中字段（改状态只能走 store 方法）。 */
export interface AppSnapshot {
  profile: Profile;
  /** 当前/最近一次旅程；undefined 表示没有进行中的盲盒 */
  session?: QuestSession;
  /** 当前旅程对应的地点（到达前 UI 不得展示 name） */
  currentPlace?: Place;
  /**
   * 地点库：内置 24 个 + 本次抽到过的真实地点。
   * 图鉴/首页「上一次的惊喜」用它把 PlaceCard.placeID 还原成完整地点。
   */
  places: Place[];
  /**
   * 揭晓卡编号（如 "0247"）。到达后才有值；到达前为 undefined。
   * UI 在 Reveal 页用它渲染 `No.0247`。
   */
  revealSerial?: string;
  /** 当前地点对应的卡片（收录后才有值，用于「去图鉴看看」跳转） */
  currentCard?: PlaceCardType;
  /** 同频码：好友输入同一个码，各自开盒、结束后交换线索（演示值即可） */
  togetherCode: string;
  /** 抽盒设置 */
  selectedMood: Mood;
  selectedDuration: WalkDuration;
  /** 抽盒区域（可选） */
  selectedArea?: Area;
  /** 最近一次确认位置（抽盒起点 / 真实定位用） */
  lastKnownOrigin?: GeoPoint;
  /** 附近可探索的惊喜（已按距离排序） */
  explorableSurprises: BuriedSurprise[];
  /** 我埋下的惊喜 */
  mySurprises: BuriedSurprise[];
  /**
   * 附近的兴趣点（真实数据源；图鉴「附近的兴趣点」区块用）。
   * 未探索的条目在 UI 上显示为「?」+ 类别 + 距离，点击开始探索。
   * 已探索（已收录卡片）的条目显示为普通卡片。
   */
  nearbyPlaces: Place[];
  /** 圈子动态 */
  feed: FeedPost[];
  /** 排行榜 */
  leaderboard: LeaderboardEntry[];
  /** 是否演示模式（真实定位不可用时为 true，UI 要显式标注「演示」） */
  demoMode: boolean;
  /** 步行路线（真实模式有值；迷雾路径视图用） */
  route?: RoutePolyline;
  /** 数据源状态（失败面板 / 设置页展示） */
  dataSource?: DataSourceStatus;
}

/** 数据源状态（parity.md §1：Key 由后台下发，用户看不到输入框） */
export interface DataSourceStatus {
  /** bundled / pages / admin / none */
  keySource: string;
  /** 高德是否已配置 */
  amapReady: boolean;
  /** 百度是否已配置 */
  baiduReady: boolean;
  /** 高德 / 百度 Key 的掩码（只显示前 4 + 后 4） */
  amapMask: string;
  baiduMask: string;
  /** 上次搜索各源结果（失败面板逐条显示） */
  reports: SourceReport[];
  /** 上次搜索时间 */
  checkedAt: number;
  /** 后台策展地点的条数（pois.json；0 = 没有策展数据） */
  curatedCount: number;
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

export interface WalkaholicStoreApi {
  // ---------- 抽盒 ----------
  /** 选择心情 */
  setMood(mood: Mood): void;
  /** 选择时长 */
  setDuration(duration: WalkDuration): void;
  /** 选择区域：附近 / 河边 / 老城区；不传 = 不限 */
  setArea(area?: Area): void;
  /**
   * 抽一个盲盒并开始旅程（**演示模式专用**：从内置地点库抽）。
   * 真实模式请用 `startQuestWithPlace(place, origin)`，绝不走这里。
   * @param origin 用户真实坐标；不传则用 lastKnownOrigin；都没有则用演示坐标（demoMode = true）
   * @returns 抽到的地点与会话；失败（如地点库为空）返回 undefined
   */
  startQuest(origin?: GeoPoint): DrawResult | undefined;
  /**
   * 用**已经找到的真实地点**开始旅程（真实模式唯一入口）。
   *
   * 为什么单独一个方法：parity.md §2 要求「找不到真实地点就明确失败，绝不虚构兜底」。
   * 若沿用 `startQuest` 从内置地点库抽，就必然会在失败时悄悄给一个虚构地点，
   * 所以真实模式必须由搜索层（core/search.ts）把地点交进来。
   *
   * @param place 真实地点（source ∈ curated/amap/baidu/osm/wiki，必须有 coordinate）
   * @param origin 用户当前位置（算真实距离用）
   */
  startQuestWithPlace(place: Place, origin: GeoPoint): DrawResult | undefined;
  /** 当前旅程的步行路线（迷雾路径视图用；没有规划到路线时为 undefined） */
  setRoute(route?: RoutePolyline): void;
  /** 读取当前路线（UI 绘制用） */
  currentRoute(): RoutePolyline | undefined;
  /** 记录本次搜索的数据源状态（设置页 / 失败面板展示） */
  setDataSourceStatus(status: DataSourceStatus): void;
  /** 当前数据源状态 */
  dataSourceStatus(): DataSourceStatus;
  /**
   * 写入「附近的兴趣点」（图鉴区块用；由 core/nearby.ts 检索后灌入）。
   * 传空数组即清空。只保存内存态，不持久化（每次进图鉴重新拉取）。
   */
  setNearbyPlaces(places: Place[]): void;

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
  /** 圈子：给某条动态加/取消一个反应（乐观 UI 由 UI 层自己做） */
  reactToPost(postID: string, reaction: ReactionKey): void;
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
  getStore(): WalkaholicStoreApi;
}

export { QuestPhase, Rarity };
