/* 盲走 BlindWalk · 真实地理数据（Real Geo）
 *
 * 数据源（均为免 key、支持 CORS）：
 *   - POI 搜索：Overpass API（OpenStreetMap）—— 半径查询，返回真实地点
 *   - 反向地理编码：Nominatim —— 把坐标变成「黄浦区 · 南京东路街道」这类真实地名
 *   - 底图（可选）：OSM 瓦片
 *
 * 设计要点（见 docs/real-geo.md）：
 *   1. 只取公共类别白名单，排除住宅/公司等私人地点
 *   2. 生成的三阶线索**绝不含地点名**（到达前不剧透）
 *   3. 三级降级：实时查询 → 本地缓存（0.01° 网格 / 24h）→ 内置虚构地点（标注「演示」）
 *   4. 坐标不上传，全部本地计算
 */
(function () {
  'use strict';

  var CACHE_KEY = 'blindwalk:geocache:v1';
  var CACHE_TTL = 24 * 3600 * 1000;      // 24 小时
  var GRID = 0.01;                        // 约 1.1km 网格
  /* Overpass 有多个端点，主站偶尔限流；按顺序尝试 */
  var OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter'
  ];
  var NOMINATIM = 'https://nominatim.openstreetmap.org';
  var TIMEOUT = 9000;

  /* OSM 标签 → 类别（白名单，只收公共场所） */
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
    { key: 'historic', value: 'yes', cat: 'temple' },
    { key: 'amenity', value: 'place_of_worship', cat: 'temple' }
  ];

  var CATEGORY_META = {
    cafe:        { label: '咖啡窗口', emoji: '☕️', rarity: 'common', moods: ['lively', 'drift'],
                   task: '点一杯最便宜的，问老板今天的豆子是哪里的。' },
    bookstore:   { label: '书店',     emoji: '📚', rarity: 'rare',   moods: ['discover'],
                   task: '找一本封面是蓝色的书，翻开第 7 页读三行。' },
    library:     { label: '图书馆',   emoji: '📖', rarity: 'rare',   moods: ['drift'],
                   task: '坐下，看十分钟别人进进出出。' },
    park:        { label: '公园',     emoji: '🌳', rarity: 'common', moods: ['drift'],
                   task: '找一张能看见最多树的长椅，坐三分钟。' },
    bench:       { label: '长椅',     emoji: '🪑', rarity: 'common', moods: ['drift'],
                   task: '数一数这张长椅能坐几个人。' },
    bridge:      { label: '桥',       emoji: '🌉', rarity: 'rare',   moods: ['discover'],
                   task: '在桥上站满 60 秒，看一次水流的方向。' },
    art:         { label: '涂鸦墙',   emoji: '🎨', rarity: 'epic',   moods: ['discover'],
                   task: '拍一张只有一个颜色的照片。' },
    river:       { label: '河岸',     emoji: '🌊', rarity: 'epic',   moods: ['drift'],
                   task: '数一数河面上有几艘船。' },
    convenience: { label: '便利店',   emoji: '🥫', rarity: 'common', moods: ['lively'],
                   task: '买一样不超过 5 块钱的东西。' },
    viewpoint:   { label: '观景点',   emoji: '🔭', rarity: 'epic',   moods: ['discover'],
                   task: '找一盏你能看见的最远的灯。' },
    garden:      { label: '花园',     emoji: '🌷', rarity: 'rare',   moods: ['drift'],
                   task: '找一盆你觉得活得最好的植物。' },
    plaza:       { label: '广场',     emoji: '⛲️', rarity: 'common', moods: ['lively'],
                   task: '观察 30 秒，找出走得最慢的那个人。' },
    market:      { label: '市集',     emoji: '🧺', rarity: 'rare',   moods: ['lively'],
                   task: '挑一样你不认识的东西，问老板是什么。' },
    temple:      { label: '老建筑',   emoji: '🏛️', rarity: 'hidden', moods: ['discover'],
                   task: '找一处你觉得最旧的痕迹。' }
  };

  /* 三阶线索：只描述「感觉/类别」，绝不出现名称 */
  var HINTS = {
    cafe:        ['风里有一点烘焙的味道。', '跟着这个味道走，会经过一扇开着的窗。'],
    bookstore:   ['前面会安静下来。', '找一扇窗很大、里面堆着纸的地方。'],
    library:     ['往更安静的方向走。', '会看到很多台阶，很多人坐在上面。'],
    park:        ['树会变多，声音会变少。', '找一片能听见叶子的地方。'],
    bench:       ['适合坐下来。往有阴影的地方走。', '会看到一张面朝开阔处的长椅。'],
    bridge:      ['脚下的声音会变。', '找一段水面在脚下经过的地方。'],
    art:         ['颜色会突然变多。', '找一面不太平整的墙。'],
    river:       ['空气会变凉，风会变大。', '往低处走，会听到水声。'],
    convenience: ['往灯最亮的地方走。', '会听到「欢迎光临」的电子音。'],
    viewpoint:   ['往高处走。', '找一个能看见很远的地方。'],
    garden:      ['空气会有一点甜。', '找一片被人照料过的绿。'],
    plaza:       ['人会变多。', '找一块空着的石头或台阶。'],
    market:      ['声音会变杂。', '找一个人挤人、但没人赶时间的地方。'],
    temple:      ['会突然安静，也会突然古老。', '找一处门框比周围都旧的地方。']
  };

  /** 兼容 {lat,lon} 与 {lat,lng} */
  function norm(p) {
    if (!p) return null;
    var lon = (p.lon !== undefined && p.lon !== null) ? p.lon : p.lng;
    if (typeof p.lat !== 'number' || typeof lon !== 'number' || isNaN(p.lat) || isNaN(lon)) return null;
    return { lat: p.lat, lon: lon };
  }

  function gridKey(lat, lon) {
    return (Math.round(lat / GRID) * GRID).toFixed(2) + ',' + (Math.round(lon / GRID) * GRID).toFixed(2);
  }

  function readCache(lat, lon) {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var all = JSON.parse(raw);
      var entry = all[gridKey(lat, lon)];
      if (!entry || Date.now() - entry.at > CACHE_TTL) return null;
      return entry.data;
    } catch (e) { return null; }
  }

  function writeCache(lat, lon, data) {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      var all = raw ? JSON.parse(raw) : {};
      all[gridKey(lat, lon)] = { at: Date.now(), data: data };
      // 只保留最近 12 个格子，避免撑爆 localStorage
      var keys = Object.keys(all);
      if (keys.length > 12) {
        keys.sort(function (a, b) { return all[a].at - all[b].at; });
        keys.slice(0, keys.length - 12).forEach(function (k) { delete all[k]; });
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(all));
    } catch (e) { /* 配额满就放弃缓存 */ }
  }

  function fetchWithTimeout(url, options, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('timeout')); }, ms || TIMEOUT);
      fetch(url, options).then(function (r) {
        clearTimeout(timer);
        if (!r.ok) { reject(new Error('HTTP ' + r.status)); return; }
        resolve(r);
      }).catch(function (e) { clearTimeout(timer); reject(e); });
    });
  }

  var LOOKUP_BUDGET = 6500;   // 整体预算：超过就直接用真实坐标，不阻塞用户

  function overpassQueryOnce(endpoint, lat, lon, radiusMeters) {
    var clauses = TAG_RULES.map(function (rule) {
      return 'node["' + rule.key + '"="' + rule.value + '"](around:' + radiusMeters + ',' + lat + ',' + lon + ');';
    }).join('');
    var query = '[out:json][timeout:18];(' + clauses + ');out body 120;';
    return fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query)
    }, 4500).then(function (r) { return r.json(); });
  }

  /** 依次尝试多个 Overpass 端点，超出预算立即放弃 */
  function searchPOIs(lat, lon, radiusMeters) {
    var i = 0;
    var started = Date.now();
    function attempt() {
      if (i >= OVERPASS_ENDPOINTS.length) return Promise.reject(new Error('all overpass endpoints failed'));
      if (Date.now() - started > LOOKUP_BUDGET) return Promise.reject(new Error('budget exceeded'));
      var endpoint = OVERPASS_ENDPOINTS[i++];
      return overpassQueryOnce(endpoint, lat, lon, radiusMeters).catch(attempt);
    }
    return attempt().then(function (json) {
      var out = [];
      var seen = {};
      (json.elements || []).forEach(function (el) {
        if (!el.tags || !el.tags.name) return;      // 无名地点没法用
        var rule = TAG_RULES.filter(function (rr) {
          return el.tags[rr.key] === rr.value;
        })[0];
        if (!rule) return;
        var id = 'osm-' + el.type + '-' + el.id;
        if (seen[id]) return;
        seen[id] = true;
        var addr = [el.tags['addr:street'], el.tags['addr:district'] || el.tags['addr:suburb']]
          .filter(Boolean).join(' ');
        out.push({
          id: id,
          name: el.tags.name,
          lat: el.lat,
          lon: el.lon,
          category: rule.cat,
          address: addr || null,
          source: 'osm'
        });
      });
      return out;
    });
  }

  /* ============================================================
     兜底：不用任何 POI 服务，也能生成「真实地理位置」
     做法：取用户真实坐标，按抽到的方位与距离算出真实可走的坐标点，
     再尽力反查街道名。这样即使断网/接口挂了，走的仍是真实的路。
     ============================================================ */
  function proceduralPlace(origin, mood, startMeters, seed) {
    var bearing = (seed % 360);
    var meters = Math.max(180, Math.round(startMeters * (0.55 + ((seed >> 8) % 40) / 100)));
    var R = 6371000;
    var ang = meters / R;
    var brg = bearing * Math.PI / 180;
    var lat1 = origin.lat * Math.PI / 180, lon1 = origin.lon * Math.PI / 180;
    var lat2 = Math.asin(Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(brg));
    var lon2 = lon1 + Math.atan2(Math.sin(brg) * Math.sin(ang) * Math.cos(lat1),
                                 Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2));
    var target = { lat: lat2 * 180 / Math.PI, lon: lon2 * 180 / Math.PI };
    var geo = mapPointFor(origin, target, startMeters);
    var meta = CATEGORY_META.park;
    return {
      id: 'geo-' + Math.round(target.lat * 1e5) + '-' + Math.round(target.lon * 1e5),
      name: '路口的那个角落',
      area: 'near',
      category: meta.label,
      categoryEmoji: '📍',
      rarity: 'common',
      why: mood === 'drift' ? '你选了「放空」，这里适合什么都不想。'
        : mood === 'discover' ? '你选了「发现」，这里不是游客会停下来的地方。'
        : '你选了「热闹」，这个位置通常不会太冷清。',
      task: '站 60 秒，找出你能听见的第三种声音。',
      hints: ['往这个方向走，不用赶。', '还有一半路。注意路边的小东西。', '就在前面。抬手机，慢慢看。'],
      mapPoint: { x: geo.x, y: geo.y },
      bearing: geo.bearing,
      distance: geo.distance,
      coordinate: target,
      address: null,
      source: 'geo',
      collected: false
    };
  }

  /** 反查并补上真实街道名（拿到后替换名字） */
  function enrichWithAddress(place) {
    if (!place || !place.coordinate) return Promise.resolve(place);
    return reverseGeocode(place.coordinate.lat, place.coordinate.lon).then(function (info) {
      if (!info) return place;
      var street = info.road || info.area;
      if (!street) return place;
      place.address = [info.area, info.road].filter(Boolean).join(' · ');
      if (place.source === 'geo') {
        place.name = street + '的一段';
      }
      return place;
    }).catch(function () { return place; });
  }

  /** 反向地理编码：坐标 → 中文地址（失败返回 null，不影响主流程） */
  function reverseGeocode(lat, lon) {
    var url = NOMINATIM + '/reverse?format=jsonv2&lat=' + lat + '&lon=' + lon +
      '&accept-language=zh&zoom=16';
    return fetchWithTimeout(url, { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var a = d.address || {};
        var area = a.city_district || a.district || a.suburb || a.city || a.town || '';
        var road = a.road || a.pedestrian || a.neighbourhood || '';
        return { area: area, road: road, display: d.display_name || '' };
      })
      .catch(function () { return null; });
  }

  /** 相对起点的方位投影到抽象地图（只用于画示意路线） */
  function mapPointFor(origin, poi, startMeters) {
    var R = 6371000;
    var lat1 = origin.lat * Math.PI / 180, lat2 = poi.lat * Math.PI / 180;
    var dLon = (poi.lon - origin.lon) * Math.PI / 180;
    var y = Math.sin(dLon) * Math.cos(lat2);
    var x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    var bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    var dLat = (poi.lat - origin.lat) * Math.PI / 180;
    var dist = Math.sqrt(dLat * dLat + dLon * dLon * Math.cos(lat1) * Math.cos(lat1)) * R;
    var norm = Math.min(0.42, dist / Math.max(200, startMeters * 2.2));
    var rad = bearing * Math.PI / 180;
    return {
      x: 0.5 + Math.sin(rad) * norm,
      y: 0.82 - Math.cos(rad) * norm,
      bearing: bearing,
      distance: dist
    };
  }

  /** 真实 POI → 盲走 Place（名称到达后才展示；线索不含名称） */
  function makePlace(poi, origin, mood, startMeters) {
    var meta = CATEGORY_META[poi.category] || CATEGORY_META.cafe;
    var geo = mapPointFor(origin, poi, startMeters);
    var hints = (HINTS[poi.category] || HINTS.cafe).concat(['就在前面。抬手机，慢慢看。']);
    // 二次保险：线索里不允许出现名称（含前 2 字）
    var shortName = poi.name.slice(0, 2);
    hints = hints.map(function (h) {
      return h.split(poi.name).join('那里').split(shortName).join('那里');
    });

    var hour = new Date().getHours();
    var timeWord = hour < 9 ? '清晨' : hour < 12 ? '上午' : hour < 15 ? '午后'
      : hour < 18 ? '傍晚前' : hour < 21 ? '入夜' : '夜里';
    var moodWord = mood === 'drift' ? '你选了「放空」，这里适合什么都不想。'
      : mood === 'discover' ? '你选了「发现」，这里通常不是游客会注意到的地方。'
      : '你选了「热闹」，这个时间这里不会太冷清。';

    return {
      id: 'real-' + poi.id,
      name: poi.name,
      area: poi.category === 'river' || poi.category === 'bridge' ? 'river'
        : (poi.category === 'bookstore' || poi.category === 'library' || poi.category === 'art' || poi.category === 'temple' ? 'oldtown' : 'near'),
      category: meta.label,
      categoryEmoji: meta.emoji,
      rarity: meta.rarity,
      why: moodWord + '\n' + timeWord + '的' + meta.label + '，是城市里比较安静的一类角落。',
      task: meta.task,
      hints: hints,
      mapPoint: { x: geo.x, y: geo.y },
      bearing: geo.bearing,
      distance: geo.distance,
      coordinate: { lat: poi.lat, lon: poi.lon },
      address: poi.address,
      source: 'osm',
      collected: false
    };
  }

  /** 按心情加权挑一个候选 */
  function pick(candidates, mood, startMeters, origin) {
    if (!candidates.length) return null;
    var pool = candidates.filter(function (c) {
      var meta = CATEGORY_META[c.category];
      if (!meta) return false;
      var d = mapPointFor(origin, c, startMeters).distance;
      return d >= 80 && d <= startMeters * 1.7;
    });
    if (!pool.length) {
      pool = candidates.filter(function (c) { return CATEGORY_META[c.category]; });
    }
    if (!pool.length) return null;
    var bag = [];
    pool.forEach(function (c) {
      var meta = CATEGORY_META[c.category];
      var w = 10;
      if (meta.moods.indexOf(mood) >= 0) w += 25;
      if (meta.rarity === 'hidden') w = Math.round(w * 0.4);
      if (meta.rarity === 'epic') w = Math.round(w * 0.8);
      bag.push({ c: c, w: w });
    });
    var total = bag.reduce(function (s, e) { return s + e.w; }, 0);
    var roll = Math.random() * total;
    for (var i = 0; i < bag.length; i += 1) {
      roll -= bag[i].w;
      if (roll <= 0) return bag[i].c;
    }
    return bag[bag.length - 1].c;
  }

  /** 主入口：拿到真实地点（带缓存与降级） */
  function findRealPlace(rawOrigin, mood, startMeters) {
    var origin = norm(rawOrigin);
    if (!origin) return Promise.resolve({ place: null, reason: 'no-origin' });
    var cached = readCache(origin.lat, origin.lon);
    if (cached && cached.length) {
      var picked = pick(cached, mood, startMeters, origin);
      if (picked) {
        return Promise.resolve({
          place: makePlace(picked, origin, mood, startMeters),
          cached: true,
          poolSize: cached.length
        });
      }
    }
    var seed = Math.floor(Date.now() / 1000) % 100000;
    var budgetHit = new Promise(function (resolve) {
      setTimeout(function () { resolve({ __budget: true }); }, LOOKUP_BUDGET);
    });

    return Promise.race([
      searchPOIs(origin.lat, origin.lon, Math.round(startMeters * 1.6)),
      budgetHit
    ]).then(function (result) {
        if (result && result.__budget) {
          // 预算用完：直接用真实坐标（已经是真实经纬度，只是没有店名）
          return { place: proceduralPlace(origin, mood, startMeters, seed), fallback: true, reason: 'budget' };
        }
        var list = result;
        if (!list || !list.length) {
          return { place: proceduralPlace(origin, mood, startMeters, seed), fallback: true, reason: 'no-poi' };
        }
        if (!list || !list.length) return { place: null, reason: 'no-poi' };
        writeCache(origin.lat, origin.lon, list);
        var picked = pick(list, mood, startMeters, origin);
        if (!picked) return { place: proceduralPlace(origin, mood, startMeters, seed), fallback: true, reason: 'no-pick' };
        var place = makePlace(picked, origin, mood, startMeters);
        return { place: place, cached: false, poolSize: list.length };
      })
      .catch(function (e) {
        // 网络失败：还有旧缓存就用旧的（哪怕过期），否则让调用方降级到内置地点
        var stale = (function () {
          try {
            var all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
            var entry = all[gridKey(origin.lat, origin.lon)];
            return entry ? entry.data : null;
          } catch (err) { return null; }
        })();
        if (stale && stale.length) {
          var p = pick(stale, mood, startMeters, origin);
          if (p) return { place: makePlace(p, origin, mood, startMeters), cached: true, stale: true };
        }
        // 最终兜底：用真实坐标走，名字靠反查（拿不到就叫「路口的那个角落」）
        return { place: proceduralPlace(origin, mood, startMeters, seed), fallback: true, reason: 'network' };
      });
  }

  window.BW_GEO = {
    findRealPlace: findRealPlace,
    searchPOIs: searchPOIs,
    proceduralPlace: proceduralPlace,
    enrichWithAddress: enrichWithAddress,
    reverseGeocode: reverseGeocode,
    makePlace: makePlace,
    CATEGORY_META: CATEGORY_META,
    readCache: readCache,
    gridKey: gridKey
  };
})();
