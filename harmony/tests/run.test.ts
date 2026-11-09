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
  HINT_THRESHOLDS,
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
  cloneSession,
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
  DEMO_ORIGIN,
  DEMO_REVEAL_SERIAL
} from '../entry/src/main/ets/core/demo';
import {
  MemoryKV,
  PROFILE_KEY,
  SURPRISES_KEY
} from '../entry/src/main/ets/core/persistence';
import { getStore, initStore, registerPlaces } from '../entry/src/main/ets/core/store';
import { distance, offset, bearing, compassLabel, arrow } from '../entry/src/main/ets/core/geo';

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
