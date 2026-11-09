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
    museum:      { label: '博物馆',   emoji: '🏛️', rarity: 'rare',   moods: ['discover'],
                   task: '找出展厅里最旧的一件东西，记住它的年代。' },
    historic:    { label: '老房子',   emoji: '🏮', rarity: 'rare',   moods: ['discover', 'drift'],
                   task: '抬头看门牌号和窗户，猜它最年轻是哪一年建的。' },
    venue:       { label: '演出场所', emoji: '🎻', rarity: 'epic',   moods: ['discover'],
                   task: '找一张演出海报，看看最近一场演的是什么。' },
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
    museum: ['往安静、门比较高的地方走。', '找一扇比旁边宽的门。', '门口通常有人停下来抬头看。'],
    historic: ['注意墙面和窗户，越旧的越靠里。', '找一栋比旁边矮一点的楼。', '看门牌号，数字越小越可能是它。'],
    venue: ['听，有没有音乐或者排练声。', '找一排大字招牌。', '门口通常有海报和台阶。'],
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

  /* ============================================================
     Wikipedia / Wikimedia Commons：公开数据里的真实兴趣点 + 图片
     - 端点公开、无需 API Key、CORS 全开（access-control-allow-origin: *）
     - 一次请求同时拿到：地标名、真实坐标、简介、代表图片
     - 图片只用于「到达后揭晓」和图鉴，绝不提前展示（产品保密规则）
     ============================================================ */
  var WIKI_ENDPOINT = 'https://zh.wikipedia.org/w/api.php';
  var WIKI_BUDGET = 4500;
  var WIKI_FIRST_BUDGET = 3200;   // 只等 Wiki 这么久，拿不到就交给 Overpass

  /** 第 2 个起用 geo 坐标去重，避免同一地标反复出现 */
  function wikipediaPOIs(location, radiusMeters) {
    var loc = norm(location);
    if (!loc) return Promise.resolve([]);
    var lat = loc.lat, lon = loc.lon;
    var key = 'bw:wiki:' + lat.toFixed(3) + ',' + lon.toFixed(3) + ':' + radiusMeters;
    try {
      var cachedRaw = sessionStorage.getItem(key);
      if (cachedRaw) {
        var cachedParsed = JSON.parse(cachedRaw);
        if (cachedParsed && Date.now() - cachedParsed.t < 6 * 3600 * 1000) {
          return Promise.resolve(cachedParsed.v || []);
        }
      }
    } catch (e) { /* ignore */ }

    var url = WIKI_ENDPOINT +
      '?action=query&format=json&origin=*' +
      '&generator=geosearch' +
      '&ggscoord=' + lat + '%7C' + lon +
      '&ggsradius=' + Math.min(10000, Math.round(radiusMeters)) +
      '&ggslimit=20' +
      '&prop=pageimages%7Ccoordinates%7Cextracts' +
      '&piprop=thumbnail&pithumbsize=800' +
      '&exintro=1&explaintext=1&exchars=120';

    return fetchJSON(url, WIKI_BUDGET).then(function (data) {
      var pages = (data && data.query && data.query.pages) || {};
      var list = [];
      Object.keys(pages).forEach(function (id) {
        var page = pages[id];
        var coord = page.coordinates && page.coordinates[0];
        if (!coord) return;
        var photo = page.thumbnail && page.thumbnail.source;
        if (!photo) return;
        // 过滤：行政区、城市、地铁站、道路 —— 这些不是「一个可以走到的地方」
        if (/[省市县区镇]$/.test(page.title)) return;
        if (/^(中国|上海|北京|广州|深圳|杭州|成都|南京|武汉|西安|重庆|天津|苏州)$/.test(page.title)) return;
        if (/站$|站 \(|号线|铁路|高速公路|立交|隧道|大桥工程/.test(page.title)) return;
        // 去掉维基的括号消歧义后缀：「大世界 (上海市)」→「大世界」
        var displayName = page.title.replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim();
        if (!displayName) return;
        // 只收能正常加载的缩略图域名；原图域名时通时不通，宁可不要
        if (photo.indexOf('thumb.wikimedia.org') < 0 && photo.indexOf('upload.wikimedia.org') < 0) return;
        list.push({
          id: 'wiki-' + (page.pageid || id),
          name: displayName,
          lat: coord.lat,
          lon: coord.lon,
          photoUrl: photo,
          credit: 'Wikimedia Commons',
          summary: (page.extract || '').replace(/\s+/g, ' ').slice(0, 120),
          category: guessCategoryFromTitle(page.title, page.extract || '')
        });
      });
      // 按距离由近到远
      list.sort(function (a, b) {
        return distanceBetween(loc, a) - distanceBetween(loc, b);
      });
      try {
        sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v: list.slice(0, 20) }));
      } catch (e) { /* ignore */ }
      return list;
    }).catch(function () { return []; });
  }

  /** 从标题/简介里猜类别，用于选 emoji / 任务 / 线索 */
  function guessCategoryFromTitle(title, extract) {
    var text = title + ' ' + (extract || '');
    if (/公园|花园|绿地|植物园/.test(text)) return 'park';
    if (/广场/.test(text)) return 'plaza';
    if (/桥/.test(text)) return 'bridge';
    if (/河|江|湖|滨/.test(text)) return 'river';
    if (/教堂|寺|庙|会堂|清真/.test(text)) return 'temple';
    if (/博物|纪念馆|展览馆|陈列馆/.test(text)) return 'museum';
    if (/音乐厅|剧院|剧场|戏院|大戏院|演奏厅/.test(text)) return 'venue';
    if (/美术馆|艺术|画廊/.test(text)) return 'art';
    if (/大学|学院|校区|书院/.test(text)) return 'historic';
    if (/故居|旧址|会址|公馆|洋房|里弄|弄堂|饭店|酒店|宾馆|旅馆/.test(text)) return 'historic';
    if (/图书/.test(text)) return 'library';
    if (/书店/.test(text)) return 'bookstore';
    if (/咖啡/.test(text)) return 'cafe';
    if (/商场|百货|市集|市场/.test(text)) return 'market';
    if (/车站|地铁|站/.test(text)) return 'plaza';
    if (/楼|旧址|故居|大楼|建筑|弄|里/.test(text)) return 'temple';
    if (/塔|观景|天台/.test(text)) return 'viewpoint';
    return 'plaza';
  }



  /* ============================================================
     手动指定位置：地址 → 坐标（GPS 不可用时的「真实地点」出口）
     Nominatim 优先，失败换 Photon；都失败返回 null
     ============================================================ */
  function geocodeAddress(rawQuery) {
    var query = (rawQuery || '').trim();
    if (!query) return Promise.resolve(null);

    // 直接输坐标：31.23,121.47
    var coordMatch = query.match(/^\s*(-?\d{1,2}\.\d+)\s*[,， ]\s*(-?\d{2,3}\.\d+)\s*$/);
    if (coordMatch) {
      return Promise.resolve({
        lat: parseFloat(coordMatch[1]),
        lon: parseFloat(coordMatch[2]),
        label: '你输入的位置',
        source: 'manual'
      });
    }

    var nominatim = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=zh-CN&q=' +
      encodeURIComponent(query);
    return fetchJSON(nominatim, 6000).then(function (list) {
      if (Array.isArray(list) && list.length) {
        return {
          lat: parseFloat(list[0].lat),
          lon: parseFloat(list[0].lon),
          label: list[0].display_name || query,
          source: 'nominatim'
        };
      }
      return geocodePhoton(query);
    }).catch(function () {
      return geocodePhoton(query);
    });
  }

  function geocodePhoton(query) {
    return fetchJSON('https://photon.komoot.io/api/?limit=1&lang=zh&q=' + encodeURIComponent(query), 6000)
      .then(function (data) {
        var f = data && data.features && data.features[0];
        if (!f) return null;
        var c = f.geometry && f.geometry.coordinates;
        if (!c) return null;
        var p = f.properties || {};
        var label = [p.name, p.street, p.district, p.city].filter(Boolean).join(' · ') || query;
        return { lat: c[1], lon: c[0], label: label, source: 'photon' };
      })
      .catch(function () { return null; });
  }

  /* ============================================================
     步行路线与转向指令（Valhalla 公共实例，CORS 全开、无需 Key）
     - 目的：不再画地图，只给「还有多少米 / 再过多少米往哪拐」
     - 失败时返回 null，由上层退回「朝某方向走 + 距离」
     ============================================================ */
  var ROUTE_ENDPOINT = 'https://valhalla1.openstreetmap.de/route';
  var ROUTE_TIMEOUT = 6000;
  var routeCache = {};          // key: 起点网格 + 终点 → { t, route }

  /** Valhalla maneuver.type → 简化的转向语义 */
  var MANEUVER_DIRECTION = {
    1: 'start', 2: 'start', 3: 'start',
    4: 'arrive', 5: 'arrive', 6: 'arrive',
    7: 'straight', 8: 'straight',
    9: 'slight-right', 10: 'right', 11: 'sharp-right',
    12: 'uturn', 13: 'uturn',
    14: 'sharp-left', 15: 'left', 16: 'slight-left',
    18: 'right', 19: 'left',
    20: 'right', 21: 'left',
    22: 'straight', 23: 'slight-right', 24: 'slight-left',
    25: 'straight', 26: 'roundabout', 27: 'roundabout',
    37: 'straight', 38: 'straight', 39: 'straight', 40: 'straight'
  };

  /** 方向的中文说法（用于「30 米后左拐」） */
  var DIRECTION_LABEL = {
    start: '出发',
    straight: '直行',
    'slight-right': '向右前方',
    right: '右拐',
    'sharp-right': '向右大拐',
    'slight-left': '向左前方',
    left: '左拐',
    'sharp-left': '向左大拐',
    uturn: '掉头',
    roundabout: '走环岛',
    arrive: '到达'
  };

  /** Valhalla 的 shape 是 polyline6 编码，解码成 [lon, lat] 数组 */

  function distanceBetween(a, b) {
    var R = 6371000;
    var lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180;
    var dLat = (b.lat - a.lat) * Math.PI / 180;
    var dLon = (b.lon - a.lon) * Math.PI / 180;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
  }

  /** 带超时的 JSON 请求（CORS JSON 端点） */
  function fetchJSON(url, budgetMs, options) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('timeout'));
      }, budgetMs || 5000);
      var init = { mode: 'cors', credentials: 'omit' };
      if (options) {
        if (options.method) init.method = options.method;
        if (options.headers) init.headers = options.headers;
        if (options.body) init.body = options.body;
      }
      fetch(url, init)
        .then(function (res) {
          if (!res.ok) throw new Error('http ' + res.status);
          return res.json();
        })
        .then(function (json) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(json);
        })
        .catch(function (err) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /** 把 Wikipedia POI 变成可玩的 Place（含图片） */
  function makeWikiPlace(poi, origin, mood, startMeters) {
    var meta = CATEGORY_META[poi.category] || CATEGORY_META.plaza;
    var geo = mapPointFor(origin, poi, startMeters);
    var hints = (HINTS[poi.category] || HINTS.plaza).concat(['就在前面。抬手机，慢慢看。']);
    var shortName = poi.name.slice(0, 2);
    hints = hints.map(function (h) {
      return h.split(poi.name).join('那里').split(shortName).join('那里');
    });
    var hour = new Date().getHours();
    var timeWord = hour < 9 ? '清晨' : hour < 12 ? '上午' : hour < 15 ? '午后'
      : hour < 18 ? '傍晚前' : hour < 21 ? '入夜' : '夜里';
    var moodWord = mood === 'drift' ? '你选了「放空」，这里适合什么都不想。'
      : mood === 'discover' ? '你选了「发现」，这里不是游客会停下来的地方。'
      : '你选了「热闹」，这个时间这里不会太冷清。';
    return {
      id: poi.id,
      name: poi.name,
      area: poi.category === 'river' || poi.category === 'bridge' ? 'river'
        : (poi.category === 'art' || poi.category === 'temple' || poi.category === 'library' ? 'oldtown' : 'near'),
      category: meta.label,
      categoryEmoji: meta.emoji,
      rarity: meta.rarity,
      why: moodWord + '\n' + timeWord + '的' + meta.label + '，是这座城市里留下过痕迹的地方。'
        + (poi.summary ? '\n' + poi.summary : ''),
      task: meta.task,
      hints: hints,
      mapPoint: { x: geo.x, y: geo.y },
      bearing: geo.bearing,
      distance: geo.distance,
      coordinate: { lat: poi.lat, lon: poi.lon },
      address: null,
      photoUrl: poi.photoUrl,
      photoCredit: poi.credit,
      source: 'wikipedia',
      collected: false
    };
  }


  /* ============================================================
     后台策展兴趣点（admin 导出 → pois.json）
     - 优先级最高：人工审核过的点比自动抓的可靠
     - 文件不存在/请求失败时静默跳过，不影响自动抓取
     ============================================================ */
  var CURATED_URL = 'pois.json';
  var curatedCache = null;
  var curatedPending = null;

  function loadCuratedPOIs() {
    if (curatedCache) return Promise.resolve(curatedCache);
    if (curatedPending) return curatedPending;
    curatedPending = fetchJSON(CURATED_URL + '?t=' + Math.floor(Date.now() / 3600000), 3500)
      .then(function (data) {
        var list = (data && data.pois) || [];
        curatedCache = Array.isArray(list) ? list : [];
        return curatedCache;
      })
      .catch(function () {
        curatedCache = [];
        return curatedCache;
      });
    return curatedPending;
  }

  /** 从后台策展数据里挑一个（已经带 why/task/hints/图片，无需再生成） */
  function pickCurated(candidates, origin, mood, startMeters, minDistance, maxDistance) {
    if (!candidates || !candidates.length) return null;
    var pool = [];
    for (var i = 0; i < candidates.length; i += 1) {
      var c = candidates[i];
      if (typeof c.lat !== 'number' || typeof c.lon !== 'number') continue;
      var d = distanceBetween(origin, { lat: c.lat, lon: c.lon });
      if (d < minDistance || d > maxDistance) continue;
      var w = 1;
      var cat = c.category || 'plaza';
      if (mood === 'drift' && (cat === 'park' || cat === 'river' || cat === 'temple' || cat === 'historic')) w = 1.5;
      if (mood === 'discover' && (cat === 'art' || cat === 'library' || cat === 'viewpoint' || cat === 'museum')) w = 1.7;
      if (mood === 'lively' && (cat === 'plaza' || cat === 'market' || cat === 'cafe')) w = 1.6;
      pool.push({ poi: c, weight: w });
    }
    if (!pool.length) return null;
    var total = 0;
    for (var j = 0; j < pool.length; j += 1) total += pool[j].weight;
    var r = Math.random() * total;
    for (var k = 0; k < pool.length; k += 1) {
      r -= pool[k].weight;
      if (r <= 0) return pool[k].poi;
    }
    return pool[pool.length - 1].poi;
  }

  /** 把后台策展数据转成 App 的 Place 结构 */
  function makeCuratedPlace(poi, origin, startMeters) {
    var meta = CATEGORY_META[poi.category] || CATEGORY_META.plaza;
    var geo = mapPointFor(origin, poi, startMeters);
    return {
      id: 'curated-' + poi.id,
      name: poi.name,
      area: poi.area || 'near',
      category: meta.label,
      categoryEmoji: poi.emoji || meta.emoji,
      rarity: poi.rarity || meta.rarity,
      why: poi.why || ('在' + (poi.summary || '这里') + '停下看看。'),
      task: poi.task || meta.task,
      hints: (poi.hints && poi.hints.length ? poi.hints : (HINTS[poi.category] || HINTS.plaza)).slice(0, 3),
      mapPoint: { x: geo.x, y: geo.y },
      bearing: geo.bearing,
      distance: geo.distance,
      coordinate: { lat: poi.lat, lon: poi.lon },
      address: poi.address || null,
      photoUrl: poi.photoUrl || null,
      photoCredit: poi.photoCredit || null,
      summary: poi.summary || '',
      source: 'curated',
      collected: false
    };
  }

  function findRealPlace(rawOrigin, mood, startMeters) {
    var origin = norm(rawOrigin);
    if (!origin) return Promise.resolve({ place: null, reason: 'no-origin' });
    var radius = Math.max(600, Math.round(startMeters * 1.8));
    var seed = Math.floor(Date.now() / 1000) % 100000;

    // 真实定位下必须「走得到」：目标不能太近（会一开盒就到达），也不能超出抽盒半径
    var minDistance = Math.max(110, Math.round(startMeters * 0.35));
    var maxDistance = Math.round(startMeters * 1.7);

    // ① 后台策展数据优先：人工审核过的点最可靠
    return loadCuratedPOIs().then(function (curated) {
      var curatedPick = pickCurated(curated, origin, mood, startMeters, minDistance, maxDistance);
      if (curatedPick) {
        return {
          place: makeCuratedPlace(curatedPick, origin, startMeters),
          cached: false,
          poolSize: curated.length,
          source: 'curated'
        };
      }
      return autoPickPlace(origin, mood, startMeters, radius, minDistance, maxDistance, seed);
    });
  }

  /** 没有可用的策展点时：先走多数据源（高德/百度/OSM/维基），再退回旧链路 */
  function autoPickPlace(origin, mood, startMeters, radius, minDistance, maxDistance, seed) {
    var providers = window.BW_PROVIDERS;
    if (!providers || typeof providers.nearby !== 'function') {
      return autoPickLegacy(origin, mood, startMeters, radius, minDistance, maxDistance, seed);
    }
    // 硬截止 6 秒：多数据源最慢可能 8s，不能让用户干等
    var deadline = new Promise(function (resolve) {
      setTimeout(function () { resolve(null); }, 6000);
    });
    return Promise.race([
      providers.nearby({ lat: origin.lat, lon: origin.lon, radius: radius, limit: 40 }),
      deadline
    ]).then(function (list) {
      if (!list) {
        return autoPickLegacy(origin, mood, startMeters, radius, minDistance, maxDistance, seed);
      }
      var picked = pickProvider(list, mood, startMeters, origin, minDistance, maxDistance, seed);
      if (!picked) {
        return autoPickLegacy(origin, mood, startMeters, radius, minDistance, maxDistance, seed);
      }
      return {
        place: makeProviderPlace(picked, origin, mood, startMeters),
        cached: false,
        poolSize: list.length,
        source: picked.source || 'osm'
      };
    }).catch(function () {
      return autoPickLegacy(origin, mood, startMeters, radius, minDistance, maxDistance, seed);
    });
  }

  /** 商业 POI 黑名单：这些地方不值得"盲走"，哪怕地图上有 */
  var POI_BAD_WORDS = /快递|丰巢|菜鸟|驿站|停车场|停车库|加油站|充电站|公厕|厕所|垃圾|污水|变电|美容|美发|理发|足浴|按摩|足疗|养生|汗蒸|地产|房产|中介|银行|ATM|自助取款|药房|大药房|门诊|诊所|超市|便利店|菜市场|农贸|五金|建材|汽修|洗车|驾校|营业厅|打印|复印|网吧|棋牌|麻将|KTV|酒吧|夜总会|售楼|写字楼|工业园|仓库|物流|工厂/;

  /** 有「散步/探索」价值的类别（其余类别降权） */
  var POI_GOOD_CATS = {
    park: 1, garden: 1, temple: 1, historic: 1, museum: 1, art: 1,
    library: 1, viewpoint: 1, river: 1, bridge: 1, cafe: 1, bookstore: 1, market: 1, plaza: 1
  };

  function isWalkworthy(candidate) {
    var name = candidate.name || '';
    if (!name || name.length < 2) return false;
    if (POI_BAD_WORDS.test(name)) return false;
    // 纯数字/编号命名（如「3号楼」「A座」）也不适合
    if (/^[0-9A-Za-z\-\s]+$/.test(name)) return false;
    return true;
  }

  /** 从多数据源候选里挑一个（距离 + 心情加权 + 可复现随机） */
  function pickProvider(list, mood, startMeters, origin, minDistance, maxDistance, seed) {
    if (!list || !list.length) return null;
    var pool = [];
    for (var i = 0; i < list.length; i += 1) {
      var c = list[i];
      if (typeof c.lat !== 'number' || typeof c.lon !== 'number') continue;
      if (!isWalkworthy(c)) continue;
      var d = distanceBetween(origin, { lat: c.lat, lon: c.lon });
      if (d < minDistance || d > maxDistance) continue;
      var cat = c.category || 'plaza';
      if (!CATEGORY_META[cat]) cat = 'plaza';
      var w = 1;
      if (mood === 'drift' && (cat === 'park' || cat === 'river' || cat === 'temple' || cat === 'historic')) w = 1.5;
      if (mood === 'discover' && (cat === 'art' || cat === 'library' || cat === 'viewpoint' || cat === 'museum')) w = 1.7;
      if (mood === 'lively' && (cat === 'plaza' || cat === 'market' || cat === 'cafe')) w = 1.6;
      if (!POI_GOOD_CATS[cat]) w *= 0.35;      // 类别本身不适合散步 → 大幅降权
      if (c.source === 'wiki' || c.source === 'osm') w *= 1.25;  // 百科/OSM 通常比商业 POI 更有"地点感"
      if (c.photoUrl) w *= 1.15;               // 有图的优先（揭晓体验更好）
      pool.push({ poi: c, weight: w, distance: d });
    }
    if (!pool.length) return null;
    var total = 0;
    for (var j = 0; j < pool.length; j += 1) total += pool[j].weight;
    var r = ((seed % 1000) / 1000) * total;
    for (var k = 0; k < pool.length; k += 1) {
      r -= pool[k].weight;
      if (r <= 0) return pool[k].poi;
    }
    return pool[pool.length - 1].poi;
  }

  /** 把多数据源候选点转成可玩的 Place */
  function makeProviderPlace(poi, origin, mood, startMeters) {
    var cat = poi.category && CATEGORY_META[poi.category] ? poi.category : 'plaza';
    var meta = CATEGORY_META[cat];
    var geo = mapPointFor(origin, poi, startMeters);
    var hints = (HINTS[cat] || HINTS.plaza).concat(['就在前面。抬手机，慢慢看。']);
    var shortName = (poi.name || '').slice(0, 2);
    hints = hints.map(function (h) {
      return h.split(poi.name).join('那里').split(shortName).join('那里');
    });
    var hour = new Date().getHours();
    var timeWord = hour < 9 ? '清晨' : hour < 12 ? '上午' : hour < 15 ? '午后'
      : hour < 18 ? '傍晚前' : hour < 21 ? '入夜' : '夜里';
    var sourceName = poi.source === 'amap' ? '高德地图'
      : poi.source === 'baidu' ? '百度地图'
      : poi.source === 'wiki' ? '维基百科'
      : 'OpenStreetMap';
    return {
      id: (poi.source || 'osm') + '-' + (poi.id || (Math.round(poi.lat * 1e5) + '-' + Math.round(poi.lon * 1e5))),
      name: poi.name,
      area: cat === 'river' || cat === 'bridge' ? 'river'
        : (cat === 'art' || cat === 'temple' || cat === 'library' || cat === 'museum' || cat === 'historic' ? 'oldtown' : 'near'),
      category: meta.label,
      categoryEmoji: meta.emoji,
      rarity: meta.rarity,
      why: '你选了「' + (mood === 'drift' ? '放空' : mood === 'discover' ? '发现' : '热闹') + '」，'
        + timeWord + '的' + meta.label + '，是这座城市里真实存在的地方。'
        + (poi.address ? '\n' + poi.address : ''),
      task: meta.task,
      hints: hints,
      mapPoint: { x: geo.x, y: geo.y },
      bearing: geo.bearing,
      distance: geo.distance,
      coordinate: { lat: poi.lat, lon: poi.lon },
      address: poi.address || null,
      photoUrl: poi.photoUrl || null,
      photoCredit: poi.photoCredit || sourceName,
      source: poi.source || 'osm',
      collected: false
    };
  }

  function autoPickLegacy(origin, mood, startMeters, radius, minDistance, maxDistance, seed) {
    // 有旧缓存（Overpass POI）且还能挑出合适的，就直接用，省一次网络
    var cached = readCache(origin.lat, origin.lon);
    if (cached && cached.length) {
      var cachedPick = pick(cached, mood, startMeters, origin);
      if (cachedPick) {
        return Promise.resolve({
          place: makePlace(cachedPick, origin, mood, startMeters),
          cached: true,
          poolSize: cached.length
        });
      }
    }

    // 公开数据双通道：
    //   1) Wikipedia 地理搜索 —— 真实地标名 + 代表图片（首选，通常 300~800ms 返回）
    //   2) Overpass —— 街边小店/长椅等没有维基条目的真实 POI（经常慢到 5s+，不能拖累首选）
    // 策略：先等 wiki（最多 3.2s），拿到就直接用；没有才继续等 Overpass。
    var wikiPromise = wikipediaPOIs(origin, radius).catch(function () { return []; });
    var poiPromise = searchPOIs(origin.lat, origin.lon, radius).catch(function () { return []; });
    var wikiDeadline = new Promise(function (resolve) {
      setTimeout(function () { resolve({ timedOut: true }); }, WIKI_FIRST_BUDGET);
    });

    return Promise.race([
      wikiPromise.then(function (list) { return { wiki: list || [] }; }),
      wikiDeadline
    ]).then(function (first) {
      if (!first || first.timedOut) {
        // Wiki 超过 3.2s：不丢弃它，和 Overpass 一起再等最多 2.5s（整体仍在预算内）
        var lateDeadline = new Promise(function (resolve) {
          setTimeout(function () { resolve({ wiki: [], poi: [] }); }, 2500);
        });
        return Promise.race([
          Promise.all([wikiPromise, poiPromise]).then(function (pair) {
            return { wiki: pair[0] || [], poi: pair[1] || [] };
          }),
          lateDeadline
        ]).then(function (pack) {
          return resolveFromPack(pack.wiki, pack.poi, {
            mood: mood, startMeters: startMeters, origin: origin,
            minDistance: minDistance, maxDistance: maxDistance, seed: seed
          });
        });
      }
      var wikiList = (first && first.wiki) ? first.wiki : [];
      // wiki 有合适地标就立刻用，不陪 Overpass 等
      var wikiPick = pickWiki(wikiList, mood, startMeters, origin, minDistance, maxDistance);
      if (wikiPick) {
        return {
          place: makeWikiPlace(wikiPick, origin, mood, startMeters),
          cached: false,
          poolSize: wikiList.length,
          source: 'wikipedia'
        };
      }
      // wiki 没结果/都不合适 → 等 Overpass（整体不超过 LOOKUP_BUDGET）
      return Promise.race([poiPromise, budgetHit]).then(function (poiList) {
        if (poiList && poiList.length) {
          writeCache(origin.lat, origin.lon, poiList);
          var poiPick = pick(poiList, mood, startMeters, origin);
          if (poiPick) {
            return {
              place: makePlace(poiPick, origin, mood, startMeters),
              cached: false,
              poolSize: poiList.length,
              source: 'osm'
            };
          }
        }
        return { place: proceduralPlace(origin, mood, startMeters, seed), fallback: true, reason: 'no-pick' };
      });
    }).catch(function () {
      return { place: proceduralPlace(origin, mood, startMeters, seed), fallback: true, reason: 'network' };
    });
  }

  /** 从两路候选里按优先级挑：维基地标（有图）> Overpass POI > 真实坐标兜底 */
  function resolveFromPack(wikiList, poiList, ctx) {
    var wikiPick = pickWiki(wikiList, ctx.mood, ctx.startMeters, ctx.origin, ctx.minDistance, ctx.maxDistance);
    if (wikiPick) {
      return {
        place: makeWikiPlace(wikiPick, ctx.origin, ctx.mood, ctx.startMeters),
        cached: false,
        poolSize: wikiList.length,
        source: 'wikipedia'
      };
    }
    if (poiList && poiList.length) {
      writeCache(ctx.origin.lat, ctx.origin.lon, poiList);
      var poiPick = pick(poiList, ctx.mood, ctx.startMeters, ctx.origin);
      if (poiPick) {
        return {
          place: makePlace(poiPick, ctx.origin, ctx.mood, ctx.startMeters),
          cached: false,
          poolSize: poiList.length,
          source: 'osm'
        };
      }
    }
    return { place: proceduralPlace(ctx.origin, ctx.mood, ctx.startMeters, ctx.seed), fallback: true, reason: 'no-pick' };
  }

  /** 从 Wikipedia 地标里挑一个：距离合适 + 类别与心情相容 + 带图片 */
  function pickWiki(candidates, mood, startMeters, origin, minDistance, maxDistance) {
    if (!candidates || !candidates.length) return null;
    var pool = [];
    for (var i = 0; i < candidates.length; i += 1) {
      var c = candidates[i];
      if (!c.photoUrl) continue;
      var d = distanceBetween(origin, c);
      if (d < minDistance || d > maxDistance) continue;
      if (!CATEGORY_META[c.category]) c.category = 'plaza';
      // 心情亲和：放空偏好安静类，热闹偏好广场/市集
      var w = 1;
      if (mood === 'drift' && (c.category === 'park' || c.category === 'river' || c.category === 'temple')) w = 1.6;
      if (mood === 'discover' && (c.category === 'art' || c.category === 'library' || c.category === 'viewpoint')) w = 1.7;
      if (mood === 'lively' && (c.category === 'plaza' || c.category === 'market')) w = 1.6;
      pool.push({ poi: c, weight: w, distance: d });
    }
    if (!pool.length) return null;
    // 加权随机：避免每次都是同一批地标
    var total = 0;
    for (var j = 0; j < pool.length; j += 1) total += pool[j].weight;
    var r = Math.random() * total;
    for (var k = 0; k < pool.length; k += 1) {
      r -= pool[k].weight;
      if (r <= 0) return pool[k].poi;
    }
    return pool[pool.length - 1].poi;
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

  /* ============================================================
     Wikipedia / Wikimedia Commons：公开数据里的真实兴趣点 + 图片
     - 端点公开、无需 API Key、CORS 全开（access-control-allow-origin: *）
     - 一次请求同时拿到：地标名、真实坐标、简介、代表图片
     - 图片只用于「到达后揭晓」和图鉴，绝不提前展示（产品保密规则）
     ============================================================ */
  var WIKI_ENDPOINT = 'https://zh.wikipedia.org/w/api.php';

  /** 第 2 个起用 geo 坐标去重，避免同一地标反复出现 */
  function wikipediaPOIs(location, radiusMeters) {
    var loc = norm(location);
    if (!loc) return Promise.resolve([]);
    var lat = loc.lat, lon = loc.lon;
    var key = 'bw:wiki:' + lat.toFixed(3) + ',' + lon.toFixed(3) + ':' + radiusMeters;
    try {
      var cachedRaw = sessionStorage.getItem(key);
      if (cachedRaw) {
        var cachedParsed = JSON.parse(cachedRaw);
        if (cachedParsed && Date.now() - cachedParsed.t < 6 * 3600 * 1000) {
          return Promise.resolve(cachedParsed.v || []);
        }
      }
    } catch (e) { /* ignore */ }

    var url = WIKI_ENDPOINT +
      '?action=query&format=json&origin=*' +
      '&generator=geosearch' +
      '&ggscoord=' + lat + '%7C' + lon +
      '&ggsradius=' + Math.min(10000, Math.round(radiusMeters)) +
      '&ggslimit=20' +
      '&prop=pageimages%7Ccoordinates%7Cextracts' +
      '&piprop=thumbnail&pithumbsize=800' +
      '&exintro=1&explaintext=1&exchars=120';

    return fetchJSON(url, WIKI_BUDGET).then(function (data) {
      var pages = (data && data.query && data.query.pages) || {};
      var list = [];
      Object.keys(pages).forEach(function (id) {
        var page = pages[id];
        var coord = page.coordinates && page.coordinates[0];
        if (!coord) return;
        var photo = page.thumbnail && page.thumbnail.source;
        if (!photo) return;
        // 过滤：行政区、城市、地铁站、道路 —— 这些不是「一个可以走到的地方」
        if (/[省市县区镇]$/.test(page.title)) return;
        if (/^(中国|上海|北京|广州|深圳|杭州|成都|南京|武汉|西安|重庆|天津|苏州)$/.test(page.title)) return;
        if (/站$|站 \(|号线|铁路|高速公路|立交|隧道|大桥工程/.test(page.title)) return;
        // 去掉维基的括号消歧义后缀：「大世界 (上海市)」→「大世界」
        var displayName = page.title.replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim();
        if (!displayName) return;
        // 只收能正常加载的缩略图域名；原图域名时通时不通，宁可不要
        if (photo.indexOf('thumb.wikimedia.org') < 0 && photo.indexOf('upload.wikimedia.org') < 0) return;
        list.push({
          id: 'wiki-' + (page.pageid || id),
          name: displayName,
          lat: coord.lat,
          lon: coord.lon,
          photoUrl: photo,
          credit: 'Wikimedia Commons',
          summary: (page.extract || '').replace(/\s+/g, ' ').slice(0, 120),
          category: guessCategoryFromTitle(page.title, page.extract || '')
        });
      });
      // 按距离由近到远
      list.sort(function (a, b) {
        return distanceBetween(loc, a) - distanceBetween(loc, b);
      });
      try {
        sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v: list.slice(0, 20) }));
      } catch (e) { /* ignore */ }
      return list;
    }).catch(function () { return []; });
  }

  /** 从标题/简介里猜类别，用于选 emoji / 任务 / 线索 */
  function guessCategoryFromTitle(title, extract) {
    var text = title + ' ' + (extract || '');
    if (/公园|花园|绿地|植物园/.test(text)) return 'park';
    if (/广场/.test(text)) return 'plaza';
    if (/桥/.test(text)) return 'bridge';
    if (/河|江|湖|滨/.test(text)) return 'river';
    if (/教堂|寺|庙|会堂|清真/.test(text)) return 'temple';
    if (/博物|纪念馆|展览馆|陈列馆/.test(text)) return 'museum';
    if (/音乐厅|剧院|剧场|戏院|大戏院|演奏厅/.test(text)) return 'venue';
    if (/美术馆|艺术|画廊/.test(text)) return 'art';
    if (/大学|学院|校区|书院/.test(text)) return 'historic';
    if (/故居|旧址|会址|公馆|洋房|里弄|弄堂|饭店|酒店|宾馆|旅馆/.test(text)) return 'historic';
    if (/图书/.test(text)) return 'library';
    if (/书店/.test(text)) return 'bookstore';
    if (/咖啡/.test(text)) return 'cafe';
    if (/商场|百货|市集|市场/.test(text)) return 'market';
    if (/车站|地铁|站/.test(text)) return 'plaza';
    if (/楼|旧址|故居|大楼|建筑|弄|里/.test(text)) return 'temple';
    if (/塔|观景|天台/.test(text)) return 'viewpoint';
    return 'plaza';
  }



  /* ============================================================
     手动指定位置：地址 → 坐标（GPS 不可用时的「真实地点」出口）
     Nominatim 优先，失败换 Photon；都失败返回 null
     ============================================================ */
  function geocodeAddress(rawQuery) {
    var query = (rawQuery || '').trim();
    if (!query) return Promise.resolve(null);

    // 直接输坐标：31.23,121.47
    var coordMatch = query.match(/^\s*(-?\d{1,2}\.\d+)\s*[,， ]\s*(-?\d{2,3}\.\d+)\s*$/);
    if (coordMatch) {
      return Promise.resolve({
        lat: parseFloat(coordMatch[1]),
        lon: parseFloat(coordMatch[2]),
        label: '你输入的位置',
        source: 'manual'
      });
    }

    var nominatim = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=zh-CN&q=' +
      encodeURIComponent(query);
    return fetchJSON(nominatim, 6000).then(function (list) {
      if (Array.isArray(list) && list.length) {
        return {
          lat: parseFloat(list[0].lat),
          lon: parseFloat(list[0].lon),
          label: list[0].display_name || query,
          source: 'nominatim'
        };
      }
      return geocodePhoton(query);
    }).catch(function () {
      return geocodePhoton(query);
    });
  }

  function geocodePhoton(query) {
    return fetchJSON('https://photon.komoot.io/api/?limit=1&lang=zh&q=' + encodeURIComponent(query), 6000)
      .then(function (data) {
        var f = data && data.features && data.features[0];
        if (!f) return null;
        var c = f.geometry && f.geometry.coordinates;
        if (!c) return null;
        var p = f.properties || {};
        var label = [p.name, p.street, p.district, p.city].filter(Boolean).join(' · ') || query;
        return { lat: c[1], lon: c[0], label: label, source: 'photon' };
      })
      .catch(function () { return null; });
  }

  /* ============================================================
     步行路线与转向指令（Valhalla 公共实例，CORS 全开、无需 Key）
     - 目的：不再画地图，只给「还有多少米 / 再过多少米往哪拐」
     - 失败时返回 null，由上层退回「朝某方向走 + 距离」
     ============================================================ */
  var ROUTE_ENDPOINT = 'https://valhalla1.openstreetmap.de/route';
  var ROUTE_TIMEOUT = 6000;
  var routeCache = {};          // key: 起点网格 + 终点 → { t, route }

  /** Valhalla maneuver.type → 简化的转向语义 */
  var MANEUVER_DIRECTION = {
    1: 'start', 2: 'start', 3: 'start',
    4: 'arrive', 5: 'arrive', 6: 'arrive',
    7: 'straight', 8: 'straight',
    9: 'slight-right', 10: 'right', 11: 'sharp-right',
    12: 'uturn', 13: 'uturn',
    14: 'sharp-left', 15: 'left', 16: 'slight-left',
    18: 'right', 19: 'left',
    20: 'right', 21: 'left',
    22: 'straight', 23: 'slight-right', 24: 'slight-left',
    25: 'straight', 26: 'roundabout', 27: 'roundabout',
    37: 'straight', 38: 'straight', 39: 'straight', 40: 'straight'
  };

  /** 方向的中文说法（用于「30 米后左拐」） */
  var DIRECTION_LABEL = {
    start: '出发',
    straight: '直行',
    'slight-right': '向右前方',
    right: '右拐',
    'sharp-right': '向右大拐',
    'slight-left': '向左前方',
    left: '左拐',
    'sharp-left': '向左大拐',
    uturn: '掉头',
    roundabout: '走环岛',
    arrive: '到达'
  };

  /** Valhalla 的 shape 是 polyline6 编码，解码成 [lon, lat] 数组 */
  function decodePolyline6(encoded) {
    if (!encoded || typeof encoded !== 'string') return [];
    var index = 0;
    var lat = 0;
    var lon = 0;
    var coords = [];
    var len = encoded.length;
    while (index < len) {
      var shift = 0;
      var result = 0;
      var byte = 0;
      do {
        byte = encoded.charCodeAt(index) - 63;
        index += 1;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index < len);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);
      shift = 0;
      result = 0;
      byte = 0;
      do {
        byte = encoded.charCodeAt(index) - 63;
        index += 1;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index < len);
      lon += (result & 1) ? ~(result >> 1) : (result >> 1);
      coords.push([lon / 1e6, lat / 1e6]);
    }
    return coords;
  }

  /**
   * 把当前位置投影到路线上，得到「沿路线已经走了多少米 / 偏离路线多少米」。
   * 有了它，转向提示才能按真实里程触发，而不是用直线距离猜。
   */
  function routeProgress(route, hereRaw) {
    var here = norm(hereRaw);
    if (!route || !route.points || route.points.length < 2 || !here) return null;
    var pts = route.points;
    var best = { distance: Infinity, walked: 0, offRoute: 0, index: 0, t: 0, lat: here.lat, lon: here.lon, bearing: 0 };
    var walked = 0;
    for (var i = 0; i < pts.length - 1; i += 1) {
      var ax = pts[i][0];
      var ay = pts[i][1];
      var bx = pts[i + 1][0];
      var by = pts[i + 1][1];
      var segMeters = distanceBetween({ lat: ay, lon: ax }, { lat: by, lon: bx });
      // 以米为单位的平面近似（在本城市尺度足够）
      var kx = Math.cos(here.lat * Math.PI / 180) * 111320;
      var ky = 110540;
      var px = here.lon * kx;
      var py = here.lat * ky;
      var axm = ax * kx;
      var aym = ay * ky;
      var bxm = bx * kx;
      var bym = by * ky;
      var vx = bxm - axm;
      var vy = bym - aym;
      var segLen2 = vx * vx + vy * vy;
      var t = 0;
      if (segLen2 > 0) t = ((px - axm) * vx + (py - aym) * vy) / segLen2;
      t = Math.max(0, Math.min(1, t));
      var cx = axm + vx * t;
      var cy = aym + vy * t;
      var dist = Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
      if (dist < best.distance) {
        best.distance = dist;
        best.walked = walked + segMeters * t;
        best.offRoute = dist;
        best.index = i;
        best.t = t;
        // 吸附到路径上的点 + 这一段的行进朝向（用于画「你」的箭头）
        best.lat = (ay + (by - ay) * t);
        best.lon = (ax + (bx - ax) * t);
        // 这一段的行进朝向（0=正北，顺时针）
        var lat1r = ay * Math.PI / 180;
        var lat2r = by * Math.PI / 180;
        var dLonr = (bx - ax) * Math.PI / 180;
        var yy = Math.sin(dLonr) * Math.cos(lat2r);
        var xx = Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLonr);
        best.bearing = (Math.atan2(yy, xx) * 180 / Math.PI + 360) % 360;
      }
      walked += segMeters;
    }
    return {
      walked: best.walked,
      offRoute: best.offRoute,
      total: walked,
      index: best.index,
      t: best.t,
      snappedLat: best.lat,
      snappedLon: best.lon,
      bearing: best.bearing
    };
  }

  /**
   * 取一条步行路线。
   * @returns Promise<{distanceMeters, maneuvers: Array<{direction,label,cumulative,lat,lon,distance}>} | null>
   */
  function fetchRoute(fromRaw, toRaw) {
    var from = norm(fromRaw);
    var to = norm(toRaw);
    if (!from || !to) return Promise.resolve(null);
    var key = from.lat.toFixed(3) + ',' + from.lon.toFixed(3) + '->' + to.lat.toFixed(4) + ',' + to.lon.toFixed(4);
    var cached = routeCache[key];
    if (cached && Date.now() - cached.t < 10 * 60 * 1000) return Promise.resolve(cached.route);

    var body = {
      locations: [{ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }],
      costing: 'pedestrian',
      units: 'kilometers',
      shape_format: 'geojson'
    };
    return fetchJSON(ROUTE_ENDPOINT, ROUTE_TIMEOUT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (data) {
      var leg = data && data.trip && data.trip.legs && data.trip.legs[0];
      if (!leg || !Array.isArray(leg.maneuvers) || !leg.maneuvers.length) return null;
      var points = decodePolyline6(leg.shape);
      var cumulative = 0;
      var maneuvers = [];
      for (var i = 0; i < leg.maneuvers.length; i += 1) {
        var m = leg.maneuvers[i];
        var meters = Math.max(0, Math.round((m.length || 0) * 1000));
        var loc = (m.begin_shape_index !== undefined && points[m.begin_shape_index] !== undefined)
          ? points[m.begin_shape_index]
          : null;
        var direction = MANEUVER_DIRECTION[m.type] || 'straight';
        maneuvers.push({
          direction: direction,
          label: DIRECTION_LABEL[direction] || '直行',
          distance: meters,                 // 这一段有多长
          cumulative: cumulative,           // 从起点算起，到这个转向点的距离
          lat: loc ? loc[1] : null,
          lon: loc ? loc[0] : null
        });
        cumulative += meters;
      }
      var route = {
        distanceMeters: Math.round((leg.summary && leg.summary.length ? leg.summary.length : cumulative / 1000) * 1000),
        maneuvers: maneuvers,
        points: points
      };
      routeCache[key] = { t: Date.now(), route: route };
      return route;
    }).catch(function () { return null; });
  }

  /**
   * 根据「已走距离」算出当前该给什么指令。
   * @returns {{ kind, main, sub, turnInMeters, direction, emphasis } | null}
   */
  function guidanceFor(route, walkedMeters) {
    if (!route || !route.maneuvers || !route.maneuvers.length) return null;
    var ms = route.maneuvers;
    var walked = Math.max(0, walkedMeters);
    var i = 0;
    while (i + 1 < ms.length && walked >= ms[i + 1].cumulative - 4) i += 1;
    var current = ms[i];
    var next = ms[i + 1] || null;
    if (!next) {
      return { kind: 'arrive', main: '就在前面', sub: '再走几步就到了', turnInMeters: 0, direction: 'arrive', emphasis: true };
    }
    var turnIn = Math.max(0, Math.round(next.cumulative - walked));
    // 到达提示
    if (next.direction === 'arrive') {
      return {
        kind: 'arrive',
        main: turnIn <= 25 ? '就在前面' : turnIn + ' 米就到了',
        sub: turnIn <= 25 ? '抬头看看周围' : '沿着这条路一直走',
        turnInMeters: turnIn,
        direction: 'arrive',
        emphasis: turnIn <= 25
      };
    }

    var label = next.label;
    var straightish = (next.direction === 'straight' || next.direction === 'slight-left' || next.direction === 'slight-right');
    var main;
    var sub;
    if (straightish) {
      main = turnIn > 120 ? '继续直行' : '继续直行 ' + turnIn + ' 米';
      sub = '保持在同一条路上';
    } else if (turnIn <= 12) {
      main = '现在' + label;
      sub = '拐过去继续走';
    } else if (turnIn <= 45) {
      main = turnIn + ' 米后' + label;      // 提前量：45 米内就提示
      sub = '注意路口';
    } else {
      main = '继续直行';
      sub = turnIn + ' 米后' + label;
    }
    return {
      kind: straightish ? 'straight' : 'turn',
      main: main,
      sub: sub,
      turnInMeters: turnIn,
      direction: next.direction,
      emphasis: turnIn <= 25 && !straightish
    };
  }

  /** 把方向转成箭头 */
  function directionArrow(direction) {
    switch (direction) {
      case 'left': case 'sharp-left': return '↰';
      case 'slight-left': return '↖';
      case 'right': case 'sharp-right': return '↱';
      case 'slight-right': return '↗';
      case 'uturn': return '⟲';
      case 'roundabout': return '↻';
      case 'arrive': return '◉';
      default: return '↑';
    }
  }

  function distanceBetween(a, b) {
    var R = 6371000;
    var lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180;
    var dLat = (b.lat - a.lat) * Math.PI / 180;
    var dLon = (b.lon - a.lon) * Math.PI / 180;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
  }

  /** 带超时的 JSON 请求（CORS JSON 端点） */
  function fetchJSON(url, budgetMs, options) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('timeout'));
      }, budgetMs || 5000);
      var init = { mode: 'cors', credentials: 'omit' };
      if (options) {
        if (options.method) init.method = options.method;
        if (options.headers) init.headers = options.headers;
        if (options.body) init.body = options.body;
      }
      fetch(url, init)
        .then(function (res) {
          if (!res.ok) throw new Error('http ' + res.status);
          return res.json();
        })
        .then(function (json) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(json);
        })
        .catch(function (err) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /** 把 Wikipedia POI 变成可玩的 Place（含图片） */
  function makeWikiPlace(poi, origin, mood, startMeters) {
    var meta = CATEGORY_META[poi.category] || CATEGORY_META.plaza;
    var geo = mapPointFor(origin, poi, startMeters);
    var hints = (HINTS[poi.category] || HINTS.plaza).concat(['就在前面。抬手机，慢慢看。']);
    var shortName = poi.name.slice(0, 2);
    hints = hints.map(function (h) {
      return h.split(poi.name).join('那里').split(shortName).join('那里');
    });
    var hour = new Date().getHours();
    var timeWord = hour < 9 ? '清晨' : hour < 12 ? '上午' : hour < 15 ? '午后'
      : hour < 18 ? '傍晚前' : hour < 21 ? '入夜' : '夜里';
    var moodWord = mood === 'drift' ? '你选了「放空」，这里适合什么都不想。'
      : mood === 'discover' ? '你选了「发现」，这里不是游客会停下来的地方。'
      : '你选了「热闹」，这个时间这里不会太冷清。';
    return {
      id: poi.id,
      name: poi.name,
      area: poi.category === 'river' || poi.category === 'bridge' ? 'river'
        : (poi.category === 'art' || poi.category === 'temple' || poi.category === 'library' ? 'oldtown' : 'near'),
      category: meta.label,
      categoryEmoji: meta.emoji,
      rarity: meta.rarity,
      why: moodWord + '\n' + timeWord + '的' + meta.label + '，是这座城市里留下过痕迹的地方。'
        + (poi.summary ? '\n' + poi.summary : ''),
      task: meta.task,
      hints: hints,
      mapPoint: { x: geo.x, y: geo.y },
      bearing: geo.bearing,
      distance: geo.distance,
      coordinate: { lat: poi.lat, lon: poi.lon },
      address: null,
      photoUrl: poi.photoUrl,
      photoCredit: poi.credit,
      source: 'wikipedia',
      collected: false
    };
  }


  window.BW_GEO = {
    findRealPlace: findRealPlace,
    searchPOIs: searchPOIs,
    proceduralPlace: proceduralPlace,
    wikipediaPOIs: wikipediaPOIs,
    makeWikiPlace: makeWikiPlace,
    loadCuratedPOIs: loadCuratedPOIs,
    geocodeAddress: geocodeAddress,
    fetchRoute: fetchRoute,
    routeProgress: routeProgress,
    guidanceFor: guidanceFor,
    directionArrow: directionArrow,
    enrichWithAddress: enrichWithAddress,
    reverseGeocode: reverseGeocode,
    makePlace: makePlace,
    distanceOf: function (a, b) {
      var na = norm(a), nb = norm(b);
      if (!na || !nb) return null;
      return distanceBetween(na, nb);
    },
    CATEGORY_META: CATEGORY_META,
    readCache: readCache,
    gridKey: gridKey
  };
})();
