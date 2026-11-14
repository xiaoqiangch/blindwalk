/**
 * 盲走 BlindWalk · HarmonyOS 逻辑层 — Node 单元测试
 *
 * 运行：npm test（先 tsc 编译到 .test-build，再 node .test-build/tests/run.test.js）
 *
 * 覆盖：
 * 1. 地理：Haversine / 方位角 / 偏移 / 八方向 / 箭头
 * 2. 会话：480m 起步 → 线索按 200 / 60 解锁 → 30m 到达；事件序列；强制到达 / 揭晓 / 收录
 * 3. 抽盒：同 seed 可复现、档位距离、隐藏款限制、权重分布、区域过滤、心情亲和
 * 4. dHash：64 位哈希、汉明距离、相似度单调、判定阈值与文案
 * 5. 埋/寻：埋下 +30、寻到 +80 / 作者 +40、只能结算一次、不能找自己、安慰奖只发一次
 * 6. 成就：演示态 7/10、埋 1 颗解锁 bury_1、寻到 3 个解锁 seek_3
 * 7. 保密：到达前 snapshot JSON 不含当前目的地名称；线索不含地名（含前 2 字）
 * 8. 契约：places / revealSerial / currentCard / selectedArea / reactToPost / togetherCode
 * 9. 持久化：MemoryKV 存读一致、坏 JSON 容错、snapshot 浅拷贝
 */

import assert from 'node:assert/strict';

import {
  Area,
  BuriedSurprise,
  FeedPost,
  GeoPoint,
  Mood,
  Place,
  PlaceCard,
  Profile,
  QuestEvent,
  QuestEventType,
  QuestPhase,
  ReactionKey,
  Rarity,
  WalkDuration
} from '../entry/src/main/ets/core/types';
import { BlindWalkStoreApi, BuryParams, DrawResult } from '../entry/src/main/ets/core/contract';
import {
  PLACES,
  leaksPlaceName,
  maskPlaceForWalking,
  placeByID,
  rarityXpBonus
} from '../entry/src/main/ets/core/catalog';
import {
  BlindBoxDrawResult,
  DrawParams,
  draw,
  placeWeight,
  serial,
  startMetersFor
} from '../entry/src/main/ets/core/engine';
import {
  SessionUpdate,
  arrowSymbol,
  compassCopy,
  confirmReveal,
  createSession,
  forceArrive,
  markCollected,
  nextHintCopy,
  updateGeo,
  updateSession
} from '../entry/src/main/ets/core/session';
import {
  computeDHash,
  hammingDistance,
  makeClues,
  passes,
  similarity,
  verdict
} from '../entry/src/main/ets/core/surprise';
import {
  ACHIEVEMENT_DEFINITIONS,
  achievementProgress,
  findAchievement
} from '../entry/src/main/ets/core/achievements';
import {
  DEMO_ORIGIN
} from '../entry/src/main/ets/core/demo';
import {
  MemoryKV,
  PROFILE_KEY,
  SURPRISES_KEY,
  profileFromJson,
  surprisesFromJson
} from '../entry/src/main/ets/core/persistence';
import { getStore, getStoreInstance, initStore, registerPlaces } from '../entry/src/main/ets/core/store';
import {
  distance,
  offset,
  bearing,
  compassLabel,
  arrow,
  wgs84ToGcj02,
  gcj02ToWgs84,
  wgs84ToBd09,
  bd09ToWgs84,
  gcj02ToBd09,
  bd09ToGcj02
} from '../entry/src/main/ets/core/geo';
import {
  DEDUPE_METERS,
  HARD_MAX_METERS,
  LANDMARK_KEYWORD_LIMIT,
  LANDMARK_KEYWORDS,
  landmarkKeywordList,
  POI_NEVER_WORDS,
  POI_SOFT_BAD_WORDS,
  PER_CATEGORY_LIMIT,
  PoiCandidate,
  categoryMeta,
  candidateWeight,
  dedupe,
  durationMeters,
  isDullCandidate,
  pickCandidate,
  scoreWalkworthy,
  sortByDistance,
  tierParams,
  trimDiverse
} from '../entry/src/main/ets/core/parity';
import {
  baiduUrl,
  amapUrl,
  mapCategory,
  nearby,
  parseAmap,
  parseBaidu,
  parseOverpass,
  parseWiki,
  providerLabel
} from '../entry/src/main/ets/core/providers';
import {
  ADMIN_BASE_DEFAULT,
  MAPKEYS_CACHE_KEY,
  MAPKEYS_CACHE_TTL_MS,
  fetchAdminKeys,
  loadMapKeys,
  maskKey,
  parseMapKeys,
  readCachedKeys,
  writeCachedKeys
} from '../entry/src/main/ets/core/mapkeys';
import {
  ACCOUNT_BASE_DEFAULT,
  AccountConfig,
  accountErrorText,
  extractCookie,
  login,
  logout,
  me,
  normalizeBaseUrl,
  pushProfile,
  readAccountConfig,
  register,
  writeAccountConfig
} from '../entry/src/main/ets/core/account';
import {
  HttpClient,
  HttpRequest,
  HttpResponse,
  MapKeys,
  emptyKeys
} from '../entry/src/main/ets/core/http';
import {
  curatedToCandidate,
  findRealPlace,
  isRealSource,
  parseCuratedPois,
  pickCurated
} from '../entry/src/main/ets/core/search';
import {
  CHEVRON_SPACING_METERS,
  FOG_AHEAD_MAX,
  FOG_BEHIND_MAX,
  FOG_FADE_METERS,
  FOG_HIDE_REMAINING_METERS,
  NEARBY_COPY,
  RouteLine,
  buildCumulative,
  defaultLayout,
  estimatedMinutes,
  fogGeometry,
  fogWindow,
  pointAlongPath,
  routeProgressOf,
  segmentBearing,
  shouldShowOffRoute
} from '../entry/src/main/ets/core/fog';
import { isRealPlaceSource } from '../entry/src/main/ets/core/store';
import {
  areaLabelFrom,
  geocodeAddress,
  parseCoordinateText,
  parseNominatim,
  parseNominatimReverse
} from '../entry/src/main/ets/core/geocode';
import {
  QuestFlowDeps,
  loadCuratedPois,
  planRoute,
  prepareQuest,
  resetCuratedCache,
  toDataSourceStatus
} from '../entry/src/main/ets/core/flow';
import {
  DISTANCE_UNKNOWN_TEXT,
  HINT_ATMOSPHERE,
  HINT_EMPTY_CTA,
  HINT_FOOTER,
  HINT_TITLE_SUFFIX,
  LOCKED_CLUE_TEXT,
  NEARBY_HINT_LIMIT,
  NearHint,
  SEEK_NO_LOCATION_TEXT,
  SURPRISE_RADIUS_METERS,
  distanceBucket,
  hintForSurprise,
  isFarBucket,
  makeNearHint,
  nearbyHintCountText,
  nearbyHints,
  seekClueState,
  seekLeadText
} from '../entry/src/main/ets/core/hints';
import {
  ROUTE_CACHE_TTL_MS,
  decodePolyline6,
  fetchWalkingRoute,
  parseValhalla,
  toRoutePolyline
} from '../entry/src/main/ets/core/route';

interface TestCase {
  name: string;
  run: () => Promise<void> | void;
}

const cases: TestCase[] = [];

function test(name: string, run: () => Promise<void> | void): void {
  cases.push({ name: name, run: run });
}

function geoPoint(latitude: number, longitude: number): GeoPoint {
  const point: GeoPoint = { latitude: latitude, longitude: longitude };
  return point;
}

async function freshStore(): Promise<BlindWalkStoreApi> {
  const kv: MemoryKV = new MemoryKV();
  await initStore(kv);
  return getStore();
}

// ============================================================
// 1. 地理
// ============================================================

test('地理：北京 → 上海距离 ≈ 1067 km（±1%）', (): void => {
  const beijing: GeoPoint = geoPoint(39.9042, 116.4074);
  const shanghai: GeoPoint = geoPoint(31.2304, 121.4737);
  const meters: number = distance(beijing, shanghai);
  const expected: number = 1067310;
  assert.ok(meters > expected * 0.99 && meters < expected * 1.01,
    '距离应约 1067km，实际 ' + String(meters));
});

test('地理：正北偏移 100m 后距离 ≈ 100m', (): void => {
  const origin: GeoPoint = geoPoint(31.2304, 121.4737);
  const north: GeoPoint = offset(origin, 100, 0);
  const meters: number = distance(origin, north);
  assert.ok(meters > 99.5 && meters < 100.5, '实际 ' + String(meters));
  const degrees: number = bearing(origin, north);
  assert.ok(degrees < 0.5 || degrees > 359.5, '方位角应约 0，实际 ' + String(degrees));
});

test('地理：八方向文案与箭头', (): void => {
  assert.equal(compassLabel(0), '北');
  assert.equal(compassLabel(359), '北');
  assert.equal(compassLabel(90), '东');
  assert.equal(compassLabel(180), '南');
  assert.equal(compassLabel(225), '西南');
  assert.equal(compassLabel(270), '西');
  assert.equal(arrow(0), '↑');
  assert.equal(arrow(45), '↗');
  assert.equal(arrow(90), '→');
  assert.equal(arrow(135), '↘');
  assert.equal(arrow(180), '↓');
  assert.equal(arrow(225), '↙');
  assert.equal(arrow(270), '←');
  assert.equal(arrow(315), '↖');
});

// ============================================================
// 2. 会话
// ============================================================

test('会话：480m 起步 → 300m 未解锁 → 200m 第 2 条 → 50m 第 3 条 → 20m 到达', (): void => {
  const session0 = createSession('river-steps', 1000, 480);
  assert.equal(session0.unlockedHintCount, 1, '起点即第 1 条线索');
  assert.equal(session0.remainingMeters, 480);
  assert.equal(session0.phase, QuestPhase.Walking);

  const step1: SessionUpdate = updateSession(session0, 300);
  assert.equal(step1.events.length, 0, '300m 仍未解锁第 2 条（苹果版门槛 200m）');
  assert.equal(step1.session.remainingMeters, 300);

  const step2: SessionUpdate = updateSession(step1.session, 200);
  assert.equal(step2.events.length, 1);
  assert.equal(step2.events[0].type, QuestEventType.HintUnlocked);
  assert.equal(step2.events[0].index, 1);
  assert.equal(step2.session.unlockedHintCount, 2);

  const step3: SessionUpdate = updateSession(step2.session, 50);
  assert.equal(step3.events.length, 1);
  assert.equal(step3.events[0].index, 2);
  assert.equal(step3.session.unlockedHintCount, 3);

  const step4: SessionUpdate = updateSession(step3.session, 20);
  assert.equal(step4.events.length, 1);
  assert.equal(step4.events[0].type, QuestEventType.Arrived);
  assert.equal(step4.session.phase, QuestPhase.Arrived);
  assert.equal(step4.session.remainingMeters, 20);
});

test('会话：一次推进可级联解锁并到达', (): void => {
  const session0 = createSession('river-steps', 1000, 480);
  const update: SessionUpdate = updateSession(session0, 20);
  assert.equal(update.events.length, 3);
  assert.equal(update.events[0].index, 1);
  assert.equal(update.events[1].index, 2);
  assert.equal(update.events[2].type, QuestEventType.Arrived);
  assert.equal(update.session.unlockedHintCount, 3);
  assert.equal(update.session.phase, QuestPhase.Arrived);
});

test('会话：剩余距离 clamp 到 [0, total]；≤30m 才到达', (): void => {
  const session0 = createSession('river-steps', 1000, 480);
  const over: SessionUpdate = updateSession(session0, 9999);
  assert.equal(over.session.remainingMeters, 480, '不能超过总长');
  const near: SessionUpdate = updateSession(session0, 30);
  assert.equal(near.session.phase, QuestPhase.Arrived, '30m 应到达');
  const notYet: SessionUpdate = updateSession(session0, 31);
  assert.equal(notYet.session.phase, QuestPhase.Walking, '31m 尚未到达');
  const negative: SessionUpdate = updateSession(session0, -10);
  assert.equal(negative.session.remainingMeters, 0);
  assert.equal(negative.session.phase, QuestPhase.Arrived);
});

test('会话：我到了 / 揭晓 / 收录状态流转', (): void => {
  const session0 = createSession('river-steps', 1000, 480);
  const arrived: SessionUpdate = forceArrive(session0);
  assert.equal(arrived.events.length, 1);
  assert.equal(arrived.events[0].type, QuestEventType.Arrived);
  assert.equal(arrived.session.phase, QuestPhase.Arrived);
  assert.ok(arrived.session.remainingMeters <= 30);

  const revealed = confirmReveal(arrived.session);
  assert.equal(revealed.phase, QuestPhase.Revealed);
  const collected = markCollected(revealed);
  assert.equal(collected.phase, QuestPhase.Collected);
  assert.equal(forceArrive(collected).events.length, 0, '已收录后不能再到达');
});

test('会话：箭头 / 方向文案 / 线索提示', (): void => {
  const demo = createSession('river-steps', 1000, 480);
  assert.equal(arrowSymbol(demo), '↖');
  assert.equal(compassCopy(demo), '沿河往北走，别急');
  assert.equal(nextHintCopy(demo), '再走 280 米，解锁下一条线索');

  const east = createSession('river-steps', 1000, 480, geoPoint(31.2, 121.4), 90);
  assert.equal(arrowSymbol(east), '→');
  assert.equal(compassCopy(east), '往东走，别急');

  const geoUpdate: SessionUpdate = updateGeo(east, 199.6, 123);
  assert.equal(geoUpdate.session.remainingMeters, 200);
  assert.equal(geoUpdate.session.currentBearing, 123);
  assert.equal(geoUpdate.events.length, 1);
});

// ============================================================
// 3. 抽盒
// ============================================================

test('抽盒：卡片编号 seed % 9999 + 1 补 4 位', (): void => {
  assert.equal(serial(246), '0247');
  assert.equal(serial(0), '0001');
  assert.equal(serial(9998), '9999');
  assert.match(serial(123456789), /^\d{4}$/);
});

test('抽盒：同一 seed 结果可复现', (): void => {
  const params: DrawParams = {
    catalog: PLACES,
    mood: Mood.Drift,
    duration: WalkDuration.M30,
    area: undefined,
    recentPlaceIDs: new Set<string>(),
    seed: 42
  };
  const first: BlindBoxDrawResult | undefined = draw(params);
  const second: BlindBoxDrawResult | undefined = draw(params);
  assert.ok(first !== undefined && second !== undefined);
  if (first !== undefined && second !== undefined) {
    assert.equal(first.place.id, second.place.id);
    assert.equal(first.startMeters, second.startMeters);
    assert.equal(first.seed, second.seed);
  }
});

test('抽盒：档位起始距离 300 / 480 / 900', (): void => {
  assert.equal(startMetersFor(WalkDuration.M15), 300);
  assert.equal(startMetersFor(WalkDuration.M30), 480);
  assert.equal(startMetersFor(WalkDuration.M60), 900);
});

test('抽盒：隐藏款只在 60 分钟档出现', (): void => {
  let m15Hidden: number = 0;
  let m30Hidden: number = 0;
  let m60Hidden: number = 0;
  const recent: Set<string> = new Set<string>();
  for (let seed = 1; seed <= 1200; seed += 1) {
    const p15: DrawParams = {
      catalog: PLACES, mood: Mood.Lively, duration: WalkDuration.M15,
      area: undefined, recentPlaceIDs: recent, seed: seed
    };
    const p30: DrawParams = {
      catalog: PLACES, mood: Mood.Lively, duration: WalkDuration.M30,
      area: undefined, recentPlaceIDs: recent, seed: seed
    };
    const p60: DrawParams = {
      catalog: PLACES, mood: Mood.Lively, duration: WalkDuration.M60,
      area: undefined, recentPlaceIDs: recent, seed: seed
    };
    const r15: BlindBoxDrawResult | undefined = draw(p15);
    const r30: BlindBoxDrawResult | undefined = draw(p30);
    const r60: BlindBoxDrawResult | undefined = draw(p60);
    if (r15 !== undefined && r15.place.rarity === Rarity.Hidden) m15Hidden += 1;
    if (r30 !== undefined && r30.place.rarity === Rarity.Hidden) m30Hidden += 1;
    if (r60 !== undefined && r60.place.rarity === Rarity.Hidden) m60Hidden += 1;
  }
  assert.equal(m15Hidden, 0, '15 分钟档不能出现隐藏款');
  assert.equal(m30Hidden, 0, '30 分钟档不能出现隐藏款');
  assert.ok(m60Hidden > 0, '60 分钟档应偶尔出现隐藏款，实际 ' + String(m60Hidden));
});

test('抽盒：1000+ 次抽样权重分布大致符合（常见 > 稀有 > 史诗 > 隐藏）', (): void => {
  const counts: Record<string, number> = { common: 0, rare: 0, epic: 0, hidden: 0 };
  const total: number = 8000;
  const recent: Set<string> = new Set<string>();
  for (let seed = 1; seed <= total; seed += 1) {
    const params: DrawParams = {
      catalog: PLACES,
      mood: Mood.Discover,
      duration: WalkDuration.M60,
      area: undefined,
      recentPlaceIDs: recent,
      seed: seed * 7 + 3
    };
    const result: BlindBoxDrawResult | undefined = draw(params);
    if (result === undefined) continue;
    counts[result.place.rarity] += 1;
  }
  const commonRatio: number = counts.common / total;
  const rareRatio: number = counts.rare / total;
  const epicRatio: number = counts.epic / total;
  const hiddenRatio: number = counts.hidden / total;
  assert.ok(commonRatio > 0.6 && commonRatio < 0.95, '常见比例 ' + String(commonRatio));
  assert.ok(rareRatio > 0.05 && rareRatio < 0.3, '稀有比例 ' + String(rareRatio));
  assert.ok(epicRatio > 0.005 && epicRatio < 0.1, '史诗比例 ' + String(epicRatio));
  assert.ok(hiddenRatio < 0.03, '隐藏比例 ' + String(hiddenRatio));
  assert.ok(commonRatio > rareRatio && rareRatio > epicRatio && epicRatio > hiddenRatio,
    '权重顺序应为 常见 > 稀有 > 史诗 > 隐藏');
});

test('抽盒：区域过滤只返回该区域地点', (): void => {
  const recent: Set<string> = new Set<string>();
  for (let seed = 1; seed <= 120; seed += 1) {
    const params: DrawParams = {
      catalog: PLACES, mood: Mood.Drift, duration: WalkDuration.M30,
      area: Area.River, recentPlaceIDs: recent, seed: seed
    };
    const result: BlindBoxDrawResult | undefined = draw(params);
    assert.ok(result !== undefined);
    if (result !== undefined) assert.equal(result.place.area, Area.River);
  }
});

test('抽盒：候选不足时放宽「最近去过」与「区域」', (): void => {
  const target: Place | undefined = placeByID('near-store-hotdrink');
  assert.ok(target !== undefined);
  if (target === undefined) return;
  const recent: Set<string> = new Set<string>();
  recent.add(target.id);
  const onlyRecent: DrawParams = {
    catalog: [target], mood: Mood.Lively, duration: WalkDuration.M30,
    area: undefined, recentPlaceIDs: recent, seed: 1
  };
  const result: BlindBoxDrawResult | undefined = draw(onlyRecent);
  assert.ok(result !== undefined, '只有最近去过的地点时也应能抽到');
  const wrongArea: DrawParams = {
    catalog: [target], mood: Mood.Lively, duration: WalkDuration.M30,
    area: Area.River, recentPlaceIDs: new Set<string>(), seed: 1
  };
  const relaxed: BlindBoxDrawResult | undefined = draw(wrongArea);
  assert.ok(relaxed !== undefined, '区域没有候选时应放宽到不限区域');
});

test('抽盒：心情亲和权重 ×3', (): void => {
  const bench: Place | undefined = placeByID('river-bench-07');
  const store: Place | undefined = placeByID('near-store-hotdrink');
  assert.ok(bench !== undefined && store !== undefined);
  if (bench === undefined || store === undefined) return;
  assert.ok(placeWeight(bench, Mood.Drift) > placeWeight(bench, Mood.Discover),
    '长椅应更偏放空');
  assert.ok(placeWeight(store, Mood.Lively) > placeWeight(store, Mood.Drift),
    '便利店应更偏热闹');
});

// ============================================================
// 4. dHash / 照片匹配
// ============================================================

function grayPattern(seedValue: number): number[] {
  const values: number[] = [];
  for (let i = 0; i < 72; i += 1) {
    values.push((i * 37 + seedValue * 53) % 256);
  }
  return values;
}

test('dHash：同一张图两次哈希相同，格式为 16 位十六进制', (): void => {
  const gray: number[] = grayPattern(7);
  const first: string = computeDHash(gray);
  const second: string = computeDHash(gray.slice());
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{16}$/);
  assert.equal(first.length, 16);
});

test('dHash：相似图的汉明距离小、相似度高', (): void => {
  const gray: number[] = grayPattern(11);
  const slightlyDifferent: number[] = [];
  for (let i = 0; i < gray.length; i += 1) {
    // 整体加一点亮：dHash 比较的是相邻明暗关系，应几乎不变
    slightlyDifferent.push(Math.min(255, gray[i] + 3));
  }
  const a: string = computeDHash(gray);
  const b: string = computeDHash(slightlyDifferent);
  const bits: number = hammingDistance(a, b);
  assert.ok(bits <= 12, '相似图汉明距离应较小，实际 ' + String(bits));
  assert.ok(similarity(a, b) >= 0.6, '相似图相似度应较高');
  assert.equal(similarity(a, a), 1);
  assert.equal(passes(a, a), true);
});

test('dHash：汉明距离与相似度公式、阈值 0.45', (): void => {
  const zero: string = '0000000000000000';
  const one: string = '0000000000000001';
  const eight: string = '00000000000000ff';
  const all: string = 'ffffffffffffffff';
  assert.equal(hammingDistance(zero, zero), 0);
  assert.equal(hammingDistance(zero, one), 1);
  assert.equal(hammingDistance(zero, eight), 8);
  assert.equal(hammingDistance(zero, all), 64);
  assert.equal(hammingDistance(one, zero), 1);
  assert.equal(similarity(zero, zero), 1);
  assert.equal(similarity(zero, one), 31 / 32);
  assert.equal(similarity(zero, eight), 0.75);
  assert.equal(similarity(zero, all), 0);
  assert.ok(similarity(zero, zero) > similarity(zero, one));
  assert.ok(similarity(zero, one) > similarity(zero, eight));
  assert.ok(similarity(zero, eight) > similarity(zero, all));
  assert.equal(passes(zero, zero), true);
  assert.equal(passes(zero, eight), true, '0.75 ≥ 0.45');
  assert.equal(passes(zero, all), false);
  // 12 位差异 = 0.625；20 位差异 = 0.375 < 阈值
  assert.equal(similarity(zero, '0000000000000fff'), 0.625);
  assert.equal(similarity(zero, '00000000000fffff'), 0.375);
});

test('dHash：输入不足返回全 0；评价文案分级', (): void => {
  const empty: string = computeDHash([1, 2, 3]);
  assert.equal(empty, '0000000000000000');
  assert.equal(verdict(0.9), '几乎一模一样。你找到了 TA 的视角。');
  assert.equal(verdict(0.7), '很像。你站的位置差不多就是那个点。');
  assert.equal(verdict(0.5), '有点像。再往那边挪两步会更接近。');
  assert.equal(verdict(0.2), '画面不太一样。不过这张也有你自己的意思。');
});

test('埋惊喜：三阶线索结构（中间用作者提示）', (): void => {
  const clues: string[] = makeClues('往灯最暖的那扇窗走。');
  assert.equal(clues.length, 3);
  assert.equal(clues[1], '往灯最暖的那扇窗走。');
  assert.ok(!clues[0].includes('往灯'));
  const fallback: string[] = makeClues(undefined);
  assert.equal(fallback.length, 3);
  assert.equal(fallback[1], '找到能把眼前的画面装进取景框的位置。');
});

// ============================================================
// 5. 地点库 / 保密
// ============================================================

test('地点库：24 个内置地点、区域各 8 个、线索不含地名', (): void => {
  assert.equal(PLACES.length, 24);
  let river: number = 0;
  let oldtown: number = 0;
  let near: number = 0;
  for (let i = 0; i < PLACES.length; i += 1) {
    const place: Place = PLACES[i];
    assert.equal(place.source, 'catalog');
    assert.equal(place.hints.length, 3);
    if (place.area === Area.River) river += 1;
    if (place.area === Area.OldTown) oldtown += 1;
    if (place.area === Area.Near) near += 1;
    for (let j = 0; j < place.hints.length; j += 1) {
      assert.ok(!leaksPlaceName(place.hints[j], place.name),
        place.name + ' 的线索泄露了地名：' + place.hints[j]);
    }
  }
  assert.equal(river, 8);
  assert.equal(oldtown, 8);
  assert.equal(near, 8);
});

test('保密：到达前地点名与地址被抹掉，且不改内部对象', (): void => {
  const place: Place | undefined = placeByID('river-steps');
  assert.ok(place !== undefined);
  if (place === undefined) return;
  const masked: Place = maskPlaceForWalking(place);
  assert.equal(masked.name, '');
  assert.equal(masked.address, undefined);
  assert.equal(place.name, '旧码头边的石阶', '原对象不应被修改');
  assert.equal(masked.hints.length, 3);
  assert.equal(masked.category, place.category);
});

// ============================================================
// 6. Store：演示口径 / 契约新增字段
// ============================================================

test('Store：getStore() 未初始化时抛错', (): void => {
  assert.throws((): void => {
    getStore();
  }, '未初始化应抛错');
});

test('Store：演示态口径 4240 xp / 18 卡 / 12 天 / 305 惊喜值 / 480m', async (): Promise<void> => {
  const store: BlindWalkStoreApi = await freshStore();
  const snap = store.snapshot();
  assert.ok(!(snap instanceof Promise), 'snapshot() 必须同步返回');
  assert.equal(typeof snap, 'object');
  assert.equal(snap.profile.xp, 4240);
  assert.equal(snap.profile.cards.length, 18);
  assert.equal(snap.profile.streakDays, 12);
  assert.equal(snap.profile.weeklySurprise, 305);
  assert.equal(snap.places.length, 24);
  assert.equal(snap.togetherCode, 'K7M2QX');
  assert.equal(snap.selectedMood, Mood.Drift);
  assert.equal(snap.selectedDuration, WalkDuration.M30);
  assert.equal(snap.demoMode, true);
  assert.ok(snap.session !== undefined);
  if (snap.session !== undefined) {
    assert.equal(snap.session.remainingMeters, 480);
    assert.equal(snap.session.totalMeters, 1260);
    assert.equal(snap.session.phase, QuestPhase.Walking);
    assert.equal(snap.session.unlockedHintCount, 1);
  }
  assert.equal(snap.revealSerial, undefined, '行走中不应有揭晓编号');

  let rare: number = 0;
  let hidden: number = 0;
  for (let i = 0; i < snap.profile.cards.length; i += 1) {
    const place: Place | undefined = placeByID(snap.profile.cards[i].placeID);
    if (place === undefined) continue;
    if (place.rarity !== Rarity.Common) rare += 1;
    if (place.rarity === Rarity.Hidden) hidden += 1;
  }
  assert.equal(rare, 7);
  assert.equal(hidden, 1);

  let unlocked: number = 0;
  let buryUnlocked: boolean = false;
  for (let i = 0; i < snap.profile.achievements.length; i += 1) {
    const item = snap.profile.achievements[i];
    if (item.unlockedAt !== undefined) unlocked += 1;
    if (item.id === 'bury_1' && item.unlockedAt !== undefined) buryUnlocked = true;
  }
  assert.equal(snap.profile.achievements.length, ACHIEVEMENT_DEFINITIONS.length);
  assert.equal(unlocked, 7, '演示态应解锁 7 个成就');
  assert.equal(buryUnlocked, false, '演示态 bury_1 未解锁');
});

test('Store：周榜本人 305 第 4 名', async (): Promise<void> => {
  const store: BlindWalkStoreApi = await freshStore();
  const snap = store.snapshot();
  let meIndex: number = -1;
  for (let i = 0; i < snap.leaderboard.length; i += 1) {
    if (snap.leaderboard[i].isMe) meIndex = i;
  }
  assert.equal(meIndex, 3, '本人应排第 4（下标 3）');
  assert.equal(snap.leaderboard[meIndex].score, 305);
  assert.equal(snap.leaderboard[0].score, 520);
  assert.equal(snap.leaderboard[1].score, 465);
  assert.equal(snap.leaderboard[2].score, 400);
});

test('Store：places 包含全部 24 个内置地点 + 注册的真实地点', async (): Promise<void> => {
  const store: BlindWalkStoreApi = await freshStore();
  const snap = store.snapshot();
  assert.ok(snap.places.length >= 24);
  for (let i = 0; i < PLACES.length; i += 1) {
    let found: boolean = false;
    for (let j = 0; j < snap.places.length; j += 1) {
      if (snap.places[j].id === PLACES[i].id) {
        found = true;
        break;
      }
    }
    assert.ok(found, 'places 缺少内置地点 ' + PLACES[i].id);
  }

  const realPlace: Place = {
    id: 'real-test-cafe',
    name: '测试咖啡窗口',
    area: Area.Near,
    category: '咖啡窗口',
    emoji: '☕️',
    rarity: Rarity.Common,
    why: '测试用的真实地点。\n到了才知道是哪家。',
    task: '点一杯最便宜的。',
    hints: ['风里有一点烘焙的味道。', '注意转角。', '就在前面。慢慢看。'],
    mapPoint: { x: 0.55, y: 0.4 },
    radiusMeters: 500,
    coordinate: geoPoint(31.2310, 121.4742),
    address: '测试路 1 号',
    source: 'geo'
  };
  registerPlaces([realPlace]);
  const snap2 = store.snapshot();
  assert.ok(snap2.places.length > 24, '注册真实地点后 places 应 > 24');
  let registered: boolean = false;
  for (let i = 0; i < snap2.places.length; i += 1) {
    if (snap2.places[i].id === 'real-test-cafe') registered = true;
  }
  assert.equal(registered, true);

  // 多次抽盒应能抽到注册的真实地点（权重随机，循环上限内必然命中）
  let drawnReal: boolean = false;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const result: DrawResult | undefined = store.startQuest(DEMO_ORIGIN);
    if (result !== undefined && result.place.id === 'real-test-cafe') {
      drawnReal = true;
      break;
    }
  }
  assert.equal(drawnReal, true, '抽盒应能抽到注册的真实地点');
  const snap3 = store.snapshot();
  assert.ok(snap3.currentPlace !== undefined);
  if (snap3.currentPlace !== undefined) {
    assert.equal(snap3.currentPlace.id, 'real-test-cafe');
    assert.equal(snap3.currentPlace.name, '', '到达前真实地点名也不能泄露');
  }
});

test('Store：保密 —— 未收录目的地到达前不出现；已收录地点名保留给图鉴', async (): Promise<void> => {
  const store: BlindWalkStoreApi = await freshStore();

  // 演示态目的地 river-steps 已经在图鉴里：名称可以出现在 places（图鉴）里，
  // 但 currentPlace 必须继续遮住（旅程页不剧透）。
  const walking = store.snapshot();
  assert.ok(walking.currentPlace !== undefined);
  if (walking.currentPlace !== undefined) {
    assert.equal(walking.currentPlace.name, '');
    assert.equal(walking.currentPlace.hints.length, 3);
  }
  let catalogNameForJourney: string = '';
  for (let i = 0; i < walking.places.length; i += 1) {
    if (walking.places[i].id === 'river-steps') catalogNameForJourney = walking.places[i].name;
  }
  assert.equal(catalogNameForJourney, '旧码头边的石阶', '已收录地点在图鉴里应有名字');

  // 抽一个「还没收录」的新盲盒：到达前任何返回字符串/JSON 都不能出现目的地名
  let result: DrawResult | undefined = undefined;
  let destination: Place | undefined = undefined;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const candidate: DrawResult | undefined = store.startQuest(DEMO_ORIGIN);
    if (candidate === undefined) continue;
    let collected: boolean = false;
    const snap = store.snapshot();
    for (let i = 0; i < snap.profile.cards.length; i += 1) {
      if (snap.profile.cards[i].placeID === candidate.place.id) collected = true;
    }
    if (!collected) {
      result = candidate;
      destination = placeByID(candidate.place.id);
      break;
    }
  }
  assert.ok(result !== undefined, '应能抽到一个未收录地点');
  assert.ok(destination !== undefined);
  if (result === undefined || destination === undefined) return;

  const duringWalk = store.snapshot();
  assert.equal(duringWalk.revealSerial, undefined);
  assert.ok(JSON.stringify(duringWalk).indexOf(destination.name) < 0,
    '未收录目的地名不应出现在 snapshot JSON 里：' + destination.name);
  assert.ok(duringWalk.currentPlace !== undefined);
  if (duringWalk.currentPlace !== undefined) {
    assert.equal(duringWalk.currentPlace.name, '');
    for (let i = 0; i < duringWalk.currentPlace.hints.length; i += 1) {
      assert.ok(!leaksPlaceName(duringWalk.currentPlace.hints[i], destination.name));
    }
  }

  // 到达后（揭晓页）才允许出现名称
  store.arriveNow();
  const arrived = store.snapshot();
  assert.ok(arrived.currentPlace !== undefined);
  if (arrived.currentPlace !== undefined) {
    assert.equal(arrived.currentPlace.name, destination.name);
  }
  assert.ok(JSON.stringify(arrived).indexOf(destination.name) >= 0);
});

test('Store：selectedArea 参与抽盒过滤；revealSerial / currentCard 契约', async (): Promise<void> => {
  const store: BlindWalkStoreApi = await freshStore();
  store.setArea(Area.River);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result: DrawResult | undefined = store.startQuest(DEMO_ORIGIN);
    assert.ok(result !== undefined);
    if (result === undefined) return;
    assert.equal(result.place.area, Area.River, 'setArea(River) 后应只抽河边');
  }
  const snap0 = store.snapshot();
  assert.equal(snap0.selectedArea, Area.River);

  const drawResult: DrawResult | undefined = store.startQuest(DEMO_ORIGIN);
  assert.ok(drawResult !== undefined);
  if (drawResult === undefined) return;
  assert.equal(store.snapshot().revealSerial, undefined, 'walking 时 revealSerial 必须 undefined');

  store.arriveNow();
  const arrived = store.snapshot();
  assert.ok(arrived.revealSerial !== undefined);
  if (arrived.revealSerial !== undefined) assert.match(arrived.revealSerial, /^\d{4}$/);
  assert.equal(arrived.currentCard, undefined, '收录前没有 currentCard');

  store.confirmReveal();
  const collect = store.collectCurrentPlace();
  assert.ok(collect !== undefined);
  if (collect === undefined) return;
  const place: Place | undefined = placeByID(drawResult.place.id);
  assert.ok(place !== undefined);
  if (place !== undefined) {
    assert.equal(collect.xpGained, 40 + rarityXpBonus(place.rarity));
  }
  assert.match(collect.card.serial, /^\d{4}$/);
  const collected = store.snapshot();
  assert.ok(collected.currentCard !== undefined);
  if (collected.currentCard !== undefined) {
    assert.equal(collected.currentCard.serial, collected.revealSerial);
    assert.equal(collected.currentCard.placeID, drawResult.place.id);
  }
  assert.equal(collected.session?.phase, QuestPhase.Collected);
  assert.equal(store.collectCurrentPlace(), undefined, '不能重复收录');
});

test('Store：真实定位 —— startQuest(origin) 生成目标，靠近后自动到达', async (): Promise<void> => {
  const store: BlindWalkStoreApi = await freshStore();
  const origin: GeoPoint = geoPoint(31.2304, 121.4737);
  const result: DrawResult | undefined = store.startQuest(origin);
  assert.ok(result !== undefined);
  if (result === undefined) return;

  const snap0 = store.snapshot();
  assert.ok(snap0.session !== undefined);
  if (snap0.session === undefined) return;
  assert.ok(snap0.session.target !== undefined, '传了 origin 就应有真实目的地坐标');
  if (snap0.session.target === undefined) return;
  assert.equal(snap0.revealSerial, undefined);

  const near: GeoPoint = offset(snap0.session.target, 100, 0);
  const events1: QuestEvent[] = store.updateGeoLocation(near);
  const snap1 = store.snapshot();
  assert.ok(snap1.session !== undefined);
  if (snap1.session !== undefined) {
    assert.ok(snap1.session.remainingMeters >= 95 && snap1.session.remainingMeters <= 105,
      '真实剩余距离应约 100m，实际 ' + String(snap1.session.remainingMeters));
    assert.ok(snap1.session.currentBearing !== undefined);
  }
  assert.ok(events1.length >= 0);

  const veryNear: GeoPoint = offset(snap0.session.target, 20, 0);
  const events2: QuestEvent[] = store.updateGeoLocation(veryNear);
  let arrived: boolean = false;
  for (let i = 0; i < events2.length; i += 1) {
    if (events2[i].type === QuestEventType.Arrived) arrived = true;
  }
  assert.equal(arrived, true, '20m 内应触发到达');
  const arrivedSnap = store.snapshot();
  assert.equal(arrivedSnap.session?.phase, QuestPhase.Arrived);
  assert.ok(arrivedSnap.revealSerial !== undefined);
  if (arrivedSnap.revealSerial !== undefined) assert.match(arrivedSnap.revealSerial, /^\d{4}$/);
  assert.ok(arrivedSnap.lastKnownOrigin !== undefined);
});

test('Store：reactToPost 第一次 +1、第二次取消', async (): Promise<void> => {
  const store: BlindWalkStoreApi = await freshStore();
  const snap = store.snapshot();
  assert.ok(snap.feed.length >= 5);
  const post: FeedPost = snap.feed[0];
  const postID: string = post.id;
  const before: number = post.reactions['eyes'];
  const reaction: ReactionKey = 'eyes';

  store.reactToPost(postID, reaction);
  const afterFirst = store.snapshot();
  let firstCount: number = -1;
  let firstReacted: boolean = false;
  for (let i = 0; i < afterFirst.feed.length; i += 1) {
    if (afterFirst.feed[i].id === postID) {
      firstCount = afterFirst.feed[i].reactions['eyes'];
      const reacted = afterFirst.feed[i].reacted;
      if (reacted !== undefined) firstReacted = reacted['eyes'] === true;
    }
  }
  assert.equal(firstCount, before + 1, '第一次点击应 +1');
  assert.equal(firstReacted, true);

  store.reactToPost(postID, reaction);
  const afterSecond = store.snapshot();
  let secondCount: number = -1;
  let secondReacted: boolean = true;
  for (let i = 0; i < afterSecond.feed.length; i += 1) {
    if (afterSecond.feed[i].id === postID) {
      secondCount = afterSecond.feed[i].reactions['eyes'];
      const reacted = afterSecond.feed[i].reacted;
      if (reacted !== undefined) secondReacted = reacted['eyes'] === true;
    }
  }
  assert.equal(secondCount, before, '第二次点击应取消（回到原值）');
  assert.equal(secondReacted, false);
});

// ============================================================
// 7. 埋惊喜 / 寻惊喜
// ============================================================

function buryParams(): BuryParams {
  const params: BuryParams = {
    authorName: '阿澈',
    authorEmoji: '🫥',
    location: geoPoint(31.2304, 121.4737),
    areaWord: '静安 · 街角',
    hints: makeClues('往灯最暖的那扇窗走。'),
    photoHash: '6f4b1d2a9c3e8057',
    photoUri: 'file:///sandbox/surprise.jpg'
  };
  return params;
}

test('埋惊喜：mySurprises +1、xp +30、解锁 bury_1', async (): Promise<void> => {
  const store: BlindWalkStoreApi = await freshStore();
  const before = store.snapshot();
  const xpBefore: number = before.profile.xp;
  assert.equal(before.mySurprises.length, 0);

  const buried: BuriedSurprise | undefined = store.burySurprise(buryParams());
  assert.ok(buried !== undefined);
  if (buried === undefined) return;
  assert.equal(buried.authorName, '阿澈');
  assert.equal(buried.found, false);
  assert.equal(buried.hints.length, 3);

  const after = store.snapshot();
  assert.equal(after.mySurprises.length, 1);
  assert.equal(after.profile.xp, xpBefore + 30);
  const buryAchievement = findAchievement(after.profile, 'bury_1');
  assert.ok(buryAchievement !== undefined);
  if (buryAchievement !== undefined) {
    assert.ok(buryAchievement.unlockedAt !== undefined, 'bury_1 应解锁');
    assert.equal(buryAchievement.progress, 1);
  }
  assert.equal(store.burySurprise({
    authorName: '阿澈', authorEmoji: '🫥',
    location: geoPoint(31.2, 121.4), areaWord: '附近',
    hints: [], photoHash: '', photoUri: ''
  }), undefined, '没有照片不应允许埋');
});

test('寻惊喜：comparе/complete 双人奖励、只能结算一次、不能找自己', async (): Promise<void> => {
  const store: BlindWalkStoreApi = await freshStore();
  const exploration = store.snapshot().explorableSurprises;
  assert.equal(exploration.length, 3, '演示预置 3 颗等待中的惊喜');
  const target: BuriedSurprise = exploration[0];
  const compare = store.compareSurprise(target.id, target.photoHash);
  assert.ok(compare !== undefined);
  if (compare !== undefined) {
    assert.equal(compare.similarity, 1);
    assert.equal(compare.passed, true);
  }
  const xpBefore: number = store.snapshot().profile.xp;
  const result = store.completeSurpriseFind(target.id, 1);
  assert.ok(result !== undefined);
  if (result === undefined) return;
  assert.equal(result.passed, true);
  assert.equal(result.seekerXP, 80);
  assert.equal(result.authorXP, 40);
  assert.equal(result.surprise.found, true);
  assert.equal(store.snapshot().profile.xp, xpBefore + 80);
  assert.equal(store.completeSurpriseFind(target.id, 1), undefined, '同一颗只能结算一次');

  const mine: BuriedSurprise | undefined = store.burySurprise(buryParams());
  assert.ok(mine !== undefined);
  if (mine !== undefined) {
    assert.equal(store.completeSurpriseFind(mine.id, 1), undefined, '不能找自己埋的惊喜');
  }
  assert.equal(store.compareSurprise('not-exist', '0000000000000000'), undefined);

  // 再找 2 个 → 共 3 个，解锁 seek_3
  const remaining = store.snapshot().explorableSurprises;
  for (let i = 0; i < 2 && i < remaining.length; i += 1) {
    const found = store.completeSurpriseFind(remaining[i].id, 0.9);
    assert.ok(found !== undefined);
    if (found !== undefined) {
      assert.equal(found.passed, true);
      assert.equal(found.seekerXP, 80);
      assert.equal(found.authorXP, 40);
    }
  }
  const achievement = findAchievement(store.snapshot().profile, 'seek_3');
  assert.ok(achievement !== undefined);
  if (achievement !== undefined) {
    assert.ok(achievement.unlockedAt !== undefined, '找到 3 个应解锁 seek_3');
    assert.equal(achievement.progress, 3);
  }
});

test('寻惊喜：未达标只发一次 +10 安慰奖，惊喜继续等待', async (): Promise<void> => {
  const store: BlindWalkStoreApi = await freshStore();
  const target: BuriedSurprise = store.snapshot().explorableSurprises[0];
  const xpBefore: number = store.snapshot().profile.xp;
  const failed = store.completeSurpriseFind(target.id, 0.1);
  assert.ok(failed !== undefined);
  if (failed === undefined) return;
  assert.equal(failed.passed, false);
  assert.equal(failed.seekerXP, 10);
  assert.equal(failed.authorXP, 0);
  assert.equal(failed.surprise.found, false);
  assert.equal(store.snapshot().profile.xp, xpBefore + 10);
  assert.equal(failed.surprise.photoUri, '', '未找到前不应暴露作者照片 URI');

  const again = store.completeSurpriseFind(target.id, 0.1);
  assert.ok(again !== undefined);
  if (again !== undefined) {
    assert.equal(again.passed, false);
    assert.equal(again.seekerXP, 0, '安慰奖每颗只发一次');
  }
  assert.equal(store.snapshot().profile.xp, xpBefore + 10);
  // 仍未找到，仍在可探索列表里
  let stillWaiting: boolean = false;
  const list = store.snapshot().explorableSurprises;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].id === target.id) stillWaiting = true;
  }
  assert.equal(stillWaiting, true);
});

// ============================================================
// 8. 成就判定（纯函数）
// ============================================================

test('成就：定义 13 个；进度与解锁语义', (): void => {
  assert.equal(ACHIEVEMENT_DEFINITIONS.length, 13);
  const profile: Profile = {
    name: '阿澈',
    avatarEmoji: '🫥',
    xp: 0,
    streakDays: 3,
    cards: [],
    achievements: [],
    weeklySurprise: 0,
    weeklyWindowStart: 0
  };
  const card: PlaceCard = {
    id: 'card-1',
    placeID: 'river-steps',
    serial: '0001',
    collectedAt: Date.now(),
    taskDone: false
  };
  profile.cards.push(card);
  const emptyFeed: FeedPost[] = [];
  const emptySurprises: BuriedSurprise[] = [];
  const context = {
    profile: profile,
    feed: emptyFeed,
    surprises: emptySurprises,
    totalKm: 12.7
  };
  assert.equal(achievementProgress('first_box', context), 1);
  assert.equal(achievementProgress('rare_first', context), 1);
  assert.equal(achievementProgress('streak_7', context), 3);
  assert.equal(achievementProgress('km_100', context), 12);
  assert.equal(achievementProgress('bury_1', context), 0);
  assert.equal(achievementProgress('together_1', context), 0);
});

// ============================================================
// 9. 持久化 / 快照隔离
// ============================================================

test('持久化：MemoryKV 存读 profile + surprises，重启后数据仍在', async (): Promise<void> => {
  const kv: MemoryKV = new MemoryKV();
  await initStore(kv);
  const store: BlindWalkStoreApi = getStore();
  assert.equal(kv.has(PROFILE_KEY), true, '初始化应写入 profile');
  assert.equal(kv.has(SURPRISES_KEY), true, '初始化应写入 surprises');

  const before = store.snapshot();
  const buried: BuriedSurprise | undefined = store.burySurprise(buryParams());
  assert.ok(buried !== undefined);
  const xpAfterBury: number = store.snapshot().profile.xp;
  assert.equal(xpAfterBury, before.profile.xp + 30);

  await initStore(kv); // 模拟 App 重启
  const reloaded: BlindWalkStoreApi = getStore();
  const after = reloaded.snapshot();
  assert.equal(after.profile.xp, xpAfterBury);
  assert.equal(after.profile.cards.length, 18);
  assert.equal(after.mySurprises.length, 1);
  assert.equal(after.profile.weeklySurprise, 305);
  // 契约外：原型重启后仍能回到旅程页（session 随 extras 恢复）
  assert.ok(after.session !== undefined, '重启后应恢复进行中的旅程');
  if (after.session !== undefined) {
    assert.equal(after.session.placeID, 'river-steps');
    assert.equal(after.session.remainingMeters, 480);
  }
});

test('持久化：坏 JSON 容错，不抛异常', async (): Promise<void> => {
  const kv: MemoryKV = new MemoryKV();
  await initStore(kv);
  const buried: BuriedSurprise | undefined = getStore().burySurprise(buryParams());
  assert.ok(buried !== undefined);
  kv.putString(PROFILE_KEY, '{这不是合法 JSON');
  await initStore(kv);
  const store: BlindWalkStoreApi = getStore();
  const snap = store.snapshot();
  assert.equal(typeof snap, 'object');
  assert.equal(snap.profile.cards.length, 18, '坏档案应回退到演示态');
  assert.equal(snap.mySurprises.length, 1, '惊喜单独持久化，不应丢失');
});

test('保密：到达前 why / task / hints / address 都不能暴露地点特征', async () => {
  await initStore(new MemoryKV());
  const store = getStore();
  store.abandonQuest();
  const draw = store.startQuest({ latitude: 31.2304, longitude: 121.4737 });
  const walking = store.snapshot();
  assert.ok(walking.currentPlace, 'walking 时应有 currentPlace');
  assert.strictEqual(walking.currentPlace!.name, '', 'name 必须为空');
  assert.strictEqual(walking.currentPlace!.why, '', 'why 必须为空（会描述地点特征）');
  assert.strictEqual(walking.currentPlace!.task, '', 'task 必须为空');
  assert.strictEqual(walking.currentPlace!.address, undefined, 'address 必须为空');
  const walkingJSON = JSON.stringify(walking.currentPlace);
  assert.ok(!walkingJSON.includes('花店开在菜场后门'), 'why 原文不得出现');
  // places 里同 id 的那条：只有在「该地点尚未被收录」时才必须遮
  // （已收录的地点在回忆册里本来就看得到，不算剧透 —— 与 store 的注释一致）
  const alreadyCollected = walking.profile.cards.some(
    (card) => card.placeID === walking.currentPlace!.id
  );
  const inPlaces = walking.places.filter((p) => p.id === walking.currentPlace!.id);
  for (const p of inPlaces) {
    if (alreadyCollected) {
      assert.ok(p.name.length > 0, '已收录地点在图鉴里应保留名称');
    } else {
      assert.strictEqual(p.why, '', '图鉴地点库里的在途地点 why 也要遮');
      assert.strictEqual(p.name, '', '图鉴地点库里的在途地点 name 也要遮');
    }
  }
  // 到达后应恢复
  const target = walking.session!.target!;
  store.updateGeoLocation({
    latitude: target.latitude + 0.00005,
    longitude: target.longitude + 0.00005,
  });
  const arrived = store.snapshot();
  assert.strictEqual(arrived.session!.phase, QuestPhase.Arrived);
  assert.ok(arrived.currentPlace!.name.length > 0, '到达后地点名必须恢复');
  assert.ok(arrived.currentPlace!.why.length > 0, '到达后 why 必须恢复');
  assert.ok(draw !== undefined);
});

test('快照：返回对象是浅拷贝，改快照不影响内部状态', async (): Promise<void> => {
  const store: BlindWalkStoreApi = await freshStore();
  const snap = store.snapshot();
  const originalEyes: number = snap.feed[0].reactions['eyes'];
  const originalHintCount: number = snap.places[0].hints.length;
  const originalCards: number = snap.profile.cards.length;

  const fakeCard: PlaceCard = {
    id: 'hacked',
    placeID: 'river-steps',
    serial: '9999',
    collectedAt: 0,
    taskDone: false
  };
  snap.profile.cards.push(fakeCard);
  snap.profile.achievements[0].progress = 999;
  snap.feed[0].reactions['eyes'] = 999;
  snap.places[0].hints.push('泄露');
  snap.explorableSurprises[0].photoUri = 'leaked.jpg';
  if (snap.session !== undefined) snap.session.remainingMeters = 1;
  if (snap.currentPlace !== undefined) snap.currentPlace.name = '被改了';

  const next = store.snapshot();
  assert.equal(next.profile.cards.length, originalCards, 'cards 数组应是新的一份');
  assert.notEqual(next.profile.achievements[0].progress, 999);
  assert.equal(next.feed[0].reactions['eyes'], originalEyes);
  assert.equal(next.places[0].hints.length, originalHintCount);
  assert.notEqual(next.explorableSurprises[0].photoUri, 'leaked.jpg');
  if (next.session !== undefined) assert.equal(next.session.remainingMeters, 480);
  if (next.currentPlace !== undefined) assert.notEqual(next.currentPlace.name, '被改了');
});

// ============================================================
// 10. 坐标系转换（parity：高德 GCJ-02 / 百度 BD-09）
// ============================================================

test('坐标：WGS-84 → GCJ-02 偏移约 100~700 米，逆算误差 < 3 米', (): void => {
  const origin: GeoPoint = geoPoint(31.2304, 121.4737);
  const gcj: GeoPoint = wgs84ToGcj02(origin.latitude, origin.longitude);
  const shifted: number = distance(origin, gcj);
  assert.ok(shifted > 80 && shifted < 800, '国内 GCJ 偏移应在百米量级，实测 ' + shifted.toFixed(1));
  const back: GeoPoint = gcj02ToWgs84(gcj.latitude, gcj.longitude);
  const error: number = distance(origin, back);
  assert.ok(error < 3, 'GCJ 逆算误差应 < 3 米，实测 ' + error.toFixed(2));
});

test('坐标：BD-09 往返误差 < 3 米；境外不做偏移', (): void => {
  const origin: GeoPoint = geoPoint(31.2304, 121.4737);
  const bd: GeoPoint = wgs84ToBd09(origin.latitude, origin.longitude);
  const back: GeoPoint = bd09ToWgs84(bd.latitude, bd.longitude);
  assert.ok(distance(origin, back) < 3, 'BD-09 往返误差应 < 3 米');
  const viaGcj: GeoPoint = gcj02ToBd09(...([wgs84ToGcj02(origin.latitude, origin.longitude).latitude,
    wgs84ToGcj02(origin.latitude, origin.longitude).longitude] as [number, number]));
  assert.ok(distance(bd, viaGcj) < 2, 'WGS→BD 应等于 WGS→GCJ→BD');
  const backGcj: GeoPoint = bd09ToGcj02(bd.latitude, bd.longitude);
  assert.ok(distance(backGcj, wgs84ToGcj02(origin.latitude, origin.longitude)) < 2);

  const london: GeoPoint = geoPoint(51.5074, -0.1278);
  const untouched: GeoPoint = wgs84ToGcj02(london.latitude, london.longitude);
  assert.equal(untouched.latitude, london.latitude, '境外不做 GCJ 偏移');
});

// ============================================================
// 11. 三档放宽 / 距离硬帽 / 质量门槛（parity §2）
// ============================================================

test('选点：时长米数 240 / 480 / 960', (): void => {
  assert.equal(durationMeters(WalkDuration.M15), 240);
  assert.equal(durationMeters(WalkDuration.M30), 480);
  assert.equal(durationMeters(WalkDuration.M60), 960);
});

test('选点：三档最小/最大距离严格按 parity 公式', (): void => {
  const t0 = tierParams(0, WalkDuration.M30);
  assert.equal(t0.relax, 0);
  assert.equal(t0.minDistance, Math.max(168, 480 * 0.35), '档 1 最小 = max(168, 0.35×480)');
  assert.equal(t0.maxDistance, 480 * 1.7, '档 1 最大 = 1.7×480');
  assert.equal(t0.radiusScale, 1);

  const t1 = tierParams(1, WalkDuration.M30);
  assert.equal(t1.minDistance, Math.max(120, 480 * 0.25));
  assert.equal(t1.maxDistance, 480 * 2.2);
  assert.equal(t1.radiusScale, 1.8);

  const t2 = tierParams(2, WalkDuration.M30);
  assert.equal(t2.minDistance, Math.max(86, 480 * 0.18));
  assert.equal(t2.maxDistance, 480 * 2.7);
  assert.equal(t2.radiusScale, 3.2);
});

test('选点：距离硬帽 min(3500, 3.4×时长米) 任何档都不得突破', (): void => {
  // 硬帽是天花板：每档 maxDistance = min(硬帽, 倍数×时长米)，永远不超
  for (let relax = 0; relax <= 2; relax += 1) {
    const durations: WalkDuration[] = [WalkDuration.M15, WalkDuration.M30, WalkDuration.M60];
    for (let d = 0; d < durations.length; d += 1) {
      const meters: number = durationMeters(durations[d]);
      const hardMax: number = Math.min(HARD_MAX_METERS, meters * 3.4);
      const params = tierParams(relax, durations[d]);
      assert.ok(params.maxDistance <= hardMax + 0.001,
        'relax=' + String(relax) + ' 时长=' + String(meters) + ' 不得超过硬帽 ' + String(hardMax));
      assert.ok(params.maxDistance <= HARD_MAX_METERS, '永不超过 3500m');
      assert.ok(params.minDistance < params.maxDistance, '最小距离必须小于最大距离');
    }
  }
  // 15 分钟档的硬帽真正生效（2.7×240=648 < 3.4×240=816，所以档 2 由 2.7 决定）
  assert.equal(tierParams(2, WalkDuration.M15).maxDistance, 240 * 2.7);
  // 档位越宽 max 越大（单调）
  const a = tierParams(0, WalkDuration.M60).maxDistance;
  const b = tierParams(1, WalkDuration.M60).maxDistance;
  const c = tierParams(2, WalkDuration.M60).maxDistance;
  assert.ok(a < b && b < c);
});

test('选点：硬排除（公厕/加油站/停车场）与软降权（便利店/快递）', (): void => {
  assert.equal(scoreWalkworthy('人民公园').ok, true);
  assert.equal(scoreWalkworthy('人民公园').penalty, 1);
  assert.equal(scoreWalkworthy('公共厕所').ok, false);
  assert.equal(scoreWalkworthy('中石化加油站').ok, false);
  assert.equal(scoreWalkworthy('地下停车场入口').ok, false);
  assert.equal(scoreWalkworthy('A座').ok, true, '带中文的仍算地点');
  assert.equal(scoreWalkworthy('3-2-101').ok, false, '纯编号不算地点');
  assert.equal(scoreWalkworthy('菜鸟驿站').ok, true);
  assert.ok(scoreWalkworthy('菜鸟驿站').penalty < 0.3, '软降权不淘汰，但权重 ×0.22');
  assert.ok(POI_NEVER_WORDS.test('装修中'));
  assert.ok(POI_SOFT_BAD_WORDS.test('便利店'));
  assert.equal(isDullCandidate({
    id: 'x', name: '丰巢快递柜', latitude: 31.2, longitude: 121.4, category: 'convenience', source: 'osm'
  }), true);
});

test('选点：类别权重（公园 1.7 / 便利店 0，relax 拉平）', (): void => {
  const park: PoiCandidate = { id: 'p', name: '静安公园', latitude: 31.2, longitude: 121.4, category: 'park', source: 'osm' };
  const shop: PoiCandidate = { id: 'c', name: '全家便利店', latitude: 31.2, longitude: 121.4, category: 'convenience', source: 'osm' };
  assert.equal(categoryMeta('park').distinctive, 1.7);
  assert.equal(categoryMeta('convenience').distinctive, 0);
  const parkW = candidateWeight(park, Mood.Drift, 0);
  const shopW = candidateWeight(shop, Mood.Drift, 0);
  assert.ok(parkW > shopW * 3, '公园权重应远高于便利店');

  // relax=2 时非良好类别被拉平（0.85 而不是 0.35）
  const parkW2 = candidateWeight(park, Mood.Drift, 2);
  const shopW2 = candidateWeight(shop, Mood.Drift, 2);
  assert.ok(shopW2 / parkW2 > shopW / parkW, '放宽档应缩小类别差距');
});

test('选点：去重 30m（同名 / 近邻合并，保留有图的那条）', (): void => {
  const a: PoiCandidate = { id: '1', name: '星巴克', latitude: 31.2304, longitude: 121.4737, category: 'cafe', source: 'amap' };
  const b: PoiCandidate = { id: '2', name: '星巴克', latitude: 31.2304, longitude: 121.4737, category: 'cafe', source: 'osm', photoUrl: 'http://x/y.jpg' };
  const c: PoiCandidate = { id: '3', name: '静安公园', latitude: 31.2314, longitude: 121.4737, category: 'park', source: 'osm' };
  const out = dedupe([a, b, c], DEDUPE_METERS);
  assert.equal(out.length, 2, '同名合并');
  const merged = out.filter((item) => item.name === '星巴克')[0];
  assert.equal(merged.photoUrl, 'http://x/y.jpg', '应保留有图的那条');
  assert.equal(merged.source, 'osm', '质量更高的（有图）应留下');

  // 距离 < 30m 不同名也算重复
  const d: PoiCandidate = { id: '4', name: 'Manner', latitude: 31.2304, longitude: 121.4738, category: 'cafe', source: 'osm' };
  const e: PoiCandidate = { id: '5', name: 'Manner Coffee', latitude: 31.2304, longitude: 121.47385, category: 'cafe', source: 'osm' };
  assert.equal(dedupe([d, e], DEDUPE_METERS).length, 1, '30m 内合并');
});

test('选点：按距离排序 + 类别多样性（每类最多 5）', (): void => {
  const origin: GeoPoint = geoPoint(31.2304, 121.4737);
  const list: PoiCandidate[] = [];
  for (let i = 0; i < 10; i += 1) {
    list.push({
      id: 'cafe-' + String(i), name: '咖啡店 ' + String(i),
      latitude: 31.2304 + i * 0.0002, longitude: 121.4737, category: 'cafe', source: 'osm'
    });
  }
  list.push({ id: 'park-1', name: '公园', latitude: 31.2354, longitude: 121.4737, category: 'park', source: 'osm' });
  const sorted = sortByDistance(list, origin, 5000);
  assert.equal(sorted.length, 11);
  assert.ok((sorted[0].distance ?? 0) < (sorted[10].distance ?? 0), '应按距离升序');

  const trimmed = trimDiverse(sorted, 6);
  assert.equal(trimmed.length, 6);
  const cafeCount = trimmed.filter((item) => item.category === 'cafe').length;
  assert.ok(cafeCount <= PER_CATEGORY_LIMIT, '每类最多 5 个');
  assert.equal(trimmed.filter((item) => item.category === 'park').length, 1, '稍远的公园不应被挤掉');
});

test('选点：择优取前 40%（至少 3 个）做加权随机', (): void => {
  const origin: GeoPoint = geoPoint(31.2304, 121.4737);
  const list: PoiCandidate[] = [
    { id: 'a', name: '静安公园', latitude: 31.2354, longitude: 121.4737, category: 'park', source: 'osm', distance: 500 },
    { id: 'b', name: '小馄饨摊', latitude: 31.2355, longitude: 121.4737, category: 'plaza', source: 'amap', distance: 520 },
    { id: 'c', name: '社区图书馆', latitude: 31.2356, longitude: 121.4737, category: 'library', source: 'wiki', distance: 540 },
    { id: 'd', name: '菜鸟驿站', latitude: 31.2357, longitude: 121.4737, category: 'convenience', source: 'osm', distance: 560 }
  ];
  const picked = pickCandidate(list, {
    origin: origin, mood: Mood.Drift, relax: 0, minDistance: 168, maxDistance: 816, random: 0.01
  });
  assert.ok(picked !== undefined);
  if (picked !== undefined) {
    assert.notEqual(picked.candidate.id, 'd', '软黑名单点不该被优先抽中');
  }
  // 距离窗口外全部淘汰 → undefined（调用方继续下一档）
  assert.equal(pickCandidate(list, {
    origin: origin, mood: Mood.Drift, relax: 0, minDistance: 900, maxDistance: 1200, random: 0.5
  }), undefined);
});

// ============================================================
// 12. 数据源解析（fixture，不依赖网络）
// ============================================================

function amapFixture(): Record<string, unknown> {
  return {
    status: '1',
    info: 'OK',
    pois: [
      {
        id: 'B0001', name: '静安公园', type: '风景名胜;公园;公园',
        location: '121.473700,31.230400', address: '南京西路 1649 号',
        cityname: '上海市', adname: '静安区',
        photos: [{ title: '公园', url: 'http://store.is.autonavi.com/x.jpg' }]
      },
      { id: 'B0002', name: '公共厕所', type: '公共设施;公共厕所', location: '121.474,31.231', address: '' },
      { id: 'B0003', name: '', type: '餐饮服务;咖啡厅', location: '121.474,31.231', address: '' }
    ]
  };
}

function baiduFixture(): Record<string, unknown> {
  // 百度返回的是 BD-09，所以 fixture 里的坐标必须先按 BD-09 生成，
  // 否则解析出来的 WGS 坐标会偏一公里（这正是坐标系转换要解决的问题）
  const bd = wgs84ToBd09(31.2304, 121.4737);
  const bd2 = wgs84ToBd09(31.231, 121.474);
  return {
    status: 0,
    message: 'ok',
    results: [
      {
        uid: 'uuid-1', name: 'Manner Coffee', address: '静安嘉里中心',
        location: { lat: bd.latitude, lng: bd.longitude },
        detail_info: { tag: '咖啡厅', image_url: 'https://img.baidu.com/x.jpg' }
      },
      {
        uid: 'uuid-2', name: '某某停车场', address: '',
        location: { lat: bd2.latitude, lng: bd2.longitude }, detail_info: { tag: '' }
      }
    ]
  };
}

test('数据源：高德解析（GCJ→WGS、类别取最后一段、照片、地址回退）', (): void => {
  const list = parseAmap(amapFixture());
  assert.equal(list.length, 2, '无名的 POI 应被丢弃');
  const park = list[0];
  assert.equal(park.name, '静安公园');
  assert.equal(park.category, 'park', 'type 取最后一段「公园」');
  assert.equal(park.source, 'amap');
  assert.equal(park.photoUrl, 'http://store.is.autonavi.com/x.jpg');
  assert.equal(park.photoCredit, '高德地图');
  assert.equal(park.address, '南京西路 1649 号');
  // 坐标已从 GCJ-02 转回 WGS-84（拍回去应该在 200 米左右，不会 0）
  const backToGcj = wgs84ToGcj02(park.latitude, park.longitude);
  assert.ok(distance(geoPoint(31.2304, 121.4737), backToGcj) < 5, 'GCJ 往返应回到原位');
  assert.ok(list[1].name === '公共厕所', '解析阶段不淘汰（由 scoreWalkworthy 负责）');

  // status != 1 直接空
  assert.equal(parseAmap({ status: '0', pois: [] }).length, 0);
});

test('数据源：百度解析（BD→WGS、detail_info.tag、image_url）', (): void => {
  const list = parseBaidu(baiduFixture());
  assert.equal(list.length, 2);
  const cafe = list[0];
  assert.equal(cafe.name, 'Manner Coffee');
  assert.equal(cafe.category, 'cafe');
  assert.equal(cafe.source, 'baidu');
  assert.equal(cafe.photoUrl, 'https://img.baidu.com/x.jpg');
  assert.equal(cafe.photoCredit, '百度地图');
  assert.equal(cafe.address, '静安嘉里中心');
  assert.ok(distance(geoPoint(31.2304, 121.4737), geoPoint(cafe.latitude, cafe.longitude)) < 5,
    'BD-09 往返应回到原位');
  assert.equal(parseBaidu({ status: 1, results: [] }).length, 0);
});

test('数据源：URL 构造带坐标系转换与分页上限', (): void => {
  const amapLink = amapUrl(31.2304, 121.4737, 1200, 25, 2, '公园', 'test-key-1234');
  assert.ok(amapLink.indexOf('key=test-key-1234') >= 0);
  assert.ok(amapLink.indexOf('offset=25') >= 0, '高德 offset 上限 25');
  assert.ok(amapLink.indexOf('page=2') >= 0);
  assert.ok(amapLink.indexOf('extensions=all') >= 0);
  assert.ok(amapLink.indexOf(encodeURIComponent('公园')) >= 0);
  // 高德 location 是 GCJ-02 的 lon,lat，不等于入参
  assert.ok(amapLink.indexOf('location=121.473700,31.230400') < 0, '必须转换过坐标');
  // offset 超上限被夹住
  assert.ok(amapUrl(31.2, 121.4, 500, 99, 1, '', 'k').indexOf('offset=25') >= 0);

  const baiduLink = baiduUrl(31.2304, 121.4737, 1200, 20, 'test-ak', '');
  assert.ok(baiduLink.indexOf('ak=test-ak') >= 0);
  assert.ok(baiduLink.indexOf('scope=2') >= 0);
  assert.ok(baiduLink.indexOf('page_size=20') >= 0);
  assert.ok(baiduLink.indexOf('query=' + encodeURIComponent('生活服务')) >= 0);
  assert.ok(baiduUrl(31.2, 121.4, 500, 99, 'k', '').indexOf('page_size=20') >= 0);
});

test('数据源：OSM / 维基解析与过滤', (): void => {
  const overpass = parseOverpass({
    elements: [
      { type: 'node', id: 1, lat: 31.23, lon: 121.47, tags: { name: '静安公园', leisure: 'park' } },
      { type: 'node', id: 2, lat: 31.23, lon: 121.47, tags: { name: '无名店', amenity: 'toilets' } },
      { type: 'node', id: 3, lat: 31.23, lon: 121.47, tags: { amenity: 'cafe' } }
    ]
  });
  assert.equal(overpass.length, 1, '只收白名单标签 + 有名 + 有坐标');
  assert.equal(overpass[0].category, 'park');
  assert.equal(overpass[0].source, 'osm');

  const wiki = parseWiki({
    query: {
      pages: {
        '1': {
          pageid: 1, title: '静安寺', extract: '上海著名寺庙',
          coordinates: [{ lat: 31.2235, lon: 121.4454 }],
          thumbnail: { source: 'https://upload.wikimedia.org/x.jpg' }
        },
        '2': {
          pageid: 2, title: '静安区',
          coordinates: [{ lat: 31.22, lon: 121.44 }],
          thumbnail: { source: 'https://upload.wikimedia.org/y.jpg' }
        },
        '3': {
          pageid: 3, title: '静安寺站',
          coordinates: [{ lat: 31.22, lon: 121.44 }],
          thumbnail: { source: 'https://upload.wikimedia.org/z.jpg' }
        },
        '4': {
          pageid: 4, title: '某某大世界 (上海市)',
          coordinates: [{ lat: 31.23, lon: 121.47 }],
          thumbnail: { source: 'https://upload.wikimedia.org/w.jpg' }
        }
      }
    }
  });
  assert.equal(wiki.length, 2, '行政区 / 地铁站应被过滤');
  const temple = wiki[0];
  assert.equal(temple.name, '静安寺');
  assert.equal(temple.source, 'wiki');
  assert.equal(temple.category, 'temple');
  assert.equal(wiki[1].name, '某某大世界', '括号消歧义后缀应去掉');
});

test('数据源：类别映射（17 类，名称优先于原始类别）', (): void => {
  assert.equal(mapCategory('', '静安公园'), 'park');
  assert.equal(mapCategory('餐饮服务;咖啡厅', ''), 'cafe');
  assert.equal(mapCategory('', '某某图书馆'), 'library');
  assert.equal(mapCategory('', '完全没线索的名字'), 'plaza');
  // 名称优先：原始类别说「中餐厅」，但名称里有「寺」→ 按名称判 temple
  assert.equal(mapCategory('餐饮服务;中餐厅', '静安寺'), 'temple');
  assert.equal(mapCategory('风景名胜;公园', '人民广场'), 'plaza', '人民广场是广场，不是公园');
  assert.equal(mapCategory('', '广场公园'), 'park', '「广场公园」应判 park（park 规则在前）');
  assert.equal(providerLabel('amap'), '高德地图');
  assert.equal(providerLabel('unknown'), 'unknown');
});

test('数据源：去重时不同名 POI 不能互相借类别（实测踩过的坑）', (): void => {
  // 保留的那条是「无类别（落 plaza）」的餐厅，隔壁 30m 是寺庙：
  // 合并时**不能**把寺庙的类别借给它，否则会出现「鲜得来 → 寺庙」（实测踩过）
  const restaurant: PoiCandidate = {
    id: 'a', name: '鲜得来(云南路店)', latitude: 31.2304, longitude: 121.4737,
    category: 'plaza', source: 'amap', address: '云南路', photoUrl: 'https://img.amap.com/x.jpg'
  };
  const temple: PoiCandidate = {
    id: 'b', name: '云南路道观', latitude: 31.2304, longitude: 121.4738,
    category: 'temple', source: 'osm'
  };
  const merged = dedupe([restaurant, temple], 30);
  assert.equal(merged.length, 1, '30m 内应合并');
  assert.equal(merged[0].name, '鲜得来(云南路店)', '质量更高的（有图）应留下');
  assert.equal(merged[0].category, 'plaza', '不同名 → 不借类别，保持自己的 plaza');

  // 同名（同一家店的两个来源）→ 可以互补类别
  const noCategory: PoiCandidate = {
    id: 'c', name: '静安寺', latitude: 31.2235, longitude: 121.4454, category: 'plaza', source: 'amap'
  };
  const withCategory: PoiCandidate = {
    id: 'd', name: '静安寺', latitude: 31.2235, longitude: 121.4454, category: 'temple', source: 'wiki'
  };
  const sameName = dedupe([noCategory, withCategory], 30);
  assert.equal(sameName.length, 1);
  assert.equal(sameName[0].category, 'temple', '同名互补：拿到更具体的类别');
});

test('数据源：地标关键字必须拆成单个词（整串会让高德返回 count=0）', (): void => {
  assert.ok(LANDMARK_KEYWORDS.indexOf('|') >= 0, '规格原文用 | 分隔');
  const words = landmarkKeywordList();
  assert.equal(words.length, 11);
  assert.equal(words[0], '公园');
  assert.equal(words[10], '古镇');
  for (let i = 0; i < words.length; i += 1) {
    assert.ok(words[i].indexOf('|') < 0, '拆出来的词不能再带分隔符');
  }
  assert.ok(LANDMARK_KEYWORD_LIMIT >= 1 && LANDMARK_KEYWORD_LIMIT <= 5, 'QPS 有限，只查少数几个');
});

// ============================================================
// 13. 数据源编排（FakeHttp）
// ============================================================

class FakeHttp implements HttpClient {
  private handler: (request: HttpRequest) => HttpResponse;
  requests: HttpRequest[] = [];

  constructor(handler: (request: HttpRequest) => HttpResponse) {
    this.handler = handler;
  }

  async request(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    return this.handler(request);
  }
}

function jsonResponse(payload: unknown): HttpResponse {
  const response: HttpResponse = { status: 200, body: JSON.stringify(payload) };
  return response;
}

test('编排：无 Key 时只跑 OSM + 维基，高德/百度标记未配置', async (): Promise<void> => {
  const client = new FakeHttp((request: HttpRequest): HttpResponse => {
    if (request.url.indexOf('overpass') >= 0) {
      return jsonResponse({
        elements: [{ type: 'node', id: 9, lat: 31.2354, lon: 121.4737, tags: { name: '静安公园', leisure: 'park' } }]
      });
    }
    return jsonResponse({ query: { pages: {} } });
  });
  const keys: MapKeys = emptyKeys();
  const result = await nearby(client, keys, {
    latitude: 31.2304, longitude: 121.4737, radiusMeters: 1200, limit: 30
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].name, '静安公园');
  const amapReport = result.reports.filter((item) => item.id === 'amap')[0];
  assert.ok(amapReport !== undefined);
  assert.equal(amapReport.ok, false);
  assert.equal(amapReport.error, '未配置 Key');
  assert.equal(result.reports.length, 4, '四个源都要有报告（失败面板逐条展示）');
  const osmReport = result.reports.filter((item) => item.id === 'osm')[0];
  assert.equal(osmReport.ok, true);
  const baiduReport = result.reports.filter((item) => item.id === 'baidu')[0];
  assert.equal(baiduReport.error, '未配置 Key');
});

test('编排：单源失败不影响其他源（手写 allSettled）', async (): Promise<void> => {
  const client = new FakeHttp((request: HttpRequest): HttpResponse => {
    if (request.url.indexOf('restapi.amap.com') >= 0) {
      return { status: 500, body: 'boom' };
    }
    if (request.url.indexOf('overpass') >= 0) {
      return jsonResponse({
        elements: [{ type: 'node', id: 1, lat: 31.2354, lon: 121.4737, tags: { name: '静安公园', leisure: 'park' } }]
      });
    }
    return jsonResponse({ query: { pages: {} } });
  });
  const keys: MapKeys = emptyKeys();
  keys.amap = 'test-key-1234';
  const result = await nearby(client, keys, {
    latitude: 31.2304, longitude: 121.4737, radiusMeters: 1200, limit: 30
  });
  assert.equal(result.candidates.length, 1, 'OSM 仍然给出结果');
  const amapReport = result.reports.filter((item) => item.id === 'amap')[0];
  assert.equal(amapReport.ok, false);
  assert.ok(amapReport.error.length > 0, '失败原因要记下来给面板用');
});

test('编排：多源去重 + 按距离排序 + 类别多样性', async (): Promise<void> => {
  const client = new FakeHttp((request: HttpRequest): HttpResponse => {
    if (request.url.indexOf('restapi.amap.com') >= 0) {
      return jsonResponse({
        status: '1',
        pois: [
          { id: 'a1', name: '静安公园', type: '风景名胜;公园', location: '121.4737,31.2354', address: '南京西路' },
          { id: 'a2', name: '便利店', type: '购物;便利店', location: '121.4737,31.2305', address: '' }
        ]
      });
    }
    if (request.url.indexOf('overpass') >= 0) {
      return jsonResponse({
        elements: [
          // 与高德同一个公园（30m 内）→ 应合并
          { type: 'node', id: 1, lat: 31.2354, lon: 121.4737, tags: { name: '静安公园', leisure: 'park' } },
          { type: 'node', id: 2, lat: 31.2344, lon: 121.4737, tags: { name: '静安寺', amenity: 'place_of_worship' } }
        ]
      });
    }
    return jsonResponse({ query: { pages: {} } });
  });
  const keys: MapKeys = emptyKeys();
  keys.amap = 'test-key-1234';
  const result = await nearby(client, keys, {
    latitude: 31.2304, longitude: 121.4737, radiusMeters: 1200, limit: 30
  });
  const names = result.candidates.map((item) => item.name);
  assert.equal(names.filter((name) => name === '静安公园').length, 1, '跨源同名应合并');
  const distances = result.candidates.map((item) => item.distance ?? 0);
  for (let i = 1; i < distances.length; i += 1) {
    assert.ok(distances[i - 1] <= distances[i], '结果必须按距离升序');
  }
});

// ============================================================
// 14. 三档搜索编排（core/search.ts）：绝不虚构兜底
// ============================================================

test('搜索：找到真实地点 → 返回 place，source 真实', async (): Promise<void> => {
  const client = new FakeHttp((request: HttpRequest): HttpResponse => {
    if (request.url.indexOf('overpass') >= 0) {
      return jsonResponse({
        elements: [
          { type: 'node', id: 1, lat: 31.2344, lon: 121.4737, tags: { name: '静安公园', leisure: 'park' } },
          { type: 'node', id: 2, lat: 31.2334, lon: 121.4737, tags: { name: '社区图书馆', amenity: 'library' } }
        ]
      });
    }
    return jsonResponse({ query: { pages: {} } });
  });
  const origin: GeoPoint = geoPoint(31.2304, 121.4737);
  const outcome = await findRealPlace(
    client, emptyKeys(), [], origin, Mood.Drift, WalkDuration.M30, 0.3, 40
  );
  assert.ok(outcome.place !== undefined, '应该找到真实地点');
  if (outcome.place === undefined) return;
  assert.ok(isRealSource(outcome.place.source), '来源必须是真实的');
  assert.ok(outcome.place.coordinate !== undefined, '必须有真实坐标');
  assert.equal(outcome.failReason, '');
});

test('搜索：全源无结果 → 明确失败，绝不用内置虚构地点', async (): Promise<void> => {
  const client = new FakeHttp((request: HttpRequest): HttpResponse => {
    if (request.url.indexOf('overpass') >= 0) return jsonResponse({ elements: [] });
    return jsonResponse({ query: { pages: {} } });
  });
  const origin: GeoPoint = geoPoint(31.2304, 121.4737);
  const outcome = await findRealPlace(
    client, emptyKeys(), [], origin, Mood.Drift, WalkDuration.M30, 0.3, 40
  );
  assert.equal(outcome.place, undefined, '找不到就必须失败');
  assert.ok(outcome.failReason === 'no-real-place' || outcome.failReason === 'network');
  const reportLines = outcome.reports.length;
  assert.ok(reportLines >= 1, '失败面板要能逐条列出每个源的原因');
});

test('搜索：三档放宽 —— 档 1 太近的点，档 2/3 能接受', async (): Promise<void> => {
  // 只在 130 米处有一个图书馆：档 1 最小 168m 拒绝，档 2 最小 120m 接受
  const client = new FakeHttp((request: HttpRequest): HttpResponse => {
    if (request.url.indexOf('overpass') >= 0) {
      return jsonResponse({
        elements: [{ type: 'node', id: 1, lat: 31.23157, lon: 121.4737, tags: { name: '社区图书馆', amenity: 'library' } }]
      });
    }
    return jsonResponse({ query: { pages: {} } });
  });
  const origin: GeoPoint = geoPoint(31.2304, 121.4737);
  const outcome = await findRealPlace(
    client, emptyKeys(), [], origin, Mood.Drift, WalkDuration.M30, 0.3, 40
  );
  assert.ok(outcome.place !== undefined, '放宽档应该接受 130m 的点');
  assert.equal(outcome.tier, 1, '应该是第 2 档（relax=1）找到的');
});

test('搜索：只有软黑名单地点时，最后仍用它（不编造，不失败）', async (): Promise<void> => {
  const client = new FakeHttp((request: HttpRequest): HttpResponse => {
    if (request.url.indexOf('overpass') >= 0) {
      return jsonResponse({
        elements: [{ type: 'node', id: 1, lat: 31.2344, lon: 121.4737, tags: { name: '菜鸟驿站', amenity: 'cafe' } }]
      });
    }
    return jsonResponse({ query: { pages: {} } });
  });
  const origin: GeoPoint = geoPoint(31.2304, 121.4737);
  const outcome = await findRealPlace(
    client, emptyKeys(), [], origin, Mood.Drift, WalkDuration.M30, 0.3, 40
  );
  assert.ok(outcome.place !== undefined, '真实但普通的地点最终仍可用');
  if (outcome.place !== undefined) {
    assert.equal(outcome.place.name, '菜鸟驿站');
    assert.equal(outcome.place.source, 'osm');
  }
});

test('搜索：策展数据优先于多数据源', async (): Promise<void> => {
  const client = new FakeHttp((): HttpResponse => jsonResponse({ elements: [] }));
  const curated = [{
    id: 'c1', name: '编辑精选的咖啡馆', lat: 31.2344, lon: 121.4737, category: 'cafe',
    why: '编辑写的理由', task: '编辑写的小任务', hints: ['一', '二', '三']
  }];
  const origin: GeoPoint = geoPoint(31.2304, 121.4737);
  const outcome = await findRealPlace(
    client, emptyKeys(), curated, origin, Mood.Drift, WalkDuration.M30, 0.3, 40
  );
  assert.ok(outcome.place !== undefined);
  if (outcome.place !== undefined) {
    assert.equal(outcome.source, 'curated');
    assert.equal(outcome.place.name, '编辑精选的咖啡馆');
    assert.equal(outcome.place.why, '编辑写的理由', '后台策展文案应覆盖模板');
    assert.equal(outcome.place.source, 'curated');
  }
  assert.equal(curatedToCandidate(curated[0]).id, 'curated-c1');
  assert.ok(pickCurated(curated, origin, Mood.Drift, 0, 100, 900, 0.3) !== undefined);
  assert.equal(pickCurated([], origin, Mood.Drift, 0, 100, 900, 0.3), undefined);
});

// ============================================================
// 15. 地图 Key 下发（后台统一下发，不写死）
// ============================================================

test('MapKeys：解析 {keys:{amap,baidu}} 与扁平结构', (): void => {
  const nested = parseMapKeys({ keys: { amap: ' testkey1234 ', baidu: '' }, version: '1' });
  assert.equal(nested.amap, 'testkey1234');
  assert.equal(nested.baidu, '');
  const flat = parseMapKeys({ amap: 'a', baidu: 'b' });
  assert.equal(flat.amap, 'a');
  assert.equal(flat.baidu, 'b');
  assert.equal(parseMapKeys({}).amap, '');
  assert.equal(maskKey('testkey1234abcd'), 'test…abcd');
  assert.equal(maskKey(''), '');
});

test('MapKeys：缓存 12 小时内有效，过期失效', (): void => {
  const kv: MemoryKV = new MemoryKV();
  const now: number = 1700000000000;
  writeCachedKeys(kv, { amap: 'k1', baidu: '' }, 'pages', now);
  const hit = readCachedKeys(kv, now + 3600 * 1000);
  assert.ok(hit !== undefined);
  if (hit !== undefined) {
    assert.equal(hit.keys.amap, 'k1');
    assert.equal(hit.source, 'cache:pages');
  }
  assert.equal(readCachedKeys(kv, now + MAPKEYS_CACHE_TTL_MS + 1), undefined, '超过 12h 应失效');
  assert.equal(kv.has(MAPKEYS_CACHE_KEY), true);
});

test('MapKeys：按 包内 → 公网 → 后台 → 免费源 的顺序降级', async (): Promise<void> => {
  // ① 包内文件有 Key → 直接用它，不发请求
  const client = new FakeHttp((): HttpResponse => jsonResponse({}));
  const kv: MemoryKV = new MemoryKV();
  const now: number = 1700000000000;
  const bundled = await loadMapKeys(
    client, kv,
    (): string | undefined => '{"keys":{"amap":"bundled-key","baidu":""}}',
    ADMIN_BASE_DEFAULT, now
  );
  assert.equal(bundled.source, 'bundled');
  assert.equal(bundled.keys.amap, 'bundled-key');
  assert.equal(client.requests.length, 0, '包内有 Key 就不该发请求');

  // ② 包内没有 → 公网 Pages 成功
  const kv2: MemoryKV = new MemoryKV();
  const client2 = new FakeHttp((request: HttpRequest): HttpResponse => {
    if (request.url.indexOf('xiaoqiangch.github.io') >= 0) {
      return jsonResponse({ keys: { amap: 'pages-key', baidu: '' } });
    }
    return { status: 404, body: '{}' };
  });
  const pages = await loadMapKeys(client2, kv2, (): string | undefined => undefined, ADMIN_BASE_DEFAULT, now);
  assert.equal(pages.source, 'pages');
  assert.equal(pages.keys.amap, 'pages-key');

  // ③ 公网失败 → 后台端点
  const kv3: MemoryKV = new MemoryKV();
  const client3 = new FakeHttp((request: HttpRequest): HttpResponse => {
    if (request.url.indexOf('/api/public/mapkeys') >= 0) {
      return jsonResponse({ ok: true, keys: { amap: 'admin-key', baidu: '' } });
    }
    return { status: 500, body: '{}' };
  });
  const admin = await loadMapKeys(client3, kv3, (): string | undefined => undefined, 'http://192.168.1.5:8802', now);
  assert.equal(admin.source, 'admin');
  assert.equal(admin.keys.amap, 'admin-key');
  assert.equal(admin.adminBase, 'http://192.168.1.5:8802');

  // ④ 全失败 → 空 Key（只跑 OSM + 维基）
  const kv4: MemoryKV = new MemoryKV();
  const client4 = new FakeHttp((): HttpResponse => ({ status: 500, body: '{}' }));
  const none = await loadMapKeys(client4, kv4, (): string | undefined => undefined, ADMIN_BASE_DEFAULT, now);
  assert.equal(none.source, 'none');
  assert.equal(none.keys.amap, '');
  assert.equal(none.keys.baidu, '');
});

test('MapKeys：环境返回的 Key 不写死、不进代码（fetchAdminKeys 走注入的 client）', async (): Promise<void> => {
  const client = new FakeHttp((): HttpResponse => jsonResponse({ ok: true, keys: { amap: 'from-server', baidu: '' } }));
  const keys = await fetchAdminKeys(client, 'http://127.0.0.1:8802/', 1000);
  assert.equal(keys.amap, 'from-server');
  assert.ok(client.requests[0].url === 'http://127.0.0.1:8802/api/public/mapkeys');
});

// ============================================================
// 16. 账号（Cookie 手动管理）
// ============================================================

test('账号：从 set-cookie 抠出 bw_uid（大小写/多 Cookie 容错）', (): void => {
  assert.equal(
    extractCookie({ 'set-cookie': 'bw_uid=abc123; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000' }),
    'bw_uid=abc123'
  );
  assert.equal(extractCookie({ 'Set-Cookie': 'foo=1; Path=/, bw_uid=xyz; HttpOnly' }), 'bw_uid=xyz');
  assert.equal(extractCookie({ 'set-cookie': 'other=1' }), '');
  assert.equal(extractCookie(undefined), '');
});

test('账号：注册成功写 Cookie 与用户名；失败给人类可读原因', async (): Promise<void> => {
  const kv: MemoryKV = new MemoryKV();
  const client = new FakeHttp((): HttpResponse => ({
    status: 200,
    body: JSON.stringify({ ok: true, user: { id: 'u1', username: '阿澈', createdAt: 1 } }),
    headers: { 'set-cookie': 'bw_uid=tok1; HttpOnly; Path=/' }
  }));
  const result = await register(client, kv, ACCOUNT_BASE_DEFAULT, '阿澈澈', 'secret123');
  assert.equal(result.ok, true);
  if (result.value !== undefined) assert.equal(result.value.username, '阿澈');
  const config = readAccountConfig(kv);
  assert.equal(config.user !== undefined, true);
  assert.equal(config.cookie, 'bw_uid=tok1');
  assert.equal(config.baseUrl, 'https://xqlounge.top');

  const bad = new FakeHttp((): HttpResponse => ({
    status: 401,
    body: JSON.stringify({ error: '用户名或密码不对', code: 'BAD_CREDENTIALS' })
  }));
  const failed = await login(bad, new MemoryKV(), 'http://127.0.0.1:8803', '阿澈澈', 'wrong1');
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'BAD_CREDENTIALS');
  assert.equal(failed.error, '用户名或密码不对');
});

test('账号：本地前置校验（用户名 3–24 / 密码 ≥6），不发请求', async (): Promise<void> => {
  const client = new FakeHttp((): HttpResponse => jsonResponse({ ok: true }));
  const shortName = await login(client, new MemoryKV(), ACCOUNT_BASE_DEFAULT, 'ab', 'secret123');
  assert.equal(shortName.ok, false);
  assert.equal(shortName.code, 'BAD_REQUEST');
  const shortPass = await login(client, new MemoryKV(), ACCOUNT_BASE_DEFAULT, '阿澈澈', '123');
  assert.equal(shortPass.ok, false);
  assert.equal(client.requests.length, 0, '本地校验失败不该发请求');
});

test('账号：同步带 Cookie、超 240KB 拒绝；退出清本地', async (): Promise<void> => {
  const kv: MemoryKV = new MemoryKV();
  const config: AccountConfig = {
    baseUrl: 'http://127.0.0.1:8803',
    user: { id: 'u1', username: '阿澈', createdAt: 1 },
    cookie: 'bw_uid=tok1'
  };
  writeAccountConfig(kv, config);

  const client = new FakeHttp((): HttpResponse => jsonResponse({ ok: true, savedAt: 123, bytes: 10 }));
  const pushed = await pushProfile(client, config, { app: 'blindwalk', profile: { xp: 1 } });
  assert.equal(pushed.ok, true);
  assert.equal(client.requests[0].headers !== undefined, true);
  if (client.requests[0].headers !== undefined) {
    assert.equal(client.requests[0].headers['Cookie'], 'bw_uid=tok1');
  }

  const huge: Record<string, unknown> = { blob: 'x'.repeat(250 * 1024) };
  const rejected = await pushProfile(client, config, huge);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'BAD_REQUEST');

  const loggedOut = await logout(client, kv, config);
  assert.equal(loggedOut.ok, true);
  assert.equal(readAccountConfig(kv).user, undefined, '退出后本地应清掉用户');
});

test('账号：/me 返回 401 时自动清掉过期会话', async (): Promise<void> => {
  const kv: MemoryKV = new MemoryKV();
  const config: AccountConfig = {
    baseUrl: 'http://127.0.0.1:8803',
    user: { id: 'u1', username: '阿澈', createdAt: 1 },
    cookie: 'bw_uid=expired'
  };
  writeAccountConfig(kv, config);
  const client = new FakeHttp((): HttpResponse => ({
    status: 401,
    body: JSON.stringify({ error: '未登录', code: 'UNAUTHENTICATED' })
  }));
  const result = await me(client, kv, config);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'UNAUTHENTICATED');
  assert.equal(readAccountConfig(kv).user, undefined);
  assert.equal(readAccountConfig(kv).cookie, undefined);
});

test('账号：/me 恢复整包数据（profile + surprises）', async (): Promise<void> => {
  const kv: MemoryKV = new MemoryKV();
  const config: AccountConfig = {
    baseUrl: 'http://127.0.0.1:8803',
    user: { id: 'u1', username: '阿澈', createdAt: 1 },
    cookie: 'bw_uid=tok1'
  };
  const client = new FakeHttp((): HttpResponse => jsonResponse({
    user: { id: 'u1', username: '阿澈', createdAt: 1 },
    profile: { app: 'blindwalk', savedAt: 99, profile: { xp: 4240 }, surprises: [{ id: 's1' }] }
  }));
  const result = await me(client, kv, config);
  assert.equal(result.ok, true);
  if (result.value !== undefined) {
    assert.equal(result.value.savedAt, 99);
    assert.ok(result.value.profile !== undefined);
    assert.equal(result.value.surprises !== undefined ? result.value.surprises.length : 0, 1);
  }
});

test('账号：错误码文案 + 地址规范化', (): void => {
  assert.equal(accountErrorText('USERNAME_TAKEN', 'x'), '这个用户名已被注册');
  assert.equal(accountErrorText('TOO_MANY_ATTEMPTS', 'x'), '尝试次数太多，10 分钟后再试');
  assert.equal(accountErrorText('UNKNOWN', '兜底'), '兜底');
  assert.equal(normalizeBaseUrl('  http://127.0.0.1:8803/  '), 'http://127.0.0.1:8803');
  assert.equal(normalizeBaseUrl(''), ACCOUNT_BASE_DEFAULT);
  assert.equal(ACCOUNT_BASE_DEFAULT, 'https://xqlounge.top');
});

// ============================================================
// 17. 迷雾路径几何（parity §3）
// ============================================================

/** 正北方向 300 米、10 个点的竖直路线（便于手算） */
function straightRoute(): RouteLine {
  const points: number[][] = [];
  const originLat: number = 31.2304;
  for (let i = 0; i <= 10; i += 1) {
    points.push([121.4737, originLat + i * 0.00027]);
  }
  const line: RouteLine = { points: points, distanceMeters: 300 };
  return line;
}

test('迷雾：累计距离表与沿线取点', (): void => {
  const line = straightRoute();
  const cumulative = buildCumulative(line);
  assert.ok(cumulative !== undefined);
  if (cumulative === undefined) return;
  assert.ok(Math.abs(cumulative.total - 300) < 6, '总长应约 300 米');
  const head = pointAlongPath(cumulative, 0);
  assert.ok(Math.abs(head.latitude - 31.2304) < 0.00001, '起点应等于第一个点');
  const mid = pointAlongPath(cumulative, cumulative.total / 2);
  assert.ok(Math.abs(mid.latitude - (31.2304 + 0.00135)) < 0.0002, '中点应在中间');
  const tail = pointAlongPath(cumulative, 99999);
  assert.ok(Math.abs(tail.latitude - (31.2304 + 0.0027)) < 0.00001, '越界夹到终点');
});

test('迷雾：窗口参数 min(260, 剩余-25) / min(140, 已走-5) / 剩余<60 隐藏', (): void => {
  const w = fogWindow(100, 300);
  assert.equal(w.remaining, 200);
  assert.equal(w.ahead, Math.min(FOG_AHEAD_MAX, 200 - 25));
  assert.equal(w.behind, Math.min(FOG_BEHIND_MAX, 100 - 5));
  assert.equal(w.startS, 100 - w.behind);
  assert.equal(w.endS, 100 + w.ahead);
  assert.equal(w.fade, FOG_FADE_METERS);
  assert.equal(w.hidden, false);

  // 前方封顶 260（剩余很大时）/ 后方封顶 140（已走很远时）
  const far = fogWindow(500, 1000);
  assert.equal(far.ahead, FOG_AHEAD_MAX, '前方上限 260');
  assert.equal(far.behind, FOG_BEHIND_MAX, '后方上限 140');

  // 刚出发：后方为 0
  const start = fogWindow(0, 300);
  assert.equal(start.behind, 0, '刚出发后方不显示');

  // 剩余 < 60 → 整段隐藏
  const near = fogWindow(290, 300);
  assert.equal(near.remaining, 10);
  assert.equal(near.hidden, true, '剩余 < 60m 必须隐藏');
  assert.equal(fogWindow(241, 300).hidden, true, '剩余 59 也隐藏');
  assert.equal(fogWindow(240, 300).hidden, false, '剩余 60 不隐藏');
  assert.equal(FOG_HIDE_REMAINING_METERS, 60);
});

test('迷雾：沿线投影（walked / offRoute / bearing / lateral）', (): void => {
  const line = straightRoute();
  const cumulative = buildCumulative(line)!;
  const at100 = pointAlongPath(cumulative, 100);
  // 在路径上 → 偏离 0
  const onPath = routeProgressOf(line, at100);
  assert.ok(onPath !== undefined);
  if (onPath !== undefined) {
    assert.ok(Math.abs(onPath.walked - 100) < 8, '沿路径里程应约 100，实测 ' + onPath.walked.toFixed(1));
    assert.ok(onPath.offRoute < 1, '在路径上偏离应接近 0');
    assert.ok(Math.abs(onPath.bearing) < 1, '正北路线朝向应约 0°');
  }
  // 往东偏 30 米 → offRoute ≈ 30，lateral 为正（右手边）
  const shifted: GeoPoint = geoPoint(at100.latitude, at100.longitude + 0.00032);
  const offPath = routeProgressOf(line, shifted);
  assert.ok(offPath !== undefined);
  if (offPath !== undefined) {
    assert.ok(Math.abs(offPath.offRoute - 30) < 6, '偏离应约 30 米，实测 ' + offPath.offRoute.toFixed(1));
    assert.ok(offPath.lateral > 20, '向东偏 → 横向为正');
  }
});

test('迷雾：几何数据（已走/前方颜色、箭头间距、两端渐隐、指北针）', (): void => {
  const line = straightRoute();
  const cumulative = buildCumulative(line)!;
  const here = pointAlongPath(cumulative, 100);
  const layout = defaultLayout(320, 196);
  const geometry = fogGeometry(line, here, layout);

  assert.equal(geometry.hidden, false);
  assert.ok(geometry.segments.length > 10, '应该画出一批线段');
  assert.equal(geometry.caption, '迷雾模式 · 只看见前后一段');

  const behind = geometry.segments.filter((segment) => segment.behind);
  const ahead = geometry.segments.filter((segment) => !segment.behind);
  assert.ok(behind.length > 0, '应该有已走部分');
  assert.ok(ahead.length > 0, '应该有前方部分');
  for (let i = 0; i < behind.length; i += 1) {
    assert.equal(behind[i].color, '#99A0A6');
    assert.equal(behind[i].width, 7);
    assert.ok(behind[i].opacity <= 0.55 + 0.001, '已走部分不透明度 ≤ 0.55');
  }
  for (let i = 0; i < ahead.length; i += 1) {
    assert.equal(ahead[i].color, '#0A59F7');
    assert.equal(ahead[i].width, 9);
  }
  // 两端渐隐：窗口最边上一条应明显更透明
  const first = geometry.segments[0];
  assert.ok(first.opacity < 0.5, '窗口起点应渐隐');

  // 箭头：至少 1 个，间距 55 米（正北直线上 y 间隔 = 55 * scaleY）
  assert.ok(geometry.chevrons.length >= 1);
  assert.ok(geometry.chevrons.length <= Math.floor(geometry.remaining / CHEVRON_SPACING_METERS) + 1);
  // 指北针：正北路线 → 旋转 0
  assert.ok(Math.abs(geometry.compassRotation) < 1);
  // 「你」在画布下方居中
  assert.ok(Math.abs(geometry.userX - layout.centerX) < 2);
  assert.equal(geometry.userY, layout.centerY);
});

test('迷雾：剩余 < 60m 时不画任何路径（不露终点）', (): void => {
  const line = straightRoute();
  const cumulative = buildCumulative(line)!;
  const here = pointAlongPath(cumulative, cumulative.total - 20);
  const geometry = fogGeometry(line, here, defaultLayout(320, 196));
  assert.equal(geometry.hidden, true);
  assert.equal(geometry.segments.length, 0, '不能画任何路径');
  assert.equal(geometry.chevrons.length, 0);
  assert.equal(geometry.caption, NEARBY_COPY);
});

test('迷雾：偏离 > 18m 才提示，且带滞回', (): void => {
  assert.equal(shouldShowOffRoute(10, false), false);
  assert.equal(shouldShowOffRoute(20, false), true);
  assert.equal(shouldShowOffRoute(20, true), true);
  assert.equal(shouldShowOffRoute(15, true), true, '滞回：已显示时 15m 仍显示');
  assert.equal(shouldShowOffRoute(13, true), false, '滞回：13m 才收起');
  assert.equal(estimatedMinutes(150), 2);
  assert.equal(estimatedMinutes(10), 1, '至少 1 分钟');
});

test('迷雾：指北针旋转 = -bearing（东向路线 → -90°）', (): void => {
  // 正东 200 米
  const points: number[][] = [];
  for (let i = 0; i <= 5; i += 1) {
    points.push([121.4737 + i * 0.00038, 31.2304]);
  }
  const line: RouteLine = { points: points, distanceMeters: 200 };
  assert.ok(Math.abs(segmentBearing(31.2304, 121.4737, 31.2304, 121.4756) - 90) < 1, '正东应 90°');
  const geometry = fogGeometry(line, geoPoint(31.2304, 121.4737), defaultLayout(320, 196));
  assert.ok(Math.abs(geometry.compassRotation + 90) < 1,
    '指北针应转 -bearing（东向 = -90°），实测 ' + geometry.compassRotation.toFixed(1));
});

// ============================================================
// 18. Store：真实地点入口 / 路线 / 数据源状态
// ============================================================

test('Store：startQuestWithPlace 只接受真实来源 + 真实坐标', async (): Promise<void> => {
  const store: BlindWalkStoreApi = await freshStore();
  const origin: GeoPoint = geoPoint(31.2304, 121.4737);

  const catalogPlace: Place = placeByID('river-steps')!;
  assert.equal(store.startQuestWithPlace(catalogPlace, origin), undefined, '内置虚构地点必须被拒绝');

  const realPlace: Place = {
    id: 'real-test-1', name: '静安公园', area: Area.Near, category: '公园', emoji: '🌳',
    rarity: Rarity.Common, why: '为什么', task: '小任务', hints: ['一', '二', '三'],
    mapPoint: { x: 0.5, y: 0.5 }, radiusMeters: 1000,
    coordinate: geoPoint(31.2344, 121.4737), source: 'osm'
  };
  const result = store.startQuestWithPlace(realPlace, origin);
  assert.ok(result !== undefined, '真实地点应该能开始旅程');
  if (result === undefined) return;
  assert.equal(result.session.target !== undefined, true);
  assert.equal(store.snapshot().demoMode, false);
  assert.ok(result.session.totalMeters >= 120, '真实距离下限 120m');

  const walkSnapshot = store.snapshot();
  assert.equal(walkSnapshot.currentPlace!.name, '', '到达前仍然保密');
  assert.equal(isRealPlaceSource('curated'), true);
  assert.equal(isRealPlaceSource('catalog'), false);
});

test('Store：路线存取 + 数据源状态快照（浅拷贝）', async (): Promise<void> => {
  const store: BlindWalkStoreApi = await freshStore();
  assert.equal(store.currentRoute(), undefined);

  store.setRoute({
    points: [[121.4737, 31.2304], [121.4737, 31.2324]],
    distanceMeters: 222,
    fetchedAt: 123
  });
  const route = store.currentRoute();
  assert.ok(route !== undefined);
  if (route !== undefined) {
    assert.equal(route.points.length, 2);
    assert.equal(route.distanceMeters, 222);
  }
  assert.ok(store.snapshot().route !== undefined);

  store.setDataSourceStatus({
    keySource: 'pages', amapReady: true, baiduReady: false,
    amapMask: '52da…f425', baiduMask: '',
    reports: [], checkedAt: 456, curatedCount: 13
  });
  const status = store.dataSourceStatus();
  assert.equal(status.keySource, 'pages');
  assert.equal(status.amapReady, true);
  const snap = store.snapshot();
  assert.ok(snap.dataSource !== undefined);
  if (snap.dataSource !== undefined) {
    assert.equal(snap.dataSource.amapMask, '52da…f425');
  }
  store.setRoute(undefined);
  assert.equal(store.currentRoute(), undefined);
});

test('策展：解析 pois.json（字段裁剪 / 非法坐标丢弃 / 缺字段容错）', (): void => {
  const parsed = parseCuratedPois({
    version: 1,
    count: 3,
    pois: [
      {
        id: 'poi-1', name: '上海音乐厅', lat: 31.22888889, lon: 121.47333333,
        category: 'venue', emoji: '🎻', rarity: 'epic', area: 'oldtown',
        photoUrl: 'https://thumb.wikimedia.org/x.jpg', photoCredit: 'Wikimedia Commons',
        why: '编辑写的 why', task: '编辑写的 task', hints: ['一', '二', '三']
      },
      { id: 'poi-2', name: '坏坐标', lat: 999, lon: 121.4, category: 'park' },
      { id: 'poi-3', name: '', lat: 31.2, lon: 121.4, category: 'park' },
      { name: '缺 id 也能解析', lat: 31.23, lon: 121.47, category: 'cafe' }
    ]
  });
  assert.equal(parsed.length, 2, '非法坐标 / 空名应丢弃');
  assert.equal(parsed[0].name, '上海音乐厅');
  assert.equal(parsed[0].category, 'venue');
  assert.equal(parsed[0].why, '编辑写的 why');
  assert.equal(parsed[0].task, '编辑写的 task');
  assert.equal(parsed[0].hints !== undefined ? parsed[0].hints.length : 0, 3);
  assert.ok(parsed[1].id.length > 0, '缺 id 应自动补');
  assert.equal(parseCuratedPois({}).length, 0);
  assert.equal(parseCuratedPois({ pois: 'not-array' }).length, 0);
});

test('抽盒编排：Key 下发 + 策展优先 + 真实地点（成功路径）', async (): Promise<void> => {
  resetCuratedCache();
  const pois = {
    pois: [{
      id: 'c1', name: '上海音乐厅', lat: 31.2330, lon: 121.4737, category: 'venue',
      why: '编辑的理由', task: '编辑的任务', hints: ['一', '二', '三']
    }]
  };
  const client = new FakeHttp((request: HttpRequest): HttpResponse => {
    if (request.url.indexOf('xiaoqiangch.github.io/blindwalk/pois.json') >= 0) return jsonResponse(pois);
    if (request.url.indexOf('mapkeys.json') >= 0) {
      return jsonResponse({ keys: { amap: 'test-key-1234', baidu: '' } });
    }
    return jsonResponse({ query: { pages: {} } });
  });
  const deps: QuestFlowDeps = {
    http: client,
    kv: new MemoryKV(),
    readBundledKeys: (): string | undefined => undefined,
    adminBase: 'http://127.0.0.1:8802',
    now: (): number => 1700000000000
  };
  const result = await prepareQuest(deps, {
    origin: geoPoint(31.2304, 121.4737),
    mood: Mood.Drift,
    duration: WalkDuration.M30
  }, 0.2);
  assert.equal(result.failReason, '', '应该成功');
  assert.ok(result.place !== undefined);
  if (result.place !== undefined) {
    assert.equal(result.place.name, '上海音乐厅');
    assert.equal(result.place.source, 'curated');
    assert.equal(result.place.coordinate !== undefined, true);
  }
  assert.equal(result.curatedCount, 1);
  assert.equal(result.keySource, 'pages');
  assert.equal(result.keys.amap, 'test-key-1234');

  const status = toDataSourceStatus(result.keySource, result.keys, result.reports, 1, result.curatedCount);
  assert.equal(status.curatedCount, 1);
  assert.equal(status.amapReady, true);
  assert.equal(status.baiduReady, false);
  assert.equal(status.amapMask, 'test…1234');
});

test('抽盒编排：没有真实地点时返回 failReason（绝不虚构）', async (): Promise<void> => {
  resetCuratedCache();
  const client = new FakeHttp((request: HttpRequest): HttpResponse => {
    if (request.url.indexOf('overpass') >= 0) return jsonResponse({ elements: [] });
    if (request.url.indexOf('pois.json') >= 0) return { status: 404, body: '{}' };
    if (request.url.indexOf('mapkeys.json') >= 0) return { status: 404, body: '{}' };
    return jsonResponse({ query: { pages: {} } });
  });
  const deps: QuestFlowDeps = {
    http: client,
    kv: new MemoryKV(),
    readBundledKeys: (): string | undefined => undefined,
    adminBase: 'http://127.0.0.1:8802',
    now: (): number => 1700000000000
  };
  const result = await prepareQuest(deps, {
    origin: geoPoint(31.2304, 121.4737),
    mood: Mood.Drift,
    duration: WalkDuration.M30
  }, 0.2);
  assert.equal(result.place, undefined, '找不到就必须失败，不能给内置地点');
  assert.ok(result.failReason === 'no-real-place' || result.failReason === 'network');
  assert.ok(result.reports.length >= 1, '失败面板需要逐条原因');
  assert.equal(result.curatedCount, 0);
  assert.equal(result.keySource, 'none');
});

test('抽盒编排：策展缓存 6 小时内不重复拉取', async (): Promise<void> => {
  resetCuratedCache();
  let curatedCalls: number = 0;
  const client = new FakeHttp((request: HttpRequest): HttpResponse => {
    if (request.url.indexOf('pois.json') >= 0) {
      curatedCalls += 1;
      return jsonResponse({ pois: [] });
    }
    return jsonResponse({});
  });
  const now: number = 1700000000000;
  await loadCuratedPois(client, now);
  await loadCuratedPois(client, now + 1000);
  assert.equal(curatedCalls, 1, '6 小时内应命中缓存');
  await loadCuratedPois(client, now + 6 * 3600 * 1000 + 1);
  assert.equal(curatedCalls, 2, '过期后重新拉取');

  // 拉取失败 → 空数组且不抛错
  resetCuratedCache();
  const failing = new FakeHttp((): HttpResponse => ({ status: 500, body: '' }));
  assert.equal((await loadCuratedPois(failing, now)).length, 0);
});

test('抽盒编排：路线规划失败返回 undefined（UI 降级为直线距离）', async (): Promise<void> => {
  const ok = new FakeHttp((): HttpResponse => ({ status: 500, body: '' }));
  const deps: QuestFlowDeps = {
    http: ok,
    kv: new MemoryKV(),
    readBundledKeys: (): string | undefined => undefined,
    adminBase: 'http://127.0.0.1:8802',
    now: (): number => 1700000000000
  };
  const route = await planRoute(deps, geoPoint(31.2304, 121.4737), geoPoint(31.2344, 121.4737));
  assert.equal(route, undefined);
});

test('保密：照片/署名/简介也必须在到达前抹掉（到了才给看）', async (): Promise<void> => {
  const realPlace: Place = {
    id: 'real-photo-test', name: '静安公园', area: Area.Near, category: '公园', emoji: '🌳',
    rarity: Rarity.Common, why: '为什么', task: '小任务', hints: ['一', '二', '三'],
    mapPoint: { x: 0.5, y: 0.5 }, radiusMeters: 1000,
    coordinate: geoPoint(31.2344, 121.4737), source: 'wiki',
    photoUrl: 'https://upload.wikimedia.org/x.jpg',
    photoCredit: 'Wikimedia Commons',
    summary: '一段简介'
  };
  const masked = maskPlaceForWalking(realPlace);
  assert.equal(masked.name, '');
  assert.equal(masked.photoUrl, undefined, '照片是剧透，必须抹掉');
  assert.equal(masked.photoCredit, undefined);
  assert.equal(masked.summary, '');
  // 原对象不受影响（mask 是深拷贝）
  assert.equal(realPlace.photoUrl, 'https://upload.wikimedia.org/x.jpg');

  const store = await freshStore();
  const started = store.startQuestWithPlace(realPlace, geoPoint(31.2304, 121.4737));
  assert.ok(started !== undefined);
  const walking = store.snapshot();
  assert.equal(walking.currentPlace!.photoUrl, undefined, 'walking 时快照里不能有照片');
  assert.ok(!JSON.stringify(walking.currentPlace).includes('wikimedia'), '快照 JSON 不得含图片域名');
});

test('账号恢复：profileFromJson / surprisesFromJson 能解回本地存档结构', async (): Promise<void> => {
  const store: BlindWalkStoreApi = await freshStore();
  // 先做点改动，让数据不是初始演示态
  store.setDuration(WalkDuration.M60);
  store.startQuest();
  const buried: BuriedSurprise | undefined = store.burySurprise(buryParams());
  assert.ok(buried !== undefined);
  const before = store.snapshot();
  const xpBefore: number = before.profile.xp;

  // 模拟「同步到账号」的信封（结构 = 本地存档根）
  const envelope: Record<string, unknown> = {
    version: 1,
    name: before.profile.name,
    avatarEmoji: before.profile.avatarEmoji,
    xp: xpBefore,
    streakDays: before.profile.streakDays,
    weeklySurprise: before.profile.weeklySurprise,
    weeklyWindowStart: before.profile.weeklyWindowStart,
    cards: before.profile.cards,
    achievements: before.profile.achievements,
    extras: {
      totalKm: 12.5,
      boxesOpened: 3,
      walkArrivalTimes: [1700000000000],
      togetherCount: 0,
      feed: [],
      realPlaces: [],
      consolationPaid: []
    },
    surprises: before.mySurprises
  };
  const loaded = profileFromJson(JSON.stringify(envelope));
  assert.ok(loaded !== undefined, '应能解析账号信封');
  if (loaded === undefined) return;
  assert.equal(loaded.profile.xp, xpBefore);
  assert.equal(loaded.profile.name, before.profile.name);
  assert.equal(loaded.profile.cards.length, before.profile.cards.length);
  assert.equal(loaded.extras.totalKm, 12.5);
  assert.equal(loaded.extras.boxesOpened, 3);

  const parsedSurprises = surprisesFromJson(JSON.stringify(envelope['surprises']));
  assert.ok(parsedSurprises !== undefined);
  if (parsedSurprises !== undefined) {
    assert.equal(parsedSurprises.length, 1);
    assert.equal(parsedSurprises[0].authorName, '阿澈');
  }

  // 坏数据必须拒绝，不崩
  assert.equal(profileFromJson('{坏 JSON'), undefined);
  assert.equal(surprisesFromJson('not-json'), undefined);
  assert.equal(surprisesFromJson('{}'), undefined);
  // 空对象会被补成默认值（不死锁、不抛错）—— 只要 xp 缺省为 0
  const blank = profileFromJson('{}');
  assert.ok(blank !== undefined);
  if (blank !== undefined) assert.equal(blank.profile.xp, 0);
});

test('账号恢复：applyRemotePayload 覆盖本机（缺字段保留原值）', async (): Promise<void> => {
  // 需要直接拿 instance 的接口
  await initStore(new MemoryKV());
  const store: BlindWalkStoreApi = getStore();
  const instance = getStoreInstance();
  const before = store.snapshot();

  const envelope: Record<string, unknown> = {
    version: 1,
    name: '云端阿澈',
    avatarEmoji: '🫥',
    xp: before.profile.xp + 500,
    streakDays: 20,
    weeklySurprise: 0,
    weeklyWindowStart: 0,
    cards: before.profile.cards,
    achievements: before.profile.achievements,
    extras: { totalKm: 0, boxesOpened: 0, walkArrivalTimes: [], togetherCount: 0, feed: [], realPlaces: [], consolationPaid: [] }
  };
  const applied = instance.applyRemotePayload({ profile: envelope });
  assert.equal(applied, true);
  const after = store.snapshot();
  assert.equal(after.profile.name, '云端阿澈');
  assert.equal(after.profile.xp, before.profile.xp + 500);
  assert.equal(after.profile.streakDays, 20);

  // 结构不对 → false，且不改本机
  const xpNow: number = store.snapshot().profile.xp;
  assert.equal(instance.applyRemotePayload({}), false);
  assert.equal(instance.applyRemotePayload({ profile: { nothing: true } }), false);
  assert.equal(store.snapshot().profile.xp, xpNow, '失败时本机数据不能变');
});

test('常量：地标关键字与 parity 一致', (): void => {
  assert.equal(
    LANDMARK_KEYWORDS,
    '公园|风景名胜|博物馆|展览馆|广场|图书馆|书店|体育馆|寺|教堂|古镇'
  );
  assert.equal(DEDUPE_METERS, 30);
  assert.equal(PER_CATEGORY_LIMIT, 5);
});

// ============================================================
// 19. 地址 → 坐标（定位不可用时的真实地点出口）
// ============================================================

test('地理编码：直接输入坐标（含中文逗号）优先，不发请求', async (): Promise<void> => {
  assert.equal(parseCoordinateText('31.2304,121.4737') !== undefined, true);
  assert.equal(parseCoordinateText('31.2304，121.4737') !== undefined, true);
  assert.equal(parseCoordinateText('上海静安寺'), undefined);
  assert.equal(parseCoordinateText('91.0,200.0'), undefined, '越界坐标应拒绝');
  const client = new FakeHttp((): HttpResponse => jsonResponse([]));
  const hit = await geocodeAddress(client, ' 31.2304 , 121.4737 ');
  assert.ok(hit !== undefined);
  if (hit !== undefined) {
    assert.equal(hit.source, 'manual');
    assert.ok(Math.abs(hit.location.latitude - 31.2304) < 0.0001);
  }
  assert.equal(client.requests.length, 0, '直接坐标不该发请求');
});

test('地理编码：Nominatim 优先，失败回落 Photon', async (): Promise<void> => {
  const nominatim = new FakeHttp((): HttpResponse => jsonResponse([
    { lat: '31.2235', lon: '121.4454', display_name: '静安寺, 静安区, 上海市' }
  ]));
  const first = await geocodeAddress(nominatim, '静安寺');
  assert.ok(first !== undefined);
  if (first !== undefined) {
    assert.equal(first.source, 'nominatim');
    assert.equal(first.label, '静安寺, 静安区, 上海市');
  }

  const fallback = new FakeHttp((request: HttpRequest): HttpResponse => {
    if (request.url.indexOf('nominatim') >= 0) throw new Error('timeout');
    return jsonResponse({
      features: [{
        geometry: { coordinates: [121.4454, 31.2235] },
        properties: { name: '静安寺', city: '上海' }
      }]
    });
  });
  const second = await geocodeAddress(fallback, '静安寺');
  assert.ok(second !== undefined);
  if (second !== undefined) {
    assert.equal(second.source, 'photon');
    assert.ok(second.label.indexOf('静安寺') >= 0);
  }
});

test('地理编码：两边都失败返回 undefined（UI 提示再试，不编造）', async (): Promise<void> => {
  const client = new FakeHttp((): HttpResponse => ({ status: 500, body: '' }));
  assert.equal(await geocodeAddress(client, '不存在的地方'), undefined);
  assert.equal(await geocodeAddress(client, '  '), undefined);
});

test('反查：坐标 → 「区 · 街道」', (): void => {
  const parsed = parseNominatimReverse({
    address: { city_district: '静安区', road: '南京西路' },
    display_name: '南京西路, 静安区, 上海市'
  });
  assert.equal(parsed.area, '静安区');
  assert.equal(parsed.road, '南京西路');
  assert.equal(areaLabelFrom(parsed), '静安区 · 南京西路');
  assert.equal(areaLabelFrom(undefined), '');
  assert.equal(parseNominatim(undefined), undefined);
  assert.equal(parseNominatim([]), undefined);
});

// ============================================================
// 20. 步行路线（Valhalla）：折线解码 / 转向
// ============================================================

/** 手搓一个 polyline6：把 [lon, lat] 编码成 Valhalla 格式 */
function encodePolyline6(points: number[][]): string {
  let output: string = '';
  let lastLat: number = 0;
  let lastLon: number = 0;
  const encodeValue = (value: number): string => {
    let v: number = value < 0 ? ~(value << 1) : (value << 1);
    let out: string = '';
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
    return out;
  };
  for (let i = 0; i < points.length; i += 1) {
    const lon = Math.round(points[i][0] * 1e6);
    const lat = Math.round(points[i][1] * 1e6);
    output += encodeValue(lat - lastLat);
    output += encodeValue(lon - lastLon);
    lastLat = lat;
    lastLon = lon;
  }
  return output;
}

test('路线：polyline6 编解码往返一致', (): void => {
  const points: number[][] = [[121.4737, 31.2304], [121.4737, 31.2324], [121.4767, 31.2324]];
  const encoded: string = encodePolyline6(points);
  const decoded: number[][] = decodePolyline6(encoded);
  assert.equal(decoded.length, points.length);
  for (let i = 0; i < points.length; i += 1) {
    assert.ok(Math.abs(decoded[i][0] - points[i][0]) < 0.000001, '经度应还原');
    assert.ok(Math.abs(decoded[i][1] - points[i][1]) < 0.000001, '纬度应还原');
  }
  assert.equal(decodePolyline6('').length, 0);
});

test('路线：解析 Valhalla（距离 / 转向序列 / 累计里程）', (): void => {
  const points: number[][] = [[121.4737, 31.2304], [121.4737, 31.2344]];
  const json: Record<string, unknown> = {
    trip: {
      legs: [{
        shape: encodePolyline6(points),
        summary: { length: 0.48, time: 380 },
        maneuvers: [
          { type: 1, length: 0.3 },
          { type: 15, length: 0.18 },
          { type: 4, length: 0 }
        ]
      }]
    }
  };
  const route = parseValhalla(json);
  assert.ok(route !== undefined);
  if (route === undefined) return;
  assert.equal(route.distanceMeters, 480);
  assert.equal(route.points.length, 2);
  assert.equal(route.maneuvers.length, 3);
  assert.equal(route.maneuvers[0].direction, 'start');
  assert.equal(route.maneuvers[1].direction, 'left');
  assert.equal(route.maneuvers[1].label, '左拐');
  assert.equal(route.maneuvers[1].cumulative, 300, '第二个转向在 300m 处');
  assert.equal(route.maneuvers[2].direction, 'arrive');
  assert.equal(parseValhalla({}), undefined);
  assert.equal(parseValhalla({ trip: { legs: [] } }), undefined);
});

test('迷雾路径：传 upBearing 时地图随朝向旋转（转身地图跟着转）', () => {
  // 一条正北方向 200m 的直线路线
  const line = {
    points: [[118.78, 32.06], [118.78, 32.0618]] as number[][],
    distanceMeters: 200
  };
  const here = { latitude: 32.06, longitude: 118.78 };
  const layout = defaultLayout(320, 196);

  const northUp = fogGeometry(line, here, layout);
  const eastUp = fogGeometry(line, here, layout, 90);

  // 路线朝北（bearing≈0）：朝上时路径竖直；朝向改为东（90°）后应旋转 90°
  assert.ok(Math.abs(northUp.compassRotation) < 5, '无罗盘时按路线方向（≈0°）');
  assert.ok(Math.abs(eastUp.compassRotation + 90) < 5, '朝向 90° 时指北针转 -90°');
  assert.notEqual(northUp.segments.length, 0);
  assert.notEqual(eastUp.segments.length, 0);
  // 屏幕坐标应明显不同（旋转生效）：取同一段的中点比较
  const a = northUp.segments[Math.floor(northUp.segments.length / 2)];
  const b = eastUp.segments[Math.floor(eastUp.segments.length / 2)];
  const samePoint: boolean = Math.abs(a.x1 - b.x1) < 0.5 && Math.abs(a.y1 - b.y1) < 0.5;
  assert.equal(samePoint, false, '几何应随朝向旋转');

  // 北朝上（upBearing=0）时，画布上方=正北；行进箭头角度应等于路线方向，而不是 0
  const northFixed = fogGeometry(line, here, layout, 0);
  assert.equal(Math.abs(northFixed.compassRotation) < 0.001, true, '北朝上时指北针指北');
  const firstChevron = northFixed.chevrons[0];
  assert.ok(firstChevron !== undefined, '应有行进箭头');
  assert.ok(Math.abs(firstChevron.angle) < 10, '正北向路线在北朝上时箭头朝上');

  // 跟随朝向且设备朝东（90°）时，「你」的箭头应为 0°（屏幕上方）
  const followEast = fogGeometry(line, here, layout, 90, 90);
  assert.equal(Math.round(followEast.userRotation), 0, '跟随模式箭头恒朝上');
  const northEast = fogGeometry(line, here, layout, 0, 90);
  assert.equal(Math.round(northEast.userRotation), 90, '北朝上模式箭头按朝向旋转');
});

test('路线：取路线带 10 分钟缓存；失败返回 undefined（不阻塞）', async (): Promise<void> => {
  const points: number[][] = [[121.4737, 31.2304], [121.4737, 31.2344]];
  let calls: number = 0;
  const client = new FakeHttp((): HttpResponse => {
    calls += 1;
    return jsonResponse({
      trip: {
        legs: [{
          shape: encodePolyline6(points),
          summary: { length: 0.48 },
          maneuvers: [{ type: 1, length: 0.48 }, { type: 4, length: 0 }]
        }]
      }
    });
  });
  const from: GeoPoint = geoPoint(31.2304, 121.4737);
  const to: GeoPoint = geoPoint(31.2344, 121.4737);
  const now: number = 1700000000000;
  const first = await fetchWalkingRoute(client, from, to, now);
  assert.ok(first !== undefined);
  const second = await fetchWalkingRoute(client, from, to, now + 1000);
  assert.ok(second !== undefined);
  assert.equal(calls, 1, '10 分钟内应命中缓存');
  await fetchWalkingRoute(client, from, to, now + ROUTE_CACHE_TTL_MS + 1);
  assert.equal(calls, 2, '过期后应重新请求');

  const failing = new FakeHttp((): HttpResponse => ({ status: 500, body: '' }));
  const failed = await fetchWalkingRoute(failing, geoPoint(30, 120), geoPoint(30.01, 120.01), now);
  assert.equal(failed, undefined, '路线失败应返回 undefined 让 UI 降级');

  if (first !== undefined) {
    const polyline = toRoutePolyline(first, now);
    assert.equal(polyline.distanceMeters, first.distanceMeters);
    assert.equal(polyline.fetchedAt, now);
  }
});

// ============================================================
// 21. 图鉴「附近惊喜」隐晦提示（对齐 Web v46 / iOS）
// ============================================================

/** 造一颗可完全控制的惊喜（每个字段都填成「可识别的剧透值」） */
function spoilerSurprise(overrides: Partial<BuriedSurprise> = {}): BuriedSurprise {
  const base: BuriedSurprise = {
    id: 'surprise-spoiler-001',
    authorName: '小满',
    authorEmoji: '🐱',
    location: geoPoint(31.2344, 121.4737),
    areaWord: '静安 · 街角咖啡店后门',
    hints: ['往灯最暖的那扇窗走。', '找一块回声很大的地方。', '台阶有点滑。慢一点。'],
    photoHash: '6f4b1d2a9c3e8057',
    photoUri: 'file:///sandbox/secret-photo.jpg',
    buriedAt: 1700000000000,
    found: false
  };
  if (Object.keys(overrides).length === 0) return base;
  const merged: BuriedSurprise = {
    id: overrides.id === undefined ? base.id : overrides.id,
    authorName: overrides.authorName === undefined ? base.authorName : overrides.authorName,
    authorEmoji: overrides.authorEmoji === undefined ? base.authorEmoji : overrides.authorEmoji,
    location: overrides.location === undefined ? base.location : overrides.location,
    areaWord: overrides.areaWord === undefined ? base.areaWord : overrides.areaWord,
    hints: overrides.hints === undefined ? base.hints : overrides.hints,
    photoHash: overrides.photoHash === undefined ? base.photoHash : overrides.photoHash,
    photoUri: overrides.photoUri === undefined ? base.photoUri : overrides.photoUri,
    buriedAt: overrides.buriedAt === undefined ? base.buriedAt : overrides.buriedAt,
    found: overrides.found === undefined ? base.found : overrides.found
  };
  return merged;
}

test('提示：距离分档逐字对齐 Web v46（7 档 + 未知）', (): void => {
  assert.equal(DISTANCE_UNKNOWN_TEXT, '位置未知');
  assert.equal(distanceBucket(undefined), '位置未知');
  assert.equal(distanceBucket(NaN), '位置未知');
  assert.equal(distanceBucket(Infinity), '位置未知');
  assert.equal(distanceBucket(0), '就在附近几步');
  assert.equal(distanceBucket(120), '就在附近几步', '≤120 边界');
  assert.equal(distanceBucket(121), '大概一两百米');
  assert.equal(distanceBucket(350), '大概一两百米', '≤350 边界');
  assert.equal(distanceBucket(351), '走过去几分钟');
  assert.equal(distanceBucket(800), '走过去几分钟', '≤800 边界');
  assert.equal(distanceBucket(801), '要走一段路');
  assert.equal(distanceBucket(2000), '要走一段路', '≤2000 边界');
  assert.equal(distanceBucket(2001), '在比较远的地方');
  assert.equal(distanceBucket(8000), '在比较远的地方', '≤8000 边界');
  assert.equal(distanceBucket(8001), '不在附近，需要专程去');
  // isFarBucket 与分档一致（>800 算远）
  assert.equal(isFarBucket(800), false);
  assert.equal(isFarBucket(801), true);
  assert.equal(isFarBucket(undefined), true);
});

test('提示：氛围池 7 条逐字对齐，且按 id 稳定选择', (): void => {
  assert.equal(HINT_ATMOSPHERE.length, 7);
  assert.deepEqual(HINT_ATMOSPHERE, [
    '那儿光线不错，适合停下来喘口气。',
    '有人在那儿等到过一次意外的好天气。',
    '那个角落平时没什么人经过。',
    '声音会变小，风会变大一点。',
    '走到那儿大概会想掏出手机拍点什么。',
    '那里有一小块能坐下来的地方。',
    '路过的人都很赶，只有你可能会停。'
  ]);
  // 同一个 id 永远同一句（刷新不会变）
  const a = hintForSurprise('surprise-abc', 0);
  const b = hintForSurprise('surprise-abc', 0);
  assert.equal(a, b);
  // 结果一定来自池子
  for (let i = 0; i < 30; i += 1) {
    const picked = hintForSurprise('surprise-' + String(i), i % 3);
    assert.ok(HINT_ATMOSPHERE.indexOf(picked) >= 0, '必须来自氛围池');
  }
  // 相邻几条尽量不同（同屏不重复）
  const set = new Set<string>();
  set.add(hintForSurprise('s-1', 0));
  set.add(hintForSurprise('s-2', 1));
  set.add(hintForSurprise('s-3', 2));
  assert.ok(set.size >= 2, '同屏 3 条不应全一样');
  // 空 id 也不炸
  assert.ok(HINT_ATMOSPHERE.indexOf(hintForSurprise('', 0)) >= 0);
});

test('保密（铁律）：NearHint 里绝不能出现区域/消息/照片/坐标/作者名', (): void => {
  const surprise = spoilerSurprise();
  const hint: NearHint = makeNearHint(surprise, 0, 480);

  // 1) 结构上就不该有这些字段
  const record: Record<string, unknown> = hint as unknown as Record<string, unknown>;
  const forbiddenFields: string[] = [
    'areaWord', 'areaLabel', 'message', 'hints', 'photoUri', 'photoHash',
    'photoName', 'location', 'latitude', 'longitude', 'authorName'
  ];
  for (const field of forbiddenFields) {
    assert.equal(record[field], undefined, 'NearHint 不得包含字段 ' + field);
  }

  // 2) 序列化后不得出现任何剧透内容
  const json: string = JSON.stringify(hint);
  const spoilers: string[] = [
    surprise.areaWord,              // 「静安 · 街角咖啡店后门」
    '静安',
    '咖啡店',
    '后门',
    surprise.photoUri,              // file:///sandbox/secret-photo.jpg
    surprise.photoHash,
    'secret-photo',
    surprise.authorName,            // 「小满」
    surprise.hints[0],
    surprise.hints[1],
    surprise.hints[2],
    '灯最暖',
    '回声',
    String(surprise.location.latitude),
    String(surprise.location.longitude),
    '31.2344',
    '121.4737'
  ];
  for (const text of spoilers) {
    assert.equal(json.indexOf(text) < 0, true, 'NearHint 泄露了「' + text + '」：' + json);
  }

  // 3) 只允许：id / emoji / 分档文案 / 氛围句 / 取整距离
  const keys: string[] = Object.keys(hint);
  assert.equal(keys.length, 5, 'NearHint 只应有 5 个字段，实际：' + keys.join(','));
  assert.ok(keys.indexOf('id') >= 0);
  assert.ok(keys.indexOf('emoji') >= 0);
  assert.ok(keys.indexOf('distanceText') >= 0);
  assert.ok(keys.indexOf('atmosphere') >= 0);
  assert.ok(keys.indexOf('distanceMeters') >= 0);

  // 4) 距离只进 distanceMeters（取整），不进文案
  assert.equal(hint.distanceMeters, 480);
  assert.equal(hint.distanceText, '走过去几分钟');
  assert.equal(hint.distanceText.indexOf('480'), -1, '分档文案不能含精确数字');
  assert.equal(hint.emoji, '🐱', '作者 emoji 是唯一允许的社交信息');
});

test('保密（铁律）：nearbyHints 整体输出也不含任何剧透', (): void => {
  const origin: GeoPoint = geoPoint(31.2304, 121.4737);
  const list: BuriedSurprise[] = [
    spoilerSurprise({ id: 'sp-near', authorName: '小满', areaWord: '静安 · 街角咖啡店后门' }),
    spoilerSurprise({ id: 'sp-mid', authorName: '阿岛', areaWord: '河岸 · 桥洞下第三块石阶' }),
    spoilerSurprise({ id: 'sp-far', authorName: '77', areaWord: '老城区 · 洗衣店门口' }),
    spoilerSurprise({ id: 'sp-veryfar', authorName: '老陈', areaWord: '附近 · 广场最东侧' })
  ];
  const hints: NearHint[] = nearbyHints(list, origin, '阿澈', 3);
  const json: string = JSON.stringify(hints);

  for (const surprise of list) {
    assert.equal(json.indexOf(surprise.areaWord) < 0, true, '不得出现区域名 ' + surprise.areaWord);
    assert.equal(json.indexOf(surprise.photoUri) < 0, true, '不得出现照片 URI');
    assert.equal(json.indexOf(surprise.photoHash) < 0, true, '不得出现照片哈希');
    assert.equal(json.indexOf(surprise.authorName) < 0, true, '不得出现作者名 ' + surprise.authorName);
    for (const hintText of surprise.hints) {
      assert.equal(json.indexOf(hintText) < 0, true, '不得出现作者线索「' + hintText + '」');
    }
    assert.equal(json.indexOf(String(surprise.location.latitude)) < 0, true, '不得出现坐标');
  }
  assert.equal(json.indexOf('静安') < 0, true, '不得出现「静安」');
  assert.equal(json.indexOf('桥洞') < 0, true, '不得出现「桥洞」');
  assert.equal(json.indexOf('石阶') < 0, true, '不得出现「石阶」');
  assert.equal(json.indexOf('洗衣店') < 0, true, '不得出现「洗衣店」');
});

test('提示列表：按距离升序、排除已找到与自己埋的、最多 3 条', (): void => {
  const origin: GeoPoint = geoPoint(31.2304, 121.4737);
  // 纬度每 +0.001 ≈ 111 米
  const near: BuriedSurprise = spoilerSurprise({ id: 'a-near', location: geoPoint(31.2312, 121.4737) });   // ~89m
  const mid: BuriedSurprise = spoilerSurprise({ id: 'b-mid', location: geoPoint(31.2321, 121.4737) });     // ~189m
  const far: BuriedSurprise = spoilerSurprise({ id: 'c-far', location: geoPoint(31.2330, 121.4737) });     // ~289m
  const found: BuriedSurprise = spoilerSurprise({ id: 'd-found', location: geoPoint(31.2305, 121.4737), found: true });
  const mine: BuriedSurprise = spoilerSurprise({ id: 'e-mine', location: geoPoint(31.2306, 121.4737), authorName: '阿澈' });

  const hints: NearHint[] = nearbyHints([far, found, mine, near, mid], origin, '阿澈');
  assert.equal(hints.length, 3, '最多 3 条');
  assert.deepEqual(hints.map((h: NearHint): string => h.id), ['a-near', 'b-mid', 'c-far'],
    '应按距离升序，且排除已找到 / 自己埋的');

  // limit 可调
  assert.equal(nearbyHints([near, mid, far], origin, '阿澈', 2).length, 2);
  assert.equal(nearbyHints([near, mid, far], origin, '阿澈', 10).length, 3);
  assert.equal(nearbyHints([], origin, '阿澈').length, 0);
  assert.equal(NEARBY_HINT_LIMIT, 3);

  // 分档与真实距离一致
  assert.equal(hints[0].distanceText, '就在附近几步');
  assert.equal(hints[1].distanceText, '大概一两百米');
  assert.equal(hints[2].distanceText, '大概一两百米');
});

test('提示列表：没有定位时仍显示，文案为「位置未知」且排最后', (): void => {
  const withDist: BuriedSurprise = spoilerSurprise({ id: 'a', location: geoPoint(31.2312, 121.4737) });
  const list: BuriedSurprise[] = [withDist, spoilerSurprise({ id: 'b' }), spoilerSurprise({ id: 'c' })];

  const noLocation: NearHint[] = nearbyHints(list, undefined, '阿澈');
  assert.equal(noLocation.length, 3, '没定位也要提示（不是隐藏）');
  for (const hint of noLocation) {
    assert.equal(hint.distanceText, '位置未知');
    assert.equal(hint.distanceMeters, undefined, '没定位就不该有距离数字');
  }

  // 有定位时：有距离的排前面，且能正常分档
  const origin: GeoPoint = geoPoint(31.2304, 121.4737);
  const withLocation: NearHint[] = nearbyHints(list, origin, '阿澈');
  assert.equal(withLocation.length, 3);
  assert.equal(withLocation[0].distanceText, '就在附近几步', '≈89m 应该是最近的一档');
  assert.ok(withLocation[0].distanceMeters !== undefined);
  // 其余两颗（同一位置 31.2344）也应有距离
  for (let i = 0; i < withLocation.length; i += 1) {
    assert.notEqual(withLocation[i].distanceText, DISTANCE_UNKNOWN_TEXT);
  }
});

test('提示列表：计数文案与空状态 CTA（三端逐字一致）', (): void => {
  assert.equal(nearbyHintCountText(0), '这一带暂时没有');
  assert.equal(nearbyHintCountText(1), '1 个还没被找到');
  assert.equal(nearbyHintCountText(3), '3 个还没被找到');
  assert.equal(HINT_EMPTY_CTA, '有人在这儿留下第一张？埋一个 →');
  assert.equal(HINT_TITLE_SUFFIX, '有人留下一张照片');
  assert.equal(HINT_FOOTER, '线索要靠走近才会解锁 · 点这里开始找');
});

test('提示列表：Store 快照里就是可用的输入（三颗演示惊喜）', async (): Promise<void> => {
  const store: BlindWalkStoreApi = await freshStore();
  const snapshot = store.snapshot();
  assert.equal(snapshot.explorableSurprises.length, 3, '演示预置 3 颗待寻');
  const hints: NearHint[] = nearbyHints(
    snapshot.explorableSurprises,
    snapshot.lastKnownOrigin,
    snapshot.profile.name
  );
  assert.equal(hints.length, 3);
  for (const hint of hints) {
    assert.ok(hint.id.length > 0);
    assert.ok(hint.atmosphere.length > 0);
    assert.ok(hint.distanceText.length > 0);
  }
});

// ============================================================
// 22. 探寻页：三阶线索按距离解锁
// ============================================================

test('探寻：距离分三档解锁（起点 1 条 / 3×半径 2 条 / 半径内 3 条）', (): void => {
  const surprise: BuriedSurprise = spoilerSurprise({
    location: geoPoint(31.2304, 121.4737),
    hints: ['第一条', '第二条', '第三条']
  });

  // 1) 很近（≤60m）→ 全解锁 + 可拍
  const atDoor = seekClueState(surprise, geoPoint(31.2304, 121.4737 + 0.0002), false);
  assert.equal(atDoor.unlockedCount, 3);
  assert.equal(atDoor.inRange, true);
  assert.deepEqual(atDoor.lines, ['第一条', '第二条', '第三条']);
  assert.equal(atDoor.distanceText, '就在附近几步');

  // 2) 中距离（≤180m，>60m）→ 2 条
  const nearbyish = seekClueState(surprise, geoPoint(31.2313, 121.4737), false);
  assert.equal(nearbyish.unlockedCount, 2, '≈100m 应解锁 2 条');
  assert.equal(nearbyish.inRange, false);
  assert.equal(nearbyish.lines[2], LOCKED_CLUE_TEXT);
  assert.equal(nearbyish.lines[0], '第一条');

  // 3) 远（>180m）→ 只有第 1 条
  const farAway = seekClueState(surprise, geoPoint(31.2400, 121.4737), false);
  assert.equal(farAway.unlockedCount, 1, '≈1km 只剩第 1 条');
  assert.equal(farAway.lines[1], LOCKED_CLUE_TEXT);
  assert.equal(farAway.lines[2], LOCKED_CLUE_TEXT);
  assert.equal(farAway.inRange, false);
});

test('探寻：没定位时只解锁第 1 条，并明确说明（不假装解锁）', (): void => {
  const surprise: BuriedSurprise = spoilerSurprise({ hints: makeClues('叶子的反面比正面浅。') });
  const state = seekClueState(surprise, undefined, false);
  assert.equal(state.unlockedCount, 1);
  assert.equal(state.inRange, false);
  assert.equal(state.distanceMeters, undefined);
  assert.equal(state.distanceText, DISTANCE_UNKNOWN_TEXT);
  assert.equal(state.lines[1], LOCKED_CLUE_TEXT);
  assert.equal(state.lines[2], LOCKED_CLUE_TEXT);

  const lead: string = seekLeadText(state);
  assert.equal(lead, SEEK_NO_LOCATION_TEXT);
  assert.equal(SEEK_NO_LOCATION_TEXT, '拿不到定位，线索暂时解锁不了');
});

test('探寻：点「当作到了（演示）」全解锁，但必须标记 demoArrived', (): void => {
  const surprise: BuriedSurprise = spoilerSurprise({ hints: ['甲', '乙', '丙'] });
  const state = seekClueState(surprise, undefined, true);
  assert.equal(state.unlockedCount, 3);
  assert.equal(state.inRange, true);
  assert.equal(state.demoArrived, true, 'UI 必须能区分「真到了」和「演示」');
  assert.equal(seekLeadText(state), '演示：已当作你走到了这里。');
});

test('探寻：线索未解锁时不得泄露作者提示内容（只给占位文案）', (): void => {
  // 用真实的 makeClues() 结构：clue[0] 通用、clue[1] 作者提示、clue[2] 通用
  const authorHint: string = '往灯最暖的那扇窗走。';
  const clues: string[] = makeClues(authorHint);
  assert.equal(clues[0], '有人在这里放下了一张照片。先走近一点。', '第 1 条必须是通用句');
  assert.equal(clues[1], authorHint, '作者提示在第 2 条');
  const surprise: BuriedSurprise = spoilerSurprise({
    location: geoPoint(31.2304, 121.4737),
    hints: clues
  });
  const farAway = seekClueState(surprise, geoPoint(31.2400, 121.4737), false);
  const json: string = JSON.stringify(farAway);
  assert.equal(farAway.unlockedCount, 1, '1km 外只解锁第 1 条');
  assert.equal(json.indexOf('灯最暖') < 0, true, '作者提示（第 2 条）不得出现');
  assert.equal(json.indexOf('回声') < 0, true, '未解锁线索不得出现');
  assert.equal(json.indexOf('台阶') < 0, true, '未解锁线索不得出现');
  // 也不得出现区域名 / 照片
  assert.equal(json.indexOf(surprise.areaWord) < 0, true, '不得出现区域名');
  assert.equal(json.indexOf(surprise.photoUri) < 0, true, '不得出现照片 URI');
  assert.equal(json.indexOf(surprise.photoHash) < 0, true, '不得出现照片哈希');
  assert.equal(json.indexOf(String(surprise.location.latitude)) < 0, true, '不得出现坐标');
  // 保留的第 1 条是通用句，本身不含任何作者信息
  assert.equal(farAway.lines[0], clues[0]);
  assert.equal(farAway.lines[1], LOCKED_CLUE_TEXT);

  // 到达后才给全部线索（含作者提示）
  const atDoor = seekClueState(surprise, geoPoint(31.2304, 121.4737), false);
  assert.equal(atDoor.lines[1], authorHint);
  assert.equal(atDoor.lines[2], clues[2]);
});

test('探寻：半径可覆写（默认 60m，与苹果版一致）', (): void => {
  assert.equal(SURPRISE_RADIUS_METERS, 60);
  const surprise: BuriedSurprise = spoilerSurprise({ location: geoPoint(31.2304, 121.4737) });
  // 100 米：默认半径(60)下未到；半径 200 时算到了
  const far100 = geoPoint(31.2313, 121.4737);
  assert.equal(seekClueState(surprise, far100, false).inRange, false);
  assert.equal(seekClueState(surprise, far100, false, 200).inRange, true);
  assert.equal(seekClueState(surprise, far100, false, 200).unlockedCount, 3);
  // 非法半径回退默认
  assert.equal(seekClueState(surprise, far100, false, 0).inRange, false);
  assert.equal(seekClueState(surprise, far100, false, -5).inRange, false);
});

test('探寻：下一步文案（到了 / 还差多少米）', (): void => {
  const surprise: BuriedSurprise = spoilerSurprise({ location: geoPoint(31.2304, 121.4737) });
  const atDoor = seekClueState(surprise, geoPoint(31.2304, 121.4737), false);
  assert.equal(seekLeadText(atDoor), '你到了。抬手机，找到 TA 的角度。');

  const about150 = seekClueState(surprise, geoPoint(31.23175, 121.4737), false);
  assert.ok(about150.distanceMeters !== undefined);
  if (about150.distanceMeters !== undefined) {
    const gap = Math.round(about150.distanceMeters - SURPRISE_RADIUS_METERS);
    assert.equal(seekLeadText(about150), '再走近 ' + String(gap) + ' 米。');
  }
});

test('探寻（不变量）：makeClues 的第 1 条永远是通用句，作者提示只在第 2 条', (): void => {
  // 这条不变量是「起点即解锁第 1 条」安全的前提：
  // 如果哪天有人把作者提示挪到 index 0，1km 外就会直接看到答案。
  const generic: string = '有人在这里放下了一张照片。先走近一点。';
  const withHint: string[] = makeClues('往灯最暖的那扇窗走。');
  assert.equal(withHint.length, 3);
  assert.equal(withHint[0], generic, '第 1 条必须是通用句');
  assert.equal(withHint[1], '往灯最暖的那扇窗走。', '作者提示必须在第 2 条');
  assert.ok(withHint[2].length > 0);

  const noHint: string[] = makeClues(undefined);
  assert.equal(noHint[0], generic);
  assert.ok(noHint[1].length > 0, '没有作者提示也要有通用第 2 条');
  assert.equal(noHint[1].indexOf('灯最暖'), -1);

  const emptyHint: string[] = makeClues('');
  assert.equal(emptyHint[0], generic);
  assert.equal(emptyHint[1], '找到能把眼前的画面装进取景框的位置。');

  // 无论哪种，第 1 条都不含地名/照片信息
  for (const clues of [withHint, noHint, emptyHint]) {
    assert.equal(clues[0].indexOf('灯'), -1);
    assert.equal(clues[0].indexOf('窗'), -1);
  }
});

test('常量：探寻页文案与 Web v46 一致', (): void => {
  assert.equal(LOCKED_CLUE_TEXT, '再走近一点…');
  assert.equal(SEEK_NO_LOCATION_TEXT, '拿不到定位，线索暂时解锁不了');
  assert.equal(seekLeadText(seekClueState(spoilerSurprise(), undefined, false)), SEEK_NO_LOCATION_TEXT);
});

// ============================================================
// Runner
// ============================================================

async function main(): Promise<void> {
  let failures: number = 0;
  for (let i = 0; i < cases.length; i += 1) {
    const item: TestCase = cases[i];
    try {
      await item.run();
      console.log('PASS · ' + item.name);
    } catch (error) {
      failures += 1;
      let message: string = '';
      if (error instanceof Error) message = error.message;
      else message = String(error);
      console.log('FAIL · ' + item.name + ' — ' + message);
    }
  }
  console.log('');
  console.log('测试结果：' + String(cases.length - failures) + '/' + String(cases.length) + ' 通过');
  if (failures > 0) {
    console.log('存在失败用例');
    process.exitCode = 1;
  } else {
    console.log('全部通过');
  }
}

main().catch((error: unknown): void => {
  let message: string = '';
  if (error instanceof Error) message = error.message;
  else message = String(error);
  console.log('测试运行器异常：' + message);
  process.exitCode = 1;
});
