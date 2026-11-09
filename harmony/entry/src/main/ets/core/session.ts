/**
 * 盲走 BlindWalk · HarmonyOS 逻辑层 — 旅程会话状态机
 *
 * 移植自 apple/Shared/Core/QuestSession.swift：
 * - 起点即第 1 条线索（store 创建会话时 unlockedHintCount = 1）
 * - 剩余 ≤ 200m 解锁第 2 条；≤ 60m 解锁第 3 条；≤ 30m 到达
 * - 「我到了」立即到达；播放完揭晓动画后 confirmReveal；收录后 markCollected
 * - 箭头优先真实方位角，否则按剩余距离分段兜底
 *
 * 注意：HARMONY.md §5 的表格把阈值写成「第 2 条 400m / 第 3 条 200m」，
 * 那是 hintThresholds 数组的字面值；苹果版实际从并发起点即第 1 条，
 * 因此第 2 条的真实门槛是 200m、第 3 条是 60m。这里以苹果版实现为准。
 */

import {
  ARRIVE_THRESHOLD_METERS,
  GeoPoint,
  HINT_THRESHOLDS,
  QuestEvent,
  QuestEventType,
  QuestPhase,
  QuestSession
} from './types';
import { arrow, compassLabel } from './geo';

/** 会话更新结果：新会话 + 本次产生的事件（不改原对象） */
export interface SessionUpdate {
  session: QuestSession;
  events: QuestEvent[];
}

/** 克隆会话（快照/更新用，避免 UI 改内部可变对象） */
export function cloneSession(session: QuestSession): QuestSession {
  const copy: QuestSession = {
    id: session.id,
    placeID: session.placeID,
    startedAt: session.startedAt,
    totalMeters: session.totalMeters,
    remainingMeters: session.remainingMeters,
    phase: session.phase,
    unlockedHintCount: session.unlockedHintCount
  };
  if (session.target !== undefined) {
    const target: GeoPoint = { latitude: session.target.latitude, longitude: session.target.longitude };
    copy.target = target;
  }
  if (session.currentBearing !== undefined) {
    copy.currentBearing = session.currentBearing;
  }
  return copy;
}

/** 创建一次新旅程（起点即解锁第 1 条线索） */
export function createSession(
  placeID: string,
  startedAt: number,
  totalMeters: number,
  target?: GeoPoint,
  currentBearing?: number
): QuestSession {
  const session: QuestSession = {
    id: 'quest-' + String(startedAt) + '-' + placeID,
    placeID: placeID,
    startedAt: startedAt,
    totalMeters: totalMeters,
    remainingMeters: totalMeters,
    phase: QuestPhase.Walking,
    unlockedHintCount: 1
  };
  if (target !== undefined) {
    const point: GeoPoint = { latitude: target.latitude, longitude: target.longitude };
    session.target = point;
  }
  if (currentBearing !== undefined) {
    session.currentBearing = currentBearing;
  }
  return session;
}

/** 下一条线索的门槛；已全部解锁返回 undefined */
export function nextHintThreshold(session: QuestSession): number | undefined {
  if (session.unlockedHintCount >= HINT_THRESHOLDS.length) return undefined;
  return HINT_THRESHOLDS[session.unlockedHintCount];
}

/** 进度 0…1（已走 / 总长） */
export function progressOf(session: QuestSession): number {
  if (session.totalMeters <= 0) return 0;
  const value: number = 1 - session.remainingMeters / session.totalMeters;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * 用剩余距离推进旅程。
 * 规则（与苹果版一致）：clamp 到 [0, total]，逐条解锁线索，≤30 触发到达。
 */
export function updateSession(session: QuestSession, newRemainingMeters: number): SessionUpdate {
  const events: QuestEvent[] = [];
  const next: QuestSession = cloneSession(session);
  if (next.phase !== QuestPhase.Walking && next.phase !== QuestPhase.Arrived) {
    const unchanged: SessionUpdate = { session: next, events: events };
    return unchanged;
  }

  let remaining: number = newRemainingMeters;
  if (remaining < 0) remaining = 0;
  if (remaining > next.totalMeters) remaining = next.totalMeters;
  next.remainingMeters = remaining;

  while (next.unlockedHintCount < HINT_THRESHOLDS.length) {
    const threshold: number = HINT_THRESHOLDS[next.unlockedHintCount];
    if (remaining > threshold) break;
    next.unlockedHintCount += 1;
    const event: QuestEvent = {
      type: QuestEventType.HintUnlocked,
      index: next.unlockedHintCount - 1
    };
    events.push(event);
  }

  if (remaining <= ARRIVE_THRESHOLD_METERS && next.phase === QuestPhase.Walking) {
    next.phase = QuestPhase.Arrived;
    const event: QuestEvent = { type: QuestEventType.Arrived };
    events.push(event);
  }

  const result: SessionUpdate = { session: next, events: events };
  return result;
}

/** 真实 GPS：传「当前位置 → 目的地」的距离与方位角 */
export function updateGeo(
  session: QuestSession,
  distanceMeters: number,
  bearingDegrees: number | undefined
): SessionUpdate {
  let rounded: number = Math.round(distanceMeters);
  if (rounded < 0) rounded = 0;
  const base: QuestSession = cloneSession(session);
  if (bearingDegrees !== undefined) {
    base.currentBearing = bearingDegrees;
  }
  return updateSession(base, rounded);
}

/** 「我到了」：立即进入到达态（剩余距离夹到到达阈值以内） */
export function forceArrive(session: QuestSession): SessionUpdate {
  const events: QuestEvent[] = [];
  const next: QuestSession = cloneSession(session);
  if (next.phase !== QuestPhase.Walking) {
    const unchanged: SessionUpdate = { session: next, events: events };
    return unchanged;
  }
  next.phase = QuestPhase.Arrived;
  if (next.remainingMeters > ARRIVE_THRESHOLD_METERS) {
    next.remainingMeters = ARRIVE_THRESHOLD_METERS;
  }
  const event: QuestEvent = { type: QuestEventType.Arrived };
  events.push(event);
  const result: SessionUpdate = { session: next, events: events };
  return result;
}

/** 播放完揭晓动画：Arrived → Revealed */
export function confirmReveal(session: QuestSession): QuestSession {
  const next: QuestSession = cloneSession(session);
  if (next.phase === QuestPhase.Arrived) {
    next.phase = QuestPhase.Revealed;
  }
  return next;
}

/** 卡片已收录：Revealed / Arrived → Collected */
export function markCollected(session: QuestSession): QuestSession {
  const next: QuestSession = cloneSession(session);
  if (next.phase === QuestPhase.Revealed || next.phase === QuestPhase.Arrived) {
    next.phase = QuestPhase.Collected;
  }
  return next;
}

/** 演示用距离分段箭头（苹果版 QuestSession.bearing） */
export function distanceArrow(remainingMeters: number): string {
  if (remainingMeters >= 361) return '↖';
  if (remainingMeters >= 241) return '↑';
  if (remainingMeters >= 121) return '↗';
  return '→';
}

/** 箭头：优先真实方位角，没有定位时退回距离分段 */
export function arrowSymbol(session: QuestSession): string {
  if (session.currentBearing !== undefined) {
    return arrow(session.currentBearing);
  }
  return distanceArrow(session.remainingMeters);
}

/** 「往北走，别急」；演示态无方位角时用固定的河岸文案（与苹果版一致） */
export function compassCopy(session: QuestSession): string {
  if (session.currentBearing === undefined) return '沿河往北走，别急';
  return '往' + compassLabel(session.currentBearing) + '走，别急';
}

/** 下一条线索的提示文案 */
export function nextHintCopy(session: QuestSession): string {
  const threshold: number | undefined = nextHintThreshold(session);
  if (threshold === undefined) return '线索已全部解锁';
  const gap: number = Math.max(0, session.remainingMeters - threshold);
  return '再走 ' + String(gap) + ' 米，解锁下一条线索';
}

/** 该线索是否已解锁 */
export function isHintUnlocked(session: QuestSession, index: number): boolean {
  return index < session.unlockedHintCount;
}
