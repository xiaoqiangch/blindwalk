/**
 * 步迷 Walkaholic · HarmonyOS 逻辑层 — 成就判定
 *
 * 移植自 apple/Shared/Core/AchievementEngine.swift（13 个成就，含 3 个埋惊喜成就）。
 *
 * 与苹果版的差异（受 HarmonyOS 数据契约限制，契约里 Profile 没有对应字段）：
 * - first_box / walker_10：用 `cards.length` 近似 `boxesOpened`（每次收录追加一张卡）
 * - early_bird / night_owl：用 `cards[].collectedAt` 的小时近似「到达时间」
 * - together_1：契约没有同频散步计数，固定不可解锁（MVP 无同频功能）
 * - km_100：用 store 自维护的累计里程（不暴露在契约 Profile 里，由持久化 extras 保存）
 * - share_3：用 feed 里 isMine 的动态数
 * - bury_1 / seek_3 / found_5：用埋惊喜列表（作者名 == 当前用户名 视为我的）
 */

import {
  Achievement,
  BuriedSurprise,
  FeedPost,
  Profile
} from './types';
import { placeByID } from './catalog';

/** 成就定义（与 design-system §5.8 + 埋惊喜扩展一致） */
export interface AchievementDefinition {
  id: string;
  name: string;
  icon: string;
  detail: string;
  target: number;
}

export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  { id: 'first_box', name: '第一次拆盒', icon: '🎁', detail: '完成第 1 次步迷', target: 1 },
  { id: 'walker_10', name: '城市漫游者', icon: '🚶', detail: '完成 10 次步迷', target: 10 },
  { id: 'rare_first', name: '稀有体质', icon: '💎', detail: '首次获得稀有卡', target: 1 },
  { id: 'hidden_first', name: '挖到隐藏款', icon: '🗝️', detail: '首次获得隐藏卡', target: 1 },
  { id: 'early_bird', name: '早起的鸟', icon: '🌅', detail: '07:00 前到达', target: 1 },
  { id: 'night_owl', name: '夜行动物', icon: '🌙', detail: '22:00 后到达', target: 1 },
  { id: 'streak_7', name: '七日不断', icon: '🔥', detail: '连续 7 天开盒', target: 7 },
  { id: 'together_1', name: '同频共振', icon: '📡', detail: '完成 1 次同频散步', target: 1 },
  { id: 'share_3', name: '分享欲', icon: '📣', detail: '发布 3 条动态', target: 3 },
  { id: 'km_100', name: '步迷百公里', icon: '🧭', detail: '累计 100 km', target: 100 },
  { id: 'bury_1', name: '埋下一颗', icon: '🌱', detail: '第一次给别人埋下惊喜', target: 1 },
  { id: 'seek_3', name: '寻光者', icon: '🔎', detail: '找到 3 个别人埋的惊喜', target: 3 },
  { id: 'found_5', name: '被找到的人', icon: '💌', detail: '你埋的惊喜被找到 5 次', target: 5 }
];

/** 成就判定需要的上下文（超出契约 Profile 的运行时数据） */
export interface AchievementContext {
  profile: Profile;
  feed: FeedPost[];
  surprises: BuriedSurprise[];
  /** 累计里程（km）；由 store 的持久化 extras 维护 */
  totalKm: number;
}

export function achievementDefinition(id: string): AchievementDefinition | undefined {
  for (let i = 0; i < ACHIEVEMENT_DEFINITIONS.length; i += 1) {
    if (ACHIEVEMENT_DEFINITIONS[i].id === id) return ACHIEVEMENT_DEFINITIONS[i];
  }
  return undefined;
}

function cardRarityCounts(profile: Profile): number[] {
  // [非普通数量, 隐藏数量]
  let nonCommon: number = 0;
  let hidden: number = 0;
  for (let i = 0; i < profile.cards.length; i += 1) {
    const place = placeByID(profile.cards[i].placeID);
    if (place === undefined) continue;
    if (place.rarity !== 'common') nonCommon += 1;
    if (place.rarity === 'hidden') hidden += 1;
  }
  return [nonCommon, hidden];
}

/** 到达时间近似：收录卡片时的小时（local time） */
function hasCardHour(profile: Profile, predicate: (hour: number) => boolean): boolean {
  for (let i = 0; i < profile.cards.length; i += 1) {
    const hour: number = new Date(profile.cards[i].collectedAt).getHours();
    if (predicate(hour)) return true;
  }
  return false;
}

function countMySurprises(context: AchievementContext): number {
  let count: number = 0;
  for (let i = 0; i < context.surprises.length; i += 1) {
    if (context.surprises[i].authorName === context.profile.name) count += 1;
  }
  return count;
}

function countSeeked(context: AchievementContext): number {
  let count: number = 0;
  for (let i = 0; i < context.surprises.length; i += 1) {
    const item: BuriedSurprise = context.surprises[i];
    if (item.found && item.authorName !== context.profile.name) count += 1;
  }
  return count;
}

function countMineFound(context: AchievementContext): number {
  let count: number = 0;
  for (let i = 0; i < context.surprises.length; i += 1) {
    const item: BuriedSurprise = context.surprises[i];
    if (item.found && item.authorName === context.profile.name) count += 1;
  }
  return count;
}

function countMyPosts(feed: FeedPost[]): number {
  let count: number = 0;
  for (let i = 0; i < feed.length; i += 1) {
    if (feed[i].isMine) count += 1;
  }
  return count;
}

/** 计算当前进度（上限 = target） */
export function achievementProgress(id: string, context: AchievementContext): number {
  const profile: Profile = context.profile;
  let raw: number = 0;

  switch (id) {
    case 'first_box':
    case 'walker_10':
      raw = profile.cards.length;
      break;
    case 'rare_first':
      raw = cardRarityCounts(profile)[0];
      break;
    case 'hidden_first':
      raw = cardRarityCounts(profile)[1];
      break;
    case 'early_bird':
      raw = hasCardHour(profile, (hour: number): boolean => hour < 7) ? 1 : 0;
      break;
    case 'night_owl':
      raw = hasCardHour(profile, (hour: number): boolean => hour >= 22) ? 1 : 0;
      break;
    case 'streak_7':
      raw = profile.streakDays;
      break;
    case 'together_1':
      raw = 0; // 契约无同频计数；MVP 无同频功能
      break;
    case 'share_3':
      raw = countMyPosts(context.feed);
      break;
    case 'km_100':
      raw = Math.floor(context.totalKm);
      break;
    case 'bury_1':
      raw = countMySurprises(context);
      break;
    case 'seek_3':
      raw = countSeeked(context);
      break;
    case 'found_5':
      raw = countMineFound(context);
      break;
    default:
      raw = 0;
      break;
  }

  const definition: AchievementDefinition | undefined = achievementDefinition(id);
  if (definition === undefined) return raw;
  return Math.min(raw, definition.target);
}

/**
 * 同步成就状态：补齐 13 个成就、刷新 progress、首次达标时写入 unlockedAt。
 * @returns 本次新解锁的成就（UI 用来弹 toast）
 */
export function syncAchievements(context: AchievementContext, now: number): Achievement[] {
  const existing: Map<string, Achievement> = new Map<string, Achievement>();
  for (let i = 0; i < context.profile.achievements.length; i += 1) {
    const item: Achievement = context.profile.achievements[i];
    existing.set(item.id, item);
  }

  const unlockedNow: Achievement[] = [];
  const ordered: Achievement[] = [];

  for (let i = 0; i < ACHIEVEMENT_DEFINITIONS.length; i += 1) {
    const definition: AchievementDefinition = ACHIEVEMENT_DEFINITIONS[i];
    const stored: Achievement | undefined = existing.get(definition.id);
    const achievement: Achievement = {
      id: definition.id,
      name: definition.name,
      icon: definition.icon,
      detail: definition.detail,
      target: definition.target,
      progress: achievementProgress(definition.id, context)
    };
    if (stored !== undefined) {
      if (stored.unlockedAt !== undefined) achievement.unlockedAt = stored.unlockedAt;
    }
    if (achievement.unlockedAt === undefined && achievement.progress >= achievement.target) {
      achievement.unlockedAt = now;
      const unlocked: Achievement = {
        id: achievement.id,
        name: achievement.name,
        icon: achievement.icon,
        detail: achievement.detail,
        target: achievement.target,
        progress: achievement.progress,
        unlockedAt: now
      };
      unlockedNow.push(unlocked);
    }
    ordered.push(achievement);
  }

  context.profile.achievements = ordered;
  return unlockedNow;
}

/** 便捷：取某个成就（快照/UI 用） */
export function findAchievement(profile: Profile, id: string): Achievement | undefined {
  for (let i = 0; i < profile.achievements.length; i += 1) {
    if (profile.achievements[i].id === id) return profile.achievements[i];
  }
  return undefined;
}
