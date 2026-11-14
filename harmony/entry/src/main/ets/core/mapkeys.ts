/**
 * 步迷 Walkaholic · HarmonyOS 逻辑层 — 地图 Key 下发
 *
 * 产品要求（docs/parity.md §1）：**不写死、不让用户填**。
 * 按顺序读，任一成功即停止：
 *
 *   1. 应用包内 `mapkeys.json`（rawfile，部署时注入；结构 {keys:{amap,baidu},version}）
 *   2. 公网 `https://xiaoqiangch.github.io/walkaholic/mapkeys.json`（Pages 发布产物）
 *   3. 后台公开端点 `GET {adminBase}/api/public/mapkeys`
 *
 * 三条都失败 → 空 Key（只用 OSM + 维基，功能不受影响）。
 *
 * 缓存 12 小时（parity.md 要求），缓存落 KeyValueStore（UI 注入 preferences）。
 * 本文件是纯 TS：rawfile 的读取由 UI 注入（`readBundledKeys` 回调）。
 */

import { KeyValueStore } from './contract';
import { HttpClient, MapKeys, emptyKeys, errorText } from './http';
import { parseJson, requestText } from './http';

/** 公网 mapkeys.json（GitHub Pages 部署产物） */
export const PAGES_MAPKEYS_URL: string = 'https://xiaoqiangch.github.io/walkaholic/mapkeys.json';

/** 后台公开端点（本地开发 / 局域网） */
export const ADMIN_BASE_DEFAULT: string = 'http://127.0.0.1:8802';
export const ADMIN_MAPKEYS_PATH: string = '/api/public/mapkeys';

/** 拉 Key 的请求头（原生 HTTP 客户端不会自动带 UA） */
const MAPKEYS_HEADERS: Record<string, string> = {
  'User-Agent': 'Walkaholic-Harmony/0.7 (https://github.com/xiaoqiangch/walkaholic)',
  'Accept': 'application/json'
};

/** Key 缓存的存储键与有效期 */
export const MAPKEYS_CACHE_KEY: string = 'walkaholic.mapkeys.v1';
export const MAPKEYS_CACHE_TTL_MS: number = 12 * 3600 * 1000;

/** 下发结果 */
export interface MapKeysResult {
  keys: MapKeys;
  /** bundled / pages / admin / cache / none */
  source: string;
  /** 后台服务地址（下次拉取用；可被用户在设置里改） */
  adminBase: string;
}

/** 缓存结构（存 KeyValueStore） */
interface MapKeysCache {
  amap: string;
  baidu: string;
  source: string;
  at: number;
}

/** 从 JSON 里读 keys 对象（结构容错：两种命名都认） */
export function parseMapKeys(json: Record<string, unknown>): MapKeys {
  const keys: MapKeys = emptyKeys();
  const nested: unknown = json['keys'];
  let record: Record<string, unknown> | undefined = undefined;
  if (typeof nested === 'object' && nested !== null && !Array.isArray(nested)) {
    record = nested as Record<string, unknown>;
  } else {
    record = json;
  }
  const amap: unknown = record['amap'];
  const baidu: unknown = record['baidu'];
  if (typeof amap === 'string') keys.amap = amap.trim();
  if (typeof baidu === 'string') keys.baidu = baidu.trim();
  return keys;
}

/** 两个 Key 是否都为空 */
export function keysEmpty(keys: MapKeys): boolean {
  return keys.amap.length === 0 && keys.baidu.length === 0;
}

/** 读缓存（12h 内有效） */
export function readCachedKeys(kv: KeyValueStore, now: number): MapKeysResult | undefined {
  const raw: string | undefined = kv.getString(MAPKEYS_CACHE_KEY);
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const record: Record<string, unknown> = parsed as Record<string, unknown>;
    const at: unknown = record['at'];
    if (typeof at !== 'number') return undefined;
    if (now - at > MAPKEYS_CACHE_TTL_MS || now < at) return undefined;
    const keys: MapKeys = emptyKeys();
    const amap: unknown = record['amap'];
    const baidu: unknown = record['baidu'];
    if (typeof amap === 'string') keys.amap = amap;
    if (typeof baidu === 'string') keys.baidu = baidu;
    const source: unknown = record['source'];
    const result: MapKeysResult = {
      keys: keys,
      source: typeof source === 'string' ? 'cache:' + source : 'cache',
      adminBase: ADMIN_BASE_DEFAULT
    };
    return result;
  } catch (error) {
    return undefined;
  }
}

/** 写缓存 */
export function writeCachedKeys(kv: KeyValueStore, keys: MapKeys, source: string, now: number): void {
  const cache: MapKeysCache = {
    amap: keys.amap,
    baidu: keys.baidu,
    source: source,
    at: now
  };
  try {
    kv.putString(MAPKEYS_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    // 缓存失败不影响主流程
  }
}

/**
 * 拉取台端点：`{adminBase}/api/public/mapkeys`。
 * 服务端返回 { ok:true, keys:{amap,baidu}, version }。
 */
export async function fetchAdminKeys(
  client: HttpClient,
  adminBase: string,
  timeoutMs: number
): Promise<MapKeys> {
  const base: string = adminBase.replace(/\/+$/, '');
  const url: string = base + ADMIN_MAPKEYS_PATH;
  const body: string = await requestText(client, {
    url: url,
    method: 'GET',
    headers: MAPKEYS_HEADERS,
    timeoutMs: timeoutMs
  });
  return parseMapKeys(parseJson(body));
}

/** 拉取 Pages 上的 mapkeys.json */
export async function fetchPagesKeys(client: HttpClient, timeoutMs: number): Promise<MapKeys> {
  const body: string = await requestText(client, {
    url: PAGES_MAPKEYS_URL,
    method: 'GET',
    headers: MAPKEYS_HEADERS,
    timeoutMs: timeoutMs
  });
  return parseMapKeys(parseJson(body));
}

/**
 * 完整下发流程。
 * @param readBundledKeys UI 注入：读 rawfile 里的 mapkeys.json（同步返回文本或 undefined）
 */
export async function loadMapKeys(
  client: HttpClient,
  kv: KeyValueStore,
  readBundledKeys: () => string | undefined,
  adminBase: string,
  now: number
): Promise<MapKeysResult> {
  // ⓪ 缓存（12h）
  const cached: MapKeysResult | undefined = readCachedKeys(kv, now);
  if (cached !== undefined && !keysEmpty(cached.keys)) return cached;

  // ① 包内 rawfile（部署时注入，离线也能拿到）
  const bundledText: string | undefined = readBundledKeys();
  if (bundledText !== undefined && bundledText.length > 0) {
    try {
      const bundled: MapKeys = parseMapKeys(parseJson(bundledText));
      if (!keysEmpty(bundled)) {
        writeCachedKeys(kv, bundled, 'bundled', now);
        const result: MapKeysResult = { keys: bundled, source: 'bundled', adminBase: adminBase };
        return result;
      }
    } catch (error) {
      // 包内文件坏了就继续下一条
    }
  }

  // ② 公网 Pages
  try {
    const pages: MapKeys = await fetchPagesKeys(client, 5000);
    if (!keysEmpty(pages)) {
      writeCachedKeys(kv, pages, 'pages', now);
      const result: MapKeysResult = { keys: pages, source: 'pages', adminBase: adminBase };
      return result;
    }
  } catch (error) {
    // 继续
  }

  // ③ 后台端点
  try {
    const admin: MapKeys = await fetchAdminKeys(client, adminBase, 4000);
    if (!keysEmpty(admin)) {
      writeCachedKeys(kv, admin, 'admin', now);
      const result: MapKeysResult = { keys: admin, source: 'admin', adminBase: adminBase };
      return result;
    }
  } catch (error) {
    // 继续
  }

  // ④ 全失败：只用免费源
  const none: MapKeys = emptyKeys();
  const result: MapKeysResult = { keys: none, source: 'none', adminBase: adminBase };
  return result;
}

/** 数据源状态文案（「我的 → 数据源」展示） */
export function mapKeysSourceText(source: string): string {
  if (source.indexOf('bundled') === 0) return '随 App 内置下发';
  if (source.indexOf('pages') === 0) return '公网 Pages 下发';
  if (source.indexOf('admin') === 0) return '后台接口下发';
  if (source === 'none') return '未配置（只用免费源）';
  return source;
}

/** 把 Key 掩码成「52da…f425」（绝不回显完整 Key） */
export function maskKey(key: string): string {
  if (key.length === 0) return '';
  if (key.length <= 8) return key;
  return key.substring(0, 4) + '…' + key.substring(key.length - 4);
}

/** 失败原因汇总（UI 调试用） */
export function describeFetchError(error: unknown): string {
  return '地图 Key 没取到：' + errorText(error);
}