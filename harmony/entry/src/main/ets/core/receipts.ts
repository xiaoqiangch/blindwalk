/**
 * 步迷 Walkaholic · HarmonyOS 逻辑层 — 埋惊喜回执（「被找到」）
 *
 * 移植自 apple/Shared/Core/SurpriseReceipt.swift。
 *
 * 埋惊喜是「给予」，但之前给完就断了：别人找到你的照片，你永远不知道。
 * 这一层把「被找到」变成一条回执，并在入口上点一个红点 ——
 * 成本最低的社交闭环：不用聊天、不用关注，只要有人走过你留照片的地方。
 *
 * 数据来源：GET /api/surprises/mine（登录用户或匿名设备标识都能查自己的）。
 * 服务端只回状态，不回照片正文。
 *
 * 纯 TypeScript：不 import 任何 @ohos.*，可在 Node 里单测。
 */

import { KeyValueStore } from './contract';
import { SurpriseReceipt } from './types';

/** 回执存档键（单独一个，不跟 profile 混在一起） */
export const RECEIPTS_KEY: string = 'walkaholic.surprise.receipts.v1';

/** 合并结果：新列表 + 是否出现新的未读 */
export interface ReceiptMerge {
  list: SurpriseReceipt[];
  hasNew: boolean;
}

function cloneReceipt(receipt: SurpriseReceipt): SurpriseReceipt {
  const copy: SurpriseReceipt = {
    id: receipt.id,
    areaLabel: receipt.areaLabel,
    finderName: receipt.finderName,
    foundAt: receipt.foundAt
  };
  if (receipt.readAt !== undefined) copy.readAt = receipt.readAt;
  return copy;
}

/** 解码一条回执（容错：缺字段用安全默认值） */
function decodeReceipt(value: unknown): SurpriseReceipt | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record: Record<string, unknown> = value as Record<string, unknown>;
  const id: unknown = record['id'];
  if (typeof id !== 'string' || id.length === 0) return undefined;
  const receipt: SurpriseReceipt = {
    id: id,
    areaLabel: typeof record['areaLabel'] === 'string' ? record['areaLabel'] as string : '',
    finderName: typeof record['finderName'] === 'string' ? record['finderName'] as string : '有人',
    foundAt: typeof record['foundAt'] === 'number' ? record['foundAt'] as number : Date.now()
  };
  const readAt: unknown = record['readAt'];
  if (typeof readAt === 'number') receipt.readAt = readAt;
  return receipt;
}

/** 解码回执数组（服务端 / 本地存档共用） */
export function decodeReceipts(value: unknown): SurpriseReceipt[] {
  if (!Array.isArray(value)) return [];
  const list: SurpriseReceipt[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const receipt: SurpriseReceipt | undefined = decodeReceipt(value[i]);
    if (receipt !== undefined) list.push(receipt);
  }
  list.sort((a: SurpriseReceipt, b: SurpriseReceipt): number => b.foundAt - a.foundAt);
  return list;
}

/** 回执仓库 */
export class SurpriseReceiptStore {
  private kv: KeyValueStore;
  private list: SurpriseReceipt[];

  constructor(kv: KeyValueStore) {
    this.kv = kv;
    this.list = this.load();
  }

  /** 全部回执（按被找到时间倒序） */
  all(): SurpriseReceipt[] {
    return this.list.map((item: SurpriseReceipt): SurpriseReceipt => cloneReceipt(item));
  }

  /** 未读数量（首页入口红点 / 数字用） */
  unreadCount(): number {
    let count: number = 0;
    for (let i = 0; i < this.list.length; i += 1) {
      if (this.list[i].readAt === undefined) count += 1;
    }
    return count;
  }

  /** 最近一条未读（卡片上写「被谁找到了」） */
  latestUnread(): SurpriseReceipt | undefined {
    for (let i = 0; i < this.list.length; i += 1) {
      if (this.list[i].readAt === undefined) return cloneReceipt(this.list[i]);
    }
    return undefined;
  }

  /**
   * 合并服务端回执：新条目插入，已有条目只更新寻者与时间，保留本地已读状态。
   * 返回是否有「新的未读」——有才值得点红点。
   */
  merge(remote: SurpriseReceipt[]): ReceiptMerge {
    if (remote.length === 0) {
      const merged: ReceiptMerge = { list: this.all(), hasNew: false };
      return merged;
    }
    const index: Map<string, SurpriseReceipt> = new Map<string, SurpriseReceipt>();
    for (let i = 0; i < this.list.length; i += 1) {
      index.set(this.list[i].id, this.list[i]);
    }
    let hasNew: boolean = false;
    for (let i = 0; i < remote.length; i += 1) {
      const incoming: SurpriseReceipt = remote[i];
      const existing: SurpriseReceipt | undefined = index.get(incoming.id);
      if (existing !== undefined) {
        existing.areaLabel = incoming.areaLabel;
        existing.finderName = incoming.finderName;
        existing.foundAt = incoming.foundAt;
      } else {
        index.set(incoming.id, cloneReceipt(incoming));
        hasNew = true;
      }
    }
    const next: SurpriseReceipt[] = Array.from(index.values());
    next.sort((a: SurpriseReceipt, b: SurpriseReceipt): number => b.foundAt - a.foundAt);
    this.list = next;
    this.persist();
    const result: ReceiptMerge = { list: this.all(), hasNew: hasNew };
    return result;
  }

  /** 全部标记已读（红点熄灭） */
  markAllRead(now: number): void {
    let changed: boolean = false;
    for (let i = 0; i < this.list.length; i += 1) {
      if (this.list[i].readAt === undefined) {
        this.list[i].readAt = now;
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  removeAll(): void {
    this.list = [];
    try {
      this.kv.delete(RECEIPTS_KEY);
    } catch (error) {
      /* 清空失败不影响当前会话 */
    }
  }

  private persist(): void {
    try {
      this.kv.putString(RECEIPTS_KEY, JSON.stringify(this.list));
    } catch (error) {
      /* 持久化失败不影响当前会话 */
    }
  }

  private load(): SurpriseReceipt[] {
    const text: string | undefined = this.kv.getString(RECEIPTS_KEY);
    if (text === undefined || text.length === 0) return [];
    try {
      return decodeReceipts(JSON.parse(text));
    } catch (error) {
      return [];
    }
  }
}
