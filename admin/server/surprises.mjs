/**
 * 步迷 Walkaholic · 兴趣点后台 — 用户惊喜审核（读/审账号服务的 surprises 表）
 *
 * 背景：惊喜存在**账号服务**的 SQLite（account/data/walkaholic-users.db 的 surprises 表），
 * 后台是另一个进程、另一个库。为了不把两个服务耦合（也不需要跨服务密钥），
 * 后台在这里直接打开账号库做只读查询 + 有限的两种审核写操作。
 *
 * 为什么可以直接开：两者同机部署，SQLite WAL 支持多进程并发读写；
 * 写入只有「隐藏 / 恢复」，不碰任何用户 / 资料 / 会话表。
 *
 * 审核语义（与 account/server/surprises.mjs 的保密约束一致）：
 *   waiting  正常待寻（列表可见）
 *   found    已被找到（不再出现在列表）
 *   hidden   后台下架（列表不可见）
 * account 的 listNearby 只查 status='waiting'，所以下架立刻从所有人的附近消失；
 * 恢复回 waiting 即重新上架。
 *
 * 注意：本模块**不建表**。账号库不存在 / 没有 surprises 表时标记 unavailable，
 * 绝不创建空库（否则账号服务会以为这是它的真实库）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const ACCOUNT_DB_FILENAME = 'walkaholic-users.db';
/** 早期部署（步谜/Bumia 版）用的是 blindwalk-users.db，两个名字都认 */
export const ACCOUNT_DB_FILENAMES = ['walkaholic-users.db', 'blindwalk-users.db'];
export const SURPRISE_STATUSES = ['waiting', 'found', 'hidden'];
/** 审核只允许在这两个状态间切换（found 是用户行为的结果，不允许手动改） */
export const MODERATABLE_STATUSES = ['waiting', 'hidden'];

export class SurpriseAdminError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'SurpriseAdminError';
    this.code = code;
    this.status = status;
  }
}

/** 按优先级猜测账号库位置（可用 WA_ACCOUNT_DB / BW_ACCOUNT_DB 显式指定） */
export function resolveAccountDbPath(options = {}) {
  const env = options.env || process.env;
  // 两套环境变量前缀都认：早期部署（步谜/Bumia）用 BW_，新部署用 WA_
  const explicit = options.dbPath || env.WA_ACCOUNT_DB || env.BW_ACCOUNT_DB;
  if (explicit && String(explicit).trim()) return path.resolve(String(explicit).trim());

  const candidates = [];
  const adminDataDir = options.adminDataDir ? path.resolve(options.adminDataDir) : null;
  if (adminDataDir) {
    for (const name of ACCOUNT_DB_FILENAMES) {
      candidates.push(path.resolve(adminDataDir, '..', 'account', name));
    }
  }
  for (const name of ACCOUNT_DB_FILENAMES) {
    candidates.push(path.resolve(process.cwd(), 'account', 'data', name));
  }
  for (const name of ACCOUNT_DB_FILENAMES) {
    candidates.push('/var/lib/walkaholic/account/' + name);
    candidates.push('/var/lib/blindwalk/account/' + name);
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0] || path.resolve(ACCOUNT_DB_FILENAME);
}

function rowToSurprise(row) {
  if (!row) return null;
  let clues = [];
  try {
    const parsed = JSON.parse(row.clues || '[]');
    if (Array.isArray(parsed)) clues = parsed.map(String);
  } catch (_) {
    clues = [];
  }
  const photoData = row.photo_data || '';
  return {
    id: String(row.id),
    authorName: row.author_name || '',
    authorEmoji: row.author_emoji || '🫥',
    areaLabel: row.area_label || '',
    message: row.message || '',
    clues,
    lat: Number(row.lat),
    lon: Number(row.lon),
    radiusMeters: Number(row.radius_meters || 0),
    status: row.status || 'waiting',
    finderName: row.finder_name || null,
    foundAt: row.found_at === null || row.found_at === undefined ? null : Number(row.found_at),
    createdAt: Number(row.created_at || 0),
    hasPhoto: photoData.length > 0,
    photoBytes: photoData.length
  };
}

/**
 * 惊喜审核服务：直接读写账号库的 surprises 表（只动 status 一列）。
 */
export class SurpriseAdminService {
  constructor(options = {}) {
    this.dbPath = resolveAccountDbPath(options);
    this.env = options.env || process.env;
    this.db = null;
    this.error = '';
    this.open();
  }

  open() {
    if (!fs.existsSync(this.dbPath)) {
      this.error = '账号库不存在：' + this.dbPath + '（账号服务还没跑过，或 WA_ACCOUNT_DB 配错了）';
      return;
    }
    try {
      // readonly 不成立（要写 status），但保证文件已存在才打开，绝不新建库
      this.db = new DatabaseSync(this.dbPath);
      this.db.exec('PRAGMA busy_timeout = 3000');
      const table = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'surprises'"
      ).get();
      if (!table) {
        this.db = null;
        this.error = '账号库里没有 surprises 表（账号服务版本过旧）';
      } else {
        this.error = '';
      }
    } catch (error) {
      this.db = null;
      this.error = '打开账号库失败：' + (error && error.message ? error.message : String(error));
    }
  }

  get available() {
    return this.db !== null;
  }

  status() {
    return {
      available: this.available,
      dbPath: this.dbPath,
      error: this.error
    };
  }

  /** 没库就抛，避免上层拿到空列表误以为「没有惊喜」 */
  requireDb() {
    if (!this.db) {
      throw new SurpriseAdminError(this.error || '账号库不可用', 'SURPRISES_UNAVAILABLE', 503);
    }
    return this.db;
  }

  /**
   * 列表。支持 status / q（区域或正文关键词）/ limit / offset。
   * 默认按创建时间倒序。
   */
  list(params = {}) {
    const db = this.requireDb();
    const status = String(params.status || '').trim();
    const q = String(params.q || '').trim();
    const limit = Math.min(200, Math.max(1, Number(params.limit) || 50));
    const offset = Math.max(0, Number(params.offset) || 0);

    const where = [];
    const args = [];
    if (status && status !== 'all') {
      if (SURPRISE_STATUSES.indexOf(status) < 0) {
        throw new SurpriseAdminError('status 只能是 waiting / found / hidden', 'BAD_REQUEST', 400);
      }
      where.push('status = ?');
      args.push(status);
    }
    if (q) {
      where.push('(area_label LIKE ? OR message LIKE ? OR author_name LIKE ? OR id LIKE ?)');
      const like = '%' + q + '%';
      args.push(like, like, like, like);
    }
    const clause = where.length ? ' WHERE ' + where.join(' AND ') : '';

    const totalRow = db.prepare('SELECT COUNT(*) AS c FROM surprises' + clause).get(...args);
    const rows = db.prepare(
      'SELECT * FROM surprises' + clause + ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(...args, limit, offset);

    const counts = {};
    for (const item of db.prepare('SELECT status, COUNT(*) AS c FROM surprises GROUP BY status').all()) {
      counts[item.status] = Number(item.c);
    }

    return {
      items: rows.map(rowToSurprise),
      total: totalRow ? Number(totalRow.c) : 0,
      counts,
      limit,
      offset
    };
  }

  get(id) {
    const db = this.requireDb();
    const row = db.prepare('SELECT * FROM surprises WHERE id = ?').get(String(id));
    if (!row) throw new SurpriseAdminError('惊喜不存在：' + id, 'NOT_FOUND', 404);
    return rowToSurprise(row);
  }

  /** 下架 / 恢复：只允许 waiting ⇄ hidden */
  setStatus(id, status) {
    const db = this.requireDb();
    const target = String(status || '').trim();
    if (MODERATABLE_STATUSES.indexOf(target) < 0) {
      throw new SurpriseAdminError('只能改成 waiting 或 hidden', 'BAD_REQUEST', 400);
    }
    const current = this.get(id);
    if (current.status === 'found') {
      throw new SurpriseAdminError('已被找到的惊喜不能下架或恢复', 'ALREADY_FOUND', 409);
    }
    db.prepare('UPDATE surprises SET status = ? WHERE id = ? AND status <> ?')
      .run(target, String(id), 'found');
    return this.get(id);
  }

  /** 彻底删除（作者已删号 / 明显违规时用，不可恢复） */
  remove(id) {
    const db = this.requireDb();
    const result = db.prepare('DELETE FROM surprises WHERE id = ?').run(String(id));
    if (!Number(result.changes)) {
      throw new SurpriseAdminError('惊喜不存在：' + id, 'NOT_FOUND', 404);
    }
    return { ok: true };
  }

  /**
   * 作者原图。photo_data 里存的是 data URL（data:image/jpeg;base64,...），
   * 这里解析成 { contentType, buffer } 由 HTTP 层直接吐二进制。
   * 后台需要它才能判断「这张照片该不该下架」，所以不能像公开列表那样藏起来。
   */
  photo(id) {
    const db = this.requireDb();
    const row = db.prepare('SELECT photo_data FROM surprises WHERE id = ?').get(String(id));
    if (!row) throw new SurpriseAdminError('惊喜不存在：' + id, 'NOT_FOUND', 404);
    const raw = row.photo_data || '';
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(raw);
    if (!match) throw new SurpriseAdminError('这条惊喜没有照片', 'NO_PHOTO', 404);
    const contentType = match[1] || 'image/jpeg';
    const buffer = match[2]
      ? Buffer.from(match[3], 'base64')
      : Buffer.from(decodeURIComponent(match[3]), 'utf8');
    return { contentType, buffer };
  }

  close() {
    if (this.db) {
      try { this.db.close(); } catch (_) { /* 忽略 */ }
      this.db = null;
    }
  }
}
