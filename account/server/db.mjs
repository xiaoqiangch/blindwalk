/**
 * 步迷 Walkaholic · 账号服务 — SQLite 数据访问
 *
 * 零依赖：Node 内置 `node:sqlite`（DatabaseSync）。
 *
 * 表（契约固定）：
 *   users(id TEXT PK, username TEXT UNIQUE COLLATE NOCASE, pass_hash TEXT, pass_salt TEXT, created_at INTEGER)
 *   profiles(user_id TEXT PK, data TEXT, updated_at INTEGER)
 *   sessions(token TEXT PK, user_id TEXT, created_at INTEGER, expires_at INTEGER)
 */

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const DB_FILENAME = 'walkaholic-users.db';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- 用户埋下的惊喜（跨用户共享，这是「附近的惊喜」的数据来源）
CREATE TABLE IF NOT EXISTS surprises (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_emoji TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  area_label TEXT,
  message TEXT,
  clues TEXT NOT NULL,
  radius_meters REAL NOT NULL DEFAULT 60,
  photo_data TEXT,
  photo_hash TEXT,
  status TEXT NOT NULL DEFAULT 'waiting',
  finder_name TEXT,
  found_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_surprises_geo ON surprises(lat, lon);
CREATE INDEX IF NOT EXISTS idx_surprises_status ON surprises(status);
CREATE INDEX IF NOT EXISTS idx_surprises_user ON surprises(user_id);
`;

/** 打开 SQLite（WAL）并建表 */
export function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 3000');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

/** 把 SQLite 返回的 null-prototype 行转成普通对象 */
function toPlainUser(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    username: String(row.username),
    passwordHash: String(row.pass_hash),
    passwordSalt: String(row.pass_salt),
    createdAt: Number(row.created_at)
  };
}

export class AccountStore {
  /**
   * @param {{ dataDir: string, dbFileName?: string }} options
   */
  constructor(options = {}) {
    if (!options.dataDir) throw new Error('AccountStore 需要 dataDir');
    this.dataDir = path.resolve(options.dataDir);
    this.dbPath = path.join(this.dataDir, options.dbFileName || DB_FILENAME);
    this.db = openDatabase(this.dbPath);
  }

  close() {
    try {
      this.db.close();
    } catch (error) {
      // ignore
    }
  }

  // ---------- users ----------

  createUser(username, passwordHash, passwordSalt, createdAt) {
    const id = 'user-' + randomUUID();
    this.db.prepare(
      'INSERT INTO users (id, username, pass_hash, pass_salt, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, username, passwordHash, passwordSalt, createdAt);
    return { id, username, createdAt };
  }

  /** 按用户名（大小写不敏感）查用户；含密码哈希，仅供 auth 层使用 */
  findUserByUsername(username) {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
    return toPlainUser(row);
  }

  findUserById(id) {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    return toPlainUser(row);
  }

  countUsers() {
    const row = this.db.prepare('SELECT count(*) AS c FROM users').get();
    return row ? Number(row.c) : 0;
  }

  // ---------- profile ----------

  getProfile(userId) {
    const row = this.db.prepare('SELECT data FROM profiles WHERE user_id = ?').get(userId);
    if (!row) return null;
    try {
      const parsed = JSON.parse(String(row.data));
      return parsed === undefined ? null : parsed;
    } catch (error) {
      return null;
    }
  }

  /** 整包保存 profile；返回 { savedAt, bytes } */
  saveProfile(userId, profile, now) {
    const text = JSON.stringify(profile);
    const bytes = Buffer.byteLength(text, 'utf8');
    this.db.prepare(
      'INSERT INTO profiles (user_id, data, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
    ).run(userId, text, now);
    return { savedAt: now, bytes };
  }

  // ---------- sessions ----------

  createSession(token, userId, createdAt, expiresAt) {
    this.db.prepare(
      'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run(token, userId, createdAt, expiresAt);
  }

  /** 会话 → 用户；过期自动删除并返回 null */
  findUserByToken(token, now) {
    if (typeof token !== 'string' || token.length === 0) return null;
    const session = this.db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (!session) return null;
    if (Number(session.expires_at) <= now) {
      this.deleteSession(token);
      return null;
    }
    const user = this.findUserById(String(session.user_id));
    if (!user) {
      this.deleteSession(token);
      return null;
    }
    return { id: user.id, username: user.username, createdAt: user.createdAt };
  }

  deleteSession(token) {
    return this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  deleteSessionsForUser(userId) {
    return this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  pruneExpiredSessions(now) {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  }

  /** 删除账号及全部数据（事务） */
  deleteUserCascade(userId) {
    this.db.exec('BEGIN');
    try {
      const removedProfiles = this.db.prepare('DELETE FROM profiles WHERE user_id = ?').run(userId);
      const removedSessions = this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      const removedUsers = this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      this.db.exec('COMMIT');
      return {
        users: Number(removedUsers.changes),
        profiles: Number(removedProfiles.changes),
        sessions: Number(removedSessions.changes)
      };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  // ---------- 惊喜（跨用户共享） ----------

  createSurprise(item) {
    this.db.prepare(
      `INSERT INTO surprises
       (id, user_id, author_name, author_emoji, lat, lon, area_label, message, clues,
        radius_meters, photo_data, photo_hash, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?)`
    ).run(
      item.id, item.userId, item.authorName, item.authorEmoji || null,
      item.lat, item.lon, item.areaLabel || null, item.message || null,
      JSON.stringify(item.clues || []), item.radiusMeters || 60,
      item.photoData || null, item.photoHash || null, item.createdAt
    );
    return this.getSurprise(item.id);
  }

  getSurprise(id) {
    const row = this.db.prepare('SELECT * FROM surprises WHERE id = ?').get(id);
    return toPlainSurprise(row);
  }

  /**
   * 附近的待寻惊喜（不含自己的），按距离由调用方排序。
   * 用经纬度做粗筛（1 度 ≈ 111km），避免全表扫描后算距离。
   */
  listNearbySurprises(lat, lon, radiusMeters, excludeUserId) {
    const latDelta = radiusMeters / 111320;
    const lonDelta = radiusMeters / (111320 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
    const rows = this.db.prepare(
      `SELECT * FROM surprises
       WHERE status = 'waiting'
         AND lat BETWEEN ? AND ?
         AND lon BETWEEN ? AND ?
         AND (? IS NULL OR user_id <> ?)
       ORDER BY created_at DESC
       LIMIT 80`
    ).all(lat - latDelta, lat + latDelta, lon - lonDelta, lon + lonDelta, excludeUserId, excludeUserId);
    return rows.map(toPlainSurprise).filter(Boolean);
  }

  listMySurprises(userId) {
    const rows = this.db.prepare(
      'SELECT * FROM surprises WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
    ).all(userId);
    return rows.map(toPlainSurprise).filter(Boolean);
  }

  /** 认领：只有 waiting 的才能被找到；返回是否抢到 */
  markSurpriseFound(id, finderName, foundAt) {
    const result = this.db.prepare(
      `UPDATE surprises SET status = 'found', finder_name = ?, found_at = ?
       WHERE id = ? AND status = 'waiting'`
    ).run(finderName, foundAt, id);
    return Number(result.changes) > 0;
  }

  countSurprises() {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM surprises').get();
    return row ? Number(row.c) : 0;
  }
}

/** SQLite 行 → 普通对象（惊喜） */
function toPlainSurprise(row) {
  if (!row) return null;
  let clues = [];
  try {
    const parsed = JSON.parse(String(row.clues || '[]'));
    if (Array.isArray(parsed)) clues = parsed.map(String);
  } catch (_) { clues = []; }
  return {
    id: String(row.id),
    userId: String(row.user_id),
    authorName: String(row.author_name),
    authorEmoji: row.author_emoji ? String(row.author_emoji) : '🫥',
    lat: Number(row.lat),
    lon: Number(row.lon),
    areaLabel: row.area_label ? String(row.area_label) : '',
    message: row.message ? String(row.message) : '',
    clues,
    radiusMeters: Number(row.radius_meters) || 60,
    photoData: row.photo_data ? String(row.photo_data) : null,
    photoHash: row.photo_hash ? String(row.photo_hash) : null,
    status: String(row.status),
    finderName: row.finder_name ? String(row.finder_name) : null,
    foundAt: row.found_at === null || row.found_at === undefined ? null : Number(row.found_at),
    createdAt: Number(row.created_at)
  };
}
