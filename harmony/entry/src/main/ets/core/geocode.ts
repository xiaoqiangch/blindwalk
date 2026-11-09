/**
 * 盲走 BlindWalk · HarmonyOS 逻辑层 — 地址 → 坐标（GPS 不可用时的出口）
 *
 * 移植自 prototype/web/geo.js 的 geocodeAddress：
 *   1. 输入直接是坐标（31.23,121.47）→ 直接用
 *   2. Nominatim（OpenStreetMap，免费、无需 Key）→ 拿第一条
 *   3. Photon（komoot，免费）兜底
 * 都失败返回 undefined，由 UI 提示「换个位置再试试」。
 *
 * 用途：定位被拒 / 室内无信号时，用户仍能走一个**真实**地点（parity.md §2 的
 * 「换个位置」按钮）。绝不用这个能力去生成虚构地点。
 */

import { HttpClient, errorText, parseJson, requestText } from './http';
import { GeoPoint } from './types';

export const NOMINATIM_ENDPOINT: string = 'https://nominatim.openstreetmap.org/search';

/**
 * Nominatim / Photon 都要求带 User-Agent（否则 403）。
 * 原生 HTTP 客户端不会自动加，必须显式设置。
 */
export const GEO_HEADERS: Record<string, string> = {
  'User-Agent': 'BlindWalk-Harmony/0.7 (https://github.com/xiaoqiangch/blindwalk)',
  'Accept': 'application/json'
};
export const PHOTON_ENDPOINT: string = 'https://photon.komoot.io/api/';
export const GEOCODE_TIMEOUT_MS: number = 6000;

/** 反查结果 */
export interface GeocodeResult {
  location: GeoPoint;
  label: string;
  /** manual / nominatim / photon */
  source: string;
}

/** 尝试解析「31.2304,121.4737」这类直接坐标 */
export function parseCoordinateText(text: string): GeoPoint | undefined {
  const trimmed: string = text.trim();
  const match = trimmed.match(/^(-?\d{1,2}\.\d+)\s*[,，\s]\s*(-?\d{1,3}\.\d+)$/);
  if (match === null) return undefined;
  const latitude: number = parseFloat(match[1]);
  const longitude: number = parseFloat(match[2]);
  if (!isFinite(latitude) || !isFinite(longitude)) return undefined;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
  const point: GeoPoint = { latitude: latitude, longitude: longitude };
  return point;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value: unknown = record[key];
  return typeof value === 'string' ? value : '';
}

/** 解析 Nominatim 搜索结果（纯函数） */
export function parseNominatim(json: unknown): GeocodeResult | undefined {
  if (!Array.isArray(json) || json.length === 0) return undefined;
  const first: unknown = json[0];
  if (typeof first !== 'object' || first === null) return undefined;
  const record: Record<string, unknown> = first as Record<string, unknown>;
  const lat: number = parseFloat(readString(record, 'lat'));
  const lon: number = parseFloat(readString(record, 'lon'));
  if (!isFinite(lat) || !isFinite(lon)) return undefined;
  const label: string = readString(record, 'display_name');
  const result: GeocodeResult = {
    location: { latitude: lat, longitude: lon },
    label: label.length > 0 ? label : '这个位置',
    source: 'nominatim'
  };
  return result;
}

/** 解析 Photon 搜索结果（纯函数） */
export function parsePhoton(json: Record<string, unknown>): GeocodeResult | undefined {
  const features: unknown = json['features'];
  if (!Array.isArray(features) || features.length === 0) return undefined;
  const first: unknown = features[0];
  if (typeof first !== 'object' || first === null) return undefined;
  const feature: Record<string, unknown> = first as Record<string, unknown>;
  const geometry: unknown = feature['geometry'];
  if (typeof geometry !== 'object' || geometry === null) return undefined;
  const coordinates: unknown = (geometry as Record<string, unknown>)['coordinates'];
  if (!Array.isArray(coordinates) || coordinates.length < 2) return undefined;
  const lon: number = typeof coordinates[0] === 'number' ? coordinates[0] : NaN;
  const lat: number = typeof coordinates[1] === 'number' ? coordinates[1] : NaN;
  if (!isFinite(lat) || !isFinite(lon)) return undefined;

  const propertiesValue: unknown = feature['properties'];
  const pieces: string[] = [];
  if (typeof propertiesValue === 'object' && propertiesValue !== null) {
    const properties: Record<string, unknown> = propertiesValue as Record<string, unknown>;
    const name: string = readString(properties, 'name');
    const street: string = readString(properties, 'street');
    const district: string = readString(properties, 'district');
    const city: string = readString(properties, 'city');
    if (name.length > 0) pieces.push(name);
    if (street.length > 0) pieces.push(street);
    if (district.length > 0) pieces.push(district);
    if (city.length > 0) pieces.push(city);
  }
  const result: GeocodeResult = {
    location: { latitude: lat, longitude: lon },
    label: pieces.length > 0 ? pieces.join(' · ') : '这个位置',
    source: 'photon'
  };
  return result;
}

/**
 * 地址 → 坐标。失败返回 undefined（UI 提示用户再试）。
 * @param rawQuery 用户输入（地址或「lat,lon」）
 */
export async function geocodeAddress(
  client: HttpClient,
  rawQuery: string
): Promise<GeocodeResult | undefined> {
  const query: string = rawQuery.trim();
  if (query.length === 0) return undefined;

  const manual: GeoPoint | undefined = parseCoordinateText(query);
  if (manual !== undefined) {
    const result: GeocodeResult = {
      location: manual,
      label: '你输入的位置',
      source: 'manual'
    };
    return result;
  }

  const nominatimUrl: string = NOMINATIM_ENDPOINT +
    '?format=jsonv2&limit=1&accept-language=zh-CN&q=' + encodeURIComponent(query);

  try {
    const text: string = await requestText(client, {
      url: nominatimUrl,
      method: 'GET',
      headers: GEO_HEADERS,
      timeoutMs: GEOCODE_TIMEOUT_MS
    });
    const parsed: GeocodeResult | undefined = parseNominatim(parseJsonArray(text));
    if (parsed !== undefined) return parsed;
  } catch (error) {
    // 继续 Photon
  }

  try {
    const text: string = await requestText(client, {
      url: PHOTON_ENDPOINT + '?limit=1&lang=zh&q=' + encodeURIComponent(query),
      method: 'GET',
      headers: GEO_HEADERS,
      timeoutMs: GEOCODE_TIMEOUT_MS
    });
    return parsePhoton(parseJson(text));
  } catch (error) {
    return undefined;
  }
}

/** Nominatim 返回数组，http.ts 的 parseJson 只接受对象，这里单独解析 */
function parseJsonArray(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    return undefined;
  }
}

/** 反查失败提示 */
export function geocodeErrorText(error: unknown): string {
  return '没查到这个地方（可以试试「31.23,121.47」这样的坐标）：' + errorText(error);
}

/** 反向地理编码：坐标 → 「区 · 街道」（失败返回空串，不影响主流程） */
export interface ReverseGeocodeResult {
  area: string;
  road: string;
  display: string;
}

export function parseNominatimReverse(json: Record<string, unknown>): ReverseGeocodeResult {
  const addressValue: unknown = json['address'];
  let area: string = '';
  let road: string = '';
  if (typeof addressValue === 'object' && addressValue !== null) {
    const address: Record<string, unknown> = addressValue as Record<string, unknown>;
    const candidates: string[] = ['city_district', 'district', 'suburb', 'city', 'town', 'county'];
    for (let i = 0; i < candidates.length; i += 1) {
      const value: string = readString(address, candidates[i]);
      if (value.length > 0) {
        area = value;
        break;
      }
    }
    const roadCandidates: string[] = ['road', 'pedestrian', 'neighbourhood', 'quarter'];
    for (let i = 0; i < roadCandidates.length; i += 1) {
      const value: string = readString(address, roadCandidates[i]);
      if (value.length > 0) {
        road = value;
        break;
      }
    }
  }
  const result: ReverseGeocodeResult = {
    area: area,
    road: road,
    display: readString(json, 'display_name')
  };
  return result;
}

export async function reverseGeocode(
  client: HttpClient,
  location: GeoPoint
): Promise<ReverseGeocodeResult | undefined> {
  const url: string = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2' +
    '&lat=' + String(location.latitude) + '&lon=' + String(location.longitude) +
    '&accept-language=zh&zoom=16';
  try {
    const text: string = await requestText(client, {
      url: url,
      method: 'GET',
      headers: GEO_HEADERS,
      timeoutMs: GEOCODE_TIMEOUT_MS
    });
    return parseNominatimReverse(parseJson(text));
  } catch (error) {
    return undefined;
  }
}

/** 「区 · 街道」拼接（与 Web 版一致） */
export function areaLabelFrom(reverse: ReverseGeocodeResult | undefined): string {
  if (reverse === undefined) return '';
  const pieces: string[] = [];
  if (reverse.area.length > 0) pieces.push(reverse.area);
  if (reverse.road.length > 0) pieces.push(reverse.road);
  return pieces.join(' · ');
}