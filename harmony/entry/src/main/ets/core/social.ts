/**
 * 步迷 Walkaholic · HarmonyOS 逻辑层 — 圈子 / 排行榜
 *
 * 移植自 apple/Shared/Core/SocialFeed.swift（MVP 无后端，全部本地 mock）。
 * 反应键使用契约里的 eyes / heart / next（对应羡慕 / 一起 / 下次带我）。
 */

import {
  FeedPost,
  LeaderboardEntry,
  Profile,
  Rarity
} from './types';
import { SeededGenerator } from './engine';

/** 演示用同频码（design-system §7 / Web 原型一致） */
export const DEMO_TOGETHER_CODE: string = 'K7M2QX';

const TOGETHER_ALPHABET: string = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 生成 6 位同频码（去掉易混字符），同 seed 可复现 */
export function makeTogetherCode(seed: number): string {
  const generator: SeededGenerator = new SeededGenerator(seed);
  let code: string = '';
  for (let i = 0; i < 6; i += 1) {
    const index: number = generator.nextInt(TOGETHER_ALPHABET.length);
    code += TOGETHER_ALPHABET.charAt(index);
  }
  return code;
}

function reactions(eyes: number, heart: number, next: number): Record<string, number> {
  const value: Record<string, number> = {
    eyes: eyes,
    heart: heart,
    next: next
  };
  return value;
}

function emptyReacted(): Record<string, boolean> {
  const value: Record<string, boolean> = {
    eyes: false,
    heart: false,
    next: false
  };
  return value;
}

function mockPost(
  id: string,
  authorName: string,
  authorEmoji: string,
  placeName: string,
  categoryEmoji: string,
  rarity: Rarity,
  caption: string,
  createdAt: number,
  eyes: number,
  heart: number,
  next: number
): FeedPost {
  const post: FeedPost = {
    id: id,
    authorName: authorName,
    authorEmoji: authorEmoji,
    placeName: placeName,
    categoryEmoji: categoryEmoji,
    rarity: rarity,
    caption: caption,
    createdAt: createdAt,
    reactions: reactions(eyes, heart, next),
    reacted: emptyReacted(),
    isMine: false
  };
  return post;
}

/** 好友动态（相对时间；4 条 mock） */
export function mockPosts(now: number): FeedPost[] {
  return [
    mockPost(
      'mock-1', '小满', '🐱', '旧仓库改的书店', '📚', Rarity.Rare,
      '本来只想路过，结果在里面坐了一个小时。',
      now - 12 * 60 * 1000, 12, 3, 5
    ),
    mockPost(
      'mock-2', '阿岛', '🎧', '桥洞下的小块涂鸦墙', '🎨', Rarity.Epic,
      '桥洞里回声很大，我对着墙说了句「你好」，它回了我三遍。',
      now - 48 * 60 * 1000, 21, 6, 9
    ),
    mockPost(
      'mock-3', '77', '🌙', '24 小时自助洗衣店', '🧺', Rarity.Hidden,
      '凌晨两点，洗衣机转起来像宇宙飞船。',
      now - 3 * 3600 * 1000, 31, 2, 14
    ),
    mockPost(
      'mock-4', '老陈', '🍜', '小馄饨摊的第三张塑料凳', '🥟', Rarity.Rare,
      '第三张凳子真的会晃。老板说那是他故意的。',
      now - 6 * 3600 * 1000, 8, 4, 2
    )
  ];
}

function minePost(
  id: string,
  authorName: string,
  placeName: string,
  categoryEmoji: string,
  rarity: Rarity,
  caption: string,
  createdAt: number,
  eyes: number,
  heart: number,
  next: number
): FeedPost {
  const post: FeedPost = {
    id: id,
    authorName: authorName,
    authorEmoji: '🫥',
    placeName: placeName,
    categoryEmoji: categoryEmoji,
    rarity: rarity,
    caption: caption,
    createdAt: createdAt,
    reactions: reactions(eyes, heart, next),
    reacted: emptyReacted(),
    isMine: true
  };
  return post;
}

/** 本人演示动态（DemoData.madePosts，2 条） */
export function demoMinePosts(now: number, authorName: string): FeedPost[] {
  return [
    minePost(
      'mine-1', authorName, '旧仓库改的书店', '📚', Rarity.Rare,
      '本来只想路过，结果在里面坐了一个小时。',
      now - 26 * 60 * 1000, 9, 2, 4
    ),
    minePost(
      'mine-2', authorName, '河边的第七张长椅', '🪑', Rarity.Common,
      '坐了一会儿，什么也没想。',
      now - 2 * 86400 * 1000, 4, 1, 0
    )
  ];
}

/** 圈子动态：本人发布置顶 + 好友 mock */
export function feedWithMine(mine: FeedPost[], now: number): FeedPost[] {
  return mine.concat(mockPosts(now));
}

/** 周榜（含本人；老陈 285，保证 305 分时本人第 4 —— 与 design-system §7 一致） */
export function leaderboard(profile: Profile): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = [
    { id: 'u1', name: '小满', emoji: '🐱', score: 520, isMe: false },
    { id: 'u2', name: '阿岛', emoji: '🎧', score: 465, isMe: false },
    { id: 'u3', name: '77', emoji: '🌙', score: 400, isMe: false },
    { id: 'u4', name: '老陈', emoji: '🍜', score: 285, isMe: false },
    {
      id: 'me',
      name: profile.name,
      emoji: profile.avatarEmoji,
      score: profile.weeklySurprise,
      isMe: true
    }
  ];
  entries.sort((a: LeaderboardEntry, b: LeaderboardEntry): number => b.score - a.score);
  return entries;
}

/** 深拷贝一条动态（快照用，避免 UI 改内部对象） */
export function clonePost(post: FeedPost): FeedPost {
  const reactionCopy: Record<string, number> = {};
  const keys: string[] = Object.keys(post.reactions);
  for (let i = 0; i < keys.length; i += 1) {
    reactionCopy[keys[i]] = post.reactions[keys[i]];
  }
  const reactedCopy: Record<string, boolean> = {};
  if (post.reacted !== undefined) {
    const reactedKeys: string[] = Object.keys(post.reacted);
    for (let i = 0; i < reactedKeys.length; i += 1) {
      reactedCopy[reactedKeys[i]] = post.reacted[reactedKeys[i]];
    }
  }
  const copy: FeedPost = {
    id: post.id,
    authorName: post.authorName,
    authorEmoji: post.authorEmoji,
    placeName: post.placeName,
    categoryEmoji: post.categoryEmoji,
    rarity: post.rarity,
    caption: post.caption,
    createdAt: post.createdAt,
    reactions: reactionCopy,
    reacted: reactedCopy,
    isMine: post.isMine
  };
  return copy;
}

/** 深拷贝排行榜条目 */
export function cloneLeaderboardEntry(entry: LeaderboardEntry): LeaderboardEntry {
  const copy: LeaderboardEntry = {
    id: entry.id,
    name: entry.name,
    emoji: entry.emoji,
    score: entry.score,
    isMe: entry.isMe
  };
  return copy;
}
