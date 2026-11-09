/**
 * 盲走 BlindWalk · HarmonyOS 移植版 —— 核心数据契约
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
  /** 数据来源：catalog = 内置虚构 / osm = OpenStreetMap / apple = 系统地图 / geo = 仅真实坐标 */
  source: string;
}

/** 已收录的卡片 */
export interface PlaceCard {
  id: string;
  placeID: string;
  serial: string;
  collectedAt: number; // 毫秒时间戳
  taskDone: boolean;
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

export interface FeedPost {
  id: string;
  authorName: string;
  authorEmoji: string;
  placeName: string;
  categoryEmoji: string;
  rarity: Rarity;
  caption: string;
  createdAt: number;
  /** 反应计数：羡慕 / 一起 / 下次带我 */
  reactions: Record<string, number>;
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
