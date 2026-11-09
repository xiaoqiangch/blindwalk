/**
 * 盲走 BlindWalk · 兴趣点管理后台 v2 — POI 存储（SQLite）
 *
 * 底层从 v1 的 JSON 文件换成 Node 内置 `node:sqlite`（DatabaseSync），
 * **PoiStore 的公开方法签名保持不变**：load / save / all / get / list /
 * create / update / remove / findDuplicate / addCandidates / stats / approved。
 *
 * - 首次启动若 admin/data/pois.json 存在且库为空 → 自动全量迁移
 *   （原文件改名 pois.json.migrated-<ts>，条数必须一致；见 db.mjs）
 * - 写入依赖 SQLite 事务与 WAL，不再需要手写 .tmp 文件
 */

import path from 'node:path';

import {
  PoiError,
  buildStats,
  buildPoi,
  haversineMeters,
  mergePoi,
  normalizeName,
  nowMs
} from './poi.mjs';
import {
  DB_FILENAME,
  POI_COLUMNS,
  countPois,
  migrateLegacyJson,
  openDatabase,
  poiToValues,
  rowToPoi
} from './db.mjs';

/** 去重距离阈值：同名或距离 < 30m 视为重复（契约 §4.3） */
export const DUPLICATE_DISTANCE_METERS = 30;

const INSERT_SQL = 'INSERT INTO pois (' + POI_COLUMNS.join(', ') + ') VALUES (' +
  POI_COLUMNS.map(() => '?').join(', ') + ')';

const UPDATE_SQL = 'UPDATE pois SET ' +
  POI_COLUMNS.filter((column) => column !== 'id')
    .map((column) => column + ' = ?')
    .join(', ') +
  ' WHERE id = ?';

export class PoiStore {
  /**
   * @param {{ dataDir: string, dbFileName?: string, logger?: object }} options
   */
  constructor(options = {}) {
    if (!options.dataDir) throw new Error('PoiStore 需要 dataDir');
    this.dataDir = path.resolve(options.dataDir);
    this.dbFileName = options.dbFileName || DB_FILENAME;
    this.dbPath = path.join(this.dataDir, this.dbFileName);
    // 兼容 v1 调用方：filePath 现在指向 SQLite 文件
    this.filePath = this.dbPath;
    this.jsonPath = path.join(this.dataDir, 'pois.json');
    this.logger = options.logger || console;
    this.migration = { migrated: false, count: 0 };

    this.db = openDatabase(this.dbPath);
    this.migration = migrateLegacyJson({
      db: this.db,
      dataDir: this.dataDir,
      logger: this.logger
    });
  }

  // ---------- 基础 ----------

  /** 与 v1 保持同名（返回当前库内全部条目） */
  load() {
    return { items: this.all(), migration: this.migration };
  }

  /** SQLite 自动持久化；保留此方法以兼容旧调用方（返回数据库路径） */
  save() {
    return this.dbPath;
  }

  close() {
    try {
      this.db.close();
    } catch (error) {
      // ignore
    }
  }

  count() {
    return countPois(this.db);
  }

  // ---------- 查询 ----------

  all() {
    const rows = this.db.prepare('SELECT * FROM pois ORDER BY rowid ASC').all();
    return rows.map((row) => rowToPoi(row)).filter((poi) => poi !== null);
  }

  get(id) {
    const row = this.db.prepare('SELECT * FROM pois WHERE id = ?').get(id);
    return row ? rowToPoi(row) : null;
  }

  /**
   * 列表：status / q / category / hasPhoto / limit / offset，按 updatedAt 倒序
   */
  list(query = {}) {
    const where = [];
    const params = [];

    if (query.status) {
      where.push('status = ?');
      params.push(query.status);
    }
    if (query.category) {
      where.push('category = ?');
      params.push(query.category);
    }
    if (query.hasPhoto === true) {
      where.push("photoUrl IS NOT NULL AND photoUrl <> ''");
    } else if (query.hasPhoto === false) {
      where.push("(photoUrl IS NULL OR photoUrl = '')");
    }
    const q = String(query.q || '').trim().toLowerCase();
    if (q) {
      const like = '%' + q + '%';
      where.push(
        '(LOWER(COALESCE(name, \'\')) LIKE ? OR LOWER(COALESCE(summary, \'\')) LIKE ? OR LOWER(COALESCE(tags, \'\')) LIKE ?)'
      );
      params.push(like, like, like);
    }

    const whereSql = where.length > 0 ? ' WHERE ' + where.join(' AND ') : '';
    const totalRow = this.db.prepare('SELECT count(*) AS c FROM pois' + whereSql).get(...params);
    const total = totalRow ? Number(totalRow.c) : 0;

    const rawLimit = Number(query.limit);
    const rawOffset = Number(query.offset);
    const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, Math.floor(rawLimit))) : 100;
    const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;

    const rows = this.db.prepare(
      'SELECT * FROM pois' + whereSql + ' ORDER BY updatedAt DESC, id ASC LIMIT ? OFFSET ?'
    ).all(...params, limit, offset);

    return { total, items: rows.map((row) => rowToPoi(row)).filter((poi) => poi !== null) };
  }

  // ---------- 写入 ----------

  create(input) {
    const poi = buildPoi(input);
    this.db.prepare(INSERT_SQL).run(...poiToValues(poi));
    return poi;
  }

  update(id, input) {
    const existing = this.get(id);
    if (!existing) throw new PoiError('POI 不存在：' + id, 'NOT_FOUND', 404);
    const merged = mergePoi(existing, input);
    const values = poiToValues(merged);
    // UPDATE 参数顺序：除 id 外所有字段，最后是 WHERE id
    const updateValues = POI_COLUMNS
      .map((column, index) => ({ column, value: values[index] }))
      .filter((entry) => entry.column !== 'id')
      .map((entry) => entry.value);
    updateValues.push(id);
    const result = this.db.prepare(UPDATE_SQL).run(...updateValues);
    if (Number(result.changes) === 0) {
      throw new PoiError('POI 不存在：' + id, 'NOT_FOUND', 404);
    }
    return merged;
  }

  remove(id) {
    const result = this.db.prepare('DELETE FROM pois WHERE id = ?').run(id);
    if (Number(result.changes) === 0) {
      throw new PoiError('POI 不存在：' + id, 'NOT_FOUND', 404);
    }
    return true;
  }

  // ---------- 去重 / 批量 ----------

  /** 同名或距离 < 30m 视为重复 */
  findDuplicate(candidate, excludeId) {
    const name = normalizeName(candidate.name);
    const all = this.all();
    for (const poi of all) {
      if (excludeId && poi.id === excludeId) continue;
      if (name && normalizeName(poi.name) === name) return poi;
      if (typeof candidate.lat === 'number' && typeof candidate.lon === 'number') {
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
   * 单条不合格不拖垮整批；全部写入走一个事务。
   */
  addCandidates(candidates) {
    const added = [];
    let skipped = 0;
    const pending = [];
    const insert = this.db.prepare(INSERT_SQL);

    for (const candidate of candidates || []) {
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
      if (this.findDuplicate(candidate)) {
        skipped += 1;
        continue;
      }
      try {
        const poi = buildPoi(candidate);
        pending.push(poi);
        added.push(poi);
      } catch (error) {
        skipped += 1;
      }
    }

    if (added.length > 0) {
      this.db.exec('BEGIN');
      try {
        for (const poi of added) {
          insert.run(...poiToValues(poi));
        }
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    }
    return { added: added.length, skipped, items: added };
  }

  // ---------- 统计 / 导出 ----------

  stats() {
    return buildStats(this.all());
  }

  approved() {
    const rows = this.db.prepare(
      "SELECT * FROM pois WHERE status = 'approved' ORDER BY updatedAt ASC, id ASC"
    ).all();
    return rows.map((row) => rowToPoi(row)).filter((poi) => poi !== null);
  }

  /** 迁移信息（便于启动日志 / 测试断言） */
  migrationInfo() {
    return this.migration;
  }

  /** 插入一条完整 POI（测试用，不做校验） */
  insertRaw(poi) {
    this.db.prepare(INSERT_SQL).run(...poiToValues(poi));
    return nowMs();
  }
}
