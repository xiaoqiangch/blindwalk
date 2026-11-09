/**
 * 盲走 BlindWalk · HarmonyOS 逻辑层 — 演示数据
 *
 * 口径与 Web / iOS 完全一致（design-system §7、DemoData.swift）：
 * xp 4240（Lv.6 黄昏猎人，240/800）、连续 12 天、18 张卡（稀有 7 / 隐藏 1）、
 * 本周惊喜值 305、42.6 km、18 盒、正在走第 3 个盲盒（旧码头边的石阶，剩 480m / 共 1260m）。
 *
 * 说明：为了「本周惊喜值 = 305」在任何时刻打开都稳定，12 次到达覆盖最近 7 个自然日
 * （每天 1 次，含 06:12 与 22:40 各一次），与 DemoData.swift 的修正版一致。
 */

import {
  Area,
  BuriedSurprise,
  FeedPost,
  GeoPoint,
  Mood,
  Place,
  PlaceCard,
  Profile,
  QuestPhase,
  QuestSession,
  WalkDuration
} from './types';
import { PLACES, placeByID } from './catalog';
import { makeClues } from './surprise';
import { mockPosts, demoMinePosts } from './social';
import { offset } from './geo';
import { StoreExtras } from './persistence';

/** 演示坐标：上海人民广场（模拟器/无定位时用） */
export const DEMO_ORIGIN: GeoPoint = { latitude: 31.2304, longitude: 121.4737 };

/** 演示态里「正在走」的盲盒编号（design-system §5.4） */
export const DEMO_REVEAL_SERIAL: string = '0247';

/** 演示态正在走的地点 */
export const DEMO_JOURNEY_PLACE_ID: string = 'river-steps';

/** DemoData.collectedPlaceIDs：18 张已收集 */
export const DEMO_COLLECTED_PLACE_IDS: string[] = [
  // 常见 11
  'river-bench-07', 'river-boardwalk', 'river-carwash',
  'near-store-hotdrink', 'near-swing', 'near-basketball', 'near-library-steps',
  'near-flower-cart', 'old-flower-shop', 'old-chess', 'old-tailor-eave',
  // 稀有 4
  'river-steps', 'river-kites', 'river-bookstore', 'old-watch-repair',
  // 史诗 2
  'river-graffiti', 'old-records',
  // 隐藏 1
  'near-laundromat'
];

const DAY_MS: number = 86400000;

function pad4(value: number): string {
  let text: string = String(value);
  while (text.length < 4) text = '0' + text;
  return text;
}

/** 本地时间：今天零点往前 daysAgo 天的 hour:minute */
function localDaysAgoAt(now: number, daysAgo: number, hour: number, minute: number): number {
  const date: Date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

/** 演示卡片：18 张，日期取 index + 3 天前（design-system §5.1「已是 3 天前」） */
export function demoCards(now: number): PlaceCard[] {
  const cards: PlaceCard[] = [];
  for (let index = 0; index < DEMO_COLLECTED_PLACE_IDS.length; index += 1) {
    const placeID: string = DEMO_COLLECTED_PLACE_IDS[index];
    if (placeByID(placeID) === undefined) continue;
    let hour: number = 19;
    let minute: number = 12;
    if (index === 5) {
      hour = 6; // 清晨：解锁 early_bird
    } else if (index === 8) {
      hour = 22; // 深夜：解锁 night_owl
      minute = 40;
    }
    const collectedAt: number = localDaysAgoAt(now, index + 3, hour, minute);
    const card: PlaceCard = {
      id: 'demo-card-' + placeID,
      placeID: placeID,
      serial: pad4(101 + (index * 37) % 9000),
      collectedAt: collectedAt,
      taskDone: index % 3 !== 0
    };
    cards.push(card);
  }
  return cards;
}

/** 12 次到达：最近 7 个自然日每天 1 次，含清晨与深夜各一次 */
export function demoArrivalTimes(now: number): number[] {
  const arrivals: number[] = [];
  for (let day = 0; day < 12; day += 1) {
    let hour: number = 19;
    let minute: number = 12;
    if (day === 5) {
      hour = 6;
    } else if (day === 8) {
      hour = 22;
      minute = 40;
    }
    let timestamp: number = localDaysAgoAt(now, day, hour, minute);
    if (timestamp > now) timestamp = now - 60 * 1000;
    arrivals.push(timestamp);
  }
  return arrivals;
}

/** 演示档案（18 张卡 / 12 天 / 4240 xp / 305 周惊喜值） */
export function demoProfile(now: number): Profile {
  const cards: PlaceCard[] = demoCards(now);
  const startOfToday: Date = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const profile: Profile = {
    name: '阿澈',
    avatarEmoji: '🫥',
    xp: 4240,
    streakDays: 12,
    cards: cards,
    achievements: [],
    weeklySurprise: 305,
    weeklyWindowStart: startOfToday.getTime() - 6 * DAY_MS
  };
  return profile;
}

/** 演示动态：本人 2 条置顶 + 好友 4 条 */
export function demoFeed(now: number): FeedPost[] {
  return demoMinePosts(now, '阿澈').concat(mockPosts(now));
}

/** 演示运行时数据（里程 / 到达 / 动态） */
export function demoExtras(now: number): StoreExtras {
  const arrivals: number[] = demoArrivalTimes(now);
  const extras: StoreExtras = {
    totalKm: 42.6,
    boxesOpened: 18,
    walkArrivalTimes: arrivals,
    togetherCount: 0,
    lastWalkAt: arrivals[0],
    feed: demoFeed(now),
    realPlaces: [],
    consolationPaid: []
  };
  return extras;
}

/** 演示中的「正在走」旅程：总 1260m，已走 780m，剩余 480m，第 1 条线索已解锁 */
export function demoSession(now: number): QuestSession {
  const session: QuestSession = {
    id: 'demo-quest-3',
    placeID: DEMO_JOURNEY_PLACE_ID,
    startedAt: now - (12 * 60 + 34) * 1000,
    totalMeters: 1260,
    remainingMeters: 480,
    phase: QuestPhase.Walking,
    unlockedHintCount: 1
  };
  return session;
}

function demoSurprise(
  id: string,
  authorName: string,
  authorEmoji: string,
  anchor: GeoPoint,
  meters: number,
  bearing: number,
  areaWord: string,
  hint: string,
  photoHash: string,
  photoUri: string,
  buriedAt: number
): BuriedSurprise {
  const location: GeoPoint = offset(anchor, meters, bearing);
  const surprise: BuriedSurprise = {
    id: id,
    authorName: authorName,
    authorEmoji: authorEmoji,
    location: location,
    areaWord: areaWord,
    hints: makeClues(hint),
    photoHash: photoHash,
    photoUri: photoUri,
    buriedAt: buriedAt,
    found: false
  };
  return surprise;
}

/**
 * 预置的「别人埋的惊喜」：
 * 3 条等待中被找到（320m / 540m / 760m，按方位散开）+ 1 条已被别人找到（社区感）。
 */
export function demoSurprises(now: number, origin?: GeoPoint): BuriedSurprise[] {
  const anchor: GeoPoint = origin === undefined ? DEMO_ORIGIN : origin;
  const list: BuriedSurprise[] = [
    demoSurprise(
      'demo-surprise-1', '小满', '🐱', anchor, 320, 24, '静安 · 街角',
      '往灯最暖的那扇窗走。',
      '6f4b1d2a9c3e8057', 'surprise-seed-1.jpg', now - 3 * DAY_MS
    ),
    demoSurprise(
      'demo-surprise-2', '阿岛', '🎧', anchor, 540, 118, '河岸 · 桥洞',
      '找一块回声很大的地方。',
      'a1c07f3e5b2d9944', 'surprise-seed-2.jpg', now - 5 * DAY_MS
    ),
    demoSurprise(
      'demo-surprise-3', '77', '🌙', anchor, 760, 300, '附近 · 街口',
      '找一块很亮的玻璃，里面在转。',
      '19e8b4d7f6a02c53', 'surprise-seed-3.jpg', now - 8 * DAY_MS
    ),
    {
      id: 'demo-surprise-4',
      authorName: '老陈',
      authorEmoji: '🍜',
      location: offset(anchor, 210, 200),
      areaWord: '老城区 · 街口',
      hints: makeClues('闻，有热汤的味道。'),
      photoHash: 'c5d2a9f01b6e8374',
      photoUri: 'surprise-seed-4.jpg',
      buriedAt: now - 11 * DAY_MS,
      found: true,
      myPhotoUri: 'surprise-found-1.jpg',
      similarity: 0.78
    }
  ];
  return list;
}

/** 演示态聚合：一次拿到 store 初始化所需的全部数据 */
export interface DemoState {
  profile: Profile;
  extras: StoreExtras;
  surprises: BuriedSurprise[];
  session: QuestSession;
  currentPlaceID: string;
  lastKnownOrigin: GeoPoint;
  revealSerial: string;
  selectedMood: Mood;
  selectedDuration: WalkDuration;
  selectedArea: Area | undefined;
}

/** 生成完整演示态 */
export function demoState(now: number): DemoState {
  const state: DemoState = {
    profile: demoProfile(now),
    extras: demoExtras(now),
    surprises: demoSurprises(now),
    session: demoSession(now),
    currentPlaceID: DEMO_JOURNEY_PLACE_ID,
    lastKnownOrigin: DEMO_ORIGIN,
    revealSerial: DEMO_REVEAL_SERIAL,
    selectedMood: Mood.Drift,
    selectedDuration: WalkDuration.M30,
    selectedArea: undefined
  };
  return state;
}

/** 让演示地点的名称可从 id 还原（图鉴 / 揭晓用） */
export function demoPlace(placeID: string): Place | undefined {
  return placeByID(placeID);
}

/** 全部内置地点（图鉴用） */
export function demoPlaces(): Place[] {
  return PLACES.slice();
}
