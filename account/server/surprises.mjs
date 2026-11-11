/**
 * 惊喜（跨用户共享）HTTP 适配层
 *
 * 为什么需要它：惊喜原来只存在各自设备的 localStorage 里，
 * 所以「附近的惊喜」对真实用户永远是空的 —— 别人的惊喜永远到不了你的手机。
 * 这个模块把惊喜放到服务端共享，图鉴页才有真实数据可显示。
 *
 * 保密约束（与三端一致）：
 * - 列表接口**不返回** photoData / photoHash / message（照片就是答案）
 * - 不返回准确坐标，只返回距离（米，取整）
 * - 不返回作者 id，只给 emoji 展示名
 */

const MAX_PHOTO_BYTES = 220 * 1024;   // 单张惊喜照片上限（data URL 长度）
const MAX_CLUES = 4;
const MIN_RADIUS = 20;
const MAX_RADIUS = 300;

export class SurpriseError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function haversine(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLon = (bLon - aLon) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}

function sanitizeClues(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, MAX_CLUES).map((c) => String(c || '').slice(0, 120)).filter(Boolean);
}

/** 列表项：只给"够用但不泄密"的字段 */
function publicListItem(row, fromLat, fromLon) {
  const distance = (typeof fromLat === 'number' && typeof fromLon === 'number')
    ? Math.round(haversine(fromLat, fromLon, row.lat, row.lon))
    : null;
  return {
    id: row.id,
    authorEmoji: row.authorEmoji || '🫥',
    areaLabel: row.areaLabel || '',
    clues: row.clues,
    radiusMeters: row.radiusMeters,
    distanceMeters: distance,
    createdAt: row.createdAt,
    location: { lat: Number(row.lat.toFixed(5)), lon: Number(row.lon.toFixed(5)) }
  };
}

/**
 * 建惊喜（需要登录）
 * body: { lat, lon, message, areaLabel, clues[], radiusMeters, photoData?, photoHash? }
 */
export function createSurprise(store, user, body, now) {
  const lat = Number(body && body.lat);
  const lon = Number(body && body.lon);
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) {
    throw new SurpriseError('坐标不合法', 'BAD_COORDINATE');
  }
  const clues = sanitizeClues(body && body.clues);
  if (clues.length < 2) {
    throw new SurpriseError('至少需要两条线索', 'BAD_CLUES');
  }
  let photoData = body && typeof body.photoData === 'string' ? body.photoData : null;
  if (photoData && photoData.length > MAX_PHOTO_BYTES) {
    // 照片太大就只保留哈希：不阻塞埋惊喜，只是找到后看不到原图
    photoData = null;
  }
  const radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, Number(body && body.radiusMeters) || 60));

  const item = {
    id: 'surprise-' + now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    userId: user.id,
    authorName: user.username,
    authorEmoji: (body && body.authorEmoji) ? String(body.authorEmoji).slice(0, 4) : '🫥',
    lat,
    lon,
    areaLabel: (body && body.areaLabel) ? String(body.areaLabel).slice(0, 24) : '',
    message: (body && body.message) ? String(body.message).slice(0, 200) : '',
    clues,
    radiusMeters: radius,
    photoData,
    photoHash: (body && body.photoHash) ? String(body.photoHash).slice(0, 32) : null,
    createdAt: now()
  };
  store.createSurprise(item);
  return { ok: true, surprise: { id: item.id, createdAt: item.createdAt } };
}

/**
 * 附近的待寻惊喜（可选登录：登录了就排除自己埋的）
 */
export function listNearby(store, query, viewer) {
  const lat = Number(query.get('lat'));
  const lon = Number(query.get('lon'));
  const radius = Math.min(20000, Math.max(100, Number(query.get('radius')) || 5000));
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) {
    throw new SurpriseError('坐标不合法', 'BAD_COORDINATE');
  }
  const rows = store.listNearbySurprises(lat, lon, radius, viewer ? viewer.id : null);
  const items = rows
    .map((row) => publicListItem(row, lat, lon))
    .filter((item) => item.distanceMeters !== null && item.distanceMeters <= radius)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 40);
  return { ok: true, items, count: items.length };
}

/** 我埋的（需要登录） */
export function listMine(store, user) {
  const rows = store.listMySurprises(user.id);
  return {
    ok: true,
    items: rows.map((row) => ({
      id: row.id,
      areaLabel: row.areaLabel,
      status: row.status,
      finderName: row.finderName,
      foundAt: row.foundAt,
      createdAt: row.createdAt,
      radiusMeters: row.radiusMeters
    }))
  };
}

/** 认领：谁先到算谁的（需要登录） */
export function claimSurprise(store, user, surpriseId, now) {
  const row = store.getSurprise(surpriseId);
  if (!row) throw new SurpriseError('惊喜不存在', 'NOT_FOUND', 404);
  if (row.userId === user.id) throw new SurpriseError('不能寻找自己埋的惊喜', 'OWN_SURPRISE', 400);
  const ok = store.markSurpriseFound(surpriseId, user.username, now());
  if (!ok) throw new SurpriseError('这个惊喜已经被别人找到了', 'ALREADY_FOUND', 409);
  return { ok: true, id: surpriseId };
}
