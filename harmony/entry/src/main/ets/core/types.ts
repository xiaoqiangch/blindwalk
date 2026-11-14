/**
 * 步迷 Walkaholic · HarmonyOS 移植版 —— 核心数据契约
 *
 * 这是「逻辑层」与「UI 层」之间唯一的契约文件。
 * 逻辑层（core/*.ts）只依赖这里定义的类型；UI 层只调用 store.ts 的公开 API。
 *
 * 移植来源：apple/Shared/Core/Models.swift（字段一一对应，勿擅自改名）
 *
 * ArkTS 约束（写实现时注意）：
 * - 不使用 any / unknown 泛滥；参数与返回值显式标注类型
 * - 不使用结构类型隐式匹配传入对象字面量（ArkTS 要求显式接口）
 * - 不使用 Function 类型做属性；回调用明确的函数签名
 * - 不使用解构赋值中的默认值嵌套、不使用 as 断言绕过类型
 */

// ============================================================
// 基础枚举
// ============================================================

/** 稀有度：常见 / 稀有 / 史诗 / 隐藏 */
export enum Rarity {
  Common = 'common',
  Rare = 'rare',
  Epic = 'epic',
  Hidden = 'hidden',
}

/** 心情：放空 / 发现 / 热闹 */
export enum Mood {
  Drift = 'drift',
  Discover = 'discover',
  Lively = 'lively',
}

/**
 * 抽盒范围：走路去，还是先开车到附近再走（对应 iOS ExploreScope）
 *
 * 「远程漫游」解决的问题：城市里真正有意思的地方往往不在你楼下。
 * 但直接抽 20 公里外的点，用户没法走过去 ——
 * 所以漫游模式的规则是：**先开车到目的地 1 公里内停车，剩下的路才开始步行探索**。
 */
export enum ExploreScope {
  Walk = 'walk',
  Roam = 'roam',
}

/** 远程漫游下限（米）：低于它就不该用漫游 */
export const ROAM_MIN_METERS: number = 10000;
/** 远程漫游上限（米）：再远就不适合一日往返 */
export const ROAM_MAX_METERS: number = 45000;
/** 停车圈（米）：进入这个半径才开始步行探索，也是线索开始解锁的地方 */
export const PARKING_RADIUS_METERS: number = 1000;
/** 手动「已停车」的容忍半径（米）：停车场 GPS 常飘，给到 2.2 公里 */
export const PARKING_TOLERANCE_METERS: number = 2200;
/** 反过来：手动标记后又把车开走，离开这个半径就自动退回开车段 */
export const DRIVE_RESUME_METERS: number = 3500;

/** 抽到的总里程是否属于「需要先开车」的漫游旅程（旧数据兜底用） */
export function isRoamJourney(totalMeters: number): boolean {
  return totalMeters >= ROAM_MIN_METERS * 0.6;
}

/** 时长：15 / 30 / 60 分钟 */
export enum WalkDuration {
  M15 = 15,
  M30 = 30,
  M60 = 60,
}

/** 区域：附近 / 河边 / 老城区 */
export enum Area {
  Near = 'near',
  River = 'river',
  OldTown = 'oldtown',
}

/** 旅程阶段 */
export enum QuestPhase {
  Idle = 'idle',
  Walking = 'walking',
  Arrived = 'arrived',
  Revealed = 'revealed',
  Collected = 'collected',
}

// ============================================================
// 地理
// ============================================================

/** 真实经纬度（与抽象地图归一化坐标 MapPoint 区分） */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** 抽象地图上的归一化坐标（0…1） */
export interface MapPoint {
  x: number;
  y: number;
}

// ============================================================
// 地点
// ============================================================

/**
 * 一个可以抽到的地点。
 * 注意：`name` 在到达前**绝不能出现在任何 UI 上**（产品核心保密规则）。
 */
export interface Place {
  id: string;
  name: string;
  area: Area;
  category: string;
  emoji: string;
  rarity: Rarity;
  /** 「为什么是这里」两行文案 */
  why: string;
  /** 1 分钟小任务 */
  task: string;
  /** 三阶线索，永不包含地名 */
  hints: string[];
  mapPoint: MapPoint;
  radiusMeters: number;
  /** 真实经纬度（真实地理模式）；内置虚构地点为 undefined */
  coordinate?: GeoPoint;
  /** 真实地址（到达后展示） */
  address?: string;
  /** 实景照片 URL（策展/维基来源有；**到达前不得展示**） */
  photoUrl?: string;
  /** 照片署名（Wikimedia Commons / 高德地图 …） */
  photoCredit?: string;
  /** 一句简介（策展/维基来源有） */
  summary?: string;
  /**
   * 数据来源：
   * - catalog = 内置虚构地点（只用于**显式演示模式**）
   * - curated = 后台人工策展
   * - amap / baidu / osm / wiki = 真实多数据源
   */
  source: string;
}

/** 已收录的卡片 */
export interface PlaceCard {
  id: string;
  placeID: string;
  serial: string;
  collectedAt: number; // 毫秒时间戳
  taskDone: boolean;
  /**
   * 到达时用户自己拍的那张照片（沙箱内绝对路径）。
   * 与埋惊喜的照片同一套存储策略：只留路径，不留二进制。
   */
  photoName?: string;
  /** 同一张照片上传到账号后的路径（如 /api/photos/<placeID>），换机登录也能取回 */
  photoRemotePath?: string;
}

// ============================================================
// 旅程会话
// ============================================================

/** 旅程事件：定位推进产生，UI 据此播放线索解锁 / 到达 / 揭晓 */
export enum QuestEventType {
  HintUnlocked = 'hintUnlocked',
  Arrived = 'arrived',
  Revealed = 'revealed',
}

export interface QuestEvent {
  type: QuestEventType;
  /** 仅 HintUnlocked 有：线索下标 0…2 */
  index?: number;
}

export interface QuestSession {
  id: string;
  placeID: string;
  startedAt: number; // 毫秒时间戳
  totalMeters: number;
  remainingMeters: number;
  phase: QuestPhase;
  /** 已解锁线索数量 0…3 */
  unlockedHintCount: number;
  /** 真实目的地坐标（真实定位模式有值） */
  target?: GeoPoint;
  /** 最近一次定位算出的方位角（度，0 = 正北） */
  currentBearing?: number;
  /**
   * 这一趟是「走路去」还是「远程漫游」。
   *
   * 为什么要存进会话，而不是每次按 `totalMeters` 推断：
   * 漫游放宽后可能抽到 6–8 公里的点，按里程推断会把它当成普通散步，
   * 于是「先开车过去」的整段提示与停车圈判定全部消失 —— 用户会以为自己要走过去。
   */
  scope: ExploreScope;
}

// ============================================================
// 成就 / 社交
// ============================================================

export interface Achievement {
  id: string;
  name: string;
  icon: string;
  detail: string;
  target: number;
  progress: number;
  /** 解锁时间戳；undefined = 未解锁 */
  unlockedAt?: number;
}

/** 圈子反应的三个键（对应 Web 原型的 eyes / heart / next） */
export type ReactionKey = 'eyes' | 'heart' | 'next';

export interface FeedPost {
  id: string;
  authorName: string;
  authorEmoji: string;
  placeName: string;
  categoryEmoji: string;
  rarity: Rarity;
  caption: string;
  createdAt: number;
  /** 反应计数：eyes=羡慕 / heart=一起 / next=下次带我 */
  reactions: Record<string, number>;
  /** 我是否已点过某个反应 */
  reacted?: Record<string, boolean>;
  isMine: boolean;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  emoji: string;
  score: number;
  isMe: boolean;
}

// ============================================================
// 用户
// ============================================================

export interface Profile {
  name: string;
  avatarEmoji: string;
  xp: number;
  /** 连续天数 */
  streakDays: number;
  cards: PlaceCard[];
  achievements: Achievement[];
  /** 本周惊喜值 */
  weeklySurprise: number;
  /** 本周惊喜值最近 7 天窗口起点（毫秒时间戳），用于「本周」口径稳定 */
  weeklyWindowStart: number;
}

// ============================================================
// 埋惊喜 / 寻惊喜（docs/surprise-exchange.md）
// ============================================================

/** 一张「被埋下的照片」：作者在某地拍下，等陌生人来复刻 */
export interface BuriedSurprise {
  id: string;
  /** 作者昵称 */
  authorName: string;
  authorEmoji: string;
  /** 埋点真实坐标 */
  location: GeoPoint;
  /** 地点描述（到达后才知道具体是哪，这里只给区域词） */
  areaWord: string;
  /** 线索三阶，不含地名 */
  hints: string[];
  /** 作者照片的 64 位感知哈希（dHash） */
  photoHash: string;
  /** 作者照片 URI（沙箱内文件路径或 base64）；**寻到之前不给 UI 展示** */
  photoUri: string;
  /** 埋下时间戳 */
  buriedAt: number;
  /** 是否已被我找到 */
  found: boolean;
  /** 我拍的照片 URI（找到后才有） */
  myPhotoUri?: string;
  /** 匹配相似度 0…1 */
  similarity?: number;

  // ---------- 与 iOS BuriedSurprise 对齐的扩展字段（都可选，老存档容错） ----------
  /** 作者写的一句话：为什么埋在这里 */
  message?: string;
  /** 找到半径（米），默认 60 */
  radiusMeters?: number;
  /** 寻者得分（默认 80） */
  seekerPoints?: number;
  /** 作者得分（默认 40） */
  authorPoints?: number;
  /** 被谁找到 */
  finderName?: string;
  /** 被找到的时间戳 */
  foundAt?: number;
  /** 寻者拍的复刻照片 */
  finderPhotoUri?: string;
  /** 本机用户自己埋的（改名后也认得出来） */
  isMine?: boolean;
  /** 已经成功上传到账号服务 */
  isUploaded?: boolean;
  /** 来自账号服务（别人埋的，本机没有原图） */
  isRemote?: boolean;
}

/**
 * 埋惊喜的「被找到」回执。
 *
 * 埋惊喜是「给予」，但之前给完就断了：别人找到你的照片，你永远不知道。
 * 这一层把「被找到」变成一条回执，并在入口上点一个红点。
 * 数据来源：GET /api/surprises/mine（登录用户或匿名设备标识都能查自己的）。
 */
export interface SurpriseReceipt {
  /** 惊喜 id（= BuriedSurprise.id） */
  id: string;
  areaLabel: string;
  finderName: string;
  foundAt: number;
  /** 用户看过这条回执的时间；undefined = 未读（入口红点看它） */
  readAt?: number;
}

/** 走路轨迹点（个人城市地图的数据层） */
export interface WalkPoint {
  latitude: number;
  longitude: number;
  time: number;
}

/** 一次「寻到」的结算结果 */
export interface SurpriseFindResult {
  surprise: BuriedSurprise;
  similarity: number;
  passed: boolean;
  /** 寻到者获得的探索值 */
  seekerXP: number;
  /** 作者获得的探索值 */
  authorXP: number;
}

// ============================================================
// 常量（与苹果版保持一致，改之前先看 docs/status.md 的演示口径）
// ============================================================

export const ARRIVE_THRESHOLD_METERS: number = 30;
export const HINT_THRESHOLDS: number[] = [400, 200, 60];
/** 照片复刻判定阈值：相似度 >= 0.45 算找到 */
export const PHOTO_PASS_THRESHOLD: number = 0.45;
/** 埋下一颗惊喜立即获得的探索值 */
export const XP_BURY: number = 30;
/** 寻到者奖励 */
export const XP_SEEKER: number = 80;
/** 作者奖励 */
export const XP_AUTHOR: number = 40;
/** 没找到的安慰奖（每次惊喜只发一次） */
export const XP_CONSOLATION: number = 10;
