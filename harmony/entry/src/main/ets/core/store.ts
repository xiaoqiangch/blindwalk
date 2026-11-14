/**
 * 步迷 Walkaholic · HarmonyOS 逻辑层 — 全局编排 Store
 *
 * 对应 apple/Shared/Core/WalkaholicStore.swift，但遵循 harmony 的 core/contract.ts：
 * - UI 只通过 `getStore()` 访问；`snapshot()` 同步返回只读快照（浅拷贝数组/对象）
 * - 状态变更 → 保存到注入的 KeyValueStore（profile + surprises）
 * - 保密：到达前 snapshot / 返回值里不出现当前目的地名称（含图鉴地点库里的那一条）
 * - 埋惊喜：埋下 +30、寻到者 +80、作者 +40、未中 +10（每颗只发一次，不能找自己埋的）
 *
 * 额外导出：
 * - `initStore(kv)` / `getStore()`：UI 唯一入口（Lead 约定）
 * - `registerPlaces(places)`：UI 的真实 POI 服务找到地点后注册进来，
 *   snapshot.places 会包含它们，抽盒也可能抽到（`source = 'osm' | 'apple' | 'geo'`）
 */

import { bearing as bearingBetween, distance as distanceBetween, offset as offsetPoint } from './geo';
import {
  Achievement,
  Area,
  BuriedSurprise,
  ExploreScope,
  FeedPost,
  GeoPoint,
  Mood,
  Place,
  PlaceCard,
  Profile,
  QuestEvent,
  QuestPhase,
  LeaderboardEntry,
  QuestSession,
  ReactionKey,
  Rarity,
  SurpriseFindResult,
  SurpriseReceipt,
  WalkDuration,
  WalkPoint,
  XP_AUTHOR,
  XP_BURY,
  XP_CONSOLATION,
  XP_SEEKER,
  isRoamJourney
} from './types';
import {
  AppSnapshot,
  WalkaholicStoreApi,
  BuryParams,
  CardPhoto,
  CollectResult,
  DataSourceStatus,
  DrawResult,
  KeyValueStore,
  RoutePolyline,
  StoreProvider,
  SurpriseCompareResult
} from './contract';
import { SourceReport } from './http';
import {
  PLACES,
  clonePlace,
  leaksPlaceName,
  maskPlaceForWalking,
  placeByID,
  rarityXpBonus,
  scrubHints
} from './catalog';
import {
  BlindBoxDrawResult,
  DrawParams,
  SeededGenerator,
  draw,
  serial
} from './engine';
import {
  SessionUpdate,
  arrowSymbol,
  cloneSession,
  compassCopy,
  confirmReveal,
  createSession,
  forceArrive,
  markCollected,
  nextHintCopy,
  nextHintThreshold,
  progressOf,
  updateGeo
} from './session';
import {
  cloneSurprise,
  exploreSurprises,
  isMySurprise,
  makeClues,
  publicSurprise,
  similarity as photoSimilarity
} from './surprise';
import {
  AchievementContext,
  syncAchievements
} from './achievements';
import { DEMO_ORIGIN, demoState } from './demo';
import {
  DEMO_TOGETHER_CODE,
  cloneLeaderboardEntry,
  clonePost,
  leaderboard,
  mockPosts
} from './social';
import {
  LoadedProfile,
  SURPRISES_KEY,
  StoreExtras,
  loadProfile,
  loadSurprises,
  profileFromJson,
  saveProfile,
  saveSurprises,
  surprisesFromJson
} from './persistence';
import { SurpriseReceiptStore } from './receipts';
import { WalkTrackStore } from './track';

const DAY_MS: number = 86400000;
/** 附近可探索惊喜的最大半径（米） */
const EXPLORE_RADIUS_METERS: number = 5000;
/** 演示惊喜重定位：只在「仍锚在演示点」时做一次 */
const DEMO_RELOCATION_OFFSETS_METERS: number[] = [320, 540, 760];
const DEMO_RELOCATION_BEARINGS: number[] = [24, 118, 300];

// ============================================================
// 拷贝工具（快照必须浅拷贝，避免 UI 持有内部可变引用）
// ============================================================

function cloneGeoPoint(point: GeoPoint): GeoPoint {
  const copy: GeoPoint = { latitude: point.latitude, longitude: point.longitude };
  return copy;
}

function cloneCard(card: PlaceCard): PlaceCard {
  const copy: PlaceCard = {
    id: card.id,
    placeID: card.placeID,
    serial: card.serial,
    collectedAt: card.collectedAt,
    taskDone: card.taskDone
  };
  if (card.photoName !== undefined) copy.photoName = card.photoName;
  if (card.photoRemotePath !== undefined) copy.photoRemotePath = card.photoRemotePath;
  return copy;
}

function cloneCards(cards: PlaceCard[]): PlaceCard[] {
  return cards.map((card: PlaceCard): PlaceCard => cloneCard(card));
}

function cloneAchievements(list: Achievement[]): Achievement[] {
  return list.map((item: Achievement): Achievement => {
    const copy: Achievement = {
      id: item.id,
      name: item.name,
      icon: item.icon,
      detail: item.detail,
      target: item.target,
      progress: item.progress
    };
    if (item.unlockedAt !== undefined) copy.unlockedAt = item.unlockedAt;
    return copy;
  });
}

function cloneProfile(profile: Profile): Profile {
  const copy: Profile = {
    name: profile.name,
    avatarEmoji: profile.avatarEmoji,
    xp: profile.xp,
    streakDays: profile.streakDays,
    cards: cloneCards(profile.cards),
    achievements: cloneAchievements(profile.achievements),
    weeklySurprise: profile.weeklySurprise,
    weeklyWindowStart: profile.weeklyWindowStart
  };
  return copy;
}

function startOfDay(timestamp: number): number {
  const date: Date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** 空的数据源状态（还没搜索过） */
function emptyDataSourceStatus(): DataSourceStatus {
  const status: DataSourceStatus = {
    keySource: 'none',
    amapReady: false,
    baiduReady: false,
    amapMask: '',
    baiduMask: '',
    reports: [],
    checkedAt: 0,
    curatedCount: 0
  };
  return status;
}

// ============================================================
// Store 实现
// ============================================================

export class WalkaholicStore implements WalkaholicStoreApi {
  private kv: KeyValueStore;
  private profile: Profile;
  private extras: StoreExtras;
  private knownPlaces: Place[];
  /** 埋下的惊喜（作者与寻者的双向社区）
   *
   * 与 iOS 一致：远端条目、上传标记、被找到回执都挂在同一份列表上。
   */
  private surprises: BuriedSurprise[];
  private feed: FeedPost[];

  private sessionValue: QuestSession | undefined;
  private currentPlaceValue: Place | undefined;
  private currentCardValue: PlaceCard | undefined;
  private revealSerialValue: string | undefined;
  private selectedMoodValue: Mood;
  private selectedDurationValue: WalkDuration;
  private selectedAreaValue: Area | undefined;
  /** 抽盒范围：走路去 / 远程漫游（持久化，下次打开抽盒页保持选择） */
  private selectedScopeValue: ExploreScope;
  private lastKnownOriginValue: GeoPoint | undefined;
  private demoModeValue: boolean;
  private routeValue: RoutePolyline | undefined;
  private dataSourceValue: DataSourceStatus;
  private nearbyPlacesValue: Place[];
  private drawCounter: number;
  private surpriseCounter: number;
  private seedSurprisesRebased: boolean;
  /** 「被找到」回执（埋惊喜的社交闭环） */
  private receiptStore: SurpriseReceiptStore;
  /** 走路轨迹（个人城市地图的数据层） */
  private trackStore: WalkTrackStore;

  constructor(kv: KeyValueStore) {
    this.kv = kv;
    this.selectedMoodValue = Mood.Drift;
    this.selectedDurationValue = WalkDuration.M30;
    this.selectedAreaValue = undefined;
    this.selectedScopeValue = ExploreScope.Walk;
    this.demoModeValue = true;
    this.routeValue = undefined;
    this.dataSourceValue = emptyDataSourceStatus();
    this.nearbyPlacesValue = [];
    this.drawCounter = 0;
    this.surpriseCounter = 0;
    this.seedSurprisesRebased = false;
    this.sessionValue = undefined;
    this.currentPlaceValue = undefined;
    this.currentCardValue = undefined;
    this.revealSerialValue = undefined;
    this.currentPlaceValue = undefined;
    this.receiptStore = new SurpriseReceiptStore(kv);
    this.trackStore = new WalkTrackStore(kv);

    const now: number = Date.now();
    const loaded: LoadedProfile | undefined = loadProfile(kv);
    const seedDemo: boolean = loaded === undefined;
    const demo = demoState(now);

    if (loaded !== undefined) {
      this.profile = loaded.profile;
      this.extras = loaded.extras;
      // 契约外：恢复上次旅程（原型重启后仍能回到旅程页 / 揭晓页）
      this.sessionValue = loaded.extras.session;
      this.currentPlaceValue = loaded.extras.currentPlace;
      this.revealSerialValue = loaded.extras.revealSerial;
      this.currentCardValue = loaded.extras.currentCard;
      this.selectedScopeValue = loaded.extras.selectedScope;
    } else {
      this.profile = demo.profile;
      this.extras = demo.extras;
      this.sessionValue = demo.session;
      this.currentPlaceValue = placeByID(demo.currentPlaceID);
      this.revealSerialValue = demo.revealSerial;
      this.selectedMoodValue = demo.selectedMood;
      this.selectedDurationValue = demo.selectedDuration;
      this.selectedAreaValue = demo.selectedArea;
      this.lastKnownOriginValue = cloneGeoPoint(demo.lastKnownOrigin);
    }

    this.knownPlaces = this.buildKnownPlaces();
    this.feed = this.buildFeed(now);

    const surprisesRaw: string | undefined = kv.getString(SURPRISES_KEY);
    if (surprisesRaw === undefined && seedDemo) {
      this.surprises = demo.surprises;
    } else {
      this.surprises = loadSurprises(kv);
    }

    this.refreshWeekly(now);
    syncAchievements(this.achievementContext(), now);
    this.persist(now);
  }

  // ---------- 初始化辅助 ----------

  private buildKnownPlaces(): Place[] {
    const list: Place[] = PLACES.map((place: Place): Place => clonePlace(place));
    for (let i = 0; i < this.extras.realPlaces.length; i += 1) {
      const realPlace: Place = this.extras.realPlaces[i];
      let exists: boolean = false;
      for (let j = 0; j < list.length; j += 1) {
        if (list[j].id === realPlace.id) {
          exists = true;
          break;
        }
      }
      if (!exists) list.push(clonePlace(realPlace));
    }
    return list;
  }

  private buildFeed(now: number): FeedPost[] {
    if (this.extras.feed.length > 0) {
      return this.extras.feed.map((post: FeedPost): FeedPost => clonePost(post));
    }
    return mockPosts(now);
  }

  private achievementContext(): AchievementContext {
    const context: AchievementContext = {
      profile: this.profile,
      feed: this.feed,
      surprises: this.surprises,
      totalKm: this.extras.totalKm
    };
    return context;
  }

  private persist(now: number): void {
    this.refreshWeekly(now);
    this.extras.feed = this.feed;
    this.extras.session = this.sessionValue === undefined
      ? undefined
      : cloneSession(this.sessionValue);
    this.extras.currentPlace = this.currentPlaceValue === undefined
      ? undefined
      : clonePlace(this.currentPlaceValue);
    this.extras.revealSerial = this.revealSerialValue;
    this.extras.currentCard = this.currentCardValue === undefined
      ? undefined
      : cloneCard(this.currentCardValue);
    this.extras.selectedScope = this.selectedScopeValue;
    saveProfile(this.kv, this.profile, this.extras);
    saveSurprises(this.kv, this.surprises);
  }

  // ---------- 抽盒设置 ----------

  setMood(mood: Mood): void {
    this.selectedMoodValue = mood;
  }

  setDuration(duration: WalkDuration): void {
    this.selectedDurationValue = duration;
  }

  setArea(area?: Area): void {
    this.selectedAreaValue = area;
  }

  /** 抽盒范围：走路去 / 远程漫游（落盘，下次打开保持） */
  setScope(scope: ExploreScope): void {
    if (this.selectedScopeValue === scope) return;
    this.selectedScopeValue = scope;
    this.persist(Date.now());
  }

  /** 当前抽盒范围 */
  selectedScope(): ExploreScope {
    return this.selectedScopeValue;
  }

  // ---------- 抽盒 ----------

  startQuest(origin?: GeoPoint): DrawResult | undefined {
    const now: number = Date.now();
    const recent: Set<string> = this.recentPlaceIDs(now);

    this.drawCounter += 1;
    const seed: number = now + this.drawCounter;

    const params: DrawParams = {
      catalog: this.knownPlaces,
      mood: this.selectedMoodValue,
      duration: this.selectedDurationValue,
      area: this.selectedAreaValue,
      recentPlaceIDs: recent,
      seed: seed
    };
    const drawResult: BlindBoxDrawResult | undefined = draw(params);
    if (drawResult === undefined) return undefined;

    let resolvedOrigin: GeoPoint | undefined = origin;
    if (resolvedOrigin === undefined) resolvedOrigin = this.lastKnownOriginValue;
    if (resolvedOrigin === undefined) {
      // 契约：都没有则用演示坐标（demoMode = true）
      resolvedOrigin = cloneGeoPoint(DEMO_ORIGIN);
      this.demoModeValue = true;
    }

    const bearingGenerator: SeededGenerator = new SeededGenerator(seed + 0xA5A5);
    const bearingDegrees: number = bearingGenerator.nextInt(360);
    const target: GeoPoint = this.geoOffset(resolvedOrigin, drawResult.startMeters, bearingDegrees);

    const session: QuestSession = createSession(
      drawResult.place.id, now, drawResult.startMeters, target, bearingDegrees
    );
    this.sessionValue = session;
    this.currentPlaceValue = drawResult.place;
    this.currentCardValue = undefined;
    this.revealSerialValue = serial(seed);
    this.persist(now);

    const maskedPlace: Place = maskPlaceForWalking(drawResult.place);
    const result: DrawResult = { place: maskedPlace, session: cloneSession(session) };
    return result;
  }

  /**
   * 用已经找到的真实地点开始旅程（真实模式唯一入口）。
   *
   * 校验：必须有真实来源 + 真实坐标 —— 这正是「绝不虚构兜底」的闸门。
   * 返回 undefined 表示上游给了不合规的地点（调用方应显示失败面板，而不是继续走）。
   */
  startQuestWithPlace(place: Place, origin: GeoPoint, scope?: ExploreScope): DrawResult | undefined {
    if (!isRealPlaceSource(place.source)) return undefined;
    if (place.coordinate === undefined) return undefined;
    if (!isFinite(origin.latitude) || !isFinite(origin.longitude)) return undefined;

    const now: number = Date.now();
    // 真实距离：当前位置 → 目的地；太近会一开盒就到达，所以下限 120 米
    let meters: number = distanceBetween(origin, place.coordinate);
    if (meters < 120) meters = 120;
    const bearingDegrees: number = bearingBetween(origin, place.coordinate);
    // 范围：调用方没指定时按「这次抽盒选的范围」，旧调用按里程兜底
    let resolvedScope: ExploreScope = scope === undefined ? this.selectedScopeValue : scope;
    if (scope === undefined && isRoamJourney(Math.round(meters))) {
      resolvedScope = ExploreScope.Roam;
    }

    const session: QuestSession = createSession(
      place.id, now, Math.round(meters), place.coordinate, bearingDegrees, resolvedScope
    );
    this.sessionValue = session;
    this.currentPlaceValue = clonePlace(place);
    this.currentCardValue = undefined;
    this.drawCounter += 1;
    this.revealSerialValue = serial(now + this.drawCounter);
    this.demoModeValue = false;
    this.routeValue = undefined;
    this.persist(now);

    const result: DrawResult = {
      place: clonePlace(place),
      session: cloneSession(session)
    };
    return result;
  }

  /** 记录本次搜索的数据源状态（设置页 / 失败面板展示） */
  setDataSourceStatus(status: DataSourceStatus): void {
    this.dataSourceValue = cloneDataSourceStatus(status);
  }

  /** 当前数据源状态 */
  dataSourceStatus(): DataSourceStatus {
    return cloneDataSourceStatus(this.dataSourceValue);
  }

  /** 写入附近的兴趣点（内存态，不持久化） */
  setNearbyPlaces(places: Place[]): void {
    const copy: Place[] = [];
    for (let i = 0; i < places.length; i += 1) {
      copy.push(clonePlace(places[i]));
    }
    this.nearbyPlacesValue = copy;
  }

  /** 设置步行路线（迷雾路径视图用；传 undefined 清除） */
  setRoute(route?: RoutePolyline): void {
    if (route === undefined) {
      this.routeValue = undefined;
      return;
    }
    const points: number[][] = [];
    for (let i = 0; i < route.points.length; i += 1) {
      points.push([route.points[i][0], route.points[i][1]]);
    }
    this.routeValue = {
      points: points,
      distanceMeters: route.distanceMeters,
      fetchedAt: route.fetchedAt
    };
  }

  /** 供账号同步：把运行时 extras 暴露成只读结构（克隆一份，UI 不能改内部状态） */
  rawExtras(): StoreExtras {
    const copy: StoreExtras = {
      totalKm: this.extras.totalKm,
      boxesOpened: this.extras.boxesOpened,
      walkArrivalTimes: this.extras.walkArrivalTimes.slice(),
      togetherCount: this.extras.togetherCount,
      feed: this.extras.feed.slice(),
      realPlaces: this.extras.realPlaces.slice(),
      consolationPaid: this.extras.consolationPaid.slice(),
      selectedScope: this.extras.selectedScope
    };
    if (this.extras.lastWalkAt !== undefined) copy.lastWalkAt = this.extras.lastWalkAt;
    return copy;
  }

  /**
   * 「从账号恢复」：把云端整包写回本机（覆盖）。
   *
   * 只接受结构正确的数据；缺字段保留本机值。
   * 返回 false = 数据不可用（UI 提示「账号里还没有数据」）。
   */
  applyRemotePayload(payload: Record<string, unknown>): boolean {
    const profileValue: unknown = payload['profile'];
    if (typeof profileValue !== 'object' || profileValue === null) return false;
    let envelope: Record<string, unknown> = profileValue as Record<string, unknown>;

    // 兼容两种信封：
    //   A) Web 版 syncPayload： { profile: { profile: {...}, surprises, settings } }
    //   B) 扁平版（本端 buildSyncPayload）：{ profile: { xp, cards, extras, ... } }
    const innerProfile: unknown = envelope['profile'];
    if (typeof innerProfile === 'object' && innerProfile !== null) {
      envelope = innerProfile as Record<string, unknown>;
    }

    const xp: unknown = envelope['xp'];
    if (typeof xp !== 'number' || !isFinite(xp)) return false;

    const persisted: LoadedProfile | undefined = profileFromJson(JSON.stringify(envelope));
    if (persisted === undefined) return false;

    this.profile = persisted.profile;
    this.extras = persisted.extras;
    const rawSurprises: unknown = envelope['surprises'];
    if (Array.isArray(rawSurprises)) {
      const parsed: BuriedSurprise[] | undefined = surprisesFromJson(JSON.stringify(rawSurprises));
      if (parsed !== undefined) this.surprises = parsed;
    }
    this.refreshWeekly(Date.now());
    syncAchievements(this.achievementContext(), Date.now());
    this.persist(Date.now());
    return true;
  }

  /** 当前路线 */
  currentRoute(): RoutePolyline | undefined {
    const route: RoutePolyline | undefined = this.routeValue;
    if (route === undefined) return undefined;
    const points: number[][] = [];
    for (let i = 0; i < route.points.length; i += 1) {
      points.push([route.points[i][0], route.points[i][1]]);
    }
    const copy: RoutePolyline = {
      points: points,
      distanceMeters: route.distanceMeters,
      fetchedAt: route.fetchedAt
    };
    return copy;
  }

  private geoOffset(origin: GeoPoint, meters: number, bearingDegrees: number): GeoPoint {
    // 局部引入避免顶部循环依赖（geo 是纯函数模块，这里直接调用）
    const point: GeoPoint = offsetPoint(origin, meters, bearingDegrees);
    return point;
  }

  private recentPlaceIDs(now: number): Set<string> {
    const recent: Set<string> = new Set<string>();
    for (let i = 0; i < this.profile.cards.length; i += 1) {
      const card: PlaceCard = this.profile.cards[i];
      if (now - card.collectedAt < 7 * DAY_MS) recent.add(card.placeID);
    }
    return recent;
  }

  // ---------- 旅程 ----------

  updateLocation(distanceMeters: number, bearingDegrees?: number): QuestEvent[] {
    const session: QuestSession | undefined = this.sessionValue;
    if (session === undefined) return [];
    if (session.phase !== QuestPhase.Walking) return [];
    const update: SessionUpdate = updateGeo(session, distanceMeters, bearingDegrees);
    this.sessionValue = update.session;
    this.persist(Date.now());
    return update.events;
  }

  updateGeoLocation(origin: GeoPoint): QuestEvent[] {
    this.setLastKnownOrigin(origin);
    const session: QuestSession | undefined = this.sessionValue;
    if (session === undefined || session.phase !== QuestPhase.Walking) return [];
    if (session.target === undefined) return [];
    const remaining: number = distanceBetween(origin, session.target);
    const bearingDegrees: number = bearingBetween(origin, session.target);
    return this.updateLocation(remaining, bearingDegrees);
  }

  arriveNow(): QuestEvent[] {
    const session: QuestSession | undefined = this.sessionValue;
    if (session === undefined || session.phase !== QuestPhase.Walking) return [];
    const update: SessionUpdate = forceArrive(session);
    this.sessionValue = update.session;
    this.persist(Date.now());
    return update.events;
  }

  confirmReveal(): void {
    const session: QuestSession | undefined = this.sessionValue;
    if (session === undefined) return;
    this.sessionValue = confirmReveal(session);
    this.persist(Date.now());
  }

  collectCurrentPlace(): CollectResult | undefined {
    const session: QuestSession | undefined = this.sessionValue;
    const place: Place | undefined = this.currentPlaceValue;
    if (session === undefined || place === undefined) return undefined;
    if (session.phase !== QuestPhase.Arrived && session.phase !== QuestPhase.Revealed) return undefined;

    const now: number = Date.now();
    const serialText: string = this.revealSerialValue === undefined
      ? serial(now)
      : this.revealSerialValue;
    const card: PlaceCard = {
      id: 'card-' + serialText + '-' + String(now),
      placeID: place.id,
      serial: serialText,
      collectedAt: now,
      taskDone: false
    };
    // 同一个地方只收一次：重复收录会让「图鉴已收集」数字虚高
    let alreadyCollected: boolean = false;
    for (let i = 0; i < this.profile.cards.length; i += 1) {
      if (this.profile.cards[i].placeID === place.id) {
        alreadyCollected = true;
        break;
      }
    }
    if (!alreadyCollected) this.profile.cards.push(card);
    // 收录时把这个真实地点记进目录并落盘：否则下次打开图鉴就查不到这个 id
    this.rememberPlaceInternal(place);
    this.profile.xp += 40 + rarityXpBonus(place.rarity);
    this.extras.boxesOpened += 1;
    this.extras.totalKm = Math.round((this.extras.totalKm + session.totalMeters / 1000) * 10) / 10;
    this.extras.walkArrivalTimes.push(now);
    if (this.extras.walkArrivalTimes.length > 100) {
      this.extras.walkArrivalTimes.shift();
    }
    this.updateStreak(now);

    this.currentCardValue = card;
    this.sessionValue = markCollected(session);
    const newAchievements = syncAchievements(this.achievementContext(), now);
    this.persist(now);

    const xpGained: number = 40 + rarityXpBonus(place.rarity);
    const result: CollectResult = {
      place: clonePlace(place),
      card: cloneCard(card),
      xpGained: xpGained,
      newAchievements: cloneAchievements(newAchievements)
    };
    return result;
  }

  abandonQuest(): void {
    this.routeValue = undefined;
    this.sessionValue = undefined;
    this.currentPlaceValue = undefined;
    this.currentCardValue = undefined;
    this.revealSerialValue = undefined;
    this.persist(Date.now());
  }

  /** 记下一个真实地点（收录 / 抽盒 / 探秘时调用），并持久化 */
  private rememberPlaceInternal(place: Place): void {
    if (place.coordinate === undefined) return;
    let exists: boolean = false;
    for (let i = 0; i < this.knownPlaces.length; i += 1) {
      if (this.knownPlaces[i].id === place.id) {
        exists = true;
        break;
      }
    }
    if (!exists) this.knownPlaces.push(clonePlace(place));
    if (place.source === 'catalog') return;
    let persisted: boolean = false;
    for (let i = 0; i < this.extras.realPlaces.length; i += 1) {
      if (this.extras.realPlaces[i].id === place.id) {
        persisted = true;
        break;
      }
    }
    if (!persisted) this.extras.realPlaces.push(clonePlace(place));
  }

  /**
   * 清除本机数据（「清除演示数据」）。
   * 与 iOS `WalkaholicStore.reset()` 一致：卡片、成就、动态、惊喜、回执、轨迹全部清空。
   */
  reset(now?: number): void {
    const timestamp: number = now === undefined ? Date.now() : now;
    const emptyProfile: Profile = {
      name: '阿澈',
      avatarEmoji: '🫥',
      xp: 0,
      streakDays: 0,
      cards: [],
      achievements: [],
      weeklySurprise: 0,
      weeklyWindowStart: timestamp
    };
    const emptyExtras: StoreExtras = {
      totalKm: 0,
      boxesOpened: 0,
      walkArrivalTimes: [],
      togetherCount: 0,
      feed: [],
      realPlaces: [],
      consolationPaid: [],
      selectedScope: ExploreScope.Walk
    };
    this.profile = emptyProfile;
    this.extras = emptyExtras;
    this.feed = [];
    this.surprises = [];
    this.sessionValue = undefined;
    this.currentPlaceValue = undefined;
    this.currentCardValue = undefined;
    this.revealSerialValue = undefined;
    this.routeValue = undefined;
    this.nearbyPlacesValue = [];
    this.knownPlaces = PLACES.map((place: Place): Place => clonePlace(place));
    this.receiptStore.removeAll();
    this.trackStore.clear();
    this.persist(timestamp);
  }

  // ---------- 埋惊喜 / 寻惊喜 ----------

  burySurprise(params: BuryParams): BuriedSurprise | undefined {
    if (params.photoHash.length === 0 || params.photoUri.length === 0) return undefined;
    const now: number = Date.now();
    this.surpriseCounter += 1;
    const authorName: string = params.authorName.length > 0 ? params.authorName : this.profile.name;
    const authorEmoji: string = params.authorEmoji.length > 0
      ? params.authorEmoji
      : this.profile.avatarEmoji;
    const hints: string[] = params.hints.length > 0 ? params.hints.slice() : makeClues(undefined);
    const message: string = params.message === undefined ? '' : params.message;
    const surprise: BuriedSurprise = {
      id: 'surprise-' + String(now) + '-' + String(this.surpriseCounter),
      authorName: authorName,
      authorEmoji: authorEmoji,
      location: cloneGeoPoint(params.location),
      areaWord: params.areaWord,
      hints: hints,
      photoHash: params.photoHash,
      photoUri: params.photoUri,
      buriedAt: now,
      found: false,
      message: message,
      radiusMeters: params.radiusMeters === undefined ? 60 : params.radiusMeters,
      seekerPoints: XP_SEEKER,
      authorPoints: XP_AUTHOR,
      isMine: true,
      isUploaded: false,
      isRemote: false
    };
    this.surprises.unshift(surprise);
    this.profile.xp += XP_BURY;
    syncAchievements(this.achievementContext(), now);
    this.persist(now);
    return cloneSurprise(surprise);
  }

  // ---------- 到达实拍（卡片照片） ----------

  /**
   * 把到达时拍的照片挂到卡片上。
   * 「先拍照再收进图鉴」和「先收进图鉴再补拍」都会走这里。
   */
  attachCardPhoto(placeID: string, photoName?: string, remotePath?: string): void {
    let index: number = -1;
    for (let i = 0; i < this.profile.cards.length; i += 1) {
      if (this.profile.cards[i].placeID === placeID) {
        index = i;
        break;
      }
    }
    if (index < 0) return;
    if (photoName !== undefined && photoName.length > 0) {
      this.profile.cards[index].photoName = photoName;
    }
    if (remotePath !== undefined && remotePath.length > 0) {
      this.profile.cards[index].photoRemotePath = remotePath;
    }
    this.persist(Date.now());
  }

  /** 这张卡到达时拍的照片（本地文件名 / 远端路径）；都没有返回 undefined */
  cardPhoto(placeID: string): CardPhoto | undefined {
    for (let i = 0; i < this.profile.cards.length; i += 1) {
      const card: PlaceCard = this.profile.cards[i];
      if (card.placeID !== placeID) continue;
      if (card.photoName === undefined && card.photoRemotePath === undefined) return undefined;
      const photo: CardPhoto = {
        local: card.photoName,
        remote: card.photoRemotePath
      };
      return photo;
    }
    return undefined;
  }

  // ---------- 远端惊喜（跨用户共享） ----------

  /**
   * 服务端回来的「附近惊喜」合并进本机：
   * - 远端条目替换掉上一次的远端条目（保留本机自己埋的、和已经被找到的）
   * - 已经找到的远端惊喜不会因为服务端还在 waiting 而复活
   */
  mergeRemoteSurprises(remote: BuriedSurprise[]): void {
    const kept: BuriedSurprise[] = [];
    for (let i = 0; i < this.surprises.length; i += 1) {
      if (this.surprises[i].isRemote !== true) kept.push(this.surprises[i]);
    }
    const known: Set<string> = new Set<string>();
    for (let i = 0; i < kept.length; i += 1) known.add(kept[i].id);
    let added: boolean = false;
    for (let i = 0; i < remote.length; i += 1) {
      const incoming: BuriedSurprise = remote[i];
      if (known.has(incoming.id)) continue;
      kept.push(incoming);
      known.add(incoming.id);
      added = true;
    }
    this.surprises = kept;
    if (added) saveSurprises(this.kv, this.surprises);
  }

  /** 待上传（本机刚埋、还没成功传到服务端的） */
  pendingUploadSurprises(): BuriedSurprise[] {
    const list: BuriedSurprise[] = [];
    for (let i = 0; i < this.surprises.length; i += 1) {
      const item: BuriedSurprise = this.surprises[i];
      if (item.isMine === true && !item.found && item.isUploaded !== true && item.isRemote !== true) {
        list.push(cloneSurprise(item));
      }
    }
    return list;
  }

  /** 标记本机某条惊喜已上传到账号服务 */
  markSurpriseUploaded(surpriseID: string): void {
    for (let i = 0; i < this.surprises.length; i += 1) {
      if (this.surprises[i].id === surpriseID) {
        this.surprises[i].isUploaded = true;
        saveSurprises(this.kv, this.surprises);
        return;
      }
    }
  }

  /**
   * 服务端回来的「被找到」回执：更新本机记录 + 维护入口红点。
   * 返回是否出现了新的未读回执。
   */
  applyReceipts(remote: SurpriseReceipt[]): boolean {
    if (remote.length === 0) return false;
    // 本机的惊喜同步成「已被找到」：作者在自己的列表里能看到寻者与时间
    let changed: boolean = false;
    for (let i = 0; i < remote.length; i += 1) {
      const receipt: SurpriseReceipt = remote[i];
      for (let j = 0; j < this.surprises.length; j += 1) {
        const item: BuriedSurprise = this.surprises[j];
        if (item.id !== receipt.id) continue;
        if (!item.found || item.finderName !== receipt.finderName) {
          item.found = true;
          item.finderName = receipt.finderName;
          item.foundAt = receipt.foundAt;
          changed = true;
        }
        break;
      }
    }
    if (changed) saveSurprises(this.kv, this.surprises);
    const merged = this.receiptStore.merge(remote);
    return merged.hasNew;
  }

  /** 用户看过了「我的惊喜」：红点熄灭 */
  markReceiptsRead(now?: number): void {
    this.receiptStore.markAllRead(now === undefined ? Date.now() : now);
  }

  /** 全部回执（按被找到时间倒序） */
  receipts(): SurpriseReceipt[] {
    return this.receiptStore.all();
  }

  /** 未读回执数（首页入口红点 / 数字用） */
  unreadReceiptCount(): number {
    return this.receiptStore.unreadCount();
  }

  /** 最近一条未读回执（卡片上写「被谁找到了」） */
  latestUnreadReceipt(): SurpriseReceipt | undefined {
    return this.receiptStore.latestUnread();
  }

  /** 走路轨迹仓库（个人城市地图 / 旅程页记录用） */
  track(): WalkTrackStore {
    return this.trackStore;
  }

  compareSurprise(surpriseId: string, seekerHash: string): SurpriseCompareResult | undefined {
    const target: BuriedSurprise | undefined = this.findSurprise(surpriseId);
    if (target === undefined) return undefined;
    const similarityValue: number = photoSimilarity(target.photoHash, seekerHash);
    const result: SurpriseCompareResult = {
      similarity: similarityValue,
      passed: similarityValue >= 0.45
    };
    return result;
  }

  completeSurpriseFind(surpriseId: string, similarityValue: number): SurpriseFindResult | undefined {
    const target: BuriedSurprise | undefined = this.findSurprise(surpriseId);
    if (target === undefined) return undefined;
    // 防刷 1：同一颗只能结算一次
    if (target.found) return undefined;
    // 防刷 2：不能找自己埋的
    if (isMySurprise(target, this.profile.name)) return undefined;

    const now: number = Date.now();
    const passed: boolean = similarityValue >= 0.45;
    target.similarity = similarityValue;

    let seekerXP: number = 0;
    let authorXP: number = 0;

    if (passed) {
      target.found = true;
      seekerXP = XP_SEEKER;
      authorXP = XP_AUTHOR;
      this.profile.xp += seekerXP;
      // 作者不在本机档案里（本地优先、无后端），authorXP 只体现在结算结果中。
      syncAchievements(this.achievementContext(), now);
    } else if (!this.hasConsolationPaid(surpriseId)) {
      this.extras.consolationPaid.push(surpriseId);
      seekerXP = XP_CONSOLATION;
      this.profile.xp += seekerXP;
    }

    this.persist(now);

    const returnedSurprise: BuriedSurprise = passed
      ? cloneSurprise(target)
      : publicSurprise(target);
    const result: SurpriseFindResult = {
      surprise: returnedSurprise,
      similarity: similarityValue,
      passed: passed,
      seekerXP: seekerXP,
      authorXP: authorXP
    };
    return result;
  }

  private hasConsolationPaid(surpriseId: string): boolean {
    return this.extras.consolationPaid.indexOf(surpriseId) >= 0;
  }

  private findSurprise(surpriseId: string): BuriedSurprise | undefined {
    for (let i = 0; i < this.surprises.length; i += 1) {
      if (this.surprises[i].id === surpriseId) return this.surprises[i];
    }
    return undefined;
  }

  /** 发布动态到圈子（本人置顶；与 iOS WalkaholicStore.share 一致） */
  share(caption: string, now?: number): FeedPost | undefined {
    const place: Place | undefined = this.currentPlaceValue;
    if (place === undefined) return undefined;
    const timestamp: number = now === undefined ? Date.now() : now;
    const post: FeedPost = {
      id: 'post-' + String(timestamp) + '-' + String(this.drawCounter),
      authorName: this.profile.name,
      authorEmoji: this.profile.avatarEmoji,
      placeName: place.name,
      categoryEmoji: place.emoji,
      rarity: place.rarity,
      caption: caption,
      createdAt: timestamp,
      reactions: { eyes: 0, heart: 0, next: 0 },
      reacted: { eyes: false, heart: false, next: false },
      isMine: true
    };
    this.feed.unshift(post);
    this.profile.xp += 5;
    syncAchievements(this.achievementContext(), timestamp);
    this.persist(timestamp);
    return clonePost(post);
  }

  // ---------- 圈子 ----------

  reactToPost(postID: string, reaction: ReactionKey): void {
    let target: FeedPost | undefined = undefined;
    for (let i = 0; i < this.feed.length; i += 1) {
      if (this.feed[i].id === postID) {
        target = this.feed[i];
        break;
      }
    }
    if (target === undefined) return;
    if (target.reacted === undefined) {
      const initial: Record<string, boolean> = { eyes: false, heart: false, next: false };
      target.reacted = initial;
    }
    const reacted: Record<string, boolean> = target.reacted;
    const key: string = reaction;
    const current: number = target.reactions[key] === undefined ? 0 : target.reactions[key];
    if (reacted[key] === true) {
      reacted[key] = false;
      target.reactions[key] = Math.max(0, current - 1);
    } else {
      reacted[key] = true;
      target.reactions[key] = current + 1;
    }
    this.persist(Date.now());
  }

  // ---------- 快照 ----------

  snapshot(): AppSnapshot {
    const now: number = Date.now();
    this.refreshWeekly(now);
    const session: QuestSession | undefined = this.sessionValue;
    const place: Place | undefined = this.currentPlaceValue;
    const walking: boolean = session !== undefined && session.phase === QuestPhase.Walking;

    const snapshotProfile: Profile = cloneProfile(this.profile);
    const places: Place[] = [];
    // 保密：只在「这个地点还没被收录」时遮住名称。
    // 已经在图鉴里的地点（比如演示态正在走的 river-steps）本来就在回忆册里，
    // 它的名字不是剧透；遮掉反而会让图鉴出现空白卡。
    const destinationCollected: boolean = place === undefined
      ? false
      : this.isPlaceCollected(place.id);
    for (let i = 0; i < this.knownPlaces.length; i += 1) {
      const item: Place = this.knownPlaces[i];
      if (walking && place !== undefined && item.id === place.id && !destinationCollected) {
        places.push(maskPlaceForWalking(item));
      } else {
        places.push(clonePlace(item));
      }
    }

    const snapshot: AppSnapshot = {
      profile: snapshotProfile,
      places: places,
      togetherCode: DEMO_TOGETHER_CODE,
      selectedMood: this.selectedMoodValue,
      selectedDuration: this.selectedDurationValue,
      selectedScope: this.selectedScopeValue,
      explorableSurprises: this.explorableSurpriseList(),
      mySurprises: this.mySurpriseList(),
      foundSurprises: this.foundSurpriseList(),
      nearbyPlaces: this.nearbyPlaceList(),
      feed: this.snapshotFeed(walking, place, destinationCollected),
      leaderboard: leaderboard(this.profile).map(
        (entry: LeaderboardEntry): LeaderboardEntry => cloneLeaderboardEntry(entry)
      ),
      demoMode: this.demoModeValue,
      dataSource: cloneDataSourceStatus(this.dataSourceValue),
      receipts: this.receiptStore.all(),
      unreadReceiptCount: this.receiptStore.unreadCount(),
      totalKm: this.extras.totalKm,
      boxesOpened: this.extras.boxesOpened
    };

    if (session !== undefined) snapshot.session = cloneSession(session);
    if (place !== undefined) {
      snapshot.currentPlace = walking ? maskPlaceForWalking(place) : clonePlace(place);
    }
    if (this.selectedAreaValue !== undefined) snapshot.selectedArea = this.selectedAreaValue;
    if (this.lastKnownOriginValue !== undefined) {
      snapshot.lastKnownOrigin = cloneGeoPoint(this.lastKnownOriginValue);
    }
    if (!walking && session !== undefined && this.revealSerialValue !== undefined) {
      snapshot.revealSerial = this.revealSerialValue;
    }
    if (this.currentCardValue !== undefined) {
      snapshot.currentCard = cloneCard(this.currentCardValue);
    }
    const route: RoutePolyline | undefined = this.currentRoute();
    if (route !== undefined) snapshot.route = route;
    return snapshot;
  }

  private nearbyPlaceList(): Place[] {
    const list: Place[] = [];
    for (let i = 0; i < this.nearbyPlacesValue.length; i += 1) {
      list.push(clonePlace(this.nearbyPlacesValue[i]));
    }
    return list;
  }

  private isPlaceCollected(placeID: string): boolean {
    for (let i = 0; i < this.profile.cards.length; i += 1) {
      if (this.profile.cards[i].placeID === placeID) return true;
    }
    return false;
  }

  private snapshotFeed(
    walking: boolean,
    place: Place | undefined,
    destinationCollected: boolean
  ): FeedPost[] {
    const list: FeedPost[] = this.feed.map((post: FeedPost): FeedPost => clonePost(post));
    if (!walking || place === undefined || destinationCollected) return list;
    // 保密：到达前，若好友动态里恰好提到当前目的地，也不能出现在快照 JSON 里
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].placeName === place.name) {
        list[i].placeName = '某处';
      }
    }
    return list;
  }

  private mySurpriseList(): BuriedSurprise[] {
    const list: BuriedSurprise[] = [];
    for (let i = 0; i < this.surprises.length; i += 1) {
      if (isMySurprise(this.surprises[i], this.profile.name)) {
        list.push(cloneSurprise(this.surprises[i]));
      }
    }
    return list;
  }

  /** 我找到的别人的惊喜（已找到 + 寻者是我） */
  private foundSurpriseList(): BuriedSurprise[] {
    const list: BuriedSurprise[] = [];
    for (let i = 0; i < this.surprises.length; i += 1) {
      const item: BuriedSurprise = this.surprises[i];
      if (!item.found) continue;
      if (isMySurprise(item, this.profile.name)) continue;
      if (item.finderName === undefined || item.finderName !== this.profile.name) continue;
      list.push(cloneSurprise(item));
    }
    return list;
  }

  private explorableSurpriseList(): BuriedSurprise[] {
    const origin: GeoPoint = this.lastKnownOriginValue === undefined
      ? DEMO_ORIGIN
      : this.lastKnownOriginValue;
    const list: BuriedSurprise[] = exploreSurprises(
      this.surprises, origin, this.profile.name, EXPLORE_RADIUS_METERS
    );
    // 先拍后看：未找到前不返回作者照片 URI
    return list.map((item: BuriedSurprise): BuriedSurprise => publicSurprise(item));
  }

  // ---------- 定位 ----------

  setLastKnownOrigin(origin: GeoPoint): void {
    this.lastKnownOriginValue = cloneGeoPoint(origin);
    this.rebaseSeedSurprises(origin);
  }

  setDemoMode(demo: boolean): void {
    this.demoModeValue = demo;
  }

  /** 追加真实地点到地点库（抽盒候选 + 图鉴还原 + 持久化） */
  registerPlaces(places: Place[]): void {
    for (let i = 0; i < places.length; i += 1) {
      const incoming: Place = places[i];
      if (incoming.id.length === 0) continue;
      let exists: boolean = false;
      for (let j = 0; j < this.knownPlaces.length; j += 1) {
        if (this.knownPlaces[j].id === incoming.id) {
          exists = true;
          break;
        }
      }
      if (exists) continue;
      const copy: Place = clonePlace(incoming);
      this.knownPlaces.push(copy);
      if (incoming.source !== 'catalog') {
        this.extras.realPlaces.push(clonePlace(incoming));
      }
    }
    this.persist(Date.now());
  }

  /**
   * 真机上用户几乎不会正好在上海人民广场：
   * 首次拿到真实定位时，把「还没被人动过」的演示惊喜整体平移到用户附近，
   * 保证「320 米外有一个惊喜」在杭州 / 成都也同样成立（与苹果版一致）。
   */
  private rebaseSeedSurprises(origin: GeoPoint): void {
    if (this.seedSurprisesRebased) return;
    this.seedSurprisesRebased = true;

    const candidates: BuriedSurprise[] = [];
    for (let i = 0; i < this.surprises.length; i += 1) {
      const item: BuriedSurprise = this.surprises[i];
      if (!item.found && !isMySurprise(item, this.profile.name)) candidates.push(item);
    }
    if (candidates.length === 0) return;

    let allAtAnchor: boolean = true;
    for (let i = 0; i < candidates.length; i += 1) {
      if (distanceBetween(DEMO_ORIGIN, candidates[i].location) >= 5000) {
        allAtAnchor = false;
        break;
      }
    }
    if (!allAtAnchor) return;

    for (let i = 0; i < candidates.length; i += 1) {
      const meters: number = DEMO_RELOCATION_OFFSETS_METERS[i % DEMO_RELOCATION_OFFSETS_METERS.length];
      const bearing: number = DEMO_RELOCATION_BEARINGS[i % DEMO_RELOCATION_BEARINGS.length];
      candidates[i].location = offsetPoint(origin, meters, bearing);
    }
    saveSurprises(this.kv, this.surprises);
  }

  // ---------- 内部：数据口径 ----------

  private updateStreak(now: number): void {
    const profile: Profile = this.profile;
    const last: number | undefined = this.extras.lastWalkAt;
    if (last === undefined) {
      profile.streakDays = 1;
      this.extras.lastWalkAt = now;
      return;
    }
    const gap: number = Math.round((startOfDay(now) - startOfDay(last)) / DAY_MS);
    if (gap === 0) {
      // 同一天，连续天数不变
    } else if (gap === 1) {
      profile.streakDays += 1;
    } else {
      profile.streakDays = 1;
    }
    this.extras.lastWalkAt = now;
  }

  /** 本周惊喜值：最近 7 个自然日每天 ×20 + 非普通卡 ×15 + 已完成小任务 ×5（苹果版口径） */
  private computeWeeklySurprise(now: number): number {
    const today: number = startOfDay(now);
    const countedDays: Set<number> = new Set<number>();
    const arrivals: number[] = this.extras.walkArrivalTimes;
    for (let i = 0; i < arrivals.length; i += 1) {
      if (countedDays.size >= 7) break;
      const day: number = startOfDay(arrivals[i]);
      const gap: number = Math.round((today - day) / DAY_MS);
      if (gap < 0 || gap >= 7) continue;
      countedDays.add(day);
    }
    let rareCount: number = 0;
    let taskDoneCount: number = 0;
    for (let i = 0; i < this.profile.cards.length; i += 1) {
      const card: PlaceCard = this.profile.cards[i];
      if (card.taskDone) taskDoneCount += 1;
      const place: Place | undefined = placeByID(card.placeID);
      if (place === undefined) continue;
      if (place.rarity !== Rarity.Common) rareCount += 1;
    }
    return countedDays.size * 20 + rareCount * 15 + taskDoneCount * 5;
  }

  private refreshWeekly(now: number): void {
    this.profile.weeklySurprise = this.computeWeeklySurprise(now);
    this.profile.weeklyWindowStart = startOfDay(now) - 6 * DAY_MS;
  }

  // ---------- 调试 / 测试辅助（不属于契约，但便于校验） ----------

  /** 供测试/UI 调试：当前已解锁线索数（0…3） */
  unlockedHintCount(): number {
    if (this.sessionValue === undefined) return 0;
    return this.sessionValue.unlockedHintCount;
  }

  /** 供测试/UI 调试：某条线索是否可读 */
  hintUnlocked(index: number): boolean {
    if (this.sessionValue === undefined) return false;
    return index < this.sessionValue.unlockedHintCount;
  }

  /** 箭头符号（真实方位角优先，演示按距离分段） */
  arrowSymbol(): string {
    if (this.sessionValue === undefined) return '↑';
    return arrowSymbol(this.sessionValue);
  }

  /** 「往北走，别急」方向文案 */
  compassCopy(): string {
    if (this.sessionValue === undefined) return '沿河往北走，别急';
    return compassCopy(this.sessionValue);
  }

  /** 下一条线索提示文案 */
  nextHintCopy(): string {
    if (this.sessionValue === undefined) return '线索已全部解锁';
    return nextHintCopy(this.sessionValue);
  }

  /** 下一条线索门槛（米）；全部解锁返回 undefined */
  nextHintThresholdMeters(): number | undefined {
    if (this.sessionValue === undefined) return undefined;
    return nextHintThreshold(this.sessionValue);
  }

  /** 旅程进度 0…1 */
  journeyProgress(): number {
    if (this.sessionValue === undefined) return 0;
    return progressOf(this.sessionValue);
  }

  /** 埋惊喜列表（调试/测试） */
  surpriseCount(): number {
    return this.surprises.length;
  }
}

/** 真实来源白名单：任何不在其中的都必须被拒绝（绝不虚构兜底） */
export function isRealPlaceSource(source: string): boolean {
  return source === 'curated' || source === 'amap' || source === 'baidu' ||
    source === 'osm' || source === 'wiki';
}

function cloneDataSourceStatus(status: DataSourceStatus): DataSourceStatus {
  const reports: SourceReport[] = [];
  for (let i = 0; i < status.reports.length; i += 1) {
    const report: SourceReport = status.reports[i];
    const copy: SourceReport = {
      id: report.id,
      label: report.label,
      ok: report.ok,
      count: report.count,
      error: report.error
    };
    reports.push(copy);
  }
  const copy: DataSourceStatus = {
    keySource: status.keySource,
    amapReady: status.amapReady,
    baiduReady: status.baiduReady,
    amapMask: status.amapMask,
    baiduMask: status.baiduMask,
    reports: reports,
    checkedAt: status.checkedAt,
    curatedCount: status.curatedCount
  };
  return copy;
}

// ============================================================
// 单例：UI 在 EntryAbility / Index 启动时调用 initStore(kv) 一次
// ============================================================

let singleton: WalkaholicStore | undefined = undefined;

/**
 * 幂等初始化单例：
 * - 有存档 → 读回 profile + surprises
 * - 无存档 → 预置演示态（与 iOS `WalkaholicStore.demo()` 一致的 demo 开关）
 */
export async function initStore(kv: KeyValueStore): Promise<void> {
  singleton = new WalkaholicStore(kv);
}

/** UI 唯一的状态访问入口；未初始化时抛错，便于尽早发现启动顺序问题 */
export function getStore(): WalkaholicStoreApi {
  if (singleton === undefined) {
    throw new Error('WalkaholicStore 未初始化：请先在 EntryAbility / Index 启动时调用 initStore(kv)');
  }
  return singleton;
}

/** 当前 store 实例（需要调试辅助方法时用；常规 UI 请用 getStore()） */
export function getStoreInstance(): WalkaholicStore {
  if (singleton === undefined) {
    throw new Error('WalkaholicStore 未初始化：请先在 EntryAbility / Index 启动时调用 initStore(kv)');
  }
  return singleton;
}

/**
 * 注册真实 POI（UI 的 MapKit/OSM 等价服务拿到地点后调用）：
 * - 追加进地点库（图鉴可还原、抽盒可抽到）
 * - 持久化到 extras.realPlaces，重启后仍在
 */
export function setNearbyPlaces(places: Place[]): void {
  if (singleton === undefined) {
    throw new Error('WalkaholicStore 未初始化：请先调用 initStore(kv)');
  }
  singleton.setNearbyPlaces(places);
}

export function registerPlaces(places: Place[]): void {
  if (singleton === undefined) {
    throw new Error('WalkaholicStore 未初始化：请先调用 initStore(kv)');
  }
  singleton.registerPlaces(places);
}

/** 契约入口（StoreProvider）：方便 UI 以依赖注入方式使用 */
export const storeProvider: StoreProvider = {
  getStore: getStore
};

/** 判断文案是否泄露地点名（测试/UI 自检用） */
export function placeNameLeaks(text: string, placeName: string): boolean {
  return leaksPlaceName(text, placeName);
}

/** 清洗线索（真实地点生成兜底用） */
export function scrubPlaceHints(hints: string[], placeName: string): string[] {
  return scrubHints(hints, placeName);
}
