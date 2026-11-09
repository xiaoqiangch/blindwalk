/**
 * 盲走 BlindWalk · 兴趣点管理后台 — 公开数据抓取
 *
 * 数据源（均无需 API Key）：
 * 1. 中文维基百科 geosearch：地标名 + 真实坐标 + 简介 + 代表图片（首选）
 * 2. OpenStreetMap Overpass：街边小店 / 长椅等没有维基条目的 POI（备选，3 个镜像容错）
 *
 * 纯解析函数（parseWikipediaResponse / parseOverpassResponse）与网络分离，
 * 测试用固定 fixture 即可覆盖，不依赖网络。
 *
 * 零依赖：只用 Node 内置 fetch（Node 18+）。
 */

import { haversineMeters, clipText, normalizeName } from './poi.mjs';

const WIKI_ENDPOINT = 'https://zh.wikipedia.org/w/api.php';
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const USER_AGENT = 'BlindWalkAdmin/0.1 (POI curator; local prototype)';
const WIKI_TIMEOUT_MS = 8000;
const OVERPASS_TIMEOUT_MS = 7000;
const DEDUPE_METERS = 30;

// ============================================================
// 标题过滤 / 清洗 / 类别推断
// ============================================================

const CITY_NAMES = /^(中国|上海|北京|广州|深圳|杭州|成都|南京|武汉|西安|重庆|天津|苏州|香港|澳门|台北)$/;
const ADMIN_SUFFIX = /[省市区县镇]$/;
const STATION_PATTERN = /站\s*$|站\s*[（(]|号线|铁路|高速公路|立交桥$|隧道|高架/;
const ROAD_PATTERN = /(路|街|大道|公路|巷|弄|道)$/;
const NOT_A_PLACE_PATTERN = /(工程|规划|小区|公寓|停车场$)/;

/** 去掉维基的括号消歧义后缀：「大世界 (上海市)」→「大世界」 */
export function cleanWikiTitle(title) {
  let value = String(title || '').trim();
  let changed = true;
  while (changed) {
    changed = false;
    const next = value.replace(/\s*[（(][^（）()]*[）)]\s*$/, '').trim();
    if (next !== value) {
      value = next;
      changed = true;
    }
  }
  return value;
}

/** 行政区 / 城市 / 地铁站 / 道路 / 工程 —— 都不是「一个可以走到的地方」 */
export function isUsableWikiTitle(title) {
  const raw = String(title || '').trim();
  if (!raw) return false;
  const display = cleanWikiTitle(raw);
  if (!display) return false;
  if (CITY_NAMES.test(display)) return false;
  if (ADMIN_SUFFIX.test(display)) return false;
  if (STATION_PATTERN.test(display)) return false;
  if (ROAD_PATTERN.test(display)) return false;
  if (NOT_A_PLACE_PATTERN.test(display)) return false;
  if (display.length > 40) return false;
  return true;
}

/** 只收能直接 <img> 加载的维基缩略图域名 */
export function isLoadablePhotoUrl(url) {
  const value = String(url || '');
  if (!value.startsWith('https://')) return false;
  return value.includes('upload.wikimedia.org') || value.includes('thumb.wikimedia.org');
}

/** 从标题 / 简介猜类别（契约类别表；思路复用 prototype/web/geo.js 的 guessCategoryFromTitle） */
export function guessCategoryFromTitle(title, extract = '') {
  const titleText = String(title || '');
  const text = titleText + ' ' + String(extract || '');

  // 标题里出现强类别词时优先按标题判断，避免简介里的「公园」「地铁站」把整条带偏。
  // 例：人民广场（简介提到公园）应为 plaza；国际饭店（简介提到地铁站）应为 historic。
  if (/公园|花园|绿地|植物园|园林/.test(titleText)) return 'park';
  if (/广场/.test(titleText)) return 'plaza';
  if (/桥/.test(titleText)) return 'bridge';
  if (/寺|庙|教堂|清真|道观|庵|会堂/.test(titleText)) return 'temple';
  if (/音乐厅|剧院|剧场|戏院|演奏厅|舞台/.test(titleText)) return 'venue';
  if (/博物|纪念馆|展览馆|陈列馆/.test(titleText)) return 'museum';
  if (/图书馆/.test(titleText)) return 'library';
  if (/书店/.test(titleText)) return 'bookstore';
  if (/咖啡/.test(titleText)) return 'cafe';
  if (/故居|旧址|会址|公馆|洋房|里弄|弄堂|饭店|酒店|宾馆|旅馆|大楼|大厦/.test(titleText)) return 'historic';
  if (/塔|观景|天台/.test(titleText)) return 'viewpoint';
  if (/外滩|滩|滨江|河岸|江岸|湖畔|河|江|湖/.test(titleText)) return 'river';

  if (/公园|花园|绿地|植物园/.test(text)) return 'park';
  if (/广场/.test(text)) return 'plaza';
  if (/桥/.test(text)) return 'bridge';
  if (/外滩|滩|滨江|河岸|江岸|湖畔/.test(text)) return 'river';
  if (/博物|纪念馆|展览馆|陈列馆/.test(text)) return 'museum';
  if (/音乐厅|剧院|剧场|戏院|演奏厅|大舞台/.test(text)) return 'venue';
  if (/美术馆|艺术|画廊|涂鸦/.test(text)) return 'art';
  if (/教堂|寺|庙|会堂|清真|道观|庵/.test(text)) return 'temple';
  if (/故居|旧址|会址|公馆|洋房|里弄|弄堂|饭店|酒店|宾馆|旅馆|大楼|建筑|大楼$/.test(text)) return 'historic';
  if (/图书/.test(text)) return 'library';
  if (/书店/.test(text)) return 'bookstore';
  if (/咖啡/.test(text)) return 'cafe';
  if (/商场|百货|市集|市场/.test(text)) return 'market';
  if (/车站|地铁|站$/.test(text)) return 'plaza';
  if (/塔|观景|天台/.test(text)) return 'viewpoint';
  if (/河|江|湖|溪|运河/.test(text)) return 'river';
  if (/楼|弄|里/.test(text)) return 'historic';
  return 'plaza';
}

function cleanExtract(extract) {
  return clipText(String(extract || '').replace(/\s+/g, ' '), 120);
}

function candidateDistance(origin, item) {
  return haversineMeters(origin, { lat: item.lat, lon: item.lon });
}

/** 批内去重：同名或距离 < 30m */
export function dedupeCandidates(candidates) {
  const result = [];
  for (const candidate of candidates || []) {
    if (!candidate || typeof candidate.lat !== 'number' || typeof candidate.lon !== 'number') continue;
    const duplicate = result.find((existing) => {
      if (normalizeName(existing.name) === normalizeName(candidate.name)) return true;
      return haversineMeters(
        { lat: existing.lat, lon: existing.lon },
        { lat: candidate.lat, lon: candidate.lon }
      ) < DEDUPE_METERS;
    });
    if (!duplicate) result.push(candidate);
  }
  return result;
}

// ============================================================
// 维基百科解析（纯函数）
// ============================================================

/**
 * @param {object} json 维基 API 原始 JSON
 * @param {{ lat: number, lon: number }} origin 用于按距离排序
 * @returns {object[]} 候选 POI（未落库）
 */
export function parseWikipediaResponse(json, origin) {
  const pages = (json && json.query && json.query.pages) || {};
  const candidates = [];
  for (const key of Object.keys(pages)) {
    const page = pages[key] || {};
    const coordinate = Array.isArray(page.coordinates) ? page.coordinates[0] : null;
    if (!coordinate || typeof coordinate.lat !== 'number' || typeof coordinate.lon !== 'number') continue;
    const title = page.title;
    if (!isUsableWikiTitle(title)) continue;
    const thumbnail = page.thumbnail && page.thumbnail.source;
    if (!isLoadablePhotoUrl(thumbnail)) continue;
    const name = cleanWikiTitle(title);
    if (!name) continue;
    const extract = cleanExtract(page.extract);
    candidates.push({
      name,
      lat: coordinate.lat,
      lon: coordinate.lon,
      category: guessCategoryFromTitle(title, extract),
      photoUrl: thumbnail,
      photoCredit: 'Wikimedia Commons',
      summary: extract,
      address: null,
      tags: [],
      source: 'wikipedia'
    });
  }
  const deduped = dedupeCandidates(candidates);
  if (origin) {
    deduped.sort((a, b) => candidateDistance(origin, a) - candidateDistance(origin, b));
  }
  return deduped;
}

// ============================================================
// Overpass 解析（纯函数）
// ============================================================

const TAG_RULES = [
  { key: 'amenity', value: 'cafe', category: 'cafe' },
  { key: 'amenity', value: 'library', category: 'library' },
  { key: 'amenity', value: 'arts_centre', category: 'art' },
  { key: 'amenity', value: 'marketplace', category: 'market' },
  { key: 'amenity', value: 'bench', category: 'bench' },
  { key: 'amenity', value: 'place_of_worship', category: 'temple' },
  { key: 'amenity', value: 'theatre', category: 'venue' },
  { key: 'shop', value: 'books', category: 'bookstore' },
  { key: 'shop', value: 'convenience', category: 'convenience' },
  { key: 'leisure', value: 'park', category: 'park' },
  { key: 'leisure', value: 'garden', category: 'garden' },
  { key: 'leisure', value: 'common', category: 'plaza' },
  { key: 'tourism', value: 'viewpoint', category: 'viewpoint' },
  { key: 'tourism', value: 'artwork', category: 'art' },
  { key: 'tourism', value: 'museum', category: 'museum' },
  { key: 'man_made', value: 'bridge', category: 'bridge' },
  { key: 'waterway', value: 'riverbank', category: 'river' },
  { key: 'place', value: 'square', category: 'plaza' }
];

/** OSM 元素 → 类别（含 historic=* 通配） */
export function osmCategoryForTags(tags) {
  if (!tags) return null;
  for (const rule of TAG_RULES) {
    if (tags[rule.key] === rule.value) return rule.category;
  }
  if (tags.historic) return 'historic';
  return null;
}

/**
 * @param {object} json Overpass 原始 JSON
 * @param {{ lat: number, lon: number }} origin
 * @returns {object[]} 候选 POI
 */
export function parseOverpassResponse(json, origin) {
  const elements = (json && Array.isArray(json.elements)) ? json.elements : [];
  const candidates = [];
  for (const element of elements) {
    if (!element || !element.tags) continue;
    const tags = element.tags;
    const name = String(tags.name || '').trim();
    if (!name) continue;
    if (!isUsableWikiTitle(name)) continue;
    const category = osmCategoryForTags(tags);
    if (!category) continue;
    if (typeof element.lat !== 'number' || typeof element.lon !== 'number') continue;
    const street = tags['addr:street'] || '';
    const district = tags['addr:district'] || tags['addr:suburb'] || tags['addr:city'] || '';
    const address = [district, street].filter(Boolean).join(' · ') || null;
    candidates.push({
      name,
      lat: element.lat,
      lon: element.lon,
      category,
      photoUrl: null,
      photoCredit: null,
      summary: cleanExtract(tags.description || ''),
      address,
      tags: [],
      source: 'osm'
    });
  }
  const deduped = dedupeCandidates(candidates);
  if (origin) {
    deduped.sort((a, b) => candidateDistance(origin, a) - candidateDistance(origin, b));
  }
  return deduped;
}

// ============================================================
// 网络抓取
// ============================================================

function withTimeout(fetchImpl, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer)
  };
}

async function fetchJson(fetchImpl, url, options, timeoutMs) {
  const guard = withTimeout(fetchImpl, timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: guard.signal });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.json();
  } finally {
    guard.clear();
  }
}

/** 维基百科地理搜索 URL（参数与契约 §6 一致） */
export function buildWikipediaUrl(lat, lon, radiusMeters) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'geosearch',
    ggscoord: lat + '|' + lon,
    ggsradius: String(Math.min(10000, Math.max(10, Math.round(radiusMeters || 1200)))),
    ggslimit: '20',
    prop: 'pageimages|coordinates|extracts',
    piprop: 'thumbnail',
    pithumbsize: '800',
    exintro: '1',
    explaintext: '1',
    exchars: '120'
  });
  return WIKI_ENDPOINT + '?' + params.toString();
}

/** 抓维基候选；失败返回空数组（不抛给调用方） */
export async function fetchWikipediaCandidates(lat, lon, radius, fetchImpl) {
  try {
    const url = buildWikipediaUrl(lat, lon, radius);
    const json = await fetchJson(
      fetchImpl,
      url,
      { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } },
      WIKI_TIMEOUT_MS
    );
    return parseWikipediaResponse(json, { lat, lon });
  } catch (error) {
    return [];
  }
}

/** 生成 Overpass QL */
export function buildOverpassQuery(lat, lon, radiusMeters) {
  const clauses = TAG_RULES.map((rule) =>
    'node["' + rule.key + '"="' + rule.value + '"](around:' + radiusMeters + ',' + lat + ',' + lon + ');'
  );
  clauses.push('node["historic"](around:' + radiusMeters + ',' + lat + ',' + lon + ');');
  return '[out:json][timeout:18];(' + clauses.join('') + ');out body 120;';
}

/** 抓 OSM 候选：3 个镜像依次尝试 */
export async function fetchOverpassCandidates(lat, lon, radius, fetchImpl) {
  const query = buildOverpassQuery(lat, lon, radius);
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const json = await fetchJson(
        fetchImpl,
        endpoint,
        {
          method: 'POST',
          headers: {
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: 'data=' + encodeURIComponent(query)
        },
        OVERPASS_TIMEOUT_MS
      );
      const parsed = parseOverpassResponse(json, { lat, lon });
      if (parsed.length > 0) return parsed;
    } catch (error) {
      // 换下一个镜像
    }
  }
  return [];
}

/**
 * 抓取入口：维基优先，不够再用 Overpass 补齐。
 * @returns {{ items: object[], source: 'wikipedia'|'osm'|'mixed' }}
 */
export async function fetchCandidates(options) {
  const lat = Number(options.lat);
  const lon = Number(options.lon);
  const radius = Math.round(Number(options.radius) || 1200);
  const limit = Math.max(1, Math.min(50, Math.round(Number(options.limit) || 20)));
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node 没有可用的 fetch');

  const wiki = await fetchWikipediaCandidates(lat, lon, radius, fetchImpl);
  if (wiki.length >= Math.min(limit, 5)) {
    return { items: dedupeCandidates(wiki).slice(0, limit), source: 'wikipedia' };
  }

  const osm = await fetchOverpassCandidates(lat, lon, radius, fetchImpl);
  const merged = dedupeCandidates(wiki.concat(osm)).slice(0, limit);
  let source = 'wikipedia';
  if (wiki.length > 0 && osm.length > 0) source = 'mixed';
  else if (wiki.length === 0 && osm.length > 0) source = 'osm';
  return { items: merged, source };
}
