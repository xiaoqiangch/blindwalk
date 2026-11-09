/**
 * 盲走 BlindWalk · 兴趣点管理后台 — JSON 存储
 *
 * - 原子写：先写 `<file>.tmp` 再 rename
 * - 损坏容错：JSON 解析失败 → 把坏文件备份成 `*.corrupt-<ts>`，从空库启动
 * - 列表 / 查询 / 新建 / 合并更新 / 删除 / 去重 / 统计
 *
 * 零依赖：node:fs / node:path
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  PoiError,
  buildPoi,
  buildStats,
  haversineMeters,
  isPoiShape,
  mergePoi,
  normalizeName,
  nowMs
} from './poi.mjs';

const FILE_VERSION = 1;
/** 去重距离阈值：同名或距离 < 30m 视为重复（契约 §4.3） */
export const DUPLICATE_DISTANCE_METERS = 30;

export class PoiStore {
  /**
   * @param {{ dataDir: string, fileName?: string }} options
   */
  constructor(options = {}) {
    if (!options.dataDir) throw new Error('PoiStore 需要 dataDir');
    this.dataDir = path.resolve(options.dataDir);
    this.fileName = options.fileName || 'pois.json';
    this.filePath = path.join(this.dataDir, this.fileName);
    this.items = [];
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.load();
  }

  // ---------- 读取 / 写入 ----------

  load() {
    let raw;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.items = [];
        return { items: [], recovered: false };
      }
      throw error;
    }

    try {
      const parsed = JSON.parse(raw);
      let list;
      if (Array.isArray(parsed)) list = parsed;
      else if (parsed && Array.isArray(parsed.items)) list = parsed.items;
      else throw new Error('数据结构不是 { version, items }');

      const valid = list.filter(isPoiShape);
      this.items = valid;
      if (valid.length !== list.length) {
        // 部分条目损坏：保留能用的并写回，避免每次启动都报同一处坏数据
        this.save();
      }
      return { items: valid, recovered: valid.length !== list.length };
    } catch (error) {
      this.backupCorruptFile();
      this.items = [];
      this.save();
      return { items: [], recovered: true };
    }
  }

  /** 坏文件备份，绝不覆盖用户数据 */
  backupCorruptFile() {
    const stamp = String(nowMs());
    const backupPath = this.filePath + '.corrupt-' + stamp;
    try {
      fs.renameSync(this.filePath, backupPath);
      return backupPath;
    } catch (error) {
      return null;
    }
  }

  /** 原子写：tmp + rename */
  save() {
    const payload = {
      version: FILE_VERSION,
      updatedAt: nowMs(),
      items: this.items
    };
    const text = JSON.stringify(payload, null, 2);
    const tmpPath = this.filePath + '.tmp';
    fs.writeFileSync(tmpPath, text, 'utf8');
    fs.renameSync(tmpPath, this.filePath);
    return this.filePath;
  }

  // ---------- 查询 ----------

  all() {
    return this.items.slice();
  }

  get(id) {
    return this.items.find((poi) => poi.id === id) || null;
  }

  /**
   * 列表：status / q / category / hasPhoto / limit / offset，按 updatedAt 倒序
   */
  list(query = {}) {
    const status = query.status;
    const category = query.category;
    const q = String(query.q || '').trim().toLowerCase();
    const hasPhoto = query.hasPhoto;

    let filtered = this.items.filter((poi) => {
      if (status && poi.status !== status) return false;
      if (category && poi.category !== category) return false;
      if (hasPhoto === true && !poi.photoUrl) return false;
      if (hasPhoto === false && poi.photoUrl) return false;
      if (q) {
        const haystack = [
          poi.name,
          poi.summary,
          Array.isArray(poi.tags) ? poi.tags.join(' ') : ''
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    filtered = filtered.sort((a, b) => {
      const diff = (b.updatedAt || 0) - (a.updatedAt || 0);
      return diff !== 0 ? diff : String(a.id).localeCompare(String(b.id));
    });

    const total = filtered.length;
    const rawLimit = Number(query.limit);
    const rawOffset = Number(query.offset);
    const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, Math.floor(rawLimit))) : 100;
    const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
    const items = filtered.slice(offset, offset + limit);
    return { total, items };
  }

  // ---------- 写入 ----------

  create(input) {
    const poi = buildPoi(input);
    this.items.push(poi);
    this.save();
    return poi;
  }

  update(id, input) {
    const index = this.items.findIndex((poi) => poi.id === id);
    if (index < 0) throw new PoiError('POI 不存在：' + id, 'NOT_FOUND', 404);
    const merged = mergePoi(this.items[index], input);
    this.items[index] = merged;
    this.save();
    return merged;
  }

  remove(id) {
    const index = this.items.findIndex((poi) => poi.id === id);
    if (index < 0) throw new PoiError('POI 不存在：' + id, 'NOT_FOUND', 404);
    this.items.splice(index, 1);
    this.save();
    return true;
  }

  // ---------- 去重 / 批量 ----------

  /** 同名或距离 < 30m 视为重复 */
  findDuplicate(candidate, excludeId) {
    const name = normalizeName(candidate.name);
    for (const poi of this.items) {
      if (excludeId && poi.id === excludeId) continue;
      if (name && normalizeName(poi.name) === name) return poi;
      if (
        typeof candidate.lat === 'number' &&
        typeof candidate.lon === 'number'
      ) {
        const meters = haversineMeters(
          { lat: candidate.lat, lon: candidate.lon },
          { lat: poi.lat, lon: poi.lon }
        );
        if (meters < DUPLICATE_DISTANCE_METERS) return poi;
      }
    }
    return null;
  }

  /**
   * 批量导入候选：去重（库内 + 本批内），新建的默认 draft。
   * @returns {{ added: number, skipped: number, items: object[] }}
   */
  addCandidates(candidates) {
    const added = [];
    let skipped = 0;
    const pending = [];

    for (const candidate of candidates || []) {
      // 本批内去重
      const inBatch = pending.find((item) => {
        if (normalizeName(item.name) === normalizeName(candidate.name)) return true;
        return haversineMeters(
          { lat: candidate.lat, lon: candidate.lon },
          { lat: item.lat, lon: item.lon }
        ) < DUPLICATE_DISTANCE_METERS;
      });
      if (inBatch) {
        skipped += 1;
        continue;
      }
      const existing = this.findDuplicate(candidate);
      if (existing) {
        skipped += 1;
        continue;
      }
      try {
        const poi = buildPoi(candidate);
        pending.push(poi);
        added.push(poi);
      } catch (error) {
        // 单条数据不合格不拖垮整批
        skipped += 1;
      }
    }

    if (added.length > 0) {
      this.items.push(...added);
      this.save();
    }
    return { added: added.length, skipped, items: added };
  }

  // ---------- 统计 / 导出 ----------

  stats() {
    return buildStats(this.items);
  }

  approved() {
    return this.items.filter((poi) => poi.status === 'approved');
  }
}
