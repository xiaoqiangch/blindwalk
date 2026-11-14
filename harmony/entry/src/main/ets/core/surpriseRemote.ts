/**
 * 步迷 Walkaholic · HarmonyOS 逻辑层 — 惊喜跨用户共享 + 到达照片（远端接口）
 *
 * 对齐 iOS `SurpriseService` / `AccountService.uploadCheckInPhoto`，接口见 account/docs/API.md §4 §5：
 *   GET  /api/surprises?lat&lon&radius   附近待寻（无需登录；登录后自动排除自己埋的）
 *   POST /api/surprises                  埋下（登录或 X-WA-Device）
 *   POST /api/surprises/:id/find         认领（必须登录，先到先得）
 *   GET  /api/surprises/mine             我埋的（回执数据源）
 *   POST /api/photos                     上传到达照片（必须登录）
 *   GET  /api/photos/:placeId            取回到达照片（必须登录）
 *
 * 保密约束（与服务端一致）：列表接口不返回照片与正文，照片就是答案。
 * 因此本机对远端惊喜只拿到线索、区域、距离。
 *
 * 纯 TypeScript：网络走注入的 HttpClient，可在 Node 里单测。
 */

import { HttpClient, HttpResponse, errorText } from './http';
import { AccountConfig, readDeviceID } from './account';
import { KeyValueStore } from './contract';
import { BuriedSurprise, GeoPoint, SurpriseReceipt } from './types';
import { decodeReceipts } from './receipts';

/** 一次远端拉取的结果 */
export interface RemoteSurpriseResult {
  ok: boolean;
  surprises: BuriedSurprise[];
  error: string;
}

/** 远端惊喜条目的形状（服务端只回这些字段） */
export function parseRemoteSurprise(value: unknown): BuriedSurprise | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const item: Record<string, unknown> = value as Record<string, unknown>;
  const id: unknown = item['id'];
  if (typeof id !== 'string' || id.length === 0) return undefined;
  const location: unknown = item['location'];
  if (typeof location !== 'object' || location === null) return undefined;
  const locationRecord: Record<string, unknown> = location as Record<string, unknown>;
  const lat: unknown = locationRecord['lat'];
  const lon: unknown = locationRecord['lon'];
  if (typeof lat !== 'number' || typeof lon !== 'number') return undefined;

  const cluesValue: unknown = item['clues'];
  const clues: string[] = [];
  if (Array.isArray(cluesValue)) {
    for (let i = 0; i < cluesValue.length; i += 1) {
      if (typeof cluesValue[i] === 'string') clues.push(cluesValue[i] as string);
    }
  }
  const createdAt: unknown = item['createdAt'];
  const createdAtValue: number = typeof createdAt === 'number' ? createdAt : Date.now();
  const radius: unknown = item['radiusMeters'];
  const areaLabel: unknown = item['areaLabel'];
  const authorEmoji: unknown = item['authorEmoji'];

  const remote: BuriedSurprise = {
    id: id,
    // 列表接口不返回作者昵称：统一写「有人」，寻到后才在回执里看到
    authorName: '有人',
    authorEmoji: typeof authorEmoji === 'string' && authorEmoji.length > 0 ? authorEmoji : '🫥',
    location: { latitude: lat, longitude: lon },
    areaWord: typeof areaLabel === 'string' ? areaLabel : '',
    hints: clues,
    photoHash: '',
    photoUri: '',
    buriedAt: createdAtValue,
    found: false,
    radiusMeters: typeof radius === 'number' ? radius : 60,
    isRemote: true,
    isMine: false,
    isUploaded: false
  };
  return remote;
}

/** 统一的请求头（带上设备标识；登录时带 Cookie） */
function headersFor(config: AccountConfig, kv: KeyValueStore, withJson: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'X-WA-Device': readDeviceID(kv)
  };
  if (config.cookie !== undefined && config.cookie.length > 0) {
    headers['Cookie'] = config.cookie;
  }
  if (withJson) headers['Content-Type'] = 'application/json; charset=utf-8';
  return headers;
}

function baseOf(config: AccountConfig): string {
  return config.baseUrl.replace(/\/+$/, '');
}

function jsonOf(text: string): Record<string, unknown> {
  if (text.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch (error) {
    return {};
  }
}

/**
 * 拉取附近别人埋下的惊喜（未登录也能拉，只是不会排除自己埋的）。
 * 失败返回空数组 + 原因（UI 静默降级，不打扰浏览）。
 */
export async function fetchNearbySurprises(
  client: HttpClient,
  config: AccountConfig,
  kv: KeyValueStore,
  origin: GeoPoint,
  radiusMeters: number
): Promise<RemoteSurpriseResult> {
  const url: string = baseOf(config) + '/api/surprises' +
    '?lat=' + origin.latitude.toFixed(6) +
    '&lon=' + origin.longitude.toFixed(6) +
    '&radius=' + String(Math.round(radiusMeters));
  let response: HttpResponse;
  try {
    response = await client.request({
      url: url,
      method: 'GET',
      headers: headersFor(config, kv, false),
      timeoutMs: 10000
    });
  } catch (error) {
    const failed: RemoteSurpriseResult = { ok: false, surprises: [], error: errorText(error) };
    return failed;
  }
  if (response.status < 200 || response.status >= 300) {
    const failed: RemoteSurpriseResult = {
      ok: false, surprises: [], error: 'HTTP ' + String(response.status)
    };
    return failed;
  }
  const payload: Record<string, unknown> = jsonOf(response.body);
  const items: unknown = payload['items'];
  const list: BuriedSurprise[] = [];
  if (Array.isArray(items)) {
    for (let i = 0; i < items.length; i += 1) {
      const remote: BuriedSurprise | undefined = parseRemoteSurprise(items[i]);
      if (remote !== undefined) list.push(remote);
    }
  }
  const ok: RemoteSurpriseResult = { ok: true, surprises: list, error: '' };
  return ok;
}

/**
 * 把一条本机埋下的惊喜上传到服务端。
 * 登录了就按账号归属；未登录也允许上传（服务端用设备标识区分作者）——
 * 否则「埋下一个」对没注册的人等于没生效。
 *
 * @param photoDataUrl 作者照片的 data URL（可选；超上限服务端只保留哈希）
 */
export async function uploadSurprise(
  client: HttpClient,
  config: AccountConfig,
  kv: KeyValueStore,
  surprise: BuriedSurprise,
  photoDataUrl?: string
): Promise<boolean> {
  const body: Record<string, unknown> = {
    lat: surprise.location.latitude,
    lon: surprise.location.longitude,
    areaLabel: surprise.areaWord,
    message: surprise.message === undefined ? '' : surprise.message,
    clues: surprise.hints,
    radiusMeters: surprise.radiusMeters === undefined ? 60 : surprise.radiusMeters,
    authorEmoji: surprise.authorEmoji
  };
  if (photoDataUrl !== undefined && photoDataUrl.length > 0) {
    body['photoData'] = photoDataUrl;
  }
  let response: HttpResponse;
  try {
    response = await client.request({
      url: baseOf(config) + '/api/surprises',
      method: 'POST',
      headers: headersFor(config, kv, true),
      body: JSON.stringify(body),
      timeoutMs: 15000
    });
  } catch (error) {
    return false;
  }
  if (response.status < 200 || response.status >= 300) return false;
  const payload: Record<string, unknown> = jsonOf(response.body);
  return payload['ok'] === true;
}

/** 找到别人埋的惊喜后通知服务端（先到先得；已被别人抢先时返回 false） */
export async function claimSurprise(
  client: HttpClient,
  config: AccountConfig,
  kv: KeyValueStore,
  surpriseID: string
): Promise<boolean> {
  if (config.cookie === undefined || config.cookie.length === 0) return false;
  let response: HttpResponse;
  try {
    response = await client.request({
      url: baseOf(config) + '/api/surprises/' + encodeURIComponent(surpriseID) + '/find',
      method: 'POST',
      headers: headersFor(config, kv, true),
      body: '{}',
      timeoutMs: 10000
    });
  } catch (error) {
    return false;
  }
  return response.status >= 200 && response.status < 300;
}

/**
 * 拉取「我埋的惊喜」的状态（回执数据源）。
 * 登录按账号，未登录按设备标识 —— 匿名埋下的惊喜也会被找到，作者同样应该收到回执。
 */
export async function fetchMySurpriseReceipts(
  client: HttpClient,
  config: AccountConfig,
  kv: KeyValueStore
): Promise<SurpriseReceipt[]> {
  let response: HttpResponse;
  try {
    response = await client.request({
      url: baseOf(config) + '/api/surprises/mine',
      method: 'GET',
      headers: headersFor(config, kv, false),
      timeoutMs: 10000
    });
  } catch (error) {
    return [];
  }
  if (response.status < 200 || response.status >= 300) return [];
  const payload: Record<string, unknown> = jsonOf(response.body);
  const items: unknown = payload['items'];
  if (!Array.isArray(items)) return [];
  const found: unknown[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item: unknown = items[i];
    if (typeof item !== 'object' || item === null) continue;
    const record: Record<string, unknown> = item as Record<string, unknown>;
    if (record['status'] !== 'found') continue;
    found.push({
      id: record['id'],
      areaLabel: typeof record['areaLabel'] === 'string' ? record['areaLabel'] : '',
      finderName: typeof record['finderName'] === 'string' && (record['finderName'] as string).length > 0
        ? record['finderName']
        : '有人',
      foundAt: typeof record['foundAt'] === 'number' ? record['foundAt'] : Date.now()
    });
  }
  return decodeReceipts(found);
}

/**
 * 上传到达时拍的照片（需要登录）。返回远端路径（`/api/photos/<placeId>`），失败返回 undefined。
 * 照片不进 profile 同步包（256KB 上限塞不下），而是单独存、按地点取。
 */
export async function uploadCheckInPhoto(
  client: HttpClient,
  config: AccountConfig,
  kv: KeyValueStore,
  placeID: string,
  dataUrl: string
): Promise<string | undefined> {
  if (config.cookie === undefined || config.cookie.length === 0) return undefined;
  const body: Record<string, unknown> = { placeId: placeID, dataUrl: dataUrl };
  let response: HttpResponse;
  try {
    response = await client.request({
      url: baseOf(config) + '/api/photos',
      method: 'POST',
      headers: headersFor(config, kv, true),
      body: JSON.stringify(body),
      timeoutMs: 20000
    });
  } catch (error) {
    return undefined;
  }
  if (response.status < 200 || response.status >= 300) return undefined;
  const payload: Record<string, unknown> = jsonOf(response.body);
  const path: unknown = payload['path'];
  if (typeof path === 'string' && path.length > 0) return path;
  return undefined;
}

/** 远端照片路径 → 完整 URL（图鉴详情 / 换机后取回照片用） */
export function remotePhotoURL(config: AccountConfig, path: string): string | undefined {
  if (path.length === 0 || path.indexOf('/') !== 0) return undefined;
  return baseOf(config) + path;
}
