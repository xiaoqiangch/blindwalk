/**
 * 步迷 Walkaholic · HarmonyOS 逻辑层 — 多数据源 POI
 *
 * 移植自 prototype/web/providers.js，但去掉了 Web 专属的 JSONP：
 * 鸿蒙是原生 App，`@ohos.net.http` 直接 GET 即可拿到 JSON（无 CORS 限制）。
 *
 * 四个数据源（parity.md §1）：
 *   1. 高德  restapi.amap.com/v3/place/around（请求/返回 GCJ-02 → 转换）
 *   2. 百度  api.map.baidu.com/place/v2/search（请求/返回 BD-09 → 转换）
 *   3. OSM   Overpass（3 镜像容错，单端点 4.5s、整体 8s）
 *   4. 维基  zh.wikipedia.org geosearch（带缩略图）
 *
 * 所有对外坐标一律 WGS-84；解析函数是纯函数，方便 Node fixture 测试。
 */

import { Mood, WalkDuration, GeoPoint } from './types';
import {
  bd09ToWgs84,
  gcj02ToWgs84,
  offset as offsetPoint,
  wgs84ToBd09,
  wgs84ToGcj02
} from './geo';
import {
  HttpClient,
  MapKeys,
  ProviderId,
  PROVIDER_LABELS,
  SourceReport,
  errorText,
  parseJson,
  requestText
} from './http';
import {
  DEDUPE_METERS,
  LANDMARK_KEYWORD_LIMIT,
  PoiCandidate,
  dedupe,
  landmarkKeywordList,
  roamRange,
  trimDiverse
} from './parity';

// ============================================================
// 端点 / 常量
// ============================================================

/**
 * 统一的 User-Agent。
 *
 * **为什么必须有**（实测踩过）：维基与 Overpass 都对「没有 UA 的请求」返回 403 / 406。
 * 浏览器会自动带 UA，所以 Web 版没暴露这个问题；鸿蒙是原生 HTTP 客户端，
 * 不设置就是空的 —— 结果免费源全挂，只剩商业源（或直接失败）。
 */
export const USER_AGENT: string = 'Walkaholic-Harmony/0.7 (https://github.com/xiaoqiangch/walkaholic)';

/** 所有对外的 GET 请求都带上的默认头 */
function defaultHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    'Accept': 'application/json'
  };
  return headers;
}

export const AMAP_ENDPOINT: string = 'https://restapi.amap.com/v3/place/around';
export const BAIDU_ENDPOINT: string = 'https://api.map.baidu.com/place/v2/search';
export const WIKI_ENDPOINT: string = 'https://zh.wikipedia.org/w/api.php';

export const OVERPASS_ENDPOINTS: string[] = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

/** 高德单页上限（offset ≤ 25）、最多翻 3 页 */
export const AMAP_PAGE_SIZE: number = 25;
export const AMAP_MAX_PAGES: number = 3;
/** 百度单页上限（page_size ≤ 20） */
export const BAIDU_PAGE_SIZE: number = 20;

/** 单源超时 */
export const AMAP_TIMEOUT_MS: number = 8000;
export const BAIDU_TIMEOUT_MS: number = 8000;
export const WIKI_TIMEOUT_MS: number = 8000;
export const OVERPASS_ENDPOINT_TIMEOUT_MS: number = 4500;
export const OVERPASS_TOTAL_TIMEOUT_MS: number = 8000;

/** 地图 Key（由后台下发，不写死、不让用户填；定义在 http.ts，避免循环依赖） */

// ============================================================
// OSM 标签白名单（只收公共场所）
// ============================================================

interface TagRule {
  key: string;
  value: string;
  category: string;
}

const TAG_RULES: TagRule[] = [
  { key: 'amenity', value: 'cafe', category: 'cafe' },
  { key: 'amenity', value: 'library', category: 'library' },
  { key: 'shop', value: 'books', category: 'bookstore' },
  { key: 'amenity', value: 'bench', category: 'bench' },
  { key: 'leisure', value: 'park', category: 'park' },
  { key: 'leisure', value: 'garden', category: 'garden' },
  { key: 'tourism', value: 'viewpoint', category: 'viewpoint' },
  { key: 'tourism', value: 'artwork', category: 'art' },
  { key: 'amenity', value: 'arts_centre', category: 'art' },
  { key: 'man_made', value: 'bridge', category: 'bridge' },
  { key: 'waterway', value: 'riverbank', category: 'river' },
  { key: 'amenity', value: 'marketplace', category: 'market' },
  { key: 'leisure', value: 'common', category: 'plaza' },
  { key: 'place', value: 'square', category: 'plaza' },
  { key: 'shop', value: 'convenience', category: 'convenience' },
  { key: 'historic', value: 'yes', category: 'historic' },
  { key: 'amenity', value: 'place_of_worship', category: 'temple' },
  { key: 'tourism', value: 'museum', category: 'museum' },
  { key: 'amenity', value: 'theatre', category: 'venue' }
];

// ============================================================
// 类别映射（原始类别 / 名称 → 17 类）
// ============================================================

interface CategoryRule {
  key: string;
  re: RegExp;
}

const CATEGORY_RULES: CategoryRule[] = [
  { key: 'bench', re: /长椅|长凳|座椅|条凳|bench/i },
  { key: 'bridge', re: /桥|橋|大桥|天桥|廊桥|bridge/i },
  { key: 'cafe', re: /咖啡|咖啡馆|咖啡厅|cafe|星巴克|瑞幸|manner|seesaw|m stand/i },
  { key: 'bookstore', re: /书店|書店|书城|書城|新华书店|bookstore|book shop/i },
  { key: 'library', re: /图书馆|圖書館|阅览室|library/i },
  { key: 'museum', re: /博物馆|博物館|纪念馆|紀念館|展览馆|展覽館|陈列馆|museum/i },
  { key: 'art', re: /美术馆|美術館|艺术馆|藝術館|画廊|畫廊|涂鸦|塗鴉|艺术墙|雕塑|art gallery/i },
  { key: 'park', re: /公园|公園|植物园|动物园|動物園|绿地|綠地|森林公园|park/i },
  { key: 'garden', re: /花园|花園|花圃|garden/i },
  { key: 'river', re: /河|江|湖|滨|濱|码头|碼頭|水岸|堤|river|lake|waterfront/i },
  { key: 'viewpoint', re: /观景|觀景|观景台|觀景台|天台|瞭望|塔$|电视塔|viewpoint|lookout|observation/i },
  { key: 'temple', re: /寺|庙|廟|教堂|会堂|會堂|清真|祠|道观|道觀|church|temple|cathedral|mosque/i },
  { key: 'venue', re: /音乐厅|音樂廳|剧院|劇院|剧场|劇場|戏院|戲院|大戏院|演奏厅|体育馆|體育館|体育场|體育場|影院|电影院|theatre|theater|concert|stadium/i },
  { key: 'convenience', re: /便利店|便利|超市|全家|罗森|羅森|7-11|seven-?eleven|convenience/i },
  { key: 'historic', re: /故居|旧址|舊址|会址|會址|历史建筑|歷史建築|老房子|公馆|公館|洋房|里弄|弄堂|遗址|遺址|historic/i },
  { key: 'market', re: /市集|集市|市场|市場|菜场|菜市場|夜市|market/i },
  // 注意顺序：「广场公园」「人民广场」都含「公园/广场」，
  // park 规则在 plaza 之前，所以「广场公园」正确地判成 park；
  // 「人民广场」不含「公园」，落到 plaza（广场就是广场）。
  { key: 'plaza', re: /广场|廣場|步行街|plaza|square/i }
];

/**
 * 把各家原始类别 / 名称映射到 17 类之一（兜底 plaza）。
 *
 * 匹配顺序很重要（实测踩过）：
 *   1. **先只看名称** —— 名称最可信。例：「国际饭店」应命 historic，
 *      但若把简介一起拼进去，简介里提到「人民公园」就会先命中 park，把饭店判成公园。
 *   2. 名称没线索，再看原始类别 / 简介。
 */
export function mapCategory(raw: string, name: string): string {
  const trimmedName: string = name === undefined ? '' : name;
  if (trimmedName.length > 0) {
    for (let i = 0; i < CATEGORY_RULES.length; i += 1) {
      if (CATEGORY_RULES[i].re.test(trimmedName)) return CATEGORY_RULES[i].key;
    }
  }
  const rawText: string = raw === undefined ? '' : raw;
  if (rawText.length > 0) {
    for (let i = 0; i < CATEGORY_RULES.length; i += 1) {
      if (CATEGORY_RULES[i].re.test(rawText)) return CATEGORY_RULES[i].key;
    }
  }
  return 'plaza';
}

// ============================================================
// 小工具
// ============================================================

function readString(record: Record<string, unknown>, key: string): string {
  const value: unknown = record[key];
  if (typeof value === 'string') return value;
  // 高德 / 百度的 status 有时是数字（1 / 0），统一按文本处理
  if (typeof value === 'number' && isFinite(value)) return String(value);
  return '';
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value: unknown = record[key];
  if (typeof value === 'number' && isFinite(value)) return value;
  if (typeof value === 'string' && value.length > 0) {
    const parsed: number = Number(value);
    if (isFinite(parsed)) return parsed;
  }
  return NaN;
}

function readArray(record: Record<string, unknown>, key: string): unknown[] {
  const value: unknown = record[key];
  return Array.isArray(value) ? value : [];
}

function readRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value: unknown = record[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function trimmedOrEmpty(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function clampNumber(value: number, min: number, max: number): number {
  if (!isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

// ============================================================
// 高德
// ============================================================

/** 构造高德周边搜索 URL（WGS-84 入参，内部转 GCJ-02） */
export function amapUrl(
  latitude: number,
  longitude: number,
  radiusMeters: number,
  limit: number,
  page: number,
  keywords: string,
  key: string
): string {
  const gcj = wgs84ToGcj02(latitude, longitude);
  const offset: number = clampNumber(Math.round(limit), 1, AMAP_PAGE_SIZE);
  let url: string = AMAP_ENDPOINT +
    '?key=' + encodeURIComponent(key) +
    '&location=' + gcj.longitude.toFixed(6) + ',' + gcj.latitude.toFixed(6) +
    '&radius=' + String(Math.round(radiusMeters)) +
    '&offset=' + String(offset) +
    '&page=' + String(page > 0 ? page : 1) +
    '&extensions=all';
  if (keywords.length > 0) {
    url += '&keywords=' + encodeURIComponent(keywords);
  }
  return url;
}

/**
 * 解析高德周边搜索响应（纯函数，fixture 可测）。
 * - `location` 是 GCJ-02「lon,lat」→ 转 WGS-84
 * - `type` 形如「餐饮服务;咖啡厅;…」→ 取最后一段做类别
 * - 返回坐标一律 WGS-84
 */
export function parseAmap(json: Record<string, unknown>): PoiCandidate[] {
  const out: PoiCandidate[] = [];
  if (readString(json, 'status') !== '1') return out;

  const pois: unknown[] = readArray(json, 'pois');
  for (let i = 0; i < pois.length; i += 1) {
    const raw: unknown = pois[i];
    if (typeof raw !== 'object' || raw === null) continue;
    const poi: Record<string, unknown> = raw as Record<string, unknown>;

    const name: string = trimmedOrEmpty(readString(poi, 'name'));
    if (name.length === 0) continue;

    const locationText: string = readString(poi, 'location');
    const parts: string[] = locationText.split(',');
    if (parts.length < 2) continue;
    const gcjLon: number = Number(parts[0]);
    const gcjLat: number = Number(parts[1]);
    if (!isFinite(gcjLat) || !isFinite(gcjLon)) continue;
    const wgs = gcj02ToWgs84(gcjLat, gcjLon);

    let typeText: string = readString(poi, 'type');
    const typeParts: string[] = typeText.split(';');
    const lastType: string = typeParts.length > 0 ? typeParts[typeParts.length - 1] : typeText;

    // photos[]: [{ title, url }]
    let photoUrl: string = '';
    const photos: unknown[] = readArray(poi, 'photos');
    if (photos.length > 0) {
      const first: unknown = photos[0];
      if (typeof first === 'object' && first !== null) {
        photoUrl = readString(first as Record<string, unknown>, 'url');
      }
    }

    let address: string = trimmedOrEmpty(readString(poi, 'address'));
    if (address.length === 0) {
      const city: string = trimmedOrEmpty(readString(poi, 'cityname'));
      const district: string = trimmedOrEmpty(readString(poi, 'adname'));
      const pieces: string[] = [];
      if (city.length > 0) pieces.push(city);
      if (district.length > 0) pieces.push(district);
      address = pieces.join(' · ');
    }

    const idText: string = trimmedOrEmpty(readString(poi, 'id'));
    const candidate: PoiCandidate = {
      id: 'amap-' + (idText.length > 0 ? idText : (gcjLat.toFixed(6) + '_' + gcjLon.toFixed(6))),
      name: name,
      latitude: wgs.latitude,
      longitude: wgs.longitude,
      category: mapCategory(lastType, name),
      source: 'amap'
    };
    if (address.length > 0) candidate.address = address;
    if (photoUrl.length > 0) {
      candidate.photoUrl = photoUrl;
      candidate.photoCredit = '高德地图';
    }
    out.push(candidate);
  }
  return out;
}

/** 高德：keywords 一次 + 普通页最多 3 页 */
export async function fetchAmap(
  client: HttpClient,
  latitude: number,
  longitude: number,
  radiusMeters: number,
  limit: number,
  key: string,
  lightweight?: boolean
): Promise<PoiCandidate[]> {
  const collected: PoiCandidate[] = [];
  const isLightweight: boolean = lightweight === true;

  // ① 地标关键字查询（公园/博物馆/广场…）——先拿到「值得走」的点
  //
  // 注意两个实测坑：
  //   a) parity.md 里关键字用 `|` 分隔，那是**规格写法**；把整串丢给高德会返回 count=0（静默空）。
  //      所以必须拆成单个词逐个查。
  //   b) 高德有 QPS 上限，短时间连发会返回 CUQPS_HAS_EXCEEDED_THE_LIMIT。
  //      所以只查前几个词，且任何一个失败都直接放弃（普通搜索还兜着）。
  //   远程漫游每次要撒 4 个点 × 多个源，代价更高，所以再收到 1 个词。
  const keywords: string[] = landmarkKeywordList();
  const wanted: number = isLightweight ? 1 : LANDMARK_KEYWORD_LIMIT;
  const keywordCount: number = Math.min(keywords.length, wanted);
  for (let k = 0; k < keywordCount; k += 1) {
    try {
      const keywordBody: string = await requestText(client, {
        url: amapUrl(latitude, longitude, radiusMeters, AMAP_PAGE_SIZE, 1, keywords[k], key),
        method: 'GET',
        headers: defaultHeaders(),
        timeoutMs: AMAP_TIMEOUT_MS
      });
      const keywordJson: Record<string, unknown> = parseJson(keywordBody);
      if (readString(keywordJson, 'status') !== '1') {
        // 限额 / 无结果都不重试，交给普通搜索
        break;
      }
      const keywordList: PoiCandidate[] = parseAmap(keywordJson);
      for (let i = 0; i < keywordList.length; i += 1) collected.push(keywordList[i]);
    } catch (error) {
      break;
    }
  }

  // ② 普通周边搜索，按需翻 1~3 页（密集街区第 1 页常全是「楼下 50 米的店」）
  const pageSize: number = clampNumber(Math.round(limit), 1, AMAP_PAGE_SIZE);
  let pages: number = Math.ceil(limit / pageSize);
  if (pages < 1) pages = 1;
  if (pages > AMAP_MAX_PAGES) pages = AMAP_MAX_PAGES;

  let firstError: string = '';
  for (let page = 1; page <= pages; page += 1) {
    try {
      const body: string = await requestText(client, {
        url: amapUrl(latitude, longitude, radiusMeters, pageSize, page, '', key),
        method: 'GET',
        headers: defaultHeaders(),
        timeoutMs: AMAP_TIMEOUT_MS
      });
      const json: Record<string, unknown> = parseJson(body);
      if (readString(json, 'status') !== '1') {
        const info: string = readString(json, 'info');
        if (page === 1) firstError = '高德返回错误：status=' + readString(json, 'status') + ' info=' + info;
        continue;
      }
      const list: PoiCandidate[] = parseAmap(json);
      for (let i = 0; i < list.length; i += 1) collected.push(list[i]);
    } catch (error) {
      if (page === 1) firstError = '高德请求失败：' + errorText(error);
    }
  }

  if (collected.length === 0) {
    throw new Error(firstError.length > 0 ? firstError : '高德没有返回结果');
  }
  return collected;
}

// ============================================================
// 百度
// ============================================================

/** 构造百度圆形区域检索 URL（WGS-84 入参，内部转 BD-09） */
export function baiduUrl(
  latitude: number,
  longitude: number,
  radiusMeters: number,
  limit: number,
  key: string,
  keywords: string
): string {
  const bd = wgs84ToBd09(latitude, longitude);
  const pageSize: number = clampNumber(Math.round(limit), 1, BAIDU_PAGE_SIZE);
  const query: string = keywords.length > 0 ? keywords : '生活服务';
  return BAIDU_ENDPOINT +
    '?query=' + encodeURIComponent(query) +
    '&location=' + bd.latitude.toFixed(6) + ',' + bd.longitude.toFixed(6) +
    '&radius=' + String(Math.round(radiusMeters)) +
    '&output=json&ak=' + encodeURIComponent(key) +
    '&scope=2&page_size=' + String(pageSize) +
    '&page_num=1';
}

/**
 * 解析百度圆形区域检索响应（纯函数）。
 * `location` 是 BD-09 `{lat,lng}` → 转 WGS-84。
 */
export function parseBaidu(json: Record<string, unknown>): PoiCandidate[] {
  const out: PoiCandidate[] = [];
  if (readString(json, 'status') !== '0') return out;

  const results: unknown[] = readArray(json, 'results');
  for (let i = 0; i < results.length; i += 1) {
    const raw: unknown = results[i];
    if (typeof raw !== 'object' || raw === null) continue;
    const poi: Record<string, unknown> = raw as Record<string, unknown>;

    const name: string = trimmedOrEmpty(readString(poi, 'name'));
    if (name.length === 0) continue;

    const location: Record<string, unknown> | undefined = readRecord(poi, 'location');
    if (location === undefined) continue;
    const bdLat: number = readNumber(location, 'lat');
    const bdLng: number = readNumber(location, 'lng');
    if (!isFinite(bdLat) || !isFinite(bdLng)) continue;
    const wgs = bd09ToWgs84(bdLat, bdLng);

    const detail: Record<string, unknown> | undefined = readRecord(poi, 'detail_info');
    let tag: string = '';
    let image: string = '';
    if (detail !== undefined) {
      tag = readString(detail, 'tag');
      image = trimmedOrEmpty(readString(detail, 'image_url'));
    }
    const address: string = trimmedOrEmpty(readString(poi, 'address'));
    const uid: string = trimmedOrEmpty(readString(poi, 'uid'));

    const candidate: PoiCandidate = {
      id: 'baidu-' + (uid.length > 0 ? uid : (bdLat.toFixed(6) + '_' + bdLng.toFixed(6))),
      name: name,
      latitude: wgs.latitude,
      longitude: wgs.longitude,
      category: mapCategory(tag, name),
      source: 'baidu'
    };
    if (address.length > 0) candidate.address = address;
    if (image.length > 0) {
      candidate.photoUrl = image;
      candidate.photoCredit = '百度地图';
    }
    out.push(candidate);
  }
  return out;
}

export async function fetchBaidu(
  client: HttpClient,
  latitude: number,
  longitude: number,
  radiusMeters: number,
  limit: number,
  key: string
): Promise<PoiCandidate[]> {
  const collected: PoiCandidate[] = [];
  let firstError: string = '';

  // ① 地标关键字：逐个词查（整串会导致空结果，同高德的坑）
  const keywords: string[] = landmarkKeywordList();
  const keywordCount: number = Math.min(keywords.length, LANDMARK_KEYWORD_LIMIT);
  for (let k = 0; k < keywordCount; k += 1) {
    try {
      const body: string = await requestText(client, {
        url: baiduUrl(latitude, longitude, radiusMeters, BAIDU_PAGE_SIZE, key, keywords[k]),
        method: 'GET',
        headers: defaultHeaders(),
        timeoutMs: BAIDU_TIMEOUT_MS
      });
      const json: Record<string, unknown> = parseJson(body);
      if (readString(json, 'status') !== '0') continue;
      const list: PoiCandidate[] = parseBaidu(json);
      for (let i = 0; i < list.length; i += 1) collected.push(list[i]);
    } catch (error) {
      // 单个词失败不影响其他词
    }
  }

  // ② 生活服务（默认查询）
  try {
    const body: string = await requestText(client, {
      url: baiduUrl(latitude, longitude, radiusMeters, limit, key, ''),
      method: 'GET',
      headers: defaultHeaders(),
      timeoutMs: BAIDU_TIMEOUT_MS
    });
    const json: Record<string, unknown> = parseJson(body);
    if (readString(json, 'status') !== '0') {
      const message: string = readString(json, 'message');
      firstError = '百度返回错误：status=' + readString(json, 'status') + ' message=' + message;
    } else {
      const list: PoiCandidate[] = parseBaidu(json);
      for (let i = 0; i < list.length; i += 1) collected.push(list[i]);
    }
  } catch (error) {
    if (firstError.length === 0) firstError = '百度请求失败：' + errorText(error);
  }

  if (collected.length === 0) {
    throw new Error(firstError.length > 0 ? firstError : '百度没有返回结果');
  }
  return collected;
}

// ============================================================
// OSM Overpass
// ============================================================

/** 构造 Overpass QL（node 白名单 + around + 120 条上限） */
export function overpassQuery(latitude: number, longitude: number, radiusMeters: number): string {
  const clauses: string[] = [];
  for (let i = 0; i < TAG_RULES.length; i += 1) {
    const rule: TagRule = TAG_RULES[i];
    clauses.push('node["' + rule.key + '"="' + rule.value + '"](around:' +
      String(Math.round(radiusMeters)) + ',' + String(latitude) + ',' + String(longitude) + ');');
  }
  return '[out:json][timeout:15];(' + clauses.join('') + ');out body 120;';
}

/** 解析 Overpass JSON（纯函数；无图） */
export function parseOverpass(json: Record<string, unknown>): PoiCandidate[] {
  const out: PoiCandidate[] = [];
  const elements: unknown[] = readArray(json, 'elements');
  const seen: string[] = [];

  for (let i = 0; i < elements.length; i += 1) {
    const raw: unknown = elements[i];
    if (typeof raw !== 'object' || raw === null) continue;
    const element: Record<string, unknown> = raw as Record<string, unknown>;

    const tags: Record<string, unknown> | undefined = readRecord(element, 'tags');
    if (tags === undefined) continue;
    const name: string = trimmedOrEmpty(readString(tags, 'name'));
    if (name.length === 0) continue;

    const lat: number = readNumber(element, 'lat');
    const lon: number = readNumber(element, 'lon');
    if (!isFinite(lat) || !isFinite(lon)) continue;

    let category: string = '';
    for (let j = 0; j < TAG_RULES.length; j += 1) {
      if (readString(tags, TAG_RULES[j].key) === TAG_RULES[j].value) {
        category = TAG_RULES[j].category;
        break;
      }
    }
    if (category.length === 0) continue;

    const elementType: string = readString(element, 'type');
    const elementID: unknown = element['id'];
    const idText: string = typeof elementID === 'number' ? String(elementID) : readString(element, 'id');
    const id: string = 'osm-' + elementType + '-' + idText;
    if (seen.indexOf(id) >= 0) continue;
    seen.push(id);

    const addressPieces: string[] = [];
    const street: string = readString(tags, 'addr:street');
    const district: string = readString(tags, 'addr:district');
    const suburb: string = readString(tags, 'addr:suburb');
    if (street.length > 0) addressPieces.push(street);
    if (district.length > 0) addressPieces.push(district);
    if (suburb.length > 0) addressPieces.push(suburb);

    const candidate: PoiCandidate = {
      id: id,
      name: name,
      latitude: lat,
      longitude: lon,
      category: category,
      source: 'osm'
    };
    if (addressPieces.length > 0) candidate.address = addressPieces.join(' · ');
    out.push(candidate);
  }
  return out;
}

/** OSM：3 个镜像依次尝试，单端点 4.5s */
export async function fetchOSM(
  client: HttpClient,
  latitude: number,
  longitude: number,
  radiusMeters: number
): Promise<PoiCandidate[]> {
  let lastError: string = '';
  const form: string = 'data=' + encodeURIComponent(overpassQuery(latitude, longitude, radiusMeters));
  for (let i = 0; i < OVERPASS_ENDPOINTS.length; i += 1) {
    try {
      const body: string = await requestText(client, {
        url: OVERPASS_ENDPOINTS[i],
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
          'Accept': 'application/json'
        },
        body: form,
        timeoutMs: OVERPASS_ENDPOINT_TIMEOUT_MS
      });
      const list: PoiCandidate[] = parseOverpass(parseJson(body));
      if (list.length > 0) return list;
      lastError = 'Overpass 没有返回结果';
    } catch (error) {
      lastError = 'Overpass 请求失败：' + errorText(error);
    }
  }
  throw new Error(lastError.length > 0 ? lastError : 'Overpass 所有端点都失败');
}

// ============================================================
// 中文维基 geosearch
// ============================================================

/** 构造维基 geosearch URL（要求带缩略图 + 简介） */
export function wikiUrl(latitude: number, longitude: number, radiusMeters: number, limit: number): string {
  const radius: number = clampNumber(Math.round(radiusMeters), 100, 10000);
  const count: number = clampNumber(Math.round(limit), 1, 20);
  return WIKI_ENDPOINT +
    '?action=query&format=json&origin=*' +
    '&generator=geosearch' +
    '&ggscoord=' + String(latitude) + '%7C' + String(longitude) +
    '&ggsradius=' + String(radius) +
    '&ggslimit=' + String(count) +
    '&prop=pageimages%7Ccoordinates%7Cextracts' +
    '&piprop=thumbnail&pithumbsize=800' +
    '&exintro=1&explaintext=1&exchars=120';
}

const CITY_BLACKLIST: string[] = [
  '中国', '上海', '北京', '广州', '深圳', '杭州', '成都', '南京', '武汉', '西安', '重庆', '天津', '苏州'
];

/**
 * 维基的类别判定：**只信标题**，不信简介。
 *
 * 实测踩过：条目「国际饭店」的简介里提到「面对人民公园」，
 * 把简介一起拼进去就会被判成 park —— 一个饭店变成公园。
 * 标题没有线索时落到 plaza（安全兜底），比错判成公园好。
 */
function categoryFromWikiTitle(title: string): string {
  for (let i = 0; i < CATEGORY_RULES.length; i += 1) {
    if (CATEGORY_RULES[i].re.test(title)) return CATEGORY_RULES[i].key;
  }
  return 'plaza';
}

/** 解析维基 geosearch（纯函数；行政区/城市/地铁站/道路会被过滤） */
export function parseWiki(json: Record<string, unknown>): PoiCandidate[] {
  const out: PoiCandidate[] = [];
  const query: Record<string, unknown> | undefined = readRecord(json, 'query');
  if (query === undefined) return out;

  const pagesValue: unknown = query['pages'];
  const pages: Record<string, unknown>[] = [];
  if (Array.isArray(pagesValue)) {
    for (let i = 0; i < pagesValue.length; i += 1) {
      const item: unknown = pagesValue[i];
      if (typeof item === 'object' && item !== null) pages.push(item as Record<string, unknown>);
    }
  } else if (typeof pagesValue === 'object' && pagesValue !== null) {
    const map: Record<string, unknown> = pagesValue as Record<string, unknown>;
    const keys: string[] = Object.keys(map);
    for (let i = 0; i < keys.length; i += 1) {
      const item: unknown = map[keys[i]];
      if (typeof item === 'object' && item !== null) pages.push(item as Record<string, unknown>);
    }
  }

  for (let i = 0; i < pages.length; i += 1) {
    const page: Record<string, unknown> = pages[i];
    const title: string = readString(page, 'title');
    if (title.length === 0) continue;

    // coordinates[0].lat / lon
    const coordinates: unknown[] = readArray(page, 'coordinates');
    if (coordinates.length === 0) continue;
    const first: unknown = coordinates[0];
    if (typeof first !== 'object' || first === null) continue;
    const coordinate: Record<string, unknown> = first as Record<string, unknown>;
    const lat: number = readNumber(coordinate, 'lat');
    const lon: number = readNumber(coordinate, 'lon');
    if (!isFinite(lat) || !isFinite(lon)) continue;

    // thumbnail.source
    const thumbnail: Record<string, unknown> | undefined = readRecord(page, 'thumbnail');
    const photo: string = thumbnail === undefined ? '' : readString(thumbnail, 'source');
    if (photo.length === 0) continue;
    const isWikimedia: boolean =
      photo.indexOf('thumb.wikimedia.org') >= 0 || photo.indexOf('upload.wikimedia.org') >= 0;
    if (!isWikimedia) continue;

    // 过滤行政区 / 城市 / 地铁站 / 道路
    if (/[省市县区镇]$/.test(title)) continue;
    if (CITY_BLACKLIST.indexOf(title) >= 0) continue;
    if (/站$|站 \(|号线|铁路|高速公路|立交|隧道|大桥工程/.test(title)) continue;

    const displayName: string = title.replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim();
    if (displayName.length === 0) continue;

    const pageID: unknown = page['pageid'];
    const idText: string = typeof pageID === 'number' ? String(pageID) : title;

    out.push({
      id: 'wiki-' + idText,
      name: displayName,
      latitude: lat,
      longitude: lon,
      category: categoryFromWikiTitle(displayName),
      photoUrl: photo,
      photoCredit: 'Wikimedia Commons',
      source: 'wiki'
    });
  }
  return out;
}

export async function fetchWiki(
  client: HttpClient,
  latitude: number,
  longitude: number,
  radiusMeters: number,
  limit: number
): Promise<PoiCandidate[]> {
  const body: string = await requestText(client, {
    url: wikiUrl(latitude, longitude, radiusMeters, limit),
    method: 'GET',
    headers: defaultHeaders(),
    timeoutMs: WIKI_TIMEOUT_MS
  });
  return parseWiki(parseJson(body));
}

// ============================================================
// 数据源编排
// ============================================================

/** 运行时数据源配置（Key 由后台下发；没有 Key 时只跑 OSM + 维基） */
export interface ProviderConfig {
  keys: MapKeys;
  /** 额外允许的数据源（默认按 Key 自动决定） */
  sources?: string[];
}

/** 默认启用的数据源：有 Key 才加高德/百度 */
export function defaultSources(keys: MapKeys): string[] {
  const list: string[] = [];
  if (keys.amap.length > 0) list.push('amap');
  if (keys.baidu.length > 0) list.push('baidu');
  list.push('osm');
  list.push('wiki');
  return list;
}

function normalizeSources(input: string[] | undefined, keys: MapKeys): string[] {
  const allowed: string[] = ['amap', 'baidu', 'osm', 'wiki'];
  if (input === undefined || input.length === 0) return defaultSources(keys);
  const out: string[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const id: string = input[i].trim().toLowerCase();
    if (allowed.indexOf(id) < 0) continue;
    if (out.indexOf(id) >= 0) continue;
    out.push(id);
  }
  return out.length > 0 ? out : defaultSources(keys);
}

export interface NearbyOptions {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  limit: number;
  /** 可选：地标关键字（默认 LANDMARK_KEYWORDS） */
  keywords?: string;
  /** 可选：只跑这些源 */
  sources?: string[];
}

export interface NearbyResult {
  candidates: PoiCandidate[];
  reports: SourceReport[];
}

/**
 * 并发拉取多个源 → 去重 30m → 按距离排序 → 类别多样性截断。
 * 单源失败不影响其他源（手写 allSettled 语义）。
 */
export async function nearby(
  client: HttpClient,
  keys: MapKeys,
  options: NearbyOptions
): Promise<NearbyResult> {
  const sources: string[] = normalizeSources(options.sources, keys);
  const reports: SourceReport[] = [];
  const tasks: Promise<PoiCandidate[]>[] = [];
  const slots: number[] = [];

  // 失败面板要能逐条列出「每个源」的原因，所以 4 个源都建报告；
  // 没被本次启用的源标「未配置 Key / 本次未启用」，便于用户判断下一步。
  for (let i = 0; i < PROVIDER_IDS.length; i += 1) {
    const id: string = PROVIDER_IDS[i];
    const selected: boolean = sources.indexOf(id) >= 0;
    const report: SourceReport = {
      id: id,
      label: providerLabel(id),
      ok: false,
      count: 0,
      error: ''
    };
    if (!selected) {
      report.error = (id === 'amap' && keys.amap.length === 0) ||
        (id === 'baidu' && keys.baidu.length === 0)
        ? '未配置 Key'
        : '本次未启用';
      reports.push(report);
      continue;
    }
    reports.push(report);
    slots.push(reports.length - 1);
    tasks.push(fetchProvider(client, id, keys, options));
  }

  const results: PoiCandidate[][] = [];
  for (let i = 0; i < tasks.length; i += 1) {
    try {
      const list: PoiCandidate[] = await tasks[i];
      results.push(list);
    } catch (error) {
      results.push([]);
      const reportIndex: number = slots[i];
      reports[reportIndex].error = errorText(error);
    }
  }

  const merged: PoiCandidate[] = [];
  for (let i = 0; i < results.length; i += 1) {
    const list: PoiCandidate[] = results[i];
    const reportIndex: number = slots[i];
    reports[reportIndex].ok = list.length > 0;
    reports[reportIndex].count = list.length;
    if (list.length > 0) reports[reportIndex].error = '';
    for (let j = 0; j < list.length; j += 1) merged.push(list[j]);
  }

  const deduped: PoiCandidate[] = dedupe(merged, DEDUPE_METERS);
  const sorted: PoiCandidate[] = sortCandidates(deduped, options.latitude, options.longitude, options.radiusMeters);
  const limited: PoiCandidate[] = trimDiverse(sorted, options.limit);
  const result: NearbyResult = { candidates: limited, reports: reports };
  return result;
}

/** 数据源 ID → 中文标签 */
export function providerLabel(id: string): string {
  const label: string | undefined = PROVIDER_LABELS[id];
  return label === undefined ? id : label;
}

// ============================================================
// 远程漫游（环带撒点）
// ============================================================

/**
 * 远程漫游取点：在 10–45 公里（逐档放宽到 55/65）的环带上撒 4 个采样点，
 * 每个点用 3.2 公里的半径查一次（高德/百度/维基）。
 *
 * 为什么不是直接查「半径 30 公里」：高德 around 半径上限 50000，但大半径返回的
 * 全是城市地标类 POI，稀释严重且很慢。环带撒点等效于「查到了远程的地标」，
 * 还能顺便带出实景照片（维基 geosearch）。
 *
 * OSM 不参与：Overpass 不支持这么大的半径，失败面板里如实标注。
 */
export async function roamNearby(
  client: HttpClient,
  keys: MapKeys,
  origin: GeoPoint,
  relax: number,
  deadlineMs: number,
  random: number[]
): Promise<NearbyResult> {
  const range: number[] = roamRange(relax);
  const low: number = Math.max(range[0] + 2000, 12000);
  const high: number = Math.max(low + 1000, Math.min(range[1] - 1200, 43000));
  const centers: GeoPoint[] = [];
  for (let index = 0; index < 4; index += 1) {
    const jitter: number = random.length > index ? random[index] : 0.5;
    const bearing: number = index * 90 + (jitter * 60 - 30);
    const ratio: number = random.length > index + 4 ? random[index + 4] : 0.5;
    const meters: number = low + (high - low) * ratio;
    centers.push(offsetPoint(origin, meters, (bearing + 360) % 360));
  }

  const reports: SourceReport[] = [];
  const merged: PoiCandidate[] = [];
  let amapTotal: number = 0;
  let baiduTotal: number = 0;
  let wikiTotal: number = 0;
  let lastError: string = '';

  if (keys.amap.length === 0) {
    reports.push({ id: 'amap', label: providerLabel('amap'), ok: false, count: 0, error: '未配置 Key' });
  }
  if (keys.baidu.length === 0) {
    reports.push({ id: 'baidu', label: providerLabel('baidu'), ok: false, count: 0, error: '未配置 Key' });
  }

  for (let c = 0; c < centers.length; c += 1) {
    const center: GeoPoint = centers[c];
    if (keys.amap.length > 0) {
      try {
        const list: PoiCandidate[] = await fetchAmap(
          client, center.latitude, center.longitude, 3200, 20, keys.amap, true
        );
        amapTotal += list.length;
        for (let i = 0; i < list.length; i += 1) merged.push(list[i]);
      } catch (error) {
        lastError = errorText(error);
      }
    }
    if (keys.baidu.length > 0) {
      try {
        const list: PoiCandidate[] = await fetchBaidu(
          client, center.latitude, center.longitude, 3200, 20, keys.baidu
        );
        baiduTotal += list.length;
        for (let i = 0; i < list.length; i += 1) merged.push(list[i]);
      } catch (error) {
        if (lastError.length === 0) lastError = errorText(error);
      }
    }
    // 维基 geosearch 单次上限 10 公里 —— 采样点本身就在 10 公里外，
    // 以小半径绕采样点查，等效于查到了远程的地标（还带实景照片）。
    try {
      const list: PoiCandidate[] = await fetchWiki(
        client, center.latitude, center.longitude, 3200, 12
      );
      wikiTotal += list.length;
      for (let i = 0; i < list.length; i += 1) merged.push(list[i]);
    } catch (error) {
      if (lastError.length === 0) lastError = errorText(error);
    }
  }

  if (keys.amap.length > 0) {
    reports.push({
      id: 'amap', label: providerLabel('amap'), ok: amapTotal > 0, count: amapTotal,
      error: amapTotal > 0 ? '' : (lastError.length > 0 ? lastError : '环带内没搜到地点')
    });
  }
  if (keys.baidu.length > 0) {
    reports.push({
      id: 'baidu', label: providerLabel('baidu'), ok: baiduTotal > 0, count: baiduTotal,
      error: baiduTotal > 0 ? '' : '环带内没搜到地点'
    });
  }
  reports.push({
    id: 'osm', label: providerLabel('osm'), ok: false, count: 0,
    error: '远程漫游不支持（半径过大）'
  });
  reports.push({
    id: 'wiki', label: providerLabel('wiki'), ok: wikiTotal > 0, count: wikiTotal,
    error: wikiTotal > 0 ? '' : '环带内没查到地标词条'
  });

  const deduped: PoiCandidate[] = dedupe(merged, 120);
  // 只留真正落在漫游环带里的（采样点 3 公里范围可能有一部分掉到环带外）
  const inBand: PoiCandidate[] = [];
  for (let i = 0; i < deduped.length; i += 1) {
    const meters: number = distanceMeters(origin, deduped[i]);
    if (meters >= range[0] && meters <= range[1]) inBand.push(deduped[i]);
  }
  inBand.sort((a: PoiCandidate, b: PoiCandidate): number => {
    return distanceMeters(origin, a) - distanceMeters(origin, b);
  });
  const limited: PoiCandidate[] = inBand.length > 40 ? inBand.slice(0, 40) : inBand;
  reports.sort((a: SourceReport, b: SourceReport): number => {
    return sourceOrder(a.id) - sourceOrder(b.id);
  });
  const result: NearbyResult = { candidates: limited, reports: reports };
  return result;
}

function sourceOrder(id: string): number {
  if (id === 'amap') return 0;
  if (id === 'baidu') return 1;
  if (id === 'osm') return 2;
  if (id === 'wiki') return 3;
  return 9;
}

async function fetchProvider(
  client: HttpClient,
  id: string,
  keys: MapKeys,
  options: NearbyOptions
): Promise<PoiCandidate[]> {
  // keywords 由各 fetch 内部使用（高德/百度各自带地标关键字查询），这里不再单独取
  if (id === 'amap') {
    return fetchAmap(client, options.latitude, options.longitude, options.radiusMeters, options.limit, keys.amap);
  }
  if (id === 'baidu') {
    return fetchBaidu(client, options.latitude, options.longitude, options.radiusMeters, options.limit, keys.baidu);
  }
  if (id === 'osm') {
    return fetchOSM(client, options.latitude, options.longitude, options.radiusMeters);
  }
  if (id === 'wiki') {
    return fetchWiki(client, options.latitude, options.longitude, options.radiusMeters, options.limit);
  }
  throw new Error('未知数据源：' + id);
}

/** 计算距离并排序（不截断；radius ≤ 0 表示不过滤） */
export function sortCandidates(
  candidates: PoiCandidate[],
  latitude: number,
  longitude: number,
  radiusMeters: number
): PoiCandidate[] {
  const origin = { latitude: latitude, longitude: longitude };
  const out: PoiCandidate[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate: PoiCandidate = candidates[i];
    const copy: PoiCandidate = {
      id: candidate.id,
      name: candidate.name,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      category: candidate.category,
      source: candidate.source
    };
    if (candidate.address !== undefined) copy.address = candidate.address;
    if (candidate.photoUrl !== undefined) copy.photoUrl = candidate.photoUrl;
    if (candidate.photoCredit !== undefined) copy.photoCredit = candidate.photoCredit;
    copy.distance = Math.round(distanceMeters(origin, candidate) * 10) / 10;
    out.push(copy);
  }
  out.sort((a: PoiCandidate, b: PoiCandidate): number => {
    const left: number = a.distance === undefined ? 0 : a.distance;
    const right: number = b.distance === undefined ? 0 : b.distance;
    return left - right;
  });
  if (radiusMeters <= 0) return out;
  const limit: number = radiusMeters * 1.1;
  const filtered: PoiCandidate[] = [];
  for (let i = 0; i < out.length; i += 1) {
    const sampled: number | undefined = out[i].distance;
    const value: number = sampled === undefined ? 0 : sampled;
    if (value <= limit) filtered.push(out[i]);
  }
  return filtered;
}

function distanceMeters(
  origin: { latitude: number; longitude: number },
  candidate: PoiCandidate
): number {
  const target = { latitude: candidate.latitude, longitude: candidate.longitude };
  // 复用 parity 里的 Haversine（避免重复实现）
  const parityOrigin = { latitude: origin.latitude, longitude: origin.longitude };
  return geoDistance(parityOrigin, target);
}

function geoDistance(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
): number {
  const R: number = 6371000;
  const lat1: number = from.latitude * Math.PI / 180;
  const lat2: number = to.latitude * Math.PI / 180;
  const dLat: number = (to.latitude - from.latitude) * Math.PI / 180;
  const dLon: number = (to.longitude - from.longitude) * Math.PI / 180;
  const x: number = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}

/** 空 Mood 提示（避免未使用 import 告警；也用于 UI 文案映射） */
export function moodKey(mood: Mood): string {
  return mood;
}

/** 时长的步行米数（转发给 parity，保持单一来源） */
export function walkMetersOf(duration: WalkDuration): number {
  if (duration === WalkDuration.M15) return 240;
  if (duration === WalkDuration.M60) return 960;
  return 480;
}

/** 数据源 ID 常量（UI 展示用） */
export const PROVIDER_IDS: ProviderId[] = ['amap', 'baidu', 'osm', 'wiki'];