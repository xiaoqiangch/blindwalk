/**
 * 盲走 BlindWalk · HarmonyOS 逻辑层 — 全局编排 Store
 *
 * 对应 apple/Shared/Core/BlindWalkStore.swift，但遵循 harmony 的 core/contract.ts：
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
  WalkDuration,
  XP_AUTHOR,
  XP_BURY,
  XP_CONSOLATION,
  XP_SEEKER
} from './types';
import {
  AppSnapshot,
  BlindWalkStoreApi,
  BuryParams,
  CollectResult,
  DrawResult,
  KeyValueStore,
  StoreProvider,
  SurpriseCompareResult
} from './contract';
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
  PROFILE_KEY,
  SURPRISES_KEY,
  StoreExtras,
  loadProfile,
  loadSurprises,
  saveProfile,
  saveSurprises
} from './persistence';

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

// ============================================================
// Store 实现
// ============================================================

export class BlindWalkStore implements BlindWalkStoreApi {
  private kv: KeyValueStore;
  private profile: Profile;
  private extras: StoreExtras;
  private knownPlaces: Place[];
  private surprises: BuriedSurprise[];
  private feed: FeedPost[];

  private sessionValue: QuestSession | undefined;
  private currentPlaceValue: Place | undefined;
  private currentCardValue: PlaceCard | undefined;
  private revealSerialValue: string | undefined;
  private selectedMoodValue: Mood;
  private selectedDurationValue: WalkDuration;
  private selectedAreaValue: Area | undefined;
  private lastKnownOriginValue: GeoPoint | undefined;
  private demoModeValue: boolean;
  private drawCounter: number;
  private surpriseCounter: number;
  private seedSurprisesRebased: boolean;

  constructor(kv: KeyValueStore) {
    this.kv = kv;
    this.selectedMoodValue = Mood.Drift;
    this.selectedDurationValue = WalkDuration.M30;
    this.selectedAreaValue = undefined;
    this.demoModeValue = true;
    this.drawCounter = 0;
    this.surpriseCounter = 0;
    this.seedSurprisesRebased = false;
    this.sessionValue = undefined;
    this.currentPlaceValue = undefined;
    this.currentCardValue = undefined;
    this.revealSerialValue = undefined;
    this.currentPlaceValue = undefined;

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
    this.profile.cards.push(card);
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
    this.sessionValue = undefined;
    this.currentPlaceValue = undefined;
    this.currentCardValue = undefined;
    this.revealSerialValue = undefined;
    this.persist(Date.now());
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
      found: false
    };
    this.surprises.unshift(surprise);
    this.profile.xp += XP_BURY;
    syncAchievements(this.achievementContext(), now);
    this.persist(now);
    return cloneSurprise(surprise);
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
    let newAchievements: Achievement[] = [];

    if (passed) {
      target.found = true;
      seekerXP = XP_SEEKER;
      authorXP = XP_AUTHOR;
      this.profile.xp += seekerXP;
      // 作者不在本机档案里（本地优先、无后端），authorXP 只体现在结算结果中。
      newAchievements = syncAchievements(this.achievementContext(), now);
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
      explorableSurprises: this.explorableSurpriseList(),
      mySurprises: this.mySurpriseList(),
      feed: this.snapshotFeed(walking, place, destinationCollected),
      leaderboard: leaderboard(this.profile).map(
        (entry: LeaderboardEntry): LeaderboardEntry => cloneLeaderboardEntry(entry)
      ),
      demoMode: this.demoModeValue
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
    return snapshot;
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

// ============================================================
// 单例：UI 在 EntryAbility / Index 启动时调用 initStore(kv) 一次
// ============================================================

let singleton: BlindWalkStore | undefined = undefined;

/**
 * 幂等初始化单例：
 * - 有存档 → 读回 profile + surprises
 * - 无存档 → 预置演示态（与 iOS `BlindWalkStore.demo()` 一致的 demo 开关）
 */
export async function initStore(kv: KeyValueStore): Promise<void> {
  singleton = new BlindWalkStore(kv);
}

/** UI 唯一的状态访问入口；未初始化时抛错，便于尽早发现启动顺序问题 */
export function getStore(): BlindWalkStoreApi {
  if (singleton === undefined) {
    throw new Error('BlindWalkStore 未初始化：请先在 EntryAbility / Index 启动时调用 initStore(kv)');
  }
  return singleton;
}

/** 当前 store 实例（需要调试辅助方法时用；常规 UI 请用 getStore()） */
export function getStoreInstance(): BlindWalkStore {
  if (singleton === undefined) {
    throw new Error('BlindWalkStore 未初始化：请先在 EntryAbility / Index 启动时调用 initStore(kv)');
  }
  return singleton;
}

/**
 * 注册真实 POI（UI 的 MapKit/OSM 等价服务拿到地点后调用）：
 * - 追加进地点库（图鉴可还原、抽盒可抽到）
 * - 持久化到 extras.realPlaces，重启后仍在
 */
export function registerPlaces(places: Place[]): void {
  if (singleton === undefined) {
    throw new Error('BlindWalkStore 未初始化：请先调用 initStore(kv)');
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
