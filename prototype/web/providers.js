/* ============================================================
   步迷 Walkaholic · POI 多数据源模块（零依赖 / ES5 风格 / JSONP）
   ============================================================
   背景：
   - PWA 部署在 GitHub Pages（纯静态、HTTPS），没有服务端代理。
   - 高德 / 百度开放平台都支持 JSONP（callback 参数），可绕过 CORS。
   - OSM Overpass / 中文维基 geosearch 是免费 CORS 源，无需 Key。
   - Key 由用户自己填，存在 localStorage（'wa.keys.v1'），**不硬编码、不上传**。

   坐标系（重要，偏差几百米会影响 30m 内到达判定）：
   - 本模块对外只使用 / 返回 WGS-84（GPS / 浏览器 Geolocation / OSM / 维基）
   - 高德 Web 服务：请求和返回都是 GCJ-02 → 发出前 WGS84→GCJ02，解析时 GCJ02→WGS84
   - 百度地图：请求和返回都是 BD-09 → 发出前 WGS84→BD09，解析时 BD09→WGS84
   转换函数为业界通用算法（GCJ-02 逆算用 3 次迭代），误差在 1–3 米内。

   对外契约（window.WA_PROVIDERS）：
     nearby({lat, lon, radius, limit, sources}) -> Promise<Array<Candidate>>
     setKeys({amap, baidu}) -> {amap:'***'|'', baidu:'***'|''}
     getKeys() -> 同上（只返回是否已配置，不返回明文）
     status() -> { sources: [{id,label,enabled,reason}], keys: {...} }
     parseAmap(json), parseBaidu(json), dedupe(list, radiusMeters)  // 供测试
   额外暴露（测试 / 调试 / 接入用）：
     mapCategory(raw, name)
     wgs84ToGcj02 / gcj02ToWgs84 / wgs84ToBd09 / bd09ToWgs84
     sortByDistance(list, lat, lon, radiusMeters)
     lastReport()  // 最近一次 nearby 的各源成功/失败情况

   Candidate = {
     id, name, lat, lon, category, address, photoUrl, photoCredit, source, distance
   }
   ============================================================ */

(function (root) {
  'use strict';

  // ============================================================
  // 常量
  // ============================================================

  var STORE_KEY = 'wa.keys.v1';
  var JSONP_TIMEOUT = 8000;
  var FETCH_TIMEOUT = 8000;
  var DEDUPE_METERS = 30;

  var AMAP_ENDPOINT = 'https://restapi.amap.com/v3/place/around';
  var BAIDU_ENDPOINT = 'https://api.map.baidu.com/place/v2/search';
  var WIKI_ENDPOINT = 'https://zh.wikipedia.org/w/api.php';
  var OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter'
  ];

  var SOURCE_LABELS = {
    amap: '高德地图',
    baidu: '百度地图',
    osm: 'OpenStreetMap',
    wiki: '中文维基百科'
  };

  /* OSM 标签白名单（与 geo.js 的 TAG_RULES 思路一致；只收公共场所） */
  var TAG_RULES = [
    { key: 'amenity', value: 'cafe', cat: 'cafe' },
    { key: 'amenity', value: 'library', cat: 'library' },
    { key: 'shop', value: 'books', cat: 'bookstore' },
    { key: 'amenity', value: 'bench', cat: 'bench' },
    { key: 'leisure', value: 'park', cat: 'park' },
    { key: 'leisure', value: 'garden', cat: 'garden' },
    { key: 'tourism', value: 'viewpoint', cat: 'viewpoint' },
    { key: 'tourism', value: 'artwork', cat: 'art' },
    { key: 'amenity', value: 'arts_centre', cat: 'art' },
    { key: 'man_made', value: 'bridge', cat: 'bridge' },
    { key: 'waterway', value: 'riverbank', cat: 'river' },
    { key: 'amenity', value: 'marketplace', cat: 'market' },
    { key: 'leisure', value: 'common', cat: 'plaza' },
    { key: 'place', value: 'square', cat: 'plaza' },
    { key: 'shop', value: 'convenience', cat: 'convenience' },
    { key: 'historic', value: 'yes', cat: 'historic' },
    { key: 'amenity', value: 'place_of_worship', cat: 'temple' },
    { key: 'tourism', value: 'museum', cat: 'museum' },
    { key: 'amenity', value: 'theatre', cat: 'venue' }
  ];

  // ============================================================
  // Key 存取（localStorage，失败静默）
  // ============================================================

  var keys = { amap: '', baidu: '' };
  var report = { at: 0, sources: [] };
  var jsonpSeq = 0;

  function safeStorage() {
    try {
      if (typeof localStorage === 'undefined' || localStorage === null) return null;
      return localStorage;
    } catch (e) {
      return null;
    }
  }

  function loadKeys() {
    var storage = safeStorage();
    if (!storage) return;
    try {
      var raw = storage.getItem(STORE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed.amap === 'string') keys.amap = parsed.amap;
      if (parsed && typeof parsed.baidu === 'string') keys.baidu = parsed.baidu;
    } catch (e) {
      keys = { amap: '', baidu: '' };
    }
  }

  function saveKeys() {
    var storage = safeStorage();
    if (!storage) return;
    try {
      storage.setItem(STORE_KEY, JSON.stringify({ amap: keys.amap, baidu: keys.baidu }));
    } catch (e) {
      /* 隐私模式 / 配额满：只保留内存 Key */
    }
  }

  function mask(key) {
    return key ? '***' : '';
  }

  function getKeys() {
    return { amap: mask(keys.amap), baidu: mask(keys.baidu) };
  }

  function setKeys(next) {
    next = next || {};
    if (typeof next.amap === 'string') keys.amap = next.amap.replace(/\s+/g, '');
    if (typeof next.baidu === 'string') keys.baidu = next.baidu.replace(/\s+/g, '');
    saveKeys();
    return getKeys();
  }

  function sourceEnabled(id) {
    if (id === 'amap') return !!keys.amap;
    if (id === 'baidu') return !!keys.baidu;
    return id === 'osm' || id === 'wiki';
  }

  function status() {
    var ids = ['amap', 'baidu', 'osm', 'wiki'];
    return {
      sources: ids.map(function (id) {
        var enabled = sourceEnabled(id);
        return {
          id: id,
          label: SOURCE_LABELS[id],
          enabled: enabled,
          reason: enabled ? '' : (id === 'amap' || id === 'baidu' ? '未配置 Key' : '')
        };
      }),
      keys: getKeys()
    };
  }

  // ============================================================
  // 基础工具
  // ============================================================

  function isNum(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function toNum(value) {
    var n = Number(value);
    return isFinite(n) ? n : null;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function copyObject(source) {
    var out = {};
    for (var key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key];
    }
    return out;
  }

  /** Haversine，单位米 */
  function distanceBetween(a, b) {
    var R = 6371000;
    var lat1 = a.lat * Math.PI / 180;
    var lat2 = b.lat * Math.PI / 180;
    var dLat = (b.lat - a.lat) * Math.PI / 180;
    var dLon = (b.lon - a.lon) * Math.PI / 180;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
  }

  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error(label + ' 超时（' + ms + 'ms）'));
      }, ms);
      promise.then(function (value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }, function (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  /** JSON 字符串 / 对象都接受；坏数据返回 null */
  function normalizeJson(json) {
    if (json === null || json === undefined) return null;
    if (typeof json === 'string') {
      try {
        return JSON.parse(json);
      } catch (e) {
        return null;
      }
    }
    return json;
  }

  function firstPhoto(value) {
    if (!value) return null;
    if (Array.isArray(value)) {
      if (!value.length) return null;
      var entry = value[0];
      if (!entry) return null;
      if (typeof entry === 'string') return entry;
      if (typeof entry.url === 'string' && entry.url) return entry.url;
      if (typeof entry.photo_url === 'string' && entry.photo_url) return entry.photo_url;
      return null;
    }
    if (typeof value === 'string') return value;
    if (typeof value.url === 'string' && value.url) return value.url;
    return null;
  }

  function trimmedOrNull(value) {
    if (typeof value !== 'string') return null;
    var trimmed = value.replace(/\s+/g, ' ').trim();
    return trimmed ? trimmed : null;
  }

  // ============================================================
  // 坐标系转换（WGS-84 <-> GCJ-02 <-> BD-09）
  // ============================================================

  var PI = Math.PI;
  var GCJ_A = 6378245.0;
  var GCJ_EE = 0.00669342162296594323;

  function outOfChina(lat, lon) {
    return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
  }

  function transformLat(x, y) {
    var ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
    ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
    return ret;
  }

  function transformLon(x, y) {
    var ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
    ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
    return ret;
  }

  /** WGS-84 → GCJ-02 */
  function wgs84ToGcj02(lat, lon) {
    if (outOfChina(lat, lon)) return { lat: lat, lon: lon };
    var dLat = transformLat(lon - 105.0, lat - 35.0);
    var dLon = transformLon(lon - 105.0, lat - 35.0);
    var radLat = lat / 180.0 * PI;
    var magic = Math.sin(radLat);
    magic = 1 - GCJ_EE * magic * magic;
    var sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / ((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic) * PI);
    dLon = (dLon * 180.0) / (GCJ_A / sqrtMagic * Math.cos(radLat) * PI);
    return { lat: lat + dLat, lon: lon + dLon };
  }

  /** GCJ-02 → WGS-84（3 次迭代逆算，误差 < 3m） */
  function gcj02ToWgs84(lat, lon) {
    if (outOfChina(lat, lon)) return { lat: lat, lon: lon };
    var wgsLat = lat;
    var wgsLon = lon;
    for (var i = 0; i < 3; i++) {
      var forward = wgs84ToGcj02(wgsLat, wgsLon);
      wgsLat += lat - forward.lat;
      wgsLon += lon - forward.lon;
    }
    return { lat: wgsLat, lon: wgsLon };
  }

  /** GCJ-02 → BD-09 */
  function gcj02ToBd09(lat, lon) {
    var x = lon;
    var y = lat;
    var z = Math.sqrt(x * x + y * y) + 0.00002 * Math.sin(y * PI * 3000.0 / 180.0);
    var theta = Math.atan2(y, x) + 0.000003 * Math.cos(x * PI * 3000.0 / 180.0);
    return { lat: z * Math.sin(theta) + 0.006, lon: z * Math.cos(theta) + 0.0065 };
  }

  /** BD-09 → GCJ-02 */
  function bd09ToGcj02(lat, lon) {
    var x = lon - 0.0065;
    var y = lat - 0.006;
    var z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * PI * 3000.0 / 180.0);
    var theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * PI * 3000.0 / 180.0);
    return { lat: z * Math.sin(theta), lon: z * Math.cos(theta) };
  }

  /** WGS-84 → BD-09 */
  function wgs84ToBd09(lat, lon) {
    var gcj = wgs84ToGcj02(lat, lon);
    return gcj02ToBd09(gcj.lat, gcj.lon);
  }

  /** BD-09 → WGS-84 */
  function bd09ToWgs84(lat, lon) {
    var gcj = bd09ToGcj02(lat, lon);
    return gcj02ToWgs84(gcj.lat, gcj.lon);
  }

  // ============================================================
  // 类别映射（17 类，key 与 geo.js CATEGORY_META 一致）
  // ============================================================

  var CATEGORY_RULES = [
    { key: 'bench', re: /长椅|长凳|座椅|条凳|bench/i },
    { key: 'bridge', re: /桥|橋|大桥|天桥|廊桥|bridge/i },
    { key: 'cafe', re: /咖啡|咖啡馆|咖啡厅|cafe|星巴克|瑞幸|manner|seesaw|m stand/i },
    { key: 'bookstore', re: /书店|書店|书城|書城|新华书店|bookstore|book shop/i },
    { key: 'library', re: /图书馆|圖書館|阅览室|library/i },
    { key: 'museum', re: /博物馆|博物館|纪念馆|紀念館|展览馆|展覽館|陈列馆|美术馆?$|museum/i },
    { key: 'art', re: /美术馆|美術館|艺术馆|藝術館|画廊|畫廊|涂鸦|塗鴉|艺术墙|雕塑|art gallery/i },
    { key: 'park', re: /公园|公園|植物园|動物園|动物园|绿地|綠地|森林公园|park/i },
    { key: 'garden', re: /花园|花園|花圃|garden/i },
    { key: 'river', re: /河|江|湖|滨|濱|码头|碼頭|水岸|堤|river|lake|waterfront/i },
    { key: 'viewpoint', re: /观景|觀景|观景台|觀景台|天台|瞭望|塔$|电视塔|viewpoint|lookout|observation/i },
    { key: 'temple', re: /寺|庙|廟|教堂|会堂|會堂|清真|祠|道观|道觀|church|temple|cathedral|mosque/i },
    { key: 'venue', re: /音乐厅|音樂廳|剧院|劇院|剧场|劇場|戏院|戲院|大戏院|演奏厅|体育馆|體育館|体育场|體育場|影院|电影院|theatre|theater|concert|stadium/i },
    { key: 'convenience', re: /便利店|便利|超市|全家|罗森|羅森|7-11|seven-?eleven|convenience/i },
    { key: 'historic', re: /故居|旧址|舊址|会址|會址|历史建筑|歷史建築|老房子|公馆|公館|洋房|里弄|弄堂|遗址|遺址|historic/i },
    { key: 'market', re: /市集|集市|市场|市場|菜场|菜市場|夜市|market/i },
    { key: 'plaza', re: /广场|廣場|步行街|plaza|square/i }
  ];

  /**
   * 把各家原始类别 / 名称映射到 17 类之一。
   * @param {string|array} raw 原始类别（高德 type / 百度 tag），可为空
   * @param {string} name 地点名（类别缺失时兜底）
   */
  function mapCategory(raw, name) {
    var rawText = '';
    if (Array.isArray(raw)) rawText = raw.join(' ');
    else if (raw !== null && raw !== undefined) rawText = String(raw);
    var text = rawText + ' ' + (name ? String(name) : '');
    for (var i = 0; i < CATEGORY_RULES.length; i++) {
      if (CATEGORY_RULES[i].re.test(text)) return CATEGORY_RULES[i].key;
    }
    return 'plaza';
  }

  // ============================================================
  // JSONP（动态 script + 唯一全局回调 + 8s 超时清理）
  // ============================================================

  function jsonp(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (typeof document === 'undefined' || !document.createElement) {
        reject(new Error('JSONP 需要浏览器环境'));
        return;
      }
      var name = 'waCb_' + (++jsonpSeq) + '_' + Date.now().toString(36);
      var script = document.createElement('script');
      var settled = false;
      var timer = null;

      function cleanup() {
        try {
          delete root[name];
        } catch (e) {
          root[name] = undefined;
        }
        if (script.parentNode) script.parentNode.removeChild(script);
        script.onerror = null;
        script.onload = null;
      }

      function finish(error, data) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        cleanup();
        if (error) reject(error);
        else resolve(data);
      }

      timer = setTimeout(function () {
        finish(new Error('JSONP 超时（' + (timeoutMs || JSONP_TIMEOUT) + 'ms）'));
      }, timeoutMs || JSONP_TIMEOUT);

      root[name] = function (data) {
        finish(null, data);
      };
      script.onerror = function () {
        finish(new Error('JSONP 脚本加载失败（网络 / 域名 / Key 无效）'));
      };
      script.async = true;
      script.src = url + (url.indexOf('?') >= 0 ? '&' : '?') +
        'callback=' + encodeURIComponent(name);

      var head = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
      head.appendChild(script);
    });
  }

  // ============================================================
  // 各家响应解析（纯函数，供 node 测试）
  // ============================================================

  /** 高德 Web 服务·周边搜索：pois[] */
  function parseAmap(json) {
    var data = normalizeJson(json);
    var out = [];
    if (!data || String(data.status) !== '1' || !Array.isArray(data.pois)) return out;

    data.pois.forEach(function (poi) {
      if (!poi) return;
      var name = trimmedOrNull(poi.name);
      if (!name) return;
      var location = typeof poi.location === 'string' ? poi.location.split(',') : null;
      if (!location || location.length < 2) return;
      var gcjLon = toNum(location[0]);
      var gcjLat = toNum(location[1]);
      if (gcjLat === null || gcjLon === null) return;
      var wgs = gcj02ToWgs84(gcjLat, gcjLon);

      var rawType = poi.type;
      if (Array.isArray(rawType)) rawType = rawType.join(';');
      var typeText = typeof rawType === 'string' ? rawType : '';
      var typeParts = typeText.split(';');
      var lastType = typeParts[typeParts.length - 1] || typeText;

      var photo = firstPhoto(poi.photos);
      var address = trimmedOrNull(poi.address);
      if (!address) {
        var fallbackAddress = [];
        if (poi.cityname) fallbackAddress.push(poi.cityname);
        if (poi.adname) fallbackAddress.push(poi.adname);
        if (fallbackAddress.length) address = fallbackAddress.join(' · ');
      }

      out.push({
        id: 'amap-' + (trimmedOrNull(poi.id) || (gcjLat.toFixed(6) + '_' + gcjLon.toFixed(6))),
        name: name,
        lat: wgs.lat,
        lon: wgs.lon,
        category: mapCategory(lastType, name),
        address: address,
        photoUrl: photo,
        photoCredit: photo ? '高德地图' : null,
        source: 'amap'
      });
    });
    return out;
  }

  /** 百度地图·圆形区域检索：results[] */
  function parseBaidu(json) {
    var data = normalizeJson(json);
    var out = [];
    if (!data || String(data.status) !== '0' || !Array.isArray(data.results)) return out;

    data.results.forEach(function (poi) {
      if (!poi) return;
      var name = trimmedOrNull(poi.name);
      if (!name) return;
      var location = poi.location || {};
      var bdLat = toNum(location.lat);
      var bdLon = toNum(location.lng);
      if (bdLat === null || bdLon === null) return;
      var wgs = bd09ToWgs84(bdLat, bdLon);

      var detail = poi.detail_info || {};
      var tag = detail.tag;
      var image = trimmedOrNull(detail.image_url);
      var address = trimmedOrNull(poi.address);

      out.push({
        id: 'baidu-' + (trimmedOrNull(poi.uid) || (bdLat.toFixed(6) + '_' + bdLon.toFixed(6))),
        name: name,
        lat: wgs.lat,
        lon: wgs.lon,
        category: mapCategory(tag, name),
        address: address,
        photoUrl: image,
        photoCredit: image ? '百度地图' : null,
        source: 'baidu'
      });
    });
    return out;
  }

  /** Overpass JSON → 候选点（内部使用；无图） */
  function parseOSMResponse(json) {
    var data = normalizeJson(json);
    var out = [];
    if (!data || !Array.isArray(data.elements)) return out;
    var seen = {};

    data.elements.forEach(function (element) {
      if (!element || !element.tags || !element.tags.name) return;
      if (!isNum(element.lat) || !isNum(element.lon)) return;
      var rule = null;
      for (var i = 0; i < TAG_RULES.length; i++) {
        if (element.tags[TAG_RULES[i].key] === TAG_RULES[i].value) {
          rule = TAG_RULES[i];
          break;
        }
      }
      if (!rule) return;
      var id = 'osm-' + element.type + '-' + element.id;
      if (seen[id]) return;
      seen[id] = true;
      var addressParts = [];
      if (element.tags['addr:street']) addressParts.push(element.tags['addr:street']);
      if (element.tags['addr:district']) addressParts.push(element.tags['addr:district']);
      if (element.tags['addr:suburb']) addressParts.push(element.tags['addr:suburb']);
      out.push({
        id: id,
        name: String(element.tags.name),
        lat: element.lat,
        lon: element.lon,
        category: mapCategory(rule.cat, element.tags.name),
        address: addressParts.length ? addressParts.join(' · ') : null,
        photoUrl: null,
        photoCredit: null,
        source: 'osm'
      });
    });
    return out;
  }

  /** Wikipedia geosearch JSON → 候选点（内部使用；要求有缩略图） */
  function parseWikiResponse(json) {
    var data = normalizeJson(json);
    var out = [];
    if (!data || !data.query || !data.query.pages) return out;
    var pages = data.query.pages;
    var list = [];
    if (Array.isArray(pages)) {
      list = pages;
    } else {
      Object.keys(pages).forEach(function (id) {
        list.push(pages[id]);
      });
    }

    list.forEach(function (page) {
      if (!page || !page.title) return;
      var coordinate = page.coordinates && page.coordinates[0];
      if (!coordinate || !isNum(coordinate.lat) || !isNum(coordinate.lon)) return;
      var photo = page.thumbnail && page.thumbnail.source;
      if (!photo) return;
      if (photo.indexOf('thumb.wikimedia.org') < 0 && photo.indexOf('upload.wikimedia.org') < 0) return;
      // 行政区 / 城市 / 地铁站 / 道路不是「可以走到的一个地方」
      if (/[省市县区镇]$/.test(page.title)) return;
      if (/^(中国|上海|北京|广州|深圳|杭州|成都|南京|武汉|西安|重庆|天津|苏州)$/.test(page.title)) return;
      if (/站$|站 \(|号线|铁路|高速公路|立交|隧道|大桥工程/.test(page.title)) return;

      var displayName = page.title.replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim();
      if (!displayName) return;
      var extract = page.extract || '';
      out.push({
        id: 'wiki-' + (page.pageid || page.title),
        name: displayName,
        lat: coordinate.lat,
        lon: coordinate.lon,
        category: mapCategory(extract, displayName),
        address: null,
        photoUrl: photo,
        photoCredit: 'Wikimedia Commons',
        source: 'wiki'
      });
    });
    return out;
  }

  // ============================================================
  // 去重 / 排序
  // ============================================================

  function nameKey(name) {
    return String(name || '').replace(/\s+/g, '').toLowerCase();
  }

  function qualityScore(item) {
    var score = 0;
    if (item.photoUrl) score += 4;
    if (item.address) score += 2;
    if (item.source === 'amap' || item.source === 'baidu') score += 1;
    return score;
  }

  function mergeMissing(target, other) {
    if (!target.photoUrl && other.photoUrl) {
      target.photoUrl = other.photoUrl;
      target.photoCredit = other.photoCredit || target.photoCredit;
    }
    if (!target.address && other.address) target.address = other.address;
    if ((!target.category || target.category === 'plaza') &&
        other.category && other.category !== 'plaza') {
      target.category = other.category;
    }
  }

  /**
   * 同名（忽略空白/大小写）或距离 < radiusMeters 合并。
   * 保留质量更高的那条（有图 > 有地址 > 高德/百度），并补齐缺失字段。
   */
  function dedupe(list, radiusMeters) {
    var threshold = toNum(radiusMeters);
    if (threshold === null || threshold <= 0) threshold = DEDUPE_METERS;
    var out = [];
    if (!Array.isArray(list)) return out;

    list.forEach(function (item) {
      if (!item || !trimmedOrNull(item.name)) return;
      if (!isNum(item.lat) || !isNum(item.lon)) return;
      if (Math.abs(item.lat) > 90 || Math.abs(item.lon) > 180) return;

      var duplicateIndex = -1;
      for (var i = 0; i < out.length; i++) {
        var kept = out[i];
        if (nameKey(kept.name) === nameKey(item.name) || distanceBetween(kept, item) < threshold) {
          duplicateIndex = i;
          break;
        }
      }

      if (duplicateIndex < 0) {
        out.push(copyObject(item));
        return;
      }

      var existing = out[duplicateIndex];
      if (qualityScore(item) > qualityScore(existing)) {
        var replacement = copyObject(item);
        mergeMissing(replacement, existing);
        out[duplicateIndex] = replacement;
      } else {
        mergeMissing(existing, item);
      }
    });

    return out;
  }

  /**
   * 计算 distance（米）并按由近到远排序；传 radius 时会温和过滤远点（×1.1 容差）。
   */
  function sortByDistance(list, lat, lon, radiusMeters) {
    var origin = { lat: toNum(lat), lon: toNum(lon) };
    if (origin.lat === null || origin.lon === null || !Array.isArray(list)) return [];
    var maxDistance = toNum(radiusMeters);

    var out = list.map(function (item) {
      var copy = copyObject(item);
      copy.distance = Math.round(distanceBetween(origin, item) * 10) / 10;
      return copy;
    });
    out.sort(function (a, b) { return a.distance - b.distance; });
    if (maxDistance !== null && maxDistance > 0) {
      out = out.filter(function (item) { return item.distance <= maxDistance * 1.1; });
    }
    return out;
  }

  // ============================================================
  // 真实网络请求
  // ============================================================

  function amapUrl(lat, lon, radius, limit, page, keywords) {
    var gcj = wgs84ToGcj02(lat, lon);
    return AMAP_ENDPOINT +
      '?key=' + encodeURIComponent(keys.amap) +
      '&location=' + gcj.lon.toFixed(6) + ',' + gcj.lat.toFixed(6) +
      '&radius=' + Math.round(radius) +
      '&offset=' + clamp(Math.round(limit) || 25, 1, 25) +
      '&page=' + (page || 1) + '&extensions=all' +
      (keywords ? ('&keywords=' + encodeURIComponent(keywords)) : '');
  }

  function baiduUrl(lat, lon, radius, limit) {
    var bd = wgs84ToBd09(lat, lon);
    return BAIDU_ENDPOINT +
      '?query=' + encodeURIComponent('生活服务') +
      '&location=' + bd.lat.toFixed(6) + ',' + bd.lon.toFixed(6) +
      '&radius=' + Math.round(radius) +
      '&output=json&ak=' + encodeURIComponent(keys.baidu) +
      '&scope=2&page_size=' + clamp(Math.round(limit) || 20, 1, 20) +
      '&page_num=1';
  }

  function fetchAmap(context) {
    var collected = [];
    // 注意：高德不接受 "公园|博物馆|…" 这种整串关键字（会返回 status=1 但 count=0 的静默空结果），
    // 必须一个词查一次；为兼顾 QPS 限制，只查前 3 个。
    var keywords = (context.keywords || '').split('|').filter(function (k) { return k && k.trim(); }).slice(0, 2);
    var chain = Promise.resolve();
    keywords.forEach(function (kw, index) {
      chain = chain.then(function () {
        // 控制 QPS：每次调用间隔 120ms，避免高德 CUQPS_HAS_EXCEEDED_THE_LIMIT
        if (index > 0) return new Promise(function (r) { setTimeout(r, 120); }).then(function () { return doQuery(); });
        return doQuery();
        function doQuery() {
        return jsonp(
          amapUrl(context.lat, context.lon, context.radius, 25, 1, kw.trim()),
          JSONP_TIMEOUT
        ).then(function (data) {
          if (data && String(data.status) === '1' && Array.isArray(data.pois)) {
            collected = collected.concat(parseAmap(data));
          }
          return null;
        }).catch(function () { return null; });
        }
      });
    });
    return chain.then(function () { return fetchAmapPages(context, collected); });
  }

  function fetchAmapPages(context, seedList) {
    // 高德周边搜索每页最多 25 条、且按距离升序返回。
    // 密集街区里第 1 页常常全是"楼下 50 米的店"，会挤掉稍远但更适合走过去的点，
    // 所以按需要翻 2~3 页，扩大可选集合。
    var pageSize = clamp(Math.round(context.limit) || 25, 1, 25);
    var pages = Math.min(context.keywords ? 2 : 3, Math.max(1, Math.ceil((context.limit || 25) / pageSize)));
    var collected = (seedList || []).slice();
    var chain = Promise.resolve();
    for (var p = 1; p <= pages; p += 1) {
      (function (page) {
        chain = chain.then(function () {
          return jsonp(amapUrl(context.lat, context.lon, context.radius, pageSize, page), JSONP_TIMEOUT)
            .then(function (data) {
              if (!data || String(data.status) !== '1') {
                var info = data && data.info ? String(data.info) : 'unknown';
                if (page === 1) throw new Error('高德返回错误：status=' + (data && data.status) + ' info=' + info);
                return null;   // 后续页失败不影响已有结果
              }
              collected = collected.concat(parseAmap(data));
              return null;
            });
        });
      })(p);
    }
    return chain.then(function () {
      if (!collected.length) throw new Error('高德没有返回结果');
      return collected;
    });
  }

  function fetchBaidu(context) {
    return jsonp(baiduUrl(context.lat, context.lon, context.radius, context.limit), JSONP_TIMEOUT)
      .then(function (data) {
        if (!data || String(data.status) !== '0') {
          var message = data && data.message ? String(data.message) : 'unknown';
          throw new Error('百度返回错误：status=' + (data && data.status) + ' message=' + message);
        }
        return parseBaidu(data);
      });
  }

  function overpassQuery(endpoint, lat, lon, radiusMeters) {
    var clauses = TAG_RULES.map(function (rule) {
      return 'node["' + rule.key + '"="' + rule.value + '"](around:' +
        Math.round(radiusMeters) + ',' + lat + ',' + lon + ');';
    }).join('');
    var query = '[out:json][timeout:15];(' + clauses + ');out body 120;';
    var httpFetch = root.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (!httpFetch) return Promise.reject(new Error('当前环境没有 fetch'));
    return httpFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
      mode: 'cors',
      credentials: 'omit'
    }).then(function (response) {
      if (!response.ok) throw new Error('Overpass HTTP ' + response.status);
      return response.json();
    });
  }

  function fetchOSM(context) {
    var index = 0;
    function attempt() {
      if (index >= OVERPASS_ENDPOINTS.length) {
        return Promise.reject(new Error('Overpass 所有端点都失败'));
      }
      var endpoint = OVERPASS_ENDPOINTS[index++];
      return withTimeout(overpassQuery(endpoint, context.lat, context.lon, context.radius), 4500, 'Overpass')
        .then(function (json) { return parseOSMResponse(json); })
        .catch(function () { return attempt(); });
    }
    return withTimeout(attempt(), FETCH_TIMEOUT, 'Overpass');
  }

  function fetchWiki(context) {
    var httpFetch = root.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (!httpFetch) return Promise.reject(new Error('当前环境没有 fetch'));
    var radius = clamp(Math.round(context.radius), 100, 10000);
    var url = WIKI_ENDPOINT +
      '?action=query&format=json&origin=*' +
      '&generator=geosearch' +
      '&ggscoord=' + context.lat + '%7C' + context.lon +
      '&ggsradius=' + radius +
      '&ggslimit=' + clamp(Math.round(context.limit) || 20, 1, 20) +
      '&prop=pageimages%7Ccoordinates%7Cextracts' +
      '&piprop=thumbnail&pithumbsize=800' +
      '&exintro=1&explaintext=1&exchars=120';

    return withTimeout(httpFetch(url, { mode: 'cors', credentials: 'omit' }), FETCH_TIMEOUT, 'Wikipedia')
      .then(function (response) {
        if (!response.ok) throw new Error('Wikipedia HTTP ' + response.status);
        return response.json();
      })
      .then(function (json) { return parseWikiResponse(json); });
  }

  function fetchSource(id, context) {
    if (id === 'amap') return fetchAmap(context);
    if (id === 'baidu') return fetchBaidu(context);
    if (id === 'osm') return fetchOSM(context);
    if (id === 'wiki') return fetchWiki(context);
    return Promise.reject(new Error('未知数据源：' + id));
  }

  // ============================================================
  // 数据源编排
  // ============================================================

  function defaultSources() {
    var list = [];
    if (keys.amap) list.push('amap');
    if (keys.baidu) list.push('baidu');
    list.push('osm');
    list.push('wiki');
    return list;
  }

  function normalizeSources(input) {
    var known = { amap: true, baidu: true, osm: true, wiki: true };
    if (!Array.isArray(input) || !input.length) return defaultSources();
    var out = [];
    input.forEach(function (item) {
      var id = String(item || '').trim().toLowerCase();
      if (!known[id] || out.indexOf(id) >= 0) return;
      out.push(id);
    });
    return out.length ? out : defaultSources();
  }

  /**
   * 并发拉取多个源，统一去重排序。
   * @param {{lat:number, lon:number, radius?:number, limit?:number, sources?:string[]}} opts
   * @returns {Promise<Array<Candidate>>} 已按距离排序、已去重；坐标一律 WGS-84
   */
  function nearby(opts) {
    opts = opts || {};
    var lat = toNum(opts.lat);
    var lon = toNum(opts.lon);
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return Promise.reject(new Error('WA_PROVIDERS.nearby 需要合法的 lat / lon（WGS-84）'));
    }
    var radius = clamp(toNum(opts.radius) || 1200, 100, 50000);
    var limit = clamp(toNum(opts.limit) || 30, 1, 100);
    var sources = normalizeSources(opts.sources);
    var context = {
      lat: lat,
      lon: lon,
      radius: radius,
      limit: limit,
      keywords: opts.keywords ? String(opts.keywords) : ''
    };
    var sourceReports = [];
    var tasks = [];

    sources.forEach(function (id) {
      var entry = { id: id, label: SOURCE_LABELS[id], ok: null, count: 0, error: '' };
      sourceReports.push(entry);
      if (!sourceEnabled(id)) {
        entry.ok = false;
        entry.error = '未配置 Key';
        return;
      }
      tasks.push(
        fetchSource(id, context).then(function (list) {
          entry.ok = true;
          entry.count = list.length;
          return list;
        }, function (error) {
          entry.ok = false;
          entry.error = error && error.message ? error.message : String(error);
          return [];
        })
      );
    });

    var groups = [];
    function finish() {
      var merged = [];
      groups.forEach(function (list) {
        merged = merged.concat(list);
      });
      var deduped = dedupe(merged, DEDUPE_METERS);
      var sorted = sortByDistance(deduped, lat, lon, radius);
      report = { at: Date.now(), sources: sourceReports };
      return trimDiverse(sorted, limit);
    }

    /** 截断时保留类别多样性：最近的全是店铺时，别把稍远的公园/博物馆挤掉 */
    function trimDiverse(sorted, limit) {
      if (sorted.length <= limit) return sorted;
      var out = [];
      var picked = {};
      var perCat = {};
      var i;
      function keyOf(item) { return item && (item.id || item.name + '@' + item.lat + ',' + item.lon); }

      // 第一轮：每种类别最多留 5 个，保证多样性
      for (i = 0; i < sorted.length && out.length < limit; i += 1) {
        var item = sorted[i];
        var cat = item.category || 'plaza';
        perCat[cat] = perCat[cat] || 0;
        if (perCat[cat] >= 5) continue;
        var k = keyOf(item);
        if (picked[k]) continue;
        picked[k] = true;
        perCat[cat] += 1;
        out.push(item);
      }
      // 第二轮：还有空位就按距离补
      for (i = 0; i < sorted.length && out.length < limit; i += 1) {
        var k2 = keyOf(sorted[i]);
        if (picked[k2]) continue;
        picked[k2] = true;
        out.push(sorted[i]);
      }
      out.sort(function (a, b) { return (a.distance || 0) - (b.distance || 0); });
      return out;
    }

    // 每个源一回来就收进 groups（快源不必等慢源）
    tasks.forEach(function (task, index) {
      task.then(function (list) {
        groups[index] = list;
      });
    });

    var allDone = Promise.all(tasks).then(finish);
    var deadlineMs = clamp(toNum(opts.deadlineMs) || 0, 0, 30000);
    if (!deadlineMs) return allDone;

    // 有 deadline 时：到点就用"已经回来的源"出一版结果，慢源（如 Overpass 超时 8s）不再拖死整体
    return new Promise(function (resolve) {
      var timer = setTimeout(function () {
        resolve(finish());
      }, deadlineMs);
      allDone.then(function (list) {
        clearTimeout(timer);
        resolve(list);
      }, function (error) {
        clearTimeout(timer);
        resolve(finish());
      });
    });
  }

  function lastReport() {
    var sources = report.sources.map(function (entry) { return copyObject(entry); });
    return { at: report.at, sources: sources };
  }

  // ============================================================
  // 初始化 + 导出
  // ============================================================

  loadKeys();

  var api = {
    // 契约 API
    nearby: nearby,
    setKeys: setKeys,
    getKeys: getKeys,
    status: status,
    parseAmap: parseAmap,
    parseBaidu: parseBaidu,
    dedupe: dedupe,

    // 额外暴露（测试 / 接入 / 调试用）
    mapCategory: mapCategory,
    sortByDistance: sortByDistance,
    wgs84ToGcj02: wgs84ToGcj02,
    gcj02ToWgs84: gcj02ToWgs84,
    wgs84ToBd09: wgs84ToBd09,
    bd09ToWgs84: bd09ToWgs84,
    lastReport: lastReport
  };

  root.WA_PROVIDERS = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
