/**
 * 步迷 Walkaholic · 兴趣点管理后台 v2 — SQLite 连接 / 建表 / 迁移
 *
 * 零依赖：Node 内置 `node:sqlite` 的 DatabaseSync（启动时的 ExperimentalWarning 是正常的）。
 *
 * - 文件：admin/data/walkaholic.db，PRAGMA journal_mode=WAL
 * - 表：pois（字段同契约 §2，hints/tags/safety/llm 用 JSON 文本列）、meta、sessions
 * - 自动迁移：库为空且存在 admin/data/pois.json → 全量导入，成功后原文件改名
 *   `pois.json.migrated-<ts>`；JSON 损坏则备份 `pois.json.corrupt-<ts>` 并从空库启动。
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

import {
  AREAS,
  CATEGORY_KEYS,
  RARITIES,
  SOURCES,
  STATUSES,
  clipText,
  defaultArea,
  defaultEmoji,
  defaultRarity,
  makePoiId,
  nowMs,
  scrubHints
} from './poi.mjs';
import { completeSafety } from './safety.mjs';

export const DB_FILENAME = 'walkaholic.db';
export const SCHEMA_VERSION = 2;
const JSON_FIELDS = ['hints', 'tags', 'safety', 'llm'];

/** pois 表字段顺序（与 poiToValues 一致） */
export const POI_COLUMNS = [
  'id', 'name', 'lat', 'lon', 'category', 'emoji', 'rarity', 'area',
  'address', 'photoUrl', 'photoCredit', 'summary', 'why', 'task',
  'hints', 'tags', 'safety', 'llm',
  'status', 'source', 'createdAt', 'updatedAt'
];

const CREATE_POIS_SQL = `
CREATE TABLE IF NOT EXISTS pois (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  category TEXT NOT NULL,
  emoji TEXT,
  rarity TEXT,
  area TEXT,
  address TEXT,
  photoUrl TEXT,
  photoCredit TEXT,
  summary TEXT,
  why TEXT,
  task TEXT,
  hints TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  safety TEXT NOT NULL DEFAULT '{}',
  llm TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pois_updated ON pois(updatedAt DESC);
CREATE INDEX IF NOT EXISTS idx_pois_status ON pois(status);
CREATE INDEX IF NOT EXISTS idx_pois_photo ON pois(photoUrl);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  createdAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS app_keys (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER
);
`;

function parseJsonColumn(text, fallback) {
  if (typeof text !== 'string' || text.length === 0) return fallback;
  try {
    const parsed = JSON.parse(text);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (error) {
    return fallback;
  }
}

/** DB 行 → POI 对象（JSON 列反序列化，缺字段补默认值） */
export function rowToPoi(row) {
  if (!row) return null;
  const category = CATEGORY_KEYS.includes(row.category) ? row.category : 'plaza';
  const hints = parseJsonColumn(row.hints, []);
  const tags = parseJsonColumn(row.tags, []);
  const rawSafety = parseJsonColumn(row.safety, {});
  const llm = parseJsonColumn(row.llm, {});
  const poi = {
    id: String(row.id),
    name: String(row.name),
    lat: Number(row.lat),
    lon: Number(row.lon),
    category: category,
    emoji: typeof row.emoji === 'string' && row.emoji ? row.emoji : defaultEmoji(category),
    rarity: RARITIES.includes(row.rarity) ? row.rarity : defaultRarity(category),
    area: AREAS.includes(row.area) ? row.area : defaultArea(category),
    address: row.address === undefined || row.address === null ? null : String(row.address),
    photoUrl: row.photoUrl === undefined || row.photoUrl === null ? null : String(row.photoUrl),
    photoCredit: row.photoCredit === undefined || row.photoCredit === null
      ? null
      : String(row.photoCredit),
    summary: typeof row.summary === 'string' ? row.summary : '',
    why: typeof row.why === 'string' ? row.why : '',
    task: typeof row.task === 'string' ? row.task : '',
    hints: Array.isArray(hints) ? hints.filter((hint) => typeof hint === 'string') : [],
    tags: Array.isArray(tags) ? tags.filter((tag) => typeof tag === 'string') : [],
    safety: null,
    llm: {
      normalizedAt: Number.isFinite(Number(llm.normalizedAt)) ? Number(llm.normalizedAt) : 0,
      analyzedAt: Number.isFinite(Number(llm.analyzedAt)) ? Number(llm.analyzedAt) : 0,
      model: typeof llm.model === 'string' ? llm.model : '',
      mode: llm.mode === 'llm' ? 'llm' : 'offline'
    },
    status: STATUSES.includes(row.status) ? row.status : 'draft',
    source: SOURCES.includes(row.source) ? row.source : 'manual',
    createdAt: Number(row.createdAt) || 0,
    updatedAt: Number(row.updatedAt) || 0
  };
  poi.safety = completeSafety(poi, rawSafety);
  return poi;
}

/** POI 对象 → SQLite 位置参数数组（顺序 = POI_COLUMNS） */
export function poiToValues(poi) {
  return POI_COLUMNS.map((field) => {
    const value = poi[field];
    if (JSON_FIELDS.includes(field)) {
      return value === undefined || value === null ? (field === 'hints' || field === 'tags' ? '[]' : '{}') : JSON.stringify(value);
    }
    if (value === undefined) return null;
    return value;
  });
}

/** 打开数据库并建表 */
export function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 3000');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(CREATE_POIS_SQL);
  setMetaIfMissing(db, 'schema_version', String(SCHEMA_VERSION));
  return db;
}

export function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? String(row.value) : undefined;
}

export function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

function setMetaIfMissing(db, key, value) {
  if (getMeta(db, key) === undefined) setMeta(db, key, value);
}

export function countPois(db) {
  const row = db.prepare('SELECT count(*) AS c FROM pois').get();
  return row ? Number(row.c) : 0;
}

// ============================================================
// JSON → SQLite 一次性迁移（v1 升级 v2）
// ============================================================

function normalizeMigratedPoi(raw, index, fallbackNow) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('第 ' + (index + 1) + ' 条不是对象');
  }
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) {
    throw new Error('第 ' + (index + 1) + ' 条缺 name');
  }
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('第 ' + (index + 1) + ' 条坐标不合法');
  }
  const category = CATEGORY_KEYS.includes(raw.category) ? raw.category : 'plaza';
  const hints = scrubHints(Array.isArray(raw.hints) ? raw.hints : [], raw.name);
  const poi = {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : makePoiId(),
    name: raw.name.trim(),
    lat: lat,
    lon: lon,
    category: category,
    emoji: typeof raw.emoji === 'string' && raw.emoji ? raw.emoji : defaultEmoji(category),
    rarity: RARITIES.includes(raw.rarity) ? raw.rarity : defaultRarity(category),
    area: AREAS.includes(raw.area) ? raw.area : defaultArea(category),
    address: typeof raw.address === 'string' ? raw.address : null,
    photoUrl: typeof raw.photoUrl === 'string' ? raw.photoUrl : null,
    photoCredit: typeof raw.photoCredit === 'string' ? raw.photoCredit : null,
    summary: clipText(raw.summary || '', 120),
    why: clipText(raw.why || '', 300),
    task: clipText(raw.task || '', 160),
    hints: hints,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag) => typeof tag === 'string').slice(0, 12) : [],
    safety: raw.safety,
    llm: {
      normalizedAt: Number.isFinite(Number(raw.llm && raw.llm.normalizedAt)) ? Number(raw.llm.normalizedAt) : 0,
      analyzedAt: Number.isFinite(Number(raw.llm && raw.llm.analyzedAt)) ? Number(raw.llm.analyzedAt) : 0,
      model: raw.llm && typeof raw.llm.model === 'string' ? raw.llm.model : '',
      mode: raw.llm && raw.llm.mode === 'llm' ? 'llm' : 'offline'
    },
    status: STATUSES.includes(raw.status) ? raw.status : 'draft',
    source: SOURCES.includes(raw.source) ? raw.source : 'manual',
    createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : fallbackNow,
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : fallbackNow
  };
  poi.safety = completeSafety(poi, poi.safety);
  if (poi.photoUrl && !poi.photoCredit) poi.photoCredit = null;
  return poi;
}

/**
 * 若库为空且存在 pois.json → 全量导入并把原文件改名为 `.migrated-<ts>`。
 *
 * @returns {{ migrated:boolean, count:number, renamedTo?:string, corrupted?:boolean, error?:string }}
 */
export function migrateLegacyJson(options) {
  const db = options.db;
  const dataDir = options.dataDir;
  const logger = options.logger || console;
  const jsonPath = path.join(dataDir, 'pois.json');

  const existing = countPois(db);
  if (existing > 0) {
    return { migrated: false, count: existing };
  }
  if (!fs.existsSync(jsonPath)) {
    return { migrated: false, count: 0 };
  }

  let rawText;
  try {
    rawText = fs.readFileSync(jsonPath, 'utf8');
  } catch (error) {
    return { migrated: false, count: 0, error: '读取 pois.json 失败：' + error.message };
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    const corruptPath = jsonPath + '.corrupt-' + nowMs();
    try {
      fs.renameSync(jsonPath, corruptPath);
    } catch (renameError) {
      // ignore
    }
    if (typeof logger.warn === 'function') {
      logger.warn('pois.json 损坏，已备份为 ' + corruptPath + '，从空库启动');
    }
    return { migrated: false, count: 0, corrupted: true, renamedTo: corruptPath };
  }

  let items;
  if (Array.isArray(parsed)) items = parsed;
  else if (parsed && Array.isArray(parsed.items)) items = parsed.items;
  else {
    const corruptPath = jsonPath + '.corrupt-' + nowMs();
    try {
      fs.renameSync(jsonPath, corruptPath);
    } catch (renameError) {
      // ignore
    }
    if (typeof logger.warn === 'function') {
      logger.warn('pois.json 结构不认识，已备份为 ' + corruptPath + '，从空库启动');
    }
    return { migrated: false, count: 0, corrupted: true, renamedTo: corruptPath };
  }

  const fallbackNow = nowMs();
  let mapped;
  try {
    mapped = items.map((item, index) => normalizeMigratedPoi(item, index, fallbackNow));
  } catch (error) {
    if (typeof logger.warn === 'function') {
      logger.warn('pois.json 迁移失败（' + error.message + '），保留原文件、从空库启动');
    }
    return { migrated: false, count: 0, error: error.message };
  }

  const insert = db.prepare(
    'INSERT INTO pois (' + POI_COLUMNS.join(', ') + ') VALUES (' +
      POI_COLUMNS.map(() => '?').join(', ') + ')'
  );

  db.exec('BEGIN');
  try {
    for (const poi of mapped) {
      insert.run(...poiToValues(poi));
    }
    const inserted = countPois(db);
    if (inserted !== mapped.length) {
      throw new Error('导入条数不一致：期望 ' + mapped.length + '，实际 ' + inserted);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    if (typeof logger.warn === 'function') {
      logger.warn('pois.json 迁移回滚（' + error.message + '），保留原文件');
    }
    return { migrated: false, count: 0, error: error.message };
  }

  const migratedPath = jsonPath + '.migrated-' + nowMs();
  try {
    fs.renameSync(jsonPath, migratedPath);
  } catch (error) {
    if (typeof logger.warn === 'function') {
      logger.warn('数据已导入，但 pois.json 改名失败：' + error.message);
    }
  }
  if (typeof logger.log === 'function') {
    logger.log('已从 pois.json 迁移 ' + mapped.length + ' 条到 SQLite → ' + migratedPath);
  }
  return { migrated: true, count: mapped.length, renamedTo: migratedPath };
}
