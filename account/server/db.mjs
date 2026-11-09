/**
 * 盲走 BlindWalk · 账号服务 — SQLite 数据访问
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

export const DB_FILENAME = 'blindwalk-users.db';

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
}
