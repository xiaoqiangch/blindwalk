/* 盲走 BlindWalk · Web 高保真原型（零依赖，file:// 可直接运行）
 * 单页 hash 路由 + localStorage 持久化 + 演示/新用户两种状态。
 * 视觉与文案依据：docs/design-system.md；数据：data.js（镜像 apple/Shared/Core）。
 */
(function () {
  'use strict';

  var D = window.BW_DATA;
  var STORE_KEY = 'blindwalk:v1';
  var APP_VERSION = 'v36';
  var APP_BUILT_AT = '2026-11-09 14:10';

  var ROUTES = ['/home', '/setup', '/journey', '/reveal', '/cards', '/social', '/profile', '/debug',
    '/achievements', '/watch', '/bury', '/seek', '/seek-detail', '/surprises', '/account', '/datasource'];
  var TAB_ROUTES = ['/home', '/cards', '/social', '/profile'];
  var LEVEL_NAMES = ['出门新手', '街角观察员', '城市漫游者', '惊喜收藏家', '迷雾探险家',
    '黄昏猎人', '夜路诗人', '盲走大师', '城市传说', '盲盒之神'];

  var dom = {};
  var state = null;
  var ui = {
    route: '/home',
    filter: 'all',
    duration: 30,
    mood: 'drift',
    area: 'near',
    paused: false,
    pausedElapsed: 0,
    newHint: -1,
    revealPhase: null,
    arriving: false,
    shaking: false,
    boardOpen: false,
    /* 埋惊喜 / 寻惊喜 */
    myLocation: null,
    buryLocation: null,
    seekShot: null,
    demoArrived: false,
    seekID: null,
    geoWatch: null,
    lastHeading: null,
    geoAsked: false,
    geoErrorShown: false,
    geoErrorCount: 0,
    lastFix: null,
    geoPoll: null,
    geoSaveAt: 0,
    autoShake: false,
    route: null,
    routePlaceID: null,
    routeWalkedMeters: 0,
    routeManeuversStart: null,
    routeOffRoute: 0,
    locationBlocked: false,
    locationReason: ''
  };
  var timers = { journey: null, reveal: [] };

  /* ============================================================
     小工具
     ============================================================ */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function startOfDay(ms) {
    var d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function formatClock() {
    var d = new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function fmtElapsed(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    return pad2(Math.floor(total / 3600)) + ':' + pad2(Math.floor((total % 3600) / 60)) + ':' + pad2(total % 60);
  }

  function formatShortDate(ms) {
    var d = new Date(ms);
    return pad2(d.getMonth() + 1) + '.' + pad2(d.getDate());
  }

  function relativeDay(ms) {
    var days = Math.round((startOfDay(Date.now()) - startOfDay(ms)) / 86400000);
    if (days <= 0) return '就是今天';
    if (days === 1) return '昨天';
    return '已是 ' + days + ' 天前';
  }

  function relativeTime(ms) {
    var diff = Math.max(0, Date.now() - ms);
    var minutes = Math.floor(diff / 60000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return minutes + ' 分钟前';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + ' 小时前';
    var days = Math.floor(hours / 24);
    if (days === 1) return '昨天';
    return days + ' 天前';
  }

  function greeting() {
    var hour = new Date().getHours();
    if (hour < 5) return '夜里的';
    if (hour < 11) return '早上好';
    if (hour < 13) return '中午好';
    if (hour < 18) return '下午好';
    return '晚上好';
  }

  function randomSerial() {
    return String(Math.floor(Math.random() * 9000) + 100).padStart(4, '0');
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        v: 1,
        profile: state.profile,
        session: state.session,
        reveal: state.reveal,
        feed: state.feed,
        surprises: state.surprises,
        realPlaces: state.realPlaces,
        settings: state.settings,
        demoSeeded: !!state.demoSeeded
      }));
    } catch (err) { /* file:// 隐私模式等场景忽略 */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || data.v !== 1 || !data.profile) return null;
      // 向后兼容：旧数据没有 surprises 字段
      if (!Array.isArray(data.surprises)) data.surprises = [];
      if (!data.realPlaces || typeof data.realPlaces !== 'object') data.realPlaces = {};
      data.demoSeeded = !!data.demoSeeded;
      return data;
    } catch (err) { return null; }
  }


  /* ============================================================
     地点查询：内置虚构地点 + 真实 POI 快照
     真实地点在抽到时会把完整对象存进 state.realPlaces，
     之后图鉴/揭晓/旅程都用这里查，不再依赖 D.PLACE_MAP。
     ============================================================ */
  function placeOf(id) {
    if (!id) return null;
    var real = state.realPlaces && state.realPlaces[id];
    if (real) return real;
    return D.PLACE_MAP[id] || null;
  }

  /* ============================================================
     派生数据
     ============================================================ */
  function levelInfo() {
    var xp = state.profile.xp;
    var level = Math.max(1, Math.floor(xp / 800) + 1);
    var floorXP = (level - 1) * 800;
    var into = clamp(xp - floorXP, 0, 800);
    return {
      level: level,
      floorXP: floorXP,
      into: into,
      pct: into / 800,
      name: LEVEL_NAMES[Math.min(level - 1, LEVEL_NAMES.length - 1)]
    };
  }

  function rareCount() {
    return state.profile.cards.filter(function (card) {
      var place = placeOf(card.placeID);
      return place && place.rarity !== 'common';
    }).length;
  }

  function hiddenCount() {
    return state.profile.cards.filter(function (card) {
      var place = placeOf(card.placeID);
      return place && place.rarity === 'hidden';
    }).length;
  }

  function myPostCount() {
    return state.feed.filter(function (post) { return post.isMine; }).length;
  }

  function weeklySurprise() {
    /* 按「自然日」而不是「7×24 小时」统计：今天 06:33 打开时，
       用小时差会把 7 天前 19:12 那次算进窗口（8 次 → 325），与设计口径 305 不一致。*/
    var today = startOfDay(Date.now());
    var seen = {};
    var days = 0;
    state.profile.walkArrivalTimes.forEach(function (t) {
      if (days >= 7) return;
      var key = startOfDay(t);
      var gap = Math.round((today - key) / 86400000);
      if (gap < 0 || gap >= 7 || seen[key]) return;
      seen[key] = true;
      days += 1;
    });
    var tasks = state.profile.cards.filter(function (card) { return card.taskDone; }).length;
    return days * 20 + rareCount() * 15 + tasks * 5;
  }

  function latestCard() {
    if (!state.profile.cards.length) return null;
    return state.profile.cards.slice().sort(function (a, b) { return b.collectedAt - a.collectedAt; })[0];
  }

  function achievementProgress(id) {
    var p = state.profile;
    switch (id) {
      case 'first_box':
      case 'walker_10': return p.boxesOpened;
      case 'rare_first': return rareCount();
      case 'hidden_first': return hiddenCount();
      case 'early_bird':
        return p.walkArrivalTimes.some(function (t) { return new Date(t).getHours() < 7; }) ? 1 : 0;
      case 'night_owl':
        return p.walkArrivalTimes.some(function (t) { return new Date(t).getHours() >= 22; }) ? 1 : 0;
      case 'streak_7': return p.streakDays;
      case 'together_1': return p.togetherCount;
      case 'share_3': return myPostCount();
      case 'km_100': return Math.floor(p.totalKm);
      case 'bury_1': return myBuryCount();
      case 'seek_3': return myFoundCount();
      case 'found_5': return mySurprisesFoundCount();
      default: return 0;
    }
  }

  function achievementList() {
    return D.ACHIEVEMENTS.map(function (def) {
      var progress = Math.min(achievementProgress(def.id), def.target);
      return {
        def: def,
        progress: progress,
        unlocked: !!state.profile.achievements[def.id]
      };
    });
  }

  function syncAchievements() {
    var newly = [];
    D.ACHIEVEMENTS.forEach(function (def) {
      var progress = Math.min(achievementProgress(def.id), def.target);
      if (!state.profile.achievements[def.id] && progress >= def.target) {
        state.profile.achievements[def.id] = Date.now();
        newly.push(def);
      }
    });
    return newly;
  }

  function unlockedAchievements() {
    return achievementList().filter(function (item) { return item.unlocked; });
  }

  function areaOf(placeID) {
    var place = placeOf(placeID);
    return place ? place.area : 'near';
  }

  function placeAreaWord(place) {
    return D.AREA_MAP[place.area] ? D.AREA_MAP[place.area].word : '';
  }

  function rarityOf(place) {
    return D.RARITY[place.rarity];
  }

  /* ============================================================
     状态种子 / 持久化
     ============================================================ */
  function freshState() {
    // 说明：demoSeeded 标记本机数据是否来自「演示种子」，
    // 用于在界面上诚实提示，并提供一键切回真实定位的出口。
    return {
      profile: {
        displayName: '阿澈',
        xp: 0,
        streakDays: 0,
        totalKm: 0,
        boxesOpened: 0,
        cards: [],
        achievements: {},
        walkArrivalTimes: [],
        togetherCount: 0,
        lastWalkAt: null
      },
      session: null,
      reveal: null,
      feed: [],
      realPlaces: {},
      surprises: [],
      pendingBury: null,
      pendingSeek: null,
      settings: { sound: true, haptic: true }
    };
  }

  function seedFresh() {
    state = freshState();
    try { localStorage.removeItem(STORE_KEY); } catch (err) { /* ignore */ }
    save();   // 新用户也立即有一条完整存档，账号同步才有内容
  }

  function seedDemo() {
    state = freshState();
    state.demoSeeded = true;
    var now = Date.now();
    state.profile.xp = D.DEMO.xp;
    state.profile.streakDays = D.DEMO.streakDays;
    state.profile.totalKm = D.DEMO.totalKm;
    state.profile.boxesOpened = D.DEMO.boxesOpened;
    state.profile.togetherCount = D.DEMO.togetherCount;
    state.profile.displayName = D.DEMO.displayName;

    state.profile.cards = D.DEMO_ORDER.map(function (placeID) {
      var place = placeOf(placeID);
      return {
        placeID: placeID,
        serial: place.serial,
        collectedAt: new Date(place.date + 'T12:00:00').getTime(),
        taskDone: place.taskDone
      };
    });

    /* 12 天连续到达：最近 7 天各 1 次（保证本周惊喜值 305），含清晨与深夜各一次 */
    state.profile.walkArrivalTimes = D.DEMO.arrivals.map(function (entry) {
      // 以「本地今天零点」为基准减 N 天，再设成当时刻
      var base = new Date();
      base.setHours(0, 0, 0, 0);
      base.setDate(base.getDate() - entry.daysAgo);
      base.setHours(entry.hour, entry.minute, 0, 0);
      // 今天那次的时刻可能还没到（例如早上打开）：夹到「现在之前一分钟」，
      // 仍归属今天，保证最近 7 个自然日各 1 次，而不是被回退成昨天造成重复。
      if (base.getTime() > now) return now - 60000;
      return base.getTime();
    });
    state.profile.lastWalkAt = state.profile.walkArrivalTimes[0];

    /* 埋惊喜演示数据：合并预置的「别人埋的」，以及「自己已埋过的」统计 */
    state.surprises = D.DEMO_SURPRISES.map(function (item) {
      return Object.assign({}, item, { createdAt: item.createdAt });
    });

    state.session = {
      placeID: D.DEMO.session.placeID,
      totalMeters: D.DEMO.session.totalMeters,
      remainingMeters: D.DEMO.session.remainingMeters,
      unlockedHintCount: D.DEMO.session.unlockedHintCount,
      phase: D.DEMO.session.phase,
      startedAt: now - D.DEMO.session.startedAgoSeconds * 1000,
      demo: true
    };

    /* 动态流：本人 2 条置顶 + 好友 4 条（design-system §7） */
    state.feed = D.DEMO.minePosts.map(function (post, index) {
      return makeFeedPost(post, index, now);
    }).concat(D.MOCK_POSTS.map(function (post) {
      return makeFeedPost(post, 2, now);
    }));

    state.profile.achievements = {};
    syncAchievements();
    save();
  }

  function makeFeedPost(source, index, now) {
    return {
      id: source.id || ('post-' + index + '-' + now),
      authorName: source.authorName,
      authorEmoji: source.authorEmoji,
      placeName: source.placeName,
      categoryEmoji: source.categoryEmoji,
      rarity: source.rarity,
      caption: source.caption,
      createdAt: now - (source.agoSeconds || 0) * 1000,
      reactions: {
        eyes: source.reactions.eyes,
        heart: source.reactions.heart,
        next: source.reactions.next
      },
      reacted: {},
      isMine: !!source.isMine
    };
  }

  function hydrate(saved) {
    var base = freshState();
    state = {
      profile: Object.assign(base.profile, saved.profile || {}),
      session: saved.session || null,
      reveal: saved.reveal || null,
      feed: Array.isArray(saved.feed) ? saved.feed : [],
      realPlaces: (saved.realPlaces && typeof saved.realPlaces === 'object') ? saved.realPlaces : {},
      surprises: Array.isArray(saved.surprises) ? saved.surprises : [],
      demoSeeded: !!saved.demoSeeded,
      pendingBury: null,
      pendingSeek: null,
      settings: Object.assign(base.settings, saved.settings || {})
    };
    state.profile.achievements = state.profile.achievements || {};
    state.profile.cards = state.profile.cards || [];
    state.profile.walkArrivalTimes = state.profile.walkArrivalTimes || [];
    state.profile.achievements = state.profile.achievements || {};
    syncAchievements();
  }

  /* ============================================================
     抽盒引擎（本地规则，镜像 BlindBoxEngine 的意图）
     ============================================================ */
  /** 程序化触发一次摇盒（复用 autoShake 流程） */
  function bwShakeNow() {
    ui.autoShake = true;
    render();
  }

  function drawPlace() {
    var duration = D.DURATIONS.filter(function (d) { return d.id === ui.duration; })[0] || D.DURATIONS[1];
    var pool = D.PLACES.filter(function (place) { return place.area === ui.area; });
    if (!pool.length) pool = D.PLACES.slice();

    var recent = {};
    var weekAgo = Date.now() - 7 * 86400000;
    state.profile.cards.forEach(function (card) {
      if (card.collectedAt >= weekAgo) recent[card.placeID] = true;
    });

    var fresh = pool.filter(function (place) { return !recent[place.id]; });
    var candidates = fresh.length ? fresh : pool;

    var bag = [];
    candidates.forEach(function (place) {
      var weight = D.RARITY[place.rarity].weight;
      if (place.rarity === 'hidden' && duration.id !== 60) weight = 0;
      if (ui.mood === 'discover' && (place.rarity === 'rare' || place.rarity === 'epic')) weight *= 1.8;
      if (ui.mood === 'drift' && place.rarity === 'common') weight *= 1.5;
      if (ui.mood === 'lively' && (place.area === 'near' || place.category === '篮球场')) weight *= 1.3;
      if (weight > 0) bag.push({ place: place, weight: weight });
    });

    if (!bag.length) {
      bag = candidates.map(function (place) {
        return { place: place, weight: D.RARITY[place.rarity].weight || 1 };
      });
    }

    var total = bag.reduce(function (sum, entry) { return sum + entry.weight; }, 0);
    var roll = Math.random() * total;
    for (var i = 0; i < bag.length; i += 1) {
      roll -= bag[i].weight;
      if (roll <= 0) return bag[i].place;
    }
    return bag[bag.length - 1].place;
  }

  function startSession(place, meta) {
    var duration = D.DURATIONS.filter(function (d) { return d.id === ui.duration; })[0] || D.DURATIONS[1];
    // 真实地点（真实 POI 或真实坐标）：把完整对象存起来（之后 placeOf 能查到）
    if (place.source === 'osm' || place.source === 'geo' || place.coordinate) {
      state.realPlaces = state.realPlaces || {};
      state.realPlaces[place.id] = place;
    }
    state.session = {
      placeID: place.id,
      totalMeters: duration.startMeters,
      remainingMeters: duration.startMeters,
      unlockedHintCount: 1,
      phase: 'walking',
      startedAt: Date.now(),
      demo: false,
      source: place.source || (meta && meta.source) || 'catalog',
      coordinate: place.coordinate || null,
      bearing: place.bearing || null
    };
    state.reveal = null;
    ui.newHint = -1;
    ui.paused = false;
    ui.arriving = false;
    save();
  }

  /* ============================================================
     旅程推进
     ============================================================ */
  function advanceSession(meters) {
    var session = state.session;
    if (!session || session.phase !== 'walking') return [];
    var events = [];
    var next = Math.round(clamp(session.remainingMeters - Math.abs(meters), 0, session.totalMeters));
    session.remainingMeters = Math.round(next);

    while (session.unlockedHintCount < 3) {
      var threshold = D.HINT_THRESHOLDS[session.unlockedHintCount];
      if (next <= threshold) {
        session.unlockedHintCount += 1;
        events.push({ type: 'hint', index: session.unlockedHintCount - 1 });
      } else break;
    }
    if (next <= D.ARRIVE_THRESHOLD && session.phase === 'walking') {
      session.phase = 'arrived';
      events.push({ type: 'arrived' });
    }
    return events;
  }

  /* 真实定位：把「到目标的真实距离」作为剩余里程的唯一依据。
     旧实现用 advanceSession(prev - d) + Math.abs()，当 d > prev 时会反向外推，
     连续回调把剩余里程推到 0 —— 用户没动也会自动到达。这里彻底改掉。 */
  /**
   * 推进真实旅程。
   * @param distanceMeters 显示用的剩余里程（有路线时是「沿路线剩余」，否则是直线距离）
   * @param accuracy 定位精度
   * @param straightMeters 到目的地的直线距离（只用于「到达」判定，避免路线绕远时误判）
   */
  function applyRealDistance(distanceMeters, accuracy, straightMeters) {
    var session = state.session;
    if (!session || session.phase !== 'walking') return [];
    var d = Math.round(distanceMeters);

    // 首次定位（或目标距离与总里程差得离谱）→ 用真实距离重置基线，
    // 保证进度条从 0 开始，且不会因为「抽盒时用的旧位置」而瞬间到达。
    if (!session.geoBaselineSet) {
      session.totalMeters = Math.max(d, D.ARRIVE_THRESHOLD + 10);
      session.geoBaselineSet = true;
    }

    var prev = session.remainingMeters;
    var next = Math.round(clamp(d, 0, session.totalMeters));
    session.remainingMeters = next;

    var events = [];
    while (session.unlockedHintCount < 3) {
      var threshold = D.HINT_THRESHOLDS[session.unlockedHintCount];
      if (next <= threshold) {
        session.unlockedHintCount += 1;
        events.push({ type: 'hint', index: session.unlockedHintCount - 1 });
      } else break;
    }

    // 到达判定：用「直线距离」而不是路线里程，且要求精度够 + 连续两次在圈内
    var accurate = (typeof accuracy !== 'number') || (accuracy >= 0 && accuracy <= 80);
    var straight = typeof straightMeters === 'number' ? Math.round(straightMeters) : d;
    session.straightMeters = straight;
    if (straight <= D.ARRIVE_THRESHOLD && accurate) {
      session.arriveHits = (session.arriveHits || 0) + 1;
      if (session.arriveHits >= 2) {
        session.phase = 'arrived';
        events.push({ type: 'arrived' });
      }
    } else {
      session.arriveHits = 0;
    }
    session.lastFixAccuracy = typeof accuracy === 'number' ? accuracy : null;
    // 节流持久化：进度必须落盘，否则刷新/切后台回来会丢失里程
    if (!ui.geoSaveAt || Date.now() - ui.geoSaveAt > 3000) {
      ui.geoSaveAt = Date.now();
      save();
    }
    return events;
  }

  /** 为当前真实会话准备步行路线（失败就退回方向引导） */
  function ensureRoute(session) {
    if (!session || !session.coordinate || !window.BW_GEO || !window.BW_GEO.fetchRoute) return;
    if (state.routePlaceID === session.placeID && state.route) return;
    var origin = ui.lastFix || ui.myLocation;
    if (!origin) return;
    state.routePlaceID = session.placeID;
    state.routeManeuversStart = { lat: origin.lat, lon: (origin.lon !== undefined ? origin.lon : origin.lng) };
    state.routeState = 'loading';
    window.BW_GEO.fetchRoute(
      { lat: origin.lat, lon: (origin.lon !== undefined ? origin.lon : origin.lng) },
      session.coordinate
    ).then(function (route) {
      if (!route) { state.routeState = 'failed'; patchNav(state.session); return; }
      state.route = route;
      state.routeState = 'ready';
      state.routeWalkedMeters = 0;
      if (currentRoute() === '/journey') renderJourney(true);
    }).catch(function () { state.routeState = 'failed'; patchNav(state.session); });
  }

  /** 把当前位置投影到路线上，得到沿线已走距离与偏离距离 */
  function updateRouteProgress(session, here) {
    if (!state.route || !window.BW_GEO.routeProgress) return;
    var progress = window.BW_GEO.routeProgress(state.route, here);
    if (!progress) return;
    state.routeWalkedMeters = Math.max(0, Math.min(state.route.distanceMeters, progress.walked));
    state.routeOffRoute = progress.offRoute;

    // 偏离路线太远（走错路/抄近道）：限频重算一次
    if (progress.offRoute > 80) {
      var now = Date.now();
      if (!ui.routeRefreshAt || now - ui.routeRefreshAt > 45000) {
        ui.routeRefreshAt = now;
        state.route = null;
        state.routePlaceID = null;
        ensureRoute(session);
      }
    }
  }

  /** 把一次定位读数应用到会话（watch 回调 / 初始读数共用） */
  function applyFixToSession(pos) {
    window.__bwStat = window.__bwStat || { starts: 0, fixes: 0, early: '', src: '', hasTarget: false };
    window.__bwStat.fixes += 1;
    var session = state.session;
    if (!session || session.phase !== 'walking' || !session.coordinate) return;
    var here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    ui.myLocation = here;
    ui.lastFix = { lat: here.lat, lon: here.lon, accuracy: pos.coords.accuracy };
    ui.geoErrorCount = 0;
    startGeoRecheck();
    var target = session.coordinate;
    var d = window.BW_GEO && window.BW_GEO.distanceOf
      ? window.BW_GEO.distanceOf(here, target)
      : null;
    if (d === null || d === undefined) return;
    var heading = pos.coords.heading;
    ui.lastHeading = (heading === null || isNaN(heading)) ? null : heading;
    if (!state.route) ensureRoute(session);
    updateRouteProgress(session, here);

    // 统一口径：有路线时「剩余里程」= 沿路线剩余；没有路线才用直线距离。
    // 到达判定永远用直线距离（路线可能绕远，不能因为绕路而错过到达）。
    var displayRemaining = d;
    if (state.route && typeof state.routeWalkedMeters === 'number') {
      displayRemaining = Math.max(0, state.route.distanceMeters - state.routeWalkedMeters);
      // 路线剩余不应大于直线距离太多（数据异常时保护）
      if (displayRemaining > d + 300) displayRemaining = d;
    }

    var prev = session.remainingMeters;
    var events = applyRealDistance(displayRemaining, pos.coords.accuracy, d);
    // 不再整页重渲染：只原地刷新导航文本（节流在 patchNav 里）
    patchNav(session);
    for (var i = 0; i < events.length; i += 1) {
      if (events[i].type === 'hint') {
        ui.newHint = events[i].index;
        showToast('解锁新线索', '🔓');
      }
      if (events[i].type === 'arrived') {
        stopRealTracking();
        beginArrival();
        return;
      }
    }
    if (session.phase !== 'walking') stopRealTracking();
  }

  /* ============================================================
     设备朝向（罗盘）：迷雾路径要跟着「你面朝的方向」转，而不是路线方向
     - Android/鸿蒙：deviceorientationabsolute 的 alpha
     - iOS Safari：webkitCompassHeading（需用户手势后 requestPermission）
     - 都没有：退回路线方向（保持旧行为）
     ============================================================ */
  var HEADING_STORE = 0.28;     // 低通滤波系数，越小越稳

  function applyHeading(raw) {
    var h = null;
    if (raw === null || raw === undefined || isNaN(raw)) return;
    h = ((raw % 360) + 360) % 360;
    if (ui.deviceHeading === null || ui.deviceHeading === undefined) {
      ui.deviceHeading = h;
      return;
    }
    var delta = ((h - ui.deviceHeading + 540) % 360) - 180;
    if (Math.abs(delta) < 0.4) return;
    // 大角度转身（>45°）直接跟上，避免"转了半天地图才动"；小角度做平滑防抖
    if (Math.abs(delta) > 45) {
      ui.deviceHeading = h;
    } else {
      ui.deviceHeading = (ui.deviceHeading + delta * 0.45 + 360) % 360;
    }
    if (currentRoute() === '/journey') schedulePathRedraw();
  }

  function onOrientationEvent(event) {
    if (!event) return;
    if (typeof event.webkitCompassHeading === 'number' && !isNaN(event.webkitCompassHeading)) {
      applyHeading(event.webkitCompassHeading);
      return;
    }
    if (typeof event.alpha === 'number' && !isNaN(event.alpha)) {
      // alpha：绕 z 轴逆时针（0 = 北），转成「顺时针从北算」
      applyHeading(360 - event.alpha);
    }
  }

  function startHeadingTracking() {
    if (ui.headingBound) return;
    ui.headingBound = true;
    try {
      window.addEventListener('deviceorientationabsolute', onOrientationEvent, true);
      window.addEventListener('deviceorientation', onOrientationEvent, true);
    } catch (e) { /* ignore */ }
    // 有罗盘就每 350ms 重画一次（低通后的朝向变化不会太频繁）
    if (!ui.headingTimer) {
      ui.headingTimer = window.setInterval(function () {
        if (currentRoute() === '/journey') schedulePathRedraw();
      }, 350);
    }
  }

  /** iOS 13+ 需要用户手势授权才能拿到罗盘；失败就继续用路线方向 */
  function requestHeadingPermission() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().then(function (state) {
          if (state === 'granted') startHeadingTracking();
        }).catch(function () { /* ignore */ });
      } else {
        startHeadingTracking();
      }
    } catch (e) { /* ignore */ }
  }

  /* 真实定位模式：用 watchPosition 持续更新剩余距离与方位 */
  function startRealTracking() {
    window.__bwStat = window.__bwStat || { starts: 0, fixes: 0, early: '', src: '', hasTarget: false };
    window.__bwStat.starts += 1;
    window.__bwStat.src = state.session ? state.session.source : 'no-session';
    window.__bwStat.hasTarget = !!(state.session && state.session.coordinate);
    if (!window.BW_GEO || !state.session || !isRealSession(state.session)) { window.__bwStat.early = 'gate'; return; }
    var target = state.session.coordinate;
    if (!target) { window.__bwStat.early = 'no-target'; return; }
    if (!navigator.geolocation) { window.__bwStat.early = 'no-geo'; return; }

    stopRealTracking();

    // 先主动取一次当前位置：watchPosition 在部分浏览器（含部分鸿蒙 WebView）
    // 不会立刻推初始值，用户会一直看到抽盒时的旧距离，直到 GPS 变化才更新。
    if (navigator.geolocation.getCurrentPosition) {
      navigator.geolocation.getCurrentPosition(function (pos) {
        applyFixToSession(pos);
      }, function () { /* 失败就等 watch */ }, {
        enableHighAccuracy: true, maximumAge: 0, timeout: 8000
      });
    }

    ui.geoWatch = navigator.geolocation.watchPosition(function (pos) {
      applyFixToSession(pos);
    }, function (err) {
      // 只有「权限被拒」才真正放弃；其余（POSITION_UNAVAILABLE / TIMEOUT）多为瞬时错误，
      // 直接停掉会让用户以为 App 没反应，所以改成退避重试。
      var denied = !!(err && err.code === 1);
      ui.geoErrorCount = (ui.geoErrorCount || 0) + 1;
      stopRealTracking();
      if (denied) {
        if (!ui.geoErrorShown) {
          ui.geoErrorShown = true;
          showToast('定位权限被拒，距离不再自动更新', '📴', { duration: 2600 });
        }
        if (currentRoute() === '/journey') render();
        return;
      }
      if (ui.geoErrorCount <= 6) {
        if (!ui.geoErrorShown) {
          ui.geoErrorShown = true;
          showToast('定位信号不稳，正在重试…', '📡', { duration: 2000 });
        }
        var delay = Math.min(8000, 800 * Math.pow(2, ui.geoErrorCount - 1));
        window.setTimeout(function () {
          if (state.session && state.session.phase === 'walking') startRealTracking();
        }, delay);
      } else if (currentRoute() === '/journey') {
        render();
      }
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
  }

  function stopRealTracking() {
    if (ui.geoWatch !== null && ui.geoWatch !== undefined) {
      try { navigator.geolocation.clearWatch(ui.geoWatch); } catch (e) { /* ignore */ }
      ui.geoWatch = null;
    }
    if (ui.geoPoll !== null && ui.geoPoll !== undefined) {
      try { window.clearInterval(ui.geoPoll); } catch (e) { /* ignore */ }
      ui.geoPoll = null;
    }
  }

  /** 周期复核最近一次定位：有些浏览器 watchPosition 只给一次读数，
     静止时 GPS 也不上报；靠这个保证「走到 30m 内」一定能被识别为到达。 */
  function startGeoRecheck() {
    if (ui.geoPoll !== null && ui.geoPoll !== undefined) return;
    /* 很多浏览器/WebView（尤其鸿蒙、微信）的 watchPosition 只推一次就沉默，
       必须主动轮询 getCurrentPosition，否则用户走了几百米数字仍不动。 */
    ui.geoPoll = window.setInterval(function () {
      var session = state.session;
      if (!session || session.phase !== 'walking' || !session.coordinate) return;
      if (navigator.geolocation && navigator.geolocation.getCurrentPosition) {
        navigator.geolocation.getCurrentPosition(function (pos) {
          applyFixToSession(pos);
        }, function () {
          // 取不到新读数就退回到上次定位做一次计算（至少让界面别完全冻住）
          var fix = ui.lastFix;
          if (!fix || !window.BW_GEO || !window.BW_GEO.distanceOf) return;
          var d = window.BW_GEO.distanceOf(fix, session.coordinate);
          if (d === null || d === undefined) return;
          var events = applyRealDistance(d, fix.accuracy);
          patchNav(session);
          for (var i = 0; i < events.length; i += 1) {
            if (events[i].type === 'arrived') { stopRealTracking(); beginArrival(); }
          }
        }, { enableHighAccuracy: true, maximumAge: 0, timeout: 4000 });
      }
    }, 1800);
  }

  function onWalk() {
    if (!state.session || state.session.phase !== 'walking') return;
    var events = advanceSession(50);
    ui.newHint = -1;
    events.forEach(function (event) {
      if (event.type === 'hint') ui.newHint = event.index;
    });
    save();
    renderJourney(true);
    if (events.some(function (event) { return event.type === 'arrived'; })) {
      var delay = ui.newHint >= 0 ? 820 : 200;
      timers.reveal.push(setTimeout(beginArrival, delay));
    }
  }

  /** 到达前预热目的地照片，避免揭晓时空白 */
  function preloadPlacePhoto() {
    try {
      var place = state.session ? placeOf(state.session.placeID) : null;
      var url = place && place.photoUrl;
      if (!url) return;
      var img = new Image();
      img.decoding = 'async';
      img.src = url;
      ui.photoPreload = img;
    } catch (e) { /* ignore */ }
  }

  function beginArrival() {
    if (!state.session || ui.arriving || state.reveal) return;
    preloadPlacePhoto();
    ui.arriving = true;
    state.session.phase = 'arrived';
    state.session.remainingMeters = Math.min(state.session.remainingMeters, D.ARRIVE_THRESHOLD);
    save();
    renderJourney(true);
    dom.overlayRoot.innerHTML = '<div class="flash" role="status" aria-label="到达目的地">' +
      '<span class="flash__word">到了</span>' +
      '<span class="flash__line"></span>' +
      '</div>';
    timers.reveal.push(setTimeout(function () { goRevealFromSession(); }, 980));
  }

  function goRevealFromSession() {
    var session = state.session;
    if (!session) return;
    var place = placeOf(session.placeID);
    if (!place) {
      showToast('这个地点的数据丢了，重新抽一个吧', '😕', { duration: 2600 });
      state.session = null;
      save();
      navigate('/setup');
      return;
    }
    state.reveal = {
      placeID: session.placeID,
      serial: session.demo ? D.DEMO.reveal.serial : randomSerial(),
      collected: false,
      shared: false,
      xpGained: 40 + rarityOf(place).xpBonus
    };
    ui.revealPhase = 'open';
    ui.arriving = false;
    dom.overlayRoot.innerHTML = '';
    navigate('/reveal');
  }

  /* ============================================================
     收录 / 分享
     ============================================================ */
  function onCollect() {
    var reveal = state.reveal;
    if (!reveal) {
      if (state.session && state.session.phase === 'arrived') goRevealFromSession();
      return;
    }
    if (reveal.collected) return;
    var cardEl = $('.reveal-card');
    var animate = !reducedMotion() && cardEl;
    if (animate) cardEl.classList.add('is-flying');
    if (animate) {
      timers.reveal.push(setTimeout(function () { doCollect(); }, 460));
    } else {
      doCollect();
    }
  }

  function doCollect() {
    var reveal = state.reveal;
    if (!reveal || reveal.collected) return;
    var place = placeOf(reveal.placeID);
    if (!place) return;
    var now = Date.now();
    var xp = 40 + rarityOf(place).xpBonus;

    var existing = null;
    state.profile.cards.forEach(function (card) {
      if (card.placeID === place.id) existing = card;
    });
    if (existing) {
      existing.collectedAt = now;
      existing.serial = reveal.serial;
    } else {
      state.profile.cards.push({
        placeID: place.id,
        serial: reveal.serial,
        collectedAt: now,
        taskDone: false
      });
    }

    reveal.collected = true;
    reveal.xpGained = xp;
    state.profile.xp += xp;
    state.profile.boxesOpened += 1;
    var totalMeters = state.session ? state.session.totalMeters : 0;
    state.profile.totalKm = Math.round((state.profile.totalKm + totalMeters / 1000) * 10) / 10;
    state.profile.walkArrivalTimes.push(now);
    if (state.profile.walkArrivalTimes.length > 100) state.profile.walkArrivalTimes.shift();
    updateStreak(now);
    if (state.session) state.session.phase = 'collected';

    var newly = syncAchievements();
    save();
    renderReveal();

    showToast('已收录 · 惊喜值 +' + xp, '📥');
    newly.forEach(function (def, index) {
      showToast('成就解锁 · ' + def.name, def.icon, {
        variant: 'amber',
        delay: 640 + index * 640,
        duration: 3000
      });
    });
  }

  function onShare() {
    var reveal = state.reveal;
    if (!reveal || reveal.shared) return;
    var place = placeOf(reveal.placeID);
    if (!place) return;
    var now = Date.now();
    state.feed.unshift({
      id: 'mine-' + now,
      authorName: state.profile.displayName,
      authorEmoji: '🫥',
      placeName: place.name,
      categoryEmoji: place.categoryEmoji,
      rarity: place.rarity,
      caption: '这个地点，只为你亮一次。',
      createdAt: now,
      reactions: { eyes: 0, heart: 0, next: 0 },
      reacted: {},
      isMine: true
    });
    reveal.shared = true;
    var newly = syncAchievements();
    save();
    renderReveal();
    showToast('已分享到圈子', '📣');
    newly.forEach(function (def, index) {
      showToast('成就解锁 · ' + def.name, def.icon, {
        variant: 'amber',
        delay: 640 + index * 640,
        duration: 3000
      });
    });
  }

  function updateStreak(now) {
    var profile = state.profile;
    if (!profile.lastWalkAt) {
      profile.streakDays = 1;
      profile.lastWalkAt = now;
      return;
    }
    var gap = Math.round((startOfDay(now) - startOfDay(profile.lastWalkAt)) / 86400000);
    if (gap === 0) {
      /* 同一天，连续天数不变 */
    } else if (gap === 1) {
      profile.streakDays += 1;
    } else {
      profile.streakDays = 1;
    }
    profile.lastWalkAt = now;
  }

  /* ============================================================
     Toast
     ============================================================ */
  function showToast(text, icon, options) {
    options = options || {};
    function append() {
      var node = document.createElement('div');
      node.className = 'toast' + (options.variant === 'amber' ? ' toast--amber' : '');
      node.setAttribute('role', 'status');
      node.innerHTML = '<span class="toast__icon" aria-hidden="true">' + esc(icon || '·') + '</span><span>' + esc(text) + '</span>';
      dom.toastRoot.appendChild(node);
      window.setTimeout(function () {
        node.classList.add('is-out');
        window.setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 320);
      }, options.duration || 2600);
    }
    if (options.delay) window.setTimeout(append, options.delay);
    else append();
  }

  /* ============================================================
     图标 / 插画
     ============================================================ */
  var STATUS_ICONS = '<svg width="58" height="12" viewBox="0 0 58 12" fill="none" aria-hidden="true">' +
    '<rect x="0" y="7.2" width="3" height="3.8" rx="1" fill="currentColor"/>' +
    '<rect x="5" y="5.2" width="3" height="5.8" rx="1" fill="currentColor"/>' +
    '<rect x="10" y="2.8" width="3" height="8.2" rx="1" fill="currentColor"/>' +
    '<rect x="15" y="0.8" width="3" height="10.2" rx="1" fill="currentColor" opacity=".35"/>' +
    '<path d="M25.4 5.1a6.3 6.3 0 0 1 8 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
    '<path d="M27.4 7.5a3.4 3.4 0 0 1 4 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
    '<circle cx="29.4" cy="9.9" r="1" fill="currentColor"/>' +
    '<rect x="38.5" y="1.6" width="16.5" height="8.8" rx="2.6" stroke="currentColor" stroke-width="1.2" opacity=".5"/>' +
    '<rect x="40.4" y="3.5" width="10.6" height="5" rx="1.4" fill="currentColor"/>' +
    '<path d="M56.6 5.1v2.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".5"/>' +
    '</svg>';

  var TAB_ICONS = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.4 12 4l8 5.4v8.9a1.7 1.7 0 0 1-1.7 1.7H5.7A1.7 1.7 0 0 1 4 18.3z"/><path d="M4 9.4h16"/><path d="M9.8 13.1c0-.9.9-1.6 2.1-1.6 1.2 0 2 .7 2 1.5 0 .7-.7 1.1-1.6 1.4-.6.2-.9.5-.9 1"/><circle cx="11.4" cy="16.2" r=".6" fill="currentColor" stroke="none"/></svg>',
    cards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8.4" y="3.6" width="10.8" height="14.8" rx="2.2"/><path d="M5.6 7.2v10.7a2.3 2.3 0 0 0 2.3 2.3h7.6" opacity=".55"/></svg>',
    social: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8.6" r="3"/><path d="M3.8 19.2c.4-3 2.6-4.6 5.2-4.6s4.8 1.6 5.2 4.6"/><circle cx="17.1" cy="9.7" r="2.2"/><path d="M15.9 15c2.2-.1 3.9 1.2 4.3 3.7" opacity=".65"/></svg>',
    me: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8.4" r="3.4"/><path d="M5.6 19.4c.6-3.4 3.2-5.2 6.4-5.2s5.8 1.8 6.4 5.2"/></svg>'
  };

  var ICON = {
    back: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.5 4.5 6 10l5.5 5.5"/></svg>',
    chevron: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.2 10.8 8 6 12.8"/></svg>',
    close: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8"/></svg>',
    filter: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M2.8 5h12.4M4.8 9h8.4M7 13h4"/></svg>',
    arrow: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h10M9.6 4.6 14 9l-4.4 4.4"/></svg>',
    watch: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="9" r="5.6"/><path d="M9 6.4V9l1.8 1.2M6.6 3.2l.5-1.7h3.8l.5 1.7M6.6 14.8l.5 1.7h3.8l.5-1.7"/></svg>'
  };

  function boxArtSVG() {
    return '<svg class="boxart boxart--float" viewBox="0 0 120 106" fill="none" aria-hidden="true">' +
      '<ellipse cx="60" cy="95" rx="35" ry="5.5" fill="#111827" opacity=".10"/>' +
      '<circle cx="60" cy="55" r="33" fill="#5B6CFF" opacity=".14"/>' +
      '<path d="M29 53c0-14 8-24 17-27" stroke="#111827" stroke-width="1.3" opacity=".28" stroke-linecap="round"/>' +
      '<rect x="25" y="46" width="70" height="45" rx="7" fill="#A5B4FC" stroke="#111827" stroke-width="1.7"/>' +
      '<rect x="21" y="33.5" width="78" height="17.5" rx="5" fill="#C7D2FE" stroke="#111827" stroke-width="1.7"/>' +
      '<path d="M25 53.5h70" stroke="#111827" stroke-width="1.1" opacity=".35"/>' +
      '<path d="M39.5 33.5c1.6-7.4 7.6-12.5 14.5-12.5M64 21c7 0 13 5.1 14.5 12.5" stroke="#111827" stroke-width="1.4" stroke-linecap="round" opacity=".5"/>' +
      '<path d="M60 21v12.5" stroke="#111827" stroke-width="1.4" stroke-linecap="round" opacity=".5"/>' +
      '<text x="60" y="81" text-anchor="middle" font-size="24" font-weight="700" fill="#111827" font-family="inherit">?</text>' +
      '<circle cx="75" cy="36" r="2.2" fill="#5B6CFF"/>' +
      '<circle cx="31" cy="43" r="1.4" fill="#5B6CFF" opacity=".8"/>' +
      '</svg>';
  }

  function revealBoxSVG() {
    return '<svg class="reveal-open__box" viewBox="0 0 120 106" fill="none" aria-hidden="true">' +
      '<ellipse cx="60" cy="97" rx="38" ry="5" fill="#000" opacity=".35"/>' +
      '<g id="box-body">' +
      '<rect x="25" y="46" width="70" height="46" rx="7" fill="#A5B4FC" stroke="#111827" stroke-width="1.8"/>' +
      '<path d="M25 54h70" stroke="#111827" stroke-width="1.1" opacity=".3"/>' +
      '<g id="box-q"><text x="60" y="82" text-anchor="middle" font-size="25" font-weight="700" fill="#111827" font-family="inherit">?</text></g>' +
      '</g>' +
      '<g id="box-lid">' +
      '<rect x="21" y="33.5" width="78" height="17.5" rx="5" fill="#C7D2FE" stroke="#111827" stroke-width="1.8"/>' +
      '<path d="M39.5 33.5c1.6-7.4 7.6-12.5 14.5-12.5M64 21c7 0 13 5.1 14.5 12.5" stroke="#111827" stroke-width="1.5" stroke-linecap="round" opacity=".5"/>' +
      '<path d="M60 21v12.5" stroke="#111827" stroke-width="1.5" stroke-linecap="round" opacity=".5"/>' +
      '</g>' +
      '</svg>';
  }

  function shakeGlyph() {
    return '<svg class="shakebox" viewBox="0 0 22 22" fill="none" aria-hidden="true">' +
      '<rect x="4.5" y="8" width="13" height="10" rx="2" fill="#111827" opacity=".12" stroke="#111827" stroke-width="1.3"/>' +
      '<rect x="3" y="5" width="16" height="4.5" rx="1.4" fill="#111827" opacity=".2" stroke="#111827" stroke-width="1.3"/>' +
      '</svg>';
  }

  function emptyArtSVG() {
    return '<svg class="empty__art" viewBox="0 0 90 76" fill="none" aria-hidden="true">' +
      '<circle cx="45" cy="40" r="26" fill="#5B6CFF" opacity=".13"/>' +
      '<rect x="22" y="32" width="46" height="32" rx="5" fill="#FFFFFF" stroke="#9CA3AF" stroke-width="1.4" stroke-dasharray="4 4"/>' +
      '<rect x="19" y="24" width="52" height="12" rx="3.5" fill="#FFFFFF" stroke="#9CA3AF" stroke-width="1.4" stroke-dasharray="4 4"/>' +
      '<text x="45" y="55" text-anchor="middle" font-size="18" font-weight="700" fill="#9CA3AF" font-family="inherit">?</text>' +
      '</svg>';
  }

  /* ============================================================
     地图（SVG 手绘抽象街区）
     ============================================================ */
  function mapSVG(place) {
    var W = 390;
    var H = 300;
    var startX = 196;
    var startY = 288;
    // 内置地点用 coords，真实地点用 mapPoint（两者字段名不同）
    var point = place.coords || place.mapPoint || { x: 0.5, y: 0.3 };
    var destX = clamp(point.x, 0.1, 0.9) * W;
    var destY = clamp(point.y, 0.12, 0.78) * H;
    var midX = (startX + destX) / 2;
    var cp1x = startX + (destX - startX) * 0.18;
    var cp1y = startY - (startY - destY) * 0.44;
    var cp2x = startX + (destX - startX) * 0.76;
    var cp2y = destY + (startY - destY) * 0.28;
    var route = 'M' + startX + ' ' + startY +
      ' C ' + cp1x.toFixed(1) + ' ' + cp1y.toFixed(1) +
      ', ' + cp2x.toFixed(1) + ' ' + cp2y.toFixed(1) +
      ', ' + destX.toFixed(1) + ' ' + destY.toFixed(1);

    var blocks = [
      [30, 150, 34, 24, -2], [74, 168, 28, 20, 3], [120, 140, 40, 26, -1],
      [168, 166, 26, 22, 2], [212, 196, 34, 24, -2], [252, 150, 30, 22, 1],
      [294, 176, 38, 26, -1], [340, 148, 28, 22, 2], [56, 214, 26, 20, -1],
      [100, 232, 34, 22, 2], [150, 214, 28, 18, -2], [238, 236, 32, 22, 1],
      [302, 226, 26, 20, -2], [342, 250, 34, 24, 1], [18, 254, 26, 18, 2],
      [368, 210, 24, 18, -1], [88, 118, 30, 20, 1], [186, 116, 24, 18, -2],
      [268, 108, 34, 22, 2], [330, 96, 26, 18, -1]
    ].map(function (b, i) {
      return '<rect class="map-block' + (i % 3 === 0 ? ' map-block--alt' : '') + '" x="' + b[0] + '" y="' + b[1] +
        '" width="' + b[2] + '" height="' + b[3] + '" rx="2.5" transform="rotate(' + b[4] + ' ' + (b[0] + b[2] / 2) + ' ' + (b[1] + b[3] / 2) + ')"/>';
    }).join('');

    var trees = [
      [70, 100, 8], [108, 96, 6], [152, 108, 7], [214, 88, 6],
      [286, 92, 7], [352, 118, 6], [48, 190, 7], [318, 200, 6],
      [130, 262, 7], [268, 272, 6]
    ].map(function (t) {
      return '<circle class="map-tree" cx="' + t[0] + '" cy="' + t[1] + '" r="' + t[2] + '"/>';
    }).join('');

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="抽象街区示意地图，路线终点保密">' +
      '<rect width="' + W + '" height="' + H + '" fill="#F3F5FB"/>' +
      /* 河流 */
      '<path d="M-30 74 C 60 116 142 56 236 94 C 306 122 356 98 420 116" stroke="#DDE3F5" stroke-width="46" fill="none" stroke-linecap="round"/>' +
      '<path d="M-30 74 C 60 116 142 56 236 94 C 306 122 356 98 420 116" stroke="#C7D2FE" stroke-width="1" fill="none" stroke-dasharray="5 9" opacity=".8"/>' +
      /* 道路 */
      '<path class="map-road" d="M-10 190 C 80 182 150 197 250 188 C 320 182 372 191 412 186"/>' +
      '<path class="map-road" d="M190 -10 C 197 60 180 132 200 212 C 210 252 198 288 202 330"/>' +
      '<path class="map-road map-road--thin" d="M58 322 C 100 270 160 240 282 200 C 332 182 372 170 420 164"/>' +
      '<path class="map-road map-road--thin" d="M300 58 C 290 120 320 150 330 192"/>' +
      '<path class="map-road map-road--thin" d="M18 140 C 70 130 102 120 152 106"/>' +
      /* 路面中线 */
      '<path class="map-roadline" d="M-10 190 C 80 182 150 197 250 188 C 320 182 372 191 412 186"/>' +
      '<path class="map-roadline" d="M190 -10 C 197 60 180 132 200 212 C 210 252 198 288 202 330"/>' +
      /* 绿地 */
      '<rect class="map-park" x="56" y="238" width="72" height="46" rx="9"/>' +
      '<rect class="map-park" x="296" y="58" width="52" height="34" rx="8"/>' +
      trees +
      blocks +
      /* 路线 */
      '<path class="map-route" d="' + route + '"/>' +
      /* 终点（保密） */
      '<g class="map-glow">' +
      '<circle class="map-dest-halo" cx="' + destX.toFixed(1) + '" cy="' + destY.toFixed(1) + '" r="19"/>' +
      '<circle class="map-dest-ring" cx="' + destX.toFixed(1) + '" cy="' + destY.toFixed(1) + '" r="10"/>' +
      '<circle class="map-dest-core" cx="' + destX.toFixed(1) + '" cy="' + destY.toFixed(1) + '" r="4"/>' +
      '<text class="map-q" x="' + destX.toFixed(1) + '" y="' + (destY + 22).toFixed(1) + '">?</text>' +
      '</g>' +
      /* 起点 */
      '<circle class="map-start-halo" cx="' + startX + '" cy="' + startY + '" r="13"/>' +
      '<circle class="map-start" cx="' + startX + '" cy="' + startY + '" r="4.5"/>' +
      '<text class="map-start-label" x="' + (startX + 10) + '" y="' + (startY + 3.5) + '">你</text>' +
      '</svg>';
  }

  /* ============================================================
     页面片段
     ============================================================ */
  function statusBarMarkup(light) {
    return '<div class="statusbar__icons" aria-hidden="true">' + STATUS_ICONS + '</div>';
  }

  function ratingBadge(rarity) {
    var info = D.RARITY[rarity];
    return '<span class="badge badge--' + rarity + '">' + info.label + '</span>';
  }

  function resumeChip() {
    var session = state.session;
    if (!session || (session.phase !== 'walking' && session.phase !== 'arrived')) return '';
    return '<button class="boxcard__resume" data-action="resume" aria-label="继续这趟散步">继续 · ' +
      esc(session.remainingMeters) + ' m ›</button>';
  }

  /** 诊断页：把「为什么两边显示不一样」需要的信息一次列出来 */
  function debugHTML() {
    var session = state.session;
    var place = session ? placeOf(session.placeID) : null;
    var rows = [
      ['页面地址', location.origin + location.pathname],
      ['启动模式', state.bootMode === 'demo' ? '演示种子（URL 带 demo=1）'
        : state.bootMode === 'fresh' ? '全新用户' : '读取本机存档'],
      ['是否演示数据', state.demoSeeded ? '是（可在「我的 → 退出演示」或旅程页按钮切换）' : '否'],
      ['当前盲盒', session ? (session.phase + ' · ' + (session.demo ? '演示' : '真实')) : '没有进行中的盲盒'],
      ['地点来源', (function () {
        if (!place) return '—';
        var src = place.source || 'catalog';
        var label = src === 'curated' ? '后台策展（编辑精选）'
          : src === 'wikipedia' ? '维基百科真实地标'
          : src === 'osm' ? 'OpenStreetMap 真实地点'
          : src === 'geo' ? '仅真实坐标（无名称）'
          : '内置虚构地点（演示）';
        return src + ' · ' + label;
      })()],
      ['地点名称', session && session.phase === 'walking' ? '（保密中）' : (place ? place.name : '—')],
      ['是否真实定位', isRealSession(session) ? '是' : '否'],
      ['定位权限', ui.geoPermission || '未请求 / 未知'],
      ['最近定位精度', ui.lastFix && typeof ui.lastFix.accuracy === 'number' ? Math.round(ui.lastFix.accuracy) + ' 米' : '还没有定位读数'],
      ['当前坐标', ui.lastFix
        ? ui.lastFix.lat.toFixed(5) + ', ' + ui.lastFix.lon.toFixed(5)
        : (ui.myLocation ? ui.myLocation.lat.toFixed(5) + ', ' + ui.myLocation.lon.toFixed(5) : '还没有定位读数')],
      ['最近一次抽到', state.session && placeOf(state.session.placeID)
        ? (placeOf(state.session.placeID).name + '（' + (placeOf(state.session.placeID).source || 'catalog') + '）')
        : '—'],
      ['策划数据条数', state.curatedCount === undefined ? '加载中' : String(state.curatedCount)],
      ['窗口尺寸', window.innerWidth + ' × ' + window.innerHeight + ' @' + (window.devicePixelRatio || 1) + 'x'],
      ['触摸设备', document.documentElement.classList.contains('is-touch') ? '是' : '否（桌面）'],
      ['是否独立启动', (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ? '是（已加到桌面）' : '否（浏览器标签页）'],
      ['网络', navigator.onLine ? '在线' : '离线'],
      ['页面版本', APP_VERSION + ' · ' + APP_BUILT_AT],
      ['Service Worker', state.swVersion || '未注册 / 未知'],
      ['是否最新版本', !state.swVersion ? '未知（离线缓存未启用，通常是最新）'
        : (state.swVersion.indexOf(APP_VERSION) >= 0 ? '✅ 是' : '⚠️ 旧版本：点下面「强制更新」')],
      ['本机存档 xp', state.profile ? String(state.profile.xp) : '—'],
      ['本机卡片数', state.profile ? String(state.profile.cards.length) : '—']
    ].map(function (row) {
      return '<div class="dbg__row"><span class="dbg__k">' + esc(row[0]) + '</span>' +
        '<span class="dbg__v">' + esc(row[1]) + '</span></div>';
    }).join('');

    return '<div class="page dbg">' +
      '<header class="pagehead"><div><h2 class="pagehead__title">诊断</h2>' +
      '<p class="pagehead__sub">两边显示不一致时，把这一页截图发给开发者最快</p></div>' +
      '<button type="button" class="iconbtn" data-action="back-home" aria-label="返回首页">' + ICON.back + '</button>' +
      '</header>' +
      '<section class="dbg__card">' + rows + '</section>' +
      '<section class="dbg__card dbg__actions">' +
      '<p class="dbg__hint">想让两边完全一致：都用同一个地址打开、并且都不要带 <code>?demo=1</code>。</p>' +
      '<button type="button" class="btn btn--primary btn--block" data-action="retry-real">清掉演示数据，用真实定位重开</button>' +
      '<button type="button" class="btn btn--ghost btn--block" data-action="reset-demo">重置为演示数据（对比用）</button>' +
      '<button type="button" class="btn btn--quiet btn--block" data-action="force-update">强制更新到最新版（清缓存并重开）</button>' +
      '</section>' +
      '</div>';
  }

  /** 演示数据提示条：只在「本机数据来自演示种子」时出现，避免误以为是真实体验 */
  function demoNoticeHTML() {
    if (!state.demoSeeded) return '';
    return '<div class="demonotice" role="status">' +
      '<span class="demonotice__icon" aria-hidden="true">🧪</span>' +
      '<div class="demonotice__body">' +
      '<p class="demonotice__title">现在看到的是演示数据</p>' +
      '<p class="demonotice__text">内置的虚构地点，不是你在的城市。要用真实地点，点右边。</p>' +
      '</div>' +
      '<button type="button" class="demonotice__btn" data-action="retry-real">用真实定位</button>' +
      '</div>';
  }

  function homeHTML() {
    var profile = state.profile;
    var pass = latestCard();
    var passPlace = pass ? placeOf(pass.placeID) : null;
    var friends = D.FRIENDS.map(function (friend) {
      return '<span class="avatar" title="' + esc(friend.name) + '">' + friend.emoji +
        (friend.online ? '<span class="avatar__dot" aria-hidden="true"></span>' : '') +
        '<span class="avatar__name">' + esc(friend.name) + '</span></span>';
    }).join('');

    var lastPart = passPlace
      ? '<button class="lastcard" data-action="go-cards" aria-label="去回忆册看上一次的惊喜">' +
        '<span class="lastcard__thumb" aria-hidden="true">' + passPlace.categoryEmoji + '</span>' +
        '<span class="lastcard__body">' +
        '<span class="micro">上一次的惊喜</span>' +
        '<span class="lastcard__name">' + esc(passPlace.name) + '</span>' +
        '<span class="lastcard__date">' + esc(relativeDay(pass.collectedAt)) + '</span>' +
        '</span>' +
        '<span class="lastcard__arrow" aria-hidden="true">' + ICON.chevron + '</span>' +
        '</button>'
      : '<div class="firsthint"><p class="firsthint__title">第一盒还没开。</p><p class="firsthint__sub">城市已经准备好了。</p></div>';

    return '<section class="home">' +
      demoNoticeHTML() +
      '<header class="home__top">' +
      '<h1 class="home__greet">' + esc(greeting()) + '，' + esc(profile.displayName) + '</h1>' +
      '<span class="chip chip--streak">🔥 ' + profile.streakDays + ' 天</span>' +
      '</header>' +
      '<div class="home__hero">' +
      '<h2>今天，想去哪儿？</h2>' +
      '<p>不用选。让城市替你选。</p>' +
      '</div>' +
      '<article class="boxcard" aria-label="今晚的盲盒">' +
      '<div class="boxcard__top"><span class="micro">今日盲盒</span>' + resumeChip() + '</div>' +
      '<div class="boxcard__art" aria-hidden="true">' + boxArtSVG() + '</div>' +
      '<button class="btn btn--primary btn--block" data-action="open-setup" aria-label="开一个盲盒">开一个盲盒</button>' +
      '<p class="boxcard__meta">预计 30 分钟 · 1.6 km 内</p>' +
      '</article>' +
      '<div class="stats" aria-label="本周统计">' +
      '<div class="stat"><b>' + weeklySurprise() + '</b><span>本周惊喜值</span></div>' +
      '<div class="stat"><b>' + profile.cards.length + '</b><span>收集卡片</span></div>' +
      '<div class="stat"><b>' + profile.streakDays + '</b><span>连续天数</span></div>' +
      '</div>' +
      '<div class="friends">' +
      '<div class="friends__avatars">' + friends + '</div>' +
      '<p class="friends__copy"><b>3 个朋友</b>今晚也在散步</p>' +
      '</div>' +
      lastPart +
      surpriseHubHTML() +
      '</section>';
  }



  /* ============================================================
     地图 Key：后台统一管理，客户端自动获取（用户不再自己填）
     来源优先级：
       1. mapkeys.json（部署时由后台数据库生成，随 Pages 发布）
       2. 后台 API /api/public/mapkeys（本地开发 / 局域网）
     都没有：只用免费源（OSM + 维基）
     ============================================================ */
  var MAPKEYS_META = 'bw.mapkeys.meta.v1';

  function mapKeysEndpoint() {
    try { return localStorage.getItem('bw.mapkeys.endpoint') || ''; } catch (e) { return ''; }
  }

  function applyMapKeys(keys, source) {
    if (!window.BW_PROVIDERS || !window.BW_PROVIDERS.setKeys) return;
    window.BW_PROVIDERS.setKeys({
      amap: (keys && keys.amap) || '',
      baidu: (keys && keys.baidu) || ''
    });
    var meta = { source: source, at: Date.now(), amap: !!(keys && keys.amap), baidu: !!(keys && keys.baidu) };
    try { localStorage.setItem(MAPKEYS_META, JSON.stringify(meta)); } catch (e) { /* ignore */ }
    state.mapKeysMeta = meta;
  }

  function loadMapKeys() {
    var endpoint = mapKeysEndpoint();
    function fromJson() {
      return fetch('mapkeys.json?_=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (data && data.keys) { applyMapKeys(data.keys, 'pages'); return true; }
          return false;
        })
        .catch(function () { return false; });
    }
    function fromApi() {
      if (!endpoint) return Promise.resolve(false);
      return fetch(endpoint.replace(/\/$/, '') + '/api/public/mapkeys', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (data && data.keys) { applyMapKeys(data.keys, 'admin'); return true; }
          return false;
        })
        .catch(function () { return false; });
    }
    return fromJson().then(function (ok) {
      if (ok) return true;
      return fromApi();
    }).then(function (ok) {
      if (!ok) {
        applyMapKeys({ amap: '', baidu: '' }, 'none');
      }
      return ok;
    });
  }

  /* ============================================================
     账号（可选云端）与数据源设置
     - 未登录：完全本地，离线可用
     - 登录：把 profile / surprises / settings 整包同步到账号服务
     ============================================================ */
  var ACCOUNT_STORE = 'bw.account.v1';
  var DATA_SOURCE_STORE = 'bw.datasource.v1';

  function accountConfig() {
    try {
      var raw = localStorage.getItem(ACCOUNT_STORE);
      var cfg = raw ? JSON.parse(raw) : null;
      return cfg && typeof cfg === 'object' ? cfg : { baseUrl: 'http://127.0.0.1:8803', user: null };
    } catch (e) { return { baseUrl: 'http://127.0.0.1:8803', user: null }; }
  }

  function saveAccountConfig(cfg) {
    try { localStorage.setItem(ACCOUNT_STORE, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
  }

  function accountApi(path, options) {
    var cfg = accountConfig();
    var base = (cfg.baseUrl || '').replace(/\/$/, '');
    var init = { method: (options && options.method) || 'GET', credentials: 'include', headers: {} };
    if (options && options.body !== undefined) {
      init.headers['Content-Type'] = 'application/json; charset=utf-8';
      init.body = JSON.stringify(options.body);
    }
    return fetch(base + path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (payload) {
        if (!res.ok) {
          var err = new Error((payload && payload.error) || ('HTTP ' + res.status));
          err.code = payload && payload.code;
          err.status = res.status;
          throw err;
        }
        return payload;
      });
    });
  }

  function accountErrText(e) {
    var code = e && e.code;
    if (code === 'BAD_CREDENTIALS') return '用户名或密码不对';
    if (code === 'USERNAME_TAKEN') return '这个用户名已被注册';
    if (code === 'BAD_REQUEST') return '用户名 3–24 字符，密码至少 6 位';
    if (code === 'TOO_MANY_ATTEMPTS') return '尝试次数太多，10 分钟后再试';
    if (code === 'UNAUTHENTICATED') return '登录已过期，请重新登录';
    if (e && /Failed to fetch|NetworkError/.test(e.message || '')) {
      return '连不上账号服务（检查地址/是否启动；HTTPS 页面不能调 http）';
    }
    return (e && e.message) || '操作失败';
  }

  function accountStatusText() {
    var cfg = accountConfig();
    if (cfg.user) return '已登录：' + cfg.user.username;
    return '未登录（数据只存在本机）';
  }

  /** 登录/注册成功后刷新界面 */
  function onAccountChanged(user) {
    var cfg = accountConfig();
    cfg.user = user || null;
    saveAccountConfig(cfg);
    if (currentRoute() === '/account') render();
    else if (currentRoute() === '/profile') render();
  }

  function syncPayload() {
    return {
      app: 'blindwalk',
      version: 1,
      savedAt: Date.now(),
      profile: state.profile,
      surprises: state.surprises,
      settings: state.settings
    };
  }

  /** 登录后把本机数据推到账号 */
  function pushProfile() {
    return accountApi('/api/me/profile', { method: 'PUT', body: { profile: syncPayload() } })
      .then(function (r) { return r; });
  }

  /** 从账号拉数据覆盖本机 */
  function pullProfile() {
    return accountApi('/api/auth/me').then(function (data) {
      var remote = data && data.profile;
      if (!remote || !remote.profile) throw new Error('账号里还没有数据');
      state.profile = remote.profile;
      if (Array.isArray(remote.surprises)) state.surprises = remote.surprises;
      if (remote.settings) state.settings = remote.settings;
      save();
      return remote;
    });
  }


  /** 账号页：登录 / 注册 / 同步 / 退出 / 删号 */
  function accountHTML() {
    var cfg = accountConfig();
    var mixedBlocked = location.protocol === 'https:' && /^http:\/\//i.test(cfg.baseUrl || '');
    var logged = !!cfg.user;
    var rows = logged
      ? '<div class="dbg__row"><span class="dbg__k">当前账号</span><span class="dbg__v">' + esc(cfg.user.username) + '</span></div>' +
        '<div class="dbg__row"><span class="dbg__k">服务地址</span><span class="dbg__v">' + esc(cfg.baseUrl) + '</span></div>' +
        '<div class="dbg__row"><span class="dbg__k">本机数据</span><span class="dbg__v">' +
          state.profile.cards.length + ' 张卡片 · ' + state.profile.xp + ' 探索值 · ' + state.surprises.length + ' 个惊喜</span></div>'
      : '<div class="dbg__row"><span class="dbg__k">当前状态</span><span class="dbg__v">未登录 · 数据只存在这台设备</span></div>';

    var form = logged
      ? '<div class="dbg__actions">' +
          '<button type="button" class="btn btn--primary btn--block" data-action="account-sync">同步到账号（覆盖云端）</button>' +
          '<button type="button" class="btn btn--ghost btn--block" data-action="account-restore">从账号恢复（覆盖本机）</button>' +
          '<button type="button" class="btn btn--quiet btn--block" data-action="account-logout">退出登录</button>' +
          '<button type="button" class="btn btn--quiet btn--block" data-action="account-delete">删除账号</button>' +
        '</div>'
      : '<div class="acc__form">' +
          '<label class="acc__label" for="acc-base">账号服务地址</label>' +
          '<input class="acc__input" id="acc-base" type="url" value="' + esc(cfg.baseUrl) + '" placeholder="http://127.0.0.1:8803">' +
          '<label class="acc__label" for="acc-user">用户名</label>' +
          '<input class="acc__input" id="acc-user" type="text" autocomplete="username" placeholder="3–24 个字符">' +
          '<label class="acc__label" for="acc-pass">密码</label>' +
          '<input class="acc__input" id="acc-pass" type="password" autocomplete="current-password" placeholder="至少 6 位">' +
          '<div class="dbg__actions">' +
            '<button type="button" class="btn btn--primary btn--block" data-action="account-login">登录</button>' +
            '<button type="button" class="btn btn--ghost btn--block" data-action="account-register">注册并登录</button>' +
          '</div>' +
          '<p class="dbg__hint">账号是可选的。不登录也能用，数据留在本机。<br>' +
          '云端账号两种方式：<br>' +
          '① 本机跑 <code>bash scripts/start-account.sh</code>，服务地址填 <code>http://127.0.0.1:8803</code>' +
          '（需用 http 页面打开 App）；<br>' +
          '② 公网用 Cloudflare Worker（<code>serverless/cloudflare/</code>，HTTPS），' +
          '把 <code>https://xxx.workers.dev</code> 填进来即可，GitHub Pages 上也能登录。</p>' +
        '</div>';

    return '<div class="page dbg">' +
      '<header class="pagehead"><div><h2 class="pagehead__title">账号</h2>' +
      '<p class="pagehead__sub">' + esc(accountStatusText()) + '</p></div>' +
      '<button type="button" class="iconbtn" data-action="go-profile" aria-label="返回我的">' + ICON.back + '</button>' +
      '</header>' +
      (mixedBlocked
        ? '<section class="locblock" role="alert">' +
            '<p class="locblock__title">当前页面是 HTTPS，连不上 http 的本地账号服务</p>' +
            '<p class="locblock__text">浏览器会以「混合内容」拦掉请求。两种办法：<br>' +
            '① 用 http 打开 App（本地 <code>python3 serve.py</code>，访问 <code>http://&lt;电脑IP&gt;:8799</code>）；<br>' +
            '② 把账号服务部署到 HTTPS 域名，再把地址改成 https://…</p>' +
          '</section>'
        : '') +
      '<section class="dbg__card">' + rows + '</section>' +
      '<section class="dbg__card dbg__actions">' + form + '</section>' +
      '</div>';
  }

  /** 数据源页：Key 由后台统一配置，这里只做状态展示（用户无需/无法自己填 Key） */
  function datasourceHTML() {
    var st = (window.BW_PROVIDERS && window.BW_PROVIDERS.status)
      ? window.BW_PROVIDERS.status()
      : { sources: [], keys: {} };
    var meta = state.mapKeysMeta || {};
    var sourceLabel = meta.source === 'pages' ? '随 App 发布下发'
      : meta.source === 'admin' ? '后台接口下发'
      : meta.source === 'none' ? '未配置（只用免费源）' : '加载中…';

    var list = '<div class="dbg__row"><span class="dbg__k">高德地图</span><span class="dbg__v">' +
      (st.keys && st.keys.amap ? '已由后台配置 ✓' : '后台未配置') + '</span></div>' +
      '<div class="dbg__row"><span class="dbg__k">百度地图</span><span class="dbg__v">' +
      (st.keys && st.keys.baidu ? '已由后台配置 ✓' : '后台未配置') + '</span></div>' +
      '<div class="dbg__row"><span class="dbg__k">OpenStreetMap</span><span class="dbg__v">免费 · 始终可用</span></div>' +
      '<div class="dbg__row"><span class="dbg__k">中文维基百科</span><span class="dbg__v">免费 · 带实景照片</span></div>' +
      '<div class="dbg__row"><span class="dbg__k">Key 来源</span><span class="dbg__v">' + esc(sourceLabel) + '</span></div>';

    var last = (window.BW_PROVIDERS && window.BW_PROVIDERS.lastReport) ? window.BW_PROVIDERS.lastReport() : null;
    var report = '';
    if (last && last.sources && last.sources.length) {
      report = '<div class="dbg__row"><span class="dbg__k">上次抓取</span><span class="dbg__v">' +
        last.sources.map(function (x) {
          return esc(x.label || x.id) + '：' + (x.ok ? (x.count + ' 条') : (x.reason || x.error || '失败'));
        }).join('；') + '</span></div>';
    }

    return '<div class="page dbg">' +
      '<header class="pagehead"><div><h2 class="pagehead__title">数据源</h2>' +
      '<p class="pagehead__sub">Key 由后台统一管理，你不需要填写</p></div>' +
      '<button type="button" class="iconbtn" data-action="go-profile" aria-label="返回我的">' + ICON.back + '</button>' +
      '</header>' +
      '<section class="dbg__card">' + list + report + '</section>' +
      '<section class="dbg__card">' +
        '<p class="dbg__hint">地图服务商的 Key 由管理后台统一配置并下发，所有用户共用。<br>' +
        '客户端只用免费源（OpenStreetMap + 维基百科）也能正常抽真实地点。<br>' +
        '需要替换 Key？在后台「地图 Key」页修改，重启 App 后自动生效。</p>' +
        '<div class="dbg__actions">' +
          '<button type="button" class="btn btn--ghost btn--block" data-action="reload-mapkeys">重新加载 Key</button>' +
          '<button type="button" class="btn btn--quiet btn--block" data-action="ds-test">用当前位置测一次抓取</button>' +
        '</div>' +
      '</section>' +
      '</div>';
  }

  /** 定位受阻提示：只有「真实地点」或「明确选演示」两条路 */
  function locationBlockedHTML() {
    if (!ui.locationBlocked) return '';
    var reasonText = ui.locationReason === 'denied'
      ? '你把定位权限拒绝了'
      : ui.locationReason === 'timeout'
        ? '定位超时了（室内/地下常见）'
        : '浏览器没有给出位置';
    return '<section class="locblock" role="alert">' +
      '<p class="locblock__title">没拿到你的位置，抽不了真实地点</p>' +
      '<p class="locblock__text">' + esc(reasonText) + '。真实盲盒必须知道你在哪。</p>' +
      '<div class="locblock__actions">' +
      '<button type="button" class="btn btn--primary" data-action="retry-location">再试一次定位</button>' +
      '<button type="button" class="btn btn--ghost" data-action="manual-location">手动输入位置</button>' +
      '</div>' +
      '<button type="button" class="locblock__demo" data-action="start-demo">不定位，先看演示（虚构地点）</button>' +
      '</section>';
  }

  /** 真实地点搜索失败：明确告知 + 提供扩大范围/手动位置/演示 三条路（绝不偷偷用虚构地点） */
  function searchFailedHTML() {
    if (!ui.searchFailed) return '';
    var reason = ui.searchFailed.reason || 'no-real-place';
    var text = reason === 'network'
      ? '网络不给力，地图数据没取到（可能是 OSM/高德都被挡住或超时）'
      : '这一带暂时没有适合走过去的真实地点';
    var report = ui.searchFailed.report;
    var detail = '';
    if (report && report.sources && report.sources.length) {
      detail = '<ul class="locblock__list">' +
        report.sources.map(function (x) {
          return '<li>' + esc(x.label || x.id) + '：' +
            (x.ok ? ('找到 ' + x.count + ' 个') : esc(x.error || x.reason || '失败')) + '</li>';
        }).join('') + '</ul>';
    }
    return '<section class="locblock" role="alert">' +
      '<p class="locblock__title">没找到真实地点，这次不抽了</p>' +
      '<p class="locblock__text">' + esc(text) + '。不会用虚构地点糊弄你。' +
      '试试：换「60 分钟」把范围放大，或改个区域（河边/老城区）。</p>' +
      detail +
      '<div class="locblock__actions">' +
      '<button type="button" class="btn btn--primary" data-action="search-wider">扩大范围再找</button>' +
      '<button type="button" class="btn btn--ghost" data-action="manual-location">换个位置</button>' +
      '</div>' +
      '<button type="button" class="locblock__demo" data-action="start-demo">改成演示模式（虚构地点）</button>' +
      '</section>';
  }

  function sheetHTML() {
    var durations = D.DURATIONS.map(function (duration) {
      return '<button type="button" data-action="select-duration" data-value="' + duration.id + '"' +
        ' aria-pressed="' + (ui.duration === duration.id) + '" aria-label="' + esc(duration.title) + '">' +
        '<b>' + esc(duration.main) + '</b><em>' + esc(duration.sub) + '</em></button>';
    }).join('');

    var moods = D.MOODS.map(function (mood) {
      return '<button type="button" class="mood" data-action="select-mood" data-value="' + mood.id + '"' +
        ' aria-pressed="' + (ui.mood === mood.id) + '" aria-label="' + esc(mood.title + '：' + mood.subtitle) + '">' +
        '<span class="mood__emoji" aria-hidden="true">' + mood.emoji + '</span>' +
        '<span class="mood__text"><span class="mood__title">' + esc(mood.title) + '</span>' +
        '<span class="mood__sub">' + esc(mood.subtitle) + '</span></span>' +
        '</button>';
    }).join('');

    var areas = D.AREAS.map(function (area) {
      return '<button type="button" class="chipbtn" data-action="select-area" data-value="' + area.id + '"' +
        ' aria-pressed="' + (ui.area === area.id) + '" aria-label="区域：' + esc(area.label) + '">' + esc(area.label) + '</button>';
    }).join('');

    return '<div class="scrim" data-action="close-setup" aria-hidden="true"></div>' +
      '<section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' +
      '<div class="sheet__grabber" aria-hidden="true"></div>' +
      '<h2 class="sheet__title" id="sheet-title">这次的盲盒，你想要什么？</h2>' +
      '<p class="sheet__sub">选完就出发，目的地保密。</p>' +
      '<div class="field"><span class="field__label">时长</span><div class="segmented">' + durations + '</div></div>' +
      '<div class="field"><span class="field__label">心情</span><div class="moods">' + moods + '</div></div>' +
      '<div class="field"><span class="field__label">区域</span><div class="areachips">' + areas + '</div></div>' +
      '<div class="sheet__actions">' +
      locationBlockedHTML() +
      searchFailedHTML() +
      '<button type="button" class="btn btn--primary btn--block" data-action="shake" aria-label="摇一个盲盒">摇一个盲盒</button>' +
      '<button type="button" class="btn btn--quiet" data-action="close-setup" aria-label="今天不想出门">今天不想出门</button>' +
      '</div>' +
      '</section>';
  }

  function bearingFor(remaining) {
    if (remaining >= 361) return '↖';
    if (remaining >= 241) return '↑';
    if (remaining >= 121) return '↗';
    return '→';
  }

  function clueMarkup(place, index, unlockedCount, remaining) {
    var text = (place.hints && place.hints[index]) ||
      [place.hint1, place.hint2, place.hint3][index] || '';
    if (index < unlockedCount) {
      var fresh = ui.newHint === index ? ' clue--new' : '';
      return '<div class="clue' + fresh + '"><span class="clue__mark" aria-hidden="true">✅</span><span>' + esc(text) + '</span></div>';
    }
    var lockedText = index === 1
      ? '再走 ' + Math.max(0, remaining - D.HINT_THRESHOLDS[1]) + ' 米，解锁第二条线索'
      : '到了你就知道';
    var lockAttr = index === 1 ? ' data-clue-locked-index="1"' : (index === 2 ? ' data-clue-locked-index="2"' : '');
    return '<div class="clue clue--locked"><span class="clue__mark" aria-hidden="true">🔒</span><span' + lockAttr + '>' + esc(lockedText) + '</span></div>';
  }

  function journeyHTML() {
    var session = state.session;
    var backBtn = '<button type="button" class="iconbtn" data-action="back-home" aria-label="返回首页">' + ICON.back + '</button>';

    if (!session || !placeOf(session.placeID)) {
      return '<div class="journey">' +
        '<div class="journey__top">' + backBtn +
        '<div class="journey__topinfo"><span class="micro">盲盒进行中</span><span class="journey__timer">--:--:--</span></div>' +
        '</div>' +
        '<div class="empty" style="flex:1;justify-content:center">' +
        emptyArtSVG() +
        '<p>还没有正在进行的盲盒。</p>' +
        '<span>让城市替你选一个。</span>' +
        '<a class="btn btn--primary" href="#/setup" style="height:44px;margin-top:10px;padding:0 26px;font-size:14px">开一个盲盒</a>' +
        '</div></div>';
    }

    var place = placeOf(session.placeID);
    var remaining = session.remainingMeters;
    var unlocked = session.unlockedHintCount;
    var elapsed = ui.paused ? ui.pausedElapsed : Math.max(0, Date.now() - session.startedAt);
    var walkCopy = D.WALK_COPY[place.area] || '顺着灯走，别急';
    var areaLabel = placeAreaWord(place);

    var clues = [0, 1, 2].map(function (index) {
      return clueMarkup(place, index, unlocked, remaining);
    }).join('');

    var arrived = session.phase === 'arrived';

    return '<div class="journey">' +
      '<div class="journey__top">' + backBtn +
      '<div class="journey__topinfo">' +
      '<span class="micro">盲盒进行中</span>' +
      '<span class="journey__timer">' + fmtElapsed(elapsed) + '</span>' +
      '</div>' +
      '<button type="button" class="journey__pause" data-action="pause" aria-pressed="' + ui.paused + '" aria-label="' + (ui.paused ? '继续计时' : '暂停计时') + '">' + (ui.paused ? '继续' : '暂停') + '</button>' +
      '</div>' +
      '<div class="journey__status">' + realStatusHTML() + '</div>' +
      (isRealSession(session) ? pathViewHTML() : '') +
      navCardHTML(session) +
      '<div class="journey__side">' +
      '<div class="journey__clues" aria-label="线索">' + clues + '</div>' +
      navUpcomingHTML(session) +
      '</div>' +
      '<div class="journey__actions">' +
      (arrived
        ? '<button type="button" class="btn btn--primary btn--block" data-action="collect" aria-label="揭晓盲盒">揭晓盲盒</button>'
        : (isRealSession(session)
          ? '<button type="button" class="btn btn--primary btn--block" data-action="reveal-now" aria-label="直接揭晓">走累了？直接揭晓</button>'
          : '<button type="button" class="btn btn--primary btn--block" data-action="walk" aria-label="模拟步行 50 米">模拟步行 +50m<span class="demo-tag">演示</span></button>')) +
      '<button type="button" class="btn btn--quiet" data-action="arrive" aria-label="我到了，直接揭晓">我到了</button>' +
      '</div>' +
      '</div>';
  }

  /* ============================================================
     统一导航状态机
     原则（解决用户反馈的「混乱」）：
     1. 全页只有一个「剩余距离」数字，口径统一（有路线=沿路线剩余）
     2. 全页只有一个箭头，含义固定 = 下一步动作
     3. 转向提示有滞回，不会在阈值附近来回跳
     ============================================================ */
  function computeNav(session) {
    var result = {
      arrow: '↑',
      main: '继续走',
      sub: '',
      remaining: session.remainingMeters,
      minutes: Math.max(1, Math.round(session.remainingMeters / 75)),
      hasRoute: false
    };
    if (!isRealSession(session) || !state.route) {
      // 没有路线：不猜方向、不画箭头（避免指错），只给距离
      if (isRealSession(session) && state.routeState === 'loading') {
        result.arrow = '…';
        result.main = '正在规划步行路线';
        result.sub = '马上就好';
      } else {
        result.arrow = '·';
        result.main = session.remainingMeters > 0 ? '按提示方向走过去' : '就在附近';
        result.sub = '网络不通时只显示直线距离';
      }
      return result;
    }

    var progress = window.BW_GEO.routeProgress(state.route, ui.lastFix || ui.myLocation);
    var walked = progress ? progress.walked : (state.routeWalkedMeters || 0);
    var routeRemaining = Math.max(0, Math.round(state.route.distanceMeters - walked));
    result.hasRoute = true;
    result.remaining = routeRemaining;
    result.minutes = Math.max(1, Math.round(routeRemaining / 75));

    var ms = state.route.maneuvers || [];
    var current = 0;
    while (current + 1 < ms.length && walked >= ms[current + 1].cumulative - 4) current += 1;
    var next = ms[current + 1] || null;

    if (!next) {
      result.arrow = '◉';
      result.main = routeRemaining <= 25 ? '就在前面' : '再走 ' + routeRemaining + ' 米';
      result.sub = routeRemaining <= 25 ? '抬头看看周围' : '沿着这条路一直走';
      return result;
    }

    var turnIn = Math.max(0, Math.round(next.cumulative - walked));
    var direction = next.direction;
    var label = next.label;

    // 到达点
    if (direction === 'arrive') {
      result.arrow = '◉';
      result.main = turnIn <= 25 ? '就在前面' : '再走 ' + turnIn + ' 米就到了';
      result.sub = turnIn <= 25 ? '抬头看看周围' : '不用再拐弯';
      return result;
    }

    var straight = (direction === 'straight' || direction === 'slight-left' || direction === 'slight-right');
    if (straight) {
      result.arrow = window.BW_GEO.directionArrow(direction);
      result.main = turnIn > 120 ? '继续直行' : '继续直行 ' + turnIn + ' 米';
      result.sub = '保持在同一条路上';
      return result;
    }

    // 转弯：≤12 米就是「现在」，12~45 米给提前量，>45 米先直行
    // 滞回：一旦喊过「现在左拐」，直到真的走过这个转向点才换回
    var lock = state.navTurnLock;
    if (lock && lock.index === current + 1 && walked < next.cumulative + 8) {
      result.arrow = window.BW_GEO.directionArrow(direction);
      result.main = '现在' + label;
      result.sub = '拐过去继续走';
      return result;
    }
    if (turnIn <= 12) {
      state.navTurnLock = { index: current + 1 };
      result.arrow = window.BW_GEO.directionArrow(direction);
      result.main = '现在' + label;
      result.sub = '拐过去继续走';
      return result;
    }
    if (turnIn <= 45) {
      result.arrow = window.BW_GEO.directionArrow(direction);
      result.main = turnIn + ' 米后' + label;
      result.sub = '注意路口';
      return result;
    }
    result.arrow = '↑';
    result.main = '继续直行';
    result.sub = turnIn + ' 米后' + label;
    return result;
  }


  /* ============================================================
     路径视图（不露终点）
     - 只画「当前位置往前 220 米」这一段，末端渐隐，绝不画终点
     - 朝向：以路径前进方向为上（heading-up）
     - 箭头：「你」的位置，随行走沿路径移动
     - 距离终点 < 60 米时整段淡出，只留「快到了」
     ============================================================ */
  function pathViewHTML() {
    return '<section class="pathview" data-pathview aria-label="需要走的路径">' +
      '<svg class="pathview__svg" viewBox="0 0 320 196" preserveAspectRatio="xMidYMid meet" role="img" aria-label="前方路径示意图">' +

      '<g data-path-grid></g>' +
      '<g data-path-line></g>' +
      '<g data-path-behind></g>' +
      '<g data-path-chevrons></g>' +
      '<g data-path-arrow></g>' +
      '<g data-path-compass transform="translate(292,164)">' +
      '<circle r="14" fill="#FFFFFF" stroke="#E2E7F2" stroke-width="1"/>' +
      '<g data-compass-needle>' +
      '<path d="M 0 -9 L 4 0 L 0 -2 L -4 0 Z" fill="#FF6B6B"/>' +
      '<path d="M 0 9 L 4 0 L 0 2 L -4 0 Z" fill="#C7CEDB"/>' +
      '</g>' +
      '<text x="0" y="-18" text-anchor="middle" font-size="11" fill="#9CA3AF">北</text>' +
      '</g>' +
      '</svg>' +
      '<p class="pathview__cap" data-path-cap>迷雾模式 · 只看见前后一段</p>' +
      '</section>';
  }

  /* 路径迷雾视图用的工具：累计距离表 + 按「沿路径里程」取点 */
  var routeCum = null;

  function buildRouteCum(route) {
    var pts = route.points || [];
    var cum = [0];
    for (var i = 0; i < pts.length - 1; i += 1) {
      var d = window.BW_GEO.distanceOf
        ? window.BW_GEO.distanceOf({ lat: pts[i][1], lon: pts[i][0] }, { lat: pts[i + 1][1], lon: pts[i + 1][0] })
        : 0;
      cum.push(cum[cum.length - 1] + d);
    }
    routeCum = { pts: pts, cum: cum };
    return routeCum;
  }

  function pointAtAlong(route, cumData, sMeters) {
    if (!cumData) return null;
    var pts = cumData.pts;
    var cum = cumData.cum;
    if (sMeters <= 0) return { lat: pts[0][1], lon: pts[0][0] };
    for (var i = 0; i < cum.length - 1; i += 1) {
      if (sMeters <= cum[i + 1]) {
        var seg = cum[i + 1] - cum[i];
        var t = seg > 0 ? (sMeters - cum[i]) / seg : 0;
        return {
          lat: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t,
          lon: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t
        };
      }
    }
    var last = pts.length - 1;
    return { lat: pts[last][1], lon: pts[last][0] };
  }

  var pathRedrawTimer = null;
  function schedulePathRedraw() {
    if (pathRedrawTimer) return;
    pathRedrawTimer = window.setTimeout(function () {
      pathRedrawTimer = null;
      if (state.session && currentRoute() === '/journey') drawPathView(state.session);
    }, 60);
  }

  /** 重画路径视图（由 patchNav / 罗盘 / 定位定时调用） */
  function drawPathView(session) {
    var host = document.querySelector('[data-pathview]');
    if (!host) return;
    var svg = host.querySelector('.pathview__svg');
    if (!svg) return;
    var line = svg.querySelector('[data-path-line]');
    var chevrons = svg.querySelector('[data-path-chevrons]');
    var arrowG = svg.querySelector('[data-path-arrow]');
    var cap = host.querySelector('[data-path-cap]');


    if (!session || !isRealSession(session)) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    if (!state.route || !state.route.points || state.route.points.length < 2) {
      host.classList.add('pathview--empty');
      line.setAttribute('d', '');
      chevrons.innerHTML = '';
      arrowG.innerHTML = '';
      if (cap) cap.textContent = '正在规划路径…';
      return;
    }
    host.classList.remove('pathview--empty');

    var here = ui.lastFix || ui.myLocation;
    var progress = window.BW_GEO.routeProgress(state.route, here);
    if (!progress) return;

    var routeRemaining = Math.max(0, state.route.distanceMeters - progress.walked);
    // 保密：接近终点就整段淡出，不允许看见终点
    if (routeRemaining < 60) {
      line.setAttribute('d', '');
      chevrons.innerHTML = '';
      arrowG.innerHTML = '';
      if (cap) cap.textContent = '就在附近 · 抬头看看周围';
      return;
    }

    var pts = state.route.points;
    // 地图「朝上」的方向：优先你手机的朝向（转身地图就转），没有罗盘才用路线方向
    var hasCompass = ui.deviceHeading !== null && ui.deviceHeading !== undefined;
    var b = hasCompass ? ui.deviceHeading : (progress.bearing || 0);
    var rad = b * Math.PI / 180;
    var sinB = Math.sin(rad);
    var cosB = Math.cos(rad);
    var kx = Math.cos(progress.snappedLat * Math.PI / 180) * 111320;
    var ky = 110540;
    var CX = 160;
    var CY = 168;
    // 迷雾窗口：前后各一段；前方永远短于「剩余里程」，保证不露终点
    var AHEAD = Math.min(260, Math.max(120, routeRemaining - 25));
    var BEHIND = Math.min(140, Math.max(60, progress.walked - 5));
    var FOG = 46;               // 两端渐隐的过渡长度（米）

    if (!routeCum) buildRouteCum(state.route);

    // 沿路径按 6 米插值，得到迷雾窗口内的点（含前后）
    var local = [];
    var startS = Math.max(0, progress.walked - BEHIND);
    var endS = Math.min(state.route.distanceMeters, progress.walked + AHEAD);
    for (var sPos = startS; sPos <= endS + 0.001; sPos += 3) {
      var at = pointAtAlong(state.route, routeCum, sPos);
      if (!at) continue;
      var e = (at.lon - progress.snappedLon) * kx;
      var n = (at.lat - progress.snappedLat) * ky;
      local.push({
        s: sPos,
        along: e * sinB + n * cosB,
        lateral: e * cosB - n * sinB
      });
    }
    if (local.length < 2) return;

    // 自适应缩放：竖向前方 148px，横向不超出画布
    var scaleY = 148 / AHEAD;
    var minLat = Infinity;
    var maxLat = -Infinity;
    for (var q = 0; q < local.length; q += 1) {
      if (local[q].lateral < minLat) minLat = local[q].lateral;
      if (local[q].lateral > maxLat) maxLat = local[q].lateral;
    }
    var halfSpan = Math.max(12, Math.max(Math.abs(minLat), Math.abs(maxLat)) + 8);
    var scaleX = Math.min(scaleY, 118 / halfSpan);
    var midLat = (minLat + maxLat) / 2;
    var cX = Math.max(46, Math.min(274, CX - midLat * scaleX));

    function toScreenLocal(along, lateral) {
      return { x: cX + lateral * scaleX, y: CY - along * scaleY };
    }

    // 逐段绘制：两端透明度渐隐，未走过的后半段更淡（探索感）
    var behindG = svg.querySelector('[data-path-behind]');
    var aheadParts = '';
    var behindParts = '';
    for (var r2 = 0; r2 < local.length - 1; r2 += 1) {
      var a = local[r2];
      var b2 = local[r2 + 1];
      var pa = toScreenLocal(a.along, a.lateral);
      var pb = toScreenLocal(b2.along, b2.lateral);
      // 距窗口两端的距离 → 透明度
      var da = Math.min(a.s - startS, endS - a.s);
      var db = Math.min(b2.s - startS, endS - b2.s);
      var op = Math.min(1, Math.max(0, Math.min(da, db) / FOG));
      if (op <= 0.02) continue;
      var isBehind = (a.s < progress.walked);
      var ddx = pb.x - pa.x;
      var ddy = pb.y - pa.y;
      var dlen = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
      var ux = ddx / dlen;
      var uy = ddy / dlen;
      var ext = 0.9;   // 两端各延一点，避免 butt 端点留下细缝
      var seg = '<line x1="' + (pa.x - ux * ext).toFixed(1) + '" y1="' + (pa.y - uy * ext).toFixed(1) +
        '" x2="' + (pb.x + ux * ext).toFixed(1) + '" y2="' + (pb.y + uy * ext).toFixed(1) +
        '" stroke="' + (isBehind ? '#AEB8D6' : '#5B6CFF') + '" stroke-width="' + (isBehind ? 7 : 9) +
        '" stroke-linecap="butt" stroke-opacity="' + (op * (isBehind ? 0.55 : 1)).toFixed(2) + '"/>';
      if (isBehind) behindParts += seg;
      else aheadParts += seg;
    }
    line.innerHTML = aheadParts;
    if (behindG) behindG.innerHTML = behindParts;
    var PX_PER_M = scaleY;
    var CX_USE = cX;

    // 前方每 55 米一个行进箭头
    var chev = '';
    for (var mm = 40; mm <= AHEAD - 10; mm += 55) {
      var at2 = pointAtAlong(state.route, routeCum, progress.walked + mm);
      if (!at2) continue;
      var e3 = (at2.lon - progress.snappedLon) * kx;
      var n3 = (at2.lat - progress.snappedLat) * ky;
      var sp = toScreenLocal(e3 * sinB + n3 * cosB, e3 * cosB - n3 * sinB);
      var op2 = Math.min(1, Math.max(0, (AHEAD - mm) / FOG));
      chev += '<path d="M ' + (sp.x - 5).toFixed(1) + ' ' + (sp.y + 3).toFixed(1) +
        ' L ' + sp.x.toFixed(1) + ' ' + (sp.y - 4).toFixed(1) +
        ' L ' + (sp.x + 5).toFixed(1) + ' ' + (sp.y + 3).toFixed(1) +
        '" fill="none" stroke="rgba(17,24,39,.5)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="' + op2.toFixed(2) + '"/>';
    }
    chevrons.innerHTML = chev;

    // 你的箭头（偏离路径时画虚线连回路径）
    var userLat = here ? here.lat : progress.snappedLat;
    var userLon = here ? (here.lon !== undefined ? here.lon : here.lng) : progress.snappedLon;
    var ue = (userLon - progress.snappedLon) * kx;
    var un = (userLat - progress.snappedLat) * ky;
    var uLateral = ue * cosB - un * sinB;
    var ax = cX + uLateral * scaleX;
    var ay = CY;
    var deviated = Math.abs(uLateral) > 18;
    var pathHeadX = cX;
    var pathHeadY = CY;
    arrowG.innerHTML =
      (deviated ? '<line x1="' + pathHeadX + '" y1="' + pathHeadY + '" x2="' + ax.toFixed(1) + '" y2="' + ay +
        '" stroke="#FF6B6B" stroke-width="2" stroke-dasharray="4 4" opacity=".7"/>' : '') +
      '<g transform="translate(' + ax.toFixed(1) + ',' + ay + ')">' +
      '<circle r="17" fill="#5B6CFF" opacity=".22"/>' +
      '<circle r="12" fill="#FFFFFF" stroke="#5B6CFF" stroke-width="2.5"/>' +
      '<path d="M 0 -8 L 6 5 L 0 2 L -6 5 Z" fill="#111827"/>' +
      '</g>';

    // 指北针：画布上方是行进方向，所以北方向 = -bearing
    var compassNote = svg.querySelector('[data-compass-note]');
    var needle = svg.querySelector('[data-compass-needle]');
    if (needle) needle.setAttribute('transform', 'rotate(' + (-b).toFixed(1) + ')');
    if (cap) {
      if (deviated) {
        cap.textContent = '你离路径约 ' + Math.round(Math.abs(uLateral)) + ' 米 · 前方 ' + Math.round(routeRemaining) + ' 米';
      } else if (hasCompass) {
        cap.textContent = '跟随你的朝向 · 转身地图也会转';
      } else {
        cap.textContent = '迷雾模式 · 只看见前后一段';
      }
    }

    // 罗盘可用时，让 UI 上的「你」箭头始终朝上（地图已按朝向旋转）
    if (hasCompass && compassNote) {
      compassNote.textContent = '跟随朝向';
    }
  }

  /** 导航卡（整页唯一的距离数字与箭头都在这里） */
  function navCardHTML(session) {
    var nav = computeNav(session);
    state.navSnapshot = nav;
    state.clueSnapshot = session.unlockedHintCount;
    return '<section class="navcard" data-nav="1">' +
      '<div class="navcard__top">' +
      '<div class="navcard__arrow" data-nav-arrow aria-hidden="true">' + nav.arrow + '</div>' +
      '<div class="navcard__text">' +
      '<p class="navcard__main" data-nav-main>' + esc(nav.main) + '</p>' +
      '<p class="navcard__sub" data-nav-sub>' + esc(nav.sub) + '</p>' +
      '</div>' +
      '</div>' +
      '<div class="navcard__foot">' +
      '<span class="navcard__left">还剩 <b data-nav-remaining>' + nav.remaining + '</b> 米</span>' +
      '<span class="navcard__time" data-nav-time>约 ' + nav.minutes + ' 分钟</span>' +
      '</div>' +
      '</section>';
  }

  /** 原地刷新导航（不做整页重渲染，节流 600ms，内容不变就不动 DOM） */
  function patchNav(session) {
    if (!session) return;
    // 线索解锁 / 到达等结构变化：必须重渲染，不能只改文字
    if (state.clueSnapshot !== session.unlockedHintCount) {
      var first = state.clueSnapshot === undefined;
      state.clueSnapshot = session.unlockedHintCount;
      if (!first) {
        ui.navPatchAt = 0;
        renderJourney(true);
        return;
      }
    }
    var now = Date.now();
    if (ui.navPatchAt && now - ui.navPatchAt < 350) {
      if (!ui.navPatchTimer) {
        ui.navPatchTimer = window.setTimeout(function () {
          ui.navPatchTimer = null;
          patchNav(state.session);
        }, 380);
      }
      return;
    }
    ui.navPatchAt = now;

    var card = document.querySelector('[data-nav]');
    if (!card) return;
    var nav = computeNav(session);
    var prev = state.navSnapshot || {};
    state.navSnapshot = nav;

    if (prev.main !== nav.main) {
      var mainEl = card.querySelector('[data-nav-main]');
      if (mainEl) mainEl.textContent = nav.main;
    }
    if (prev.sub !== nav.sub) {
      var subEl = card.querySelector('[data-nav-sub]');
      if (subEl) subEl.textContent = nav.sub;
    }
    if (prev.arrow !== nav.arrow) {
      var arrowEl = card.querySelector('[data-nav-arrow]');
      if (arrowEl) arrowEl.textContent = nav.arrow;
    }
    if (prev.remaining !== nav.remaining) {
      var remEl = card.querySelector('[data-nav-remaining]');
      if (remEl) remEl.textContent = nav.remaining;
      var timeEl = card.querySelector('[data-nav-time]');
      if (timeEl) timeEl.textContent = '约 ' + nav.minutes + ' 分钟';
      // 大数字区同步（如果存在）
      var bigEl = document.querySelector('[data-big-remaining]');
      if (bigEl) bigEl.textContent = nav.remaining;
    }
    // 强调态
    card.classList.toggle('navcard--now', /^现在/.test(nav.main));

    // 路径视图（只画前方窗口，终点不显示）
    drawPathView(session);

    // 「接下来」列表：走一段后距离会变，必须跟着刷，否则显示的是旧数字
    var list = computeUpcoming(session);
    var key = upcomingKey(list);
    var box = document.querySelector('[data-upcoming]');
    if (key !== state.upcomingSnapshot) {
      state.upcomingSnapshot = key;
      if (!list.length) {
        if (box) box.parentNode.removeChild(box);
      } else if (box) {
        box.innerHTML = '<p class="upcoming__title">接下来</p>' + list.map(function (x) {
          return '<div class="upcoming__row">' +
            '<span class="upcoming__arrow" aria-hidden="true">' + x.arrow + '</span>' +
            '<span class="upcoming__label">' + esc(x.label) + '</span>' +
            (x.distance === null ? '' : '<span class="upcoming__dist">' + x.distance + ' 米</span>') +
            '</div>';
        }).join('');
      }
    }

    // 线索里的「再走 X 米」也要跟着走，不然三处数字互相打架
    var locked = document.querySelectorAll('[data-clue-locked-index]');
    for (var i = 0; i < locked.length; i += 1) {
      var idx = parseInt(locked[i].getAttribute('data-clue-locked-index'), 10);
      var threshold = D.HINT_THRESHOLDS[idx];
      locked[i].textContent = threshold === undefined ? '到了你就知道'
        : '再走 ' + Math.max(0, nav.remaining - threshold) + ' 米，解锁' +
          (idx === 1 ? '第二条' : '第三条') + '线索';
    }
  }

  /** 「接下来」的数据（渲染与局部刷新共用，保证两处数字同源） */
  function computeUpcoming(session) {
    if (!isRealSession(session) || !state.route || !window.BW_GEO.routeProgress) return [];
    var progress = window.BW_GEO.routeProgress(state.route, ui.lastFix || ui.myLocation);
    if (!progress) return [];
    var ms = state.route.maneuvers || [];
    var walked = progress.walked;
    var current = 0;
    while (current + 1 < ms.length && walked >= ms[current + 1].cumulative - 4) current += 1;
    var list = [];
    for (var i = current + 2; i < ms.length; i += 1) {
      var m = ms[i];
      if (m.direction === 'start' || m.direction === 'straight' || m.direction === 'arrive') continue;
      var at = Math.round(m.cumulative - walked);
      if (at < 3) continue;
      if (list.length >= 3) break;
      list.push({
        arrow: window.BW_GEO.directionArrow(m.direction),
        label: m.label,
        distance: at
      });
    }
    // 后面没有转弯了：明确告诉「一条道走到目的地」，别让列表凭空消失
    if (!list.length) {
      var left = Math.max(0, Math.round(state.route.distanceMeters - walked));
      if (left > 20) {
        list.push({ arrow: '◉', label: '一路直走到目的地', distance: null });
      }
    }
    return list;
  }

  function upcomingKey(list) {
    return list.map(function (x) { return x.label + x.distance; }).join('|');
  }

  function navUpcomingHTML(session) {
    var list = computeUpcoming(session);
    state.upcomingSnapshot = upcomingKey(list);
    if (!list.length) return '';
    return '<section class="upcoming" data-upcoming="1" aria-label="接下来的路线">' +
      '<p class="upcoming__title">接下来</p>' +
      list.map(function (x) {
        return '<div class="upcoming__row">' +
          '<span class="upcoming__arrow" aria-hidden="true">' + x.arrow + '</span>' +
          '<span class="upcoming__label">' + esc(x.label) + '</span>' +
          (x.distance === null ? '' : '<span class="upcoming__dist">' + x.distance + ' 米</span>') +
          '</div>';
      }).join('') +
      '</section>';
  }

  /** 真实来源：OSM POI / 维基百科地标 / 仅真实坐标，都算「真的在城市里走」 */
  /** 当前盲盒的「数据来源」标签：让人一眼看出是真地点还是演示 */
  function sourceBadgeHTML(place) {
    if (!place) return '';
    var source = place.source || 'catalog';
    if (source === 'curated') {
      return '<span class="srcbadge srcbadge--curated">编辑精选</span>';
    }
    if (source === 'wikipedia') {
      return '<span class="srcbadge srcbadge--real">真实地标</span>';
    }
    if (source === 'amap') {
      return '<span class="srcbadge srcbadge--real">高德地点</span>';
    }
    if (source === 'baidu') {
      return '<span class="srcbadge srcbadge--real">百度地点</span>';
    }
    if (source === 'osm') {
      return '<span class="srcbadge srcbadge--real">真实地点</span>';
    }
    return '<span class="srcbadge srcbadge--demo">演示地点</span>';
  }

  function isRealSource(source) {
    // 注意：'geo' 是程序编出来的坐标兜底点（假的），绝不算真实地点。
    return source === 'osm' || source === 'wikipedia' || source === 'curated'
      || source === 'amap' || source === 'baidu' || source === 'wiki';
  }

  function isRealSession(session) {
    return !!session && isRealSource(session.source);
  }

  /* 真实定位状态条 */
  function realStatusHTML() {
    var session = state.session;
    if (!session) return '';
    var place = placeOf(session.placeID);
    var badge = sourceBadgeHTML(place);
    if (isRealSource(session.source)) {
      var realLabel = '实时定位 · 真实地点';
      return '<span class="geo-pill geo-pill--live"><i aria-hidden="true"></i>' + realLabel + '</span>' +
        '<span class="geo-pill geo-pill--gps">GPS</span>' + badge;
    }
    // 演示模式：明确告诉用户为什么，并给一个「要用真定位」的出口
    return '<span class="geo-pill geo-pill--demo"><i aria-hidden="true"></i>演示模式 · 内置地点</span>' +
      badge +
      '<button type="button" class="geo-pill geo-pill--action" data-action="retry-real">用真实定位重开</button>';
  }

  /* 真实方位：如有手机朝向则相对朝向显示 */
  function realBearingSymbol(session, remaining) {
    if (isRealSession(session) && typeof session.bearing === 'number') {
      var rel = session.bearing - (ui.lastHeading || 0);
      var arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
      var idx = Math.round(((rel % 360) + 360) % 360 / 45) % 8;
      return arrows[idx];
    }
    return bearingFor(remaining);
  }

  function realWalkCopy(session, fallbackCopy) {
    if (isRealSession(session) && typeof session.bearing === 'number') {
      var compass = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
      var idx = Math.round((((session.bearing % 360) + 360) % 360) / 45) % 8;
      return '往' + compass[idx] + '走，别急';
    }
    return fallbackCopy;
  }

  function revealCardHTML() {
    var reveal = state.reveal;
    var place = placeOf(reveal.placeID);
    var info = rarityOf(place);
    var collected = reveal.collected;
    var primary = collected
      ? '<button type="button" class="btn btn--primary" data-action="go-cards" aria-label="去回忆册看看">去看看图鉴</button>'
      : '<button type="button" class="btn btn--primary" data-action="collect" aria-label="收进图鉴">收进图鉴</button>';
    var share = reveal.shared
      ? '<button type="button" class="btn btn--ghost" disabled aria-label="已分享到圈子">已分享</button>'
      : '<button type="button" class="btn btn--ghost" data-action="share" aria-label="分享到圈子">分享</button>';

    return '<div class="reveal-stage" role="dialog" aria-modal="true" aria-label="盲盒揭晓">' +
      '<div class="reveal-stage__bar">' +
      '<span aria-hidden="true">' + formatClock() + '</span>' +
      statusBarMarkup() +
      '<button type="button" class="reveal-stage__close" data-action="close-reveal" aria-label="关闭揭晓">' + ICON.close + '</button>' +
      '</div>' +
      '<div class="reveal-wrap">' +
      '<article class="reveal-card">' +
      '<div class="reveal-card__top">' +
      '<span class="serial">No.' + esc(reveal.serial) + '</span>' +
      ratingBadge(place.rarity) +
      '</div>' +
      (place.photoUrl
        ? '<figure class="reveal-card__figure" data-photo-figure data-photo-url="' + esc(place.photoUrl) + '">' +
            '<div class="reveal-card__photoloading" data-photo-loading>' +
              '<span class="reveal-card__spinner" aria-hidden="true"></span>' +
              '<p>照片加载中…</p>' +
            '</div>' +
            '<div class="reveal-card__photofallback" data-photo-fallback hidden>' +
              '<span aria-hidden="true">' + (place.categoryEmoji || '🖼️') + '</span>' +
              '<p>照片没加载出来</p>' +
              '<button type="button" data-action="retry-photo">重新加载</button>' +
            '</div>' +
            '<img class="reveal-card__photo" data-photo-img src="' + esc(place.photoUrl) + '" alt="' + esc(place.name) + ' 的实景照片" loading="eager" decoding="async" referrerpolicy="no-referrer" hidden>' +
            '<figcaption class="reveal-card__credit">图片 · ' + esc(place.photoCredit || 'Wikimedia Commons') + '</figcaption>' +
          '</figure>'
        : '') +
      '<div class="reveal-card__hero">' +
      '<span class="reveal-card__emoji" aria-hidden="true">' + place.categoryEmoji + '</span>' +
      '<h2 class="reveal-card__name">' + esc(place.name) + '</h2>' +
      '<p class="reveal-card__area">' + esc(placeAreaWord(place)) + ' · ' + esc(place.category) +
      (place.address ? ' · ' + esc(place.address) : '') +
      (isRealSource(place.source) ? ' · 真实地点' : '') + '</p>' +
      '</div>' +
      '<div class="rule"></div>' +
      '<p class="reveal-card__label">为什么是这里：</p>' +
      '<p class="reveal-card__why">' + esc(place.why) + '</p>' +
      '<div class="rule"></div>' +
      '<div class="taskcard">' +
      '<div class="taskcard__body">' +
      '<p class="taskcard__title">🎯 小任务：</p>' +
      '<p class="taskcard__text">' + esc(place.task) + '</p>' +
      '</div>' +
      '<span class="taskcard__hint">完成后点一下</span>' +
      '</div>' +
      '<div class="reveal-card__actions">' + primary + share + '</div>' +
      (collected ? '<p class="reveal-card__after">它现在是你的了。</p>' : '') +
      '</article>' +
      '</div>' +
      '</div>';
  }

  function revealOpenHTML() {
    var confetti = '';
    var colors = ['#5B6CFF', '#F3F5FB', '#FF6B6B', '#14B8A6', '#F59E0B', '#FFFFFF'];
    for (var i = 0; i < 18; i += 1) {
      var dx = Math.round((Math.random() - 0.5) * 300);
      var dy = Math.round(-60 - Math.random() * 150);
      var rot = Math.round(120 + Math.random() * 420);
      var delay = (Math.random() * 0.22).toFixed(2);
      confetti += '<span class="confetti" style="--dx:' + dx + 'px;--dy:' + dy + 'px;--rot:' + rot + 'deg;--delay:' + delay +
        's;background:' + colors[i % colors.length] + '"></span>';
    }
    return '<div class="reveal-stage" role="dialog" aria-modal="true" aria-label="正在开盒">' +
      '<div class="reveal-stage__bar">' +
      '<span aria-hidden="true">' + formatClock() + '</span>' +
      statusBarMarkup() +
      '<span style="width:30px" aria-hidden="true"></span>' +
      '</div>' +
      '<div class="reveal-open">' +
      '<span class="open-glow" aria-hidden="true"></span>' +
      confetti +
      revealBoxSVG() +
      '<p class="reveal-open__copy">这次，城市选了这个地方。</p>' +
      '</div>' +
      '</div>';
  }

  /** 揭晓照片加载失败 → 显示占位 + 重试按钮（不显示破图） */
  function bindRevealPhoto() {
    var figure = document.querySelector('[data-photo-figure]');
    if (!figure) return;
    var img = figure.querySelector('[data-photo-img]');
    var fallback = figure.querySelector('[data-photo-fallback]');
    var loading = figure.querySelector('[data-photo-loading]');
    if (!img || !fallback) return;
    var showFallback = function () {
      img.hidden = true;
      fallback.hidden = false;
      if (loading) loading.hidden = true;
      figure.classList.add('is-broken');
    };
    var showImage = function () {
      img.hidden = false;
      fallback.hidden = true;
      if (loading) loading.hidden = true;
      figure.classList.remove('is-broken');
    };
    img.addEventListener('load', function () {
      if (img.naturalWidth > 0) showImage(); else showFallback();
    });
    img.addEventListener('error', showFallback);
    if (img.complete) {
      if (img.naturalWidth > 0) showImage(); else showFallback();
    }
    window.setTimeout(function () {
      if (!img.complete || img.naturalWidth === 0) showFallback();
    }, 7000);
  }

  function renderReveal() {
    var reveal = state.reveal;
    if (!reveal) {
      var placeID = D.DEMO.reveal.placeID;
      state.reveal = {
        placeID: placeID,
        serial: D.DEMO.reveal.serial,
        collected: false,
        shared: false,
        xpGained: 40 + D.RARITY[placeOf(placeID).rarity].xpBonus
      };
      reveal = state.reveal;
    }
    if (!placeOf(reveal.placeID)) {
      state.reveal = { placeID: D.DEMO.reveal.placeID, serial: D.DEMO.reveal.serial, collected: false, shared: false, xpGained: 50 };
      reveal = state.reveal;
    }
    if (!ui.revealPhase) ui.revealPhase = 'card';

    if (ui.revealPhase === 'open') {
      dom.overlayRoot.innerHTML = revealOpenHTML();
      var open = $('.reveal-open', dom.overlayRoot);
      if (open && !reducedMotion()) {
        open.classList.add('is-opening');
      }
      var delay = reducedMotion() ? 80 : 1180;
      timers.reveal.push(setTimeout(function () {
        ui.revealPhase = 'card';
        renderReveal();
      }, delay));
      return;
    }

    dom.overlayRoot.innerHTML = revealCardHTML();
    bindRevealPhoto();
  }

  function cardsHTML() {
    var profile = state.profile;
    var cardMap = {};
    profile.cards.forEach(function (card) { cardMap[card.placeID] = card; });

    // 内置地点 + 抽到过的真实地点（真实地点只在抽到后进入图鉴）
    var allPlaces = D.PLACES.slice();
    Object.keys(state.realPlaces || {}).forEach(function (id) {
      if (!D.PLACE_MAP[id]) allPlaces.push(state.realPlaces[id]);
    });

    var filtered = allPlaces.filter(function (place) {
      if (ui.filter === 'rare') return place.rarity !== 'common';
      if (ui.filter === 'hidden') return place.rarity === 'hidden';
      if (ui.filter === 'area') return place.area === filterArea();
      return true;
    });

    filtered.sort(function (a, b) {
      var cardA = cardMap[a.id];
      var cardB = cardMap[b.id];
      if (cardA && cardB) return cardB.collectedAt - cardA.collectedAt;
      if (cardA) return -1;
      if (cardB) return 1;
      return allPlaces.indexOf(a) - allPlaces.indexOf(b);
    });

    var grid = filtered.map(function (place) {
      var card = cardMap[place.id];
      if (!card) {
        return '<div class="fcard fcard--locked" aria-label="未解锁"><span class="fcard__q" aria-hidden="true">?</span>' +
          '<span class="fcard__lock" aria-hidden="true">🔒</span></div>';
      }
      return '<button type="button" class="fcard" data-action="open-card" data-id="' + esc(place.id) + '"' +
        ' aria-label="' + esc(place.name + '，' + D.RARITY[place.rarity].label) + '">' +
        (place.photoUrl ? '<span class="fcard__photo" style="background-image:url(\'' + esc(place.photoUrl) + '\')" aria-hidden="true"></span>' : '') +
        '<span class="fcard__emoji" aria-hidden="true">' + place.categoryEmoji + '</span>' +
        '<span class="fcard__name">' + esc(place.name) + '</span>' +
        '<span class="fcard__date">' + formatShortDate(card.collectedAt) + '</span>' +
        '<i class="rdot rdot--' + place.rarity + ' fcard__dot" aria-hidden="true"></i>' +
        '</button>';
    }).join('');

    var filters = [
      { id: 'all', label: '全部' },
      { id: 'rare', label: '稀有' },
      { id: 'hidden', label: '隐藏' },
      { id: 'area', label: '本区' }
    ].map(function (filter) {
      return '<button type="button" class="chipbtn" data-action="filter" data-value="' + filter.id + '"' +
        ' aria-pressed="' + (ui.filter === filter.id) + '" aria-label="筛选：' + filter.label + '">' + filter.label + '</button>';
    }).join('');

    return '<div class="page">' +
      '<header class="pagehead">' +
      '<h1>回忆册</h1>' +
      '<div class="pagehead__right">' +
      '<button type="button" class="iconbtn iconbtn--line" data-action="cycle-filter" aria-label="切换筛选">' + ICON.filter + '</button>' +
      '</div>' +
      '</header>' +
      '<p class="collectstats">已收集 <b>' + profile.cards.length + '</b>/' + D.PLACES.length +
      '<i>·</i>稀有 <b>' + rareCount() + '</b><i>·</i>隐藏 <b>' + hiddenCount() + '</b></p>' +
      '<div class="filters" role="group" aria-label="筛选卡片">' + filters + '</div>' +
      '<div class="fcards">' + grid + '</div>' +
      '</div>';
  }

  function filterArea() {
    var latest = latestCard();
    return latest ? areaOf(latest.placeID) : 'river';
  }

  function socialHTML() {
    var profile = state.profile;
    var feed = state.feed;

    var feedMarkup = feed.length ? feed.map(function (post) {
      var react = function (id, icon, key, label) {
        var pressed = !!(post.reacted && post.reacted[key]);
        return '<button type="button" class="react" data-action="react" data-post="' + esc(post.id) + '" data-reaction="' + key + '"' +
          ' aria-pressed="' + pressed + '" aria-label="' + esc(label + ' ' + post.reactions[key]) + '">' +
          '<span aria-hidden="true">' + icon + '</span><span>' + post.reactions[key] + '</span></button>';
      };
      return '<article class="post">' +
        '<div class="post__head">' +
        '<span class="post__avatar" aria-hidden="true">' + post.authorEmoji + '</span>' +
        '<div class="post__who"><span class="post__name">' + esc(post.authorName) + '</span>' +
        '<span class="post__time">' + esc(relativeTime(post.createdAt)) + '</span></div>' +
        '<span class="post__tag">揭晓</span>' +
        '</div>' +
        '<div class="post__mini">' +
        '<span class="post__mini-emoji" aria-hidden="true">' + post.categoryEmoji + '</span>' +
        '<span class="post__mini-name">' + esc(post.placeName) + '</span>' +
        ratingBadge(post.rarity) +
        '</div>' +
        '<p class="post__caption">' + esc(post.caption) + '</p>' +
        '<div class="post__reactions" role="group" aria-label="回应">' +
        react('eyes', '👀', 'eyes', '羡慕') +
        react('heart', '🫶', 'heart', '一起') +
        react('next', '下次带我', 'next', '下次带我') +
        '</div>' +
        '</article>';
    }).join('') : '<div class="empty">' + emptyArtSVG() +
      '<p>还没有人分享今晚的惊喜。</p><span>去开一个盲盒，把第一个留在这里。</span>' +
      '<a class="btn btn--primary" href="#/setup" style="height:44px;margin-top:10px;padding:0 26px;font-size:14px">开一个盲盒</a>' +
      '</div>';

    var entries = D.LEADERBOARD.map(function (entry) {
      return { id: entry.id, name: entry.name, emoji: entry.emoji, score: entry.score, isMe: false };
    }).concat([{
      id: 'me', name: profile.displayName, emoji: '🫥', score: weeklySurprise(), isMe: true
    }]).sort(function (a, b) { return b.score - a.score; });

    entries.forEach(function (entry, index) { entry.rank = index + 1; });

    var top = entries.slice(0, 3);
    var mine = entries.filter(function (entry) { return entry.isMe; })[0];
    var rest = entries.slice(3);
    var rows = top.slice();

    if (mine && mine.rank > 3) {
      rows.push(mine);
      rest = rest.filter(function (entry) { return !entry.isMe; });
    }
    if (ui.boardOpen) rows = rows.concat(rest);

    var boardRows = rows.map(function (entry) {
      return '<div class="board__row' + (entry.isMe ? ' board__row--me' : '') + '">' +
        '<span class="board__rank board__rank--' + entry.rank + '" aria-hidden="true">' + entry.rank + '</span>' +
        '<span class="board__avatar" aria-hidden="true">' + entry.emoji + '</span>' +
        '<span class="board__name">' + esc(entry.name) + (entry.isMe ? '<i>你</i>' : '') + '</span>' +
        '<span class="board__score">' + entry.score + '</span>' +
        '</div>';
    }).join('');

    var more = (!ui.boardOpen && rest.length)
      ? '<button type="button" class="board__more" data-action="board-more" aria-label="展开其余排名">展开 · 其余 ' + rest.length + ' 位</button>'
      : (ui.boardOpen && rest.length
        ? '<button type="button" class="board__more" data-action="board-more" aria-label="收起排名">收起</button>'
        : '');

    return '<div class="page">' +
      '<header class="pagehead">' +
      '<h1>圈子</h1>' +
      '<div class="pagehead__right">' +
      '<button type="button" class="chipbtn" data-action="copy-code" aria-label="复制同频码">同频</button>' +
      '</div>' +
      '</header>' +
      '<section class="codecard" aria-label="同频码">' +
      '<h2 class="codecard__title">今晚一起走？</h2>' +
      '<p class="codecard__sub">把这串码给朋友，各自开盒。</p>' +
      '<div class="codecard__row">' +
      '<span class="codecard__code">' + D.TOGETHER_CODE + '</span>' +
      '<button type="button" class="codecard__copy" data-action="copy-code" aria-label="复制同频码 ' + D.TOGETHER_CODE + '">复制</button>' +
      '</div>' +
      '<p class="codecard__hint">好友输入同频码，各自开盒，结束后交换线索</p>' +
      '</section>' +
      '<div class="section-head"><h2>本周榜</h2><span style="font-size:10px;color:var(--ink-3);letter-spacing:.02em">惊喜指数</span></div>' +
      '<div class="board">' + boardRows + more + '</div>' +
      '<div class="section-head"><h2>今晚的惊喜</h2></div>' +
      '<div class="feed">' + feedMarkup + '</div>' +
      '</div>';
  }

  function profileHTML() {
    var profile = state.profile;
    var level = levelInfo();
    var achievements = achievementList();
    var unlocked = achievements.filter(function (item) { return item.unlocked; });

    var strip = achievements.map(function (item) {
      return '<a class="abadge ' + (item.unlocked ? 'abadge--on' : 'abadge--off') + '" href="#/achievements"' +
        ' title="' + esc(item.def.name) + '：' + esc(item.def.detail) + '"' +
        ' aria-label="' + esc(item.def.name + (item.unlocked ? '，已获得' : '，未解锁')) + '">' +
        '<span class="abadge__icon" aria-hidden="true">' + item.def.icon + '</span>' +
        '<span>' + esc(item.def.name) + '</span></a>';
    }).join('');

    var settings = '<div class="settings">' +
      '<button type="button" class="setting" data-action="toggle-setting" data-key="sound" aria-label="音效">' +
      '<span class="setting__label">音效</span>' +
      '<span class="switch" role="switch" aria-checked="' + !!state.settings.sound + '" aria-label="音效开关"></span>' +
      '</button>' +
      '<button type="button" class="setting" data-action="toggle-setting" data-key="haptic" aria-label="触感">' +
      '<span class="setting__label">触感</span>' +
      '<span class="switch" role="switch" aria-checked="' + !!state.settings.haptic + '" aria-label="触感开关"></span>' +
      '</button>' +
      '<button type="button" class="setting" data-action="privacy" aria-label="隐私与安全">' +
      '<span class="setting__label">隐私与安全</span>' +
      '<span class="setting__chev" aria-hidden="true">' + ICON.chevron + '</span>' +
      '</button>' +
      '<button type="button" class="setting setting--danger" data-action="clear-data" aria-label="清除演示数据">' +
      '<span class="setting__label">清除演示数据</span>' +
      '<span class="setting__chev" aria-hidden="true">' + ICON.chevron + '</span>' +
      '</button>' +
      '<button type="button" class="setting" data-action="go-account" aria-label="账号">' +
      '<span class="setting__label">账号 <em class="acc__state">' + (accountConfig().user ? esc(accountConfig().user.username) : '未登录') + '</em></span>' +
      '<span class="setting__chev" aria-hidden="true">' + ICON.chevron + '</span>' +
      '</button>' +
      '<button type="button" class="setting" data-action="go-datasource" aria-label="数据源">' +
      '<span class="setting__label">数据源（高德 / 百度 / OSM）</span>' +
      '<span class="setting__chev" aria-hidden="true">' + ICON.chevron + '</span>' +
      '</button>' +
      '<button type="button" class="setting" data-action="open-debug" aria-label="打开诊断信息">' +
      '<span class="setting__label">诊断（数据来源 / 定位状态）</span>' +
      '<span class="setting__chev" aria-hidden="true">' + ICON.chevron + '</span>' +
      '</button>' +
      '</div>';

    return '<div class="page">' +
      '<header class="pagehead"><h1>我的</h1>' +
      '<span class="verstamp">' + APP_VERSION + '</span></header>' +
      '<section class="levelcard" aria-label="等级">' +
      '<div class="levelcard__top">' +
      '<p class="levelcard__lv">散步 Lv.' + level.level + '<small>· ' + esc(level.name) + '</small></p>' +
      '<span class="levelcard__avatar" aria-hidden="true">🫥</span>' +
      '</div>' +
      '<div class="levelbar">' +
      '<div class="levelbar__track" role="progressbar" aria-valuemin="0" aria-valuemax="800" aria-valuenow="' + level.into + '" aria-label="等级经验 ' + level.into + '/800">' +
      '<div class="levelbar__fill" style="width:' + (level.pct * 100).toFixed(1) + '%"></div>' +
      '</div>' +
      '<div class="levelbar__meta"><span>' + level.into + '/800</span><span>距离下一级 ' + (800 - level.into) + '</span></div>' +
      '</div>' +
      '<div class="levelstats">' +
      '<div><b>' + profile.totalKm.toFixed(1) + '<span style="font-size:8px;color:rgba(17,24,39,.45);margin-left:2px">km</span></b><span>累计里程</span></div>' +
      '<div><b>' + profile.boxesOpened + '</b><span>开盒</span></div>' +
      '<div><b>' + profile.streakDays + '</b><span>连续天数</span></div>' +
      '</div>' +
      '</section>' +
      '<div class="section-head"><h2>成就</h2><a href="#/achievements" style="font-size:10.5px;color:var(--ink-3);text-decoration:none" aria-label="查看全部成就">全部成就 ›</a></div>' +
      '<div class="strip">' + strip + '</div>' +
      '<div class="section-head"><h2>设置</h2></div>' +
      settings +
      '<p class="version">BlindWalk 0.1 · 原型</p>' +
      '</div>';
  }

  function achievementsHTML() {
    var items = achievementList();
    var unlocked = items.filter(function (item) { return item.unlocked; }).length;
    var rows = items.map(function (item) {
      var pct = Math.round((item.progress / item.def.target) * 100);
      return '<article class="arow ' + (item.unlocked ? 'arow--on' : 'arow--off') + '">' +
        '<span class="arow__icon" aria-hidden="true">' + item.def.icon + '</span>' +
        '<div class="arow__body">' +
        '<div class="arow__name">' + esc(item.def.name) + '</div>' +
        '<p class="arow__detail">' + esc(item.def.detail) + '</p>' +
        '<div class="arow__track" role="progressbar" aria-valuemin="0" aria-valuemax="' + item.def.target + '" aria-valuenow="' + item.progress + '" aria-label="' + esc(item.def.name) + '进度"><div class="arow__fill" style="width:' + pct + '%"></div></div>' +
        '</div>' +
        '<div class="arow__right">' +
        (item.unlocked ? '<span class="seal">已获得</span>' : '<span class="arow__num">' + item.progress + '/' + item.def.target + '</span>') +
        '</div>' +
        '</article>';
    }).join('');

    return '<div class="page">' +
      '<header class="pushhead">' +
      '<button type="button" class="iconbtn" data-action="back-home" aria-label="返回我的">' + ICON.back + '</button>' +
      '<h1>成就</h1>' +
      '<span class="pushhead__count">' + unlocked + '/' + items.length + '</span>' +
      '</header>' +
      '<div class="alist">' + rows + '</div>' +
      '</div>';
  }

  function watchProgressFaceMarkup() {
    return '<div class="watchface watchface--progress" role="img" aria-label="手表进度表盘：剩余 480 米，进度 62%">' +
      '<svg class="watchface__ring" viewBox="0 0 198 242" aria-hidden="true">' +
      '<circle cx="99" cy="121" r="84" fill="none" stroke="rgba(255,255,255,.13)" stroke-width="7"/>' +
      '<circle cx="99" cy="121" r="84" fill="none" stroke="#5B6CFF" stroke-width="7" stroke-linecap="round" stroke-dasharray="527.8" stroke-dashoffset="200.6" transform="rotate(-90 99 121)"/>' +
      '</svg>' +
      '<div class="watchface__inner">' +
      '<span class="watchface__cap">盲盒进行中</span>' +
      '<div class="watchface__big">480<small>m</small></div>' +
      '<span class="watchface__foot">线索 1/3 · 点按查看</span>' +
      '</div>' +
      '</div>';
  }

  function watchPreviewHTML() {
    return '<div class="page">' +
      '<header class="pushhead">' +
      '<button type="button" class="iconbtn" data-action="back-home" aria-label="返回首页">' + ICON.back + '</button>' +
      '<h1>手表伴行</h1>' +
      '</header>' +
      '<div class="watchpreview">' +
      '<div class="watchpreview__face">' + watchProgressFaceMarkup() + '</div>' +
      '<div class="watchpreview__copy">' +
      '<h2>抬起手腕，看一眼还有多远。</h2>' +
      '<p>目的地依旧保密。手表只告诉你距离、方向和正在解锁的线索。</p>' +
      '</div>' +
      '<a class="watchpreview__link" href="watch.html">' + ICON.watch + '打开三块表盘</a>' +
      '</div>' +
      '</div>';
  }

  /* ============================================================
     弹层
     ============================================================ */
  function modalShell(inner, label) {
    return '<div class="modal-scrim" data-action="close-modal">' +
      '<div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(label) + '">' + inner + '</div>' +
      '</div>';
  }

  function openCardModal(placeID) {
    var place = placeOf(placeID);
    var card = null;
    state.profile.cards.forEach(function (item) { if (item.placeID === placeID) card = item; });
    if (!place || !card) return;
    var inner = '<div class="modal__top">' +
      '<span class="serial">No.' + esc(card.serial) + '</span>' +
      '<button type="button" class="modal__close" data-action="close-modal" aria-label="关闭">' + ICON.close + '</button>' +
      '</div>' +
      '<div class="modal__card-hero">' +
      '<span class="reveal-card__emoji" aria-hidden="true">' + place.categoryEmoji + '</span>' +
      '<h3>' + esc(place.name) + '</h3>' +
      '<span class="modal__area">' + esc(placeAreaWord(place)) + ' · ' + esc(D.RARITY[place.rarity].label) + '</span>' +
      '</div>' +
      '<div class="rule" style="margin:11px 0"></div>' +
      '<p class="reveal-card__label">为什么是这里：</p>' +
      '<p class="reveal-card__why">' + esc(place.why) + '</p>' +
      '<div class="taskcard" style="margin-top:12px">' +
      '<div class="taskcard__body"><p class="taskcard__title">🎯 小任务：</p>' +
      '<p class="taskcard__text">' + esc(place.task) + '</p></div>' +
      '</div>' +
      '<div class="modal__actions"><button type="button" class="btn btn--primary" data-action="close-modal">知道了</button></div>';
    dom.overlayRoot.innerHTML = modalShell(inner, '地点卡片');
  }

  function openAboutModal() {
    var inner = '<div class="modal__top"><span class="micro">关于</span>' +
      '<button type="button" class="modal__close" data-action="close-modal" aria-label="关闭">' + ICON.close + '</button></div>' +
      '<h3>步谜 StepRiddle</h3>' +
      '<div class="modal__body" style="margin-top:8px">' +
      '<p>不看见终点，才看得见路。</p>' +
      '<p>打开一个散步盲盒，它只带你走，不告诉你去哪；到了，才揭晓这个地方藏着的小惊喜。</p>' +
      '<p style="color:var(--ink-3);font-size:11px">原型 0.1 · 所有地点为虚构演示数据 · 数据只存在本机</p>' +
      '</div>' +
      '<div class="modal__actions"><button type="button" class="btn btn--primary" data-action="close-modal">好</button></div>';
    dom.overlayRoot.innerHTML = modalShell(inner, '关于步谜');
  }

  function openPrivacyModal() {
    var inner = '<div class="modal__top"><span class="micro">隐私与安全</span>' +
      '<button type="button" class="modal__close" data-action="close-modal" aria-label="关闭">' + ICON.close + '</button></div>' +
      '<h3>走路的事，只属于你</h3>' +
      '<div class="modal__body" style="margin-top:8px">' +
      '<p>夜里只带你去灯亮、人多的地方。地点库全部是公共场所。</p>' +
      '<p>走路别戴耳机，留一只耳朵给城市。</p>' +
      '<p>分享只在你点「分享」之后发生；其余时间，路线和目的地都留在本机。</p>' +
      '</div>' +
      '<div class="modal__actions"><button type="button" class="btn btn--primary" data-action="close-modal">知道了</button></div>';
    dom.overlayRoot.innerHTML = modalShell(inner, '隐私与安全');
  }

  function openClearModal() {
    var inner = '<div class="modal__top"><span class="micro">危险操作</span>' +
      '<button type="button" class="modal__close" data-action="close-modal" aria-label="关闭">' + ICON.close + '</button></div>' +
      '<h3>清除本机演示数据？</h3>' +
      '<div class="modal__body" style="margin-top:8px">' +
      '<p>18 张回忆卡、等级、成就和动态都会被清空，回到一个全新的夜晚。</p>' +
      '<p>这个操作不能撤销。</p>' +
      '</div>' +
      '<div class="modal__actions">' +
      '<button type="button" class="btn btn--ghost" data-action="close-modal">算了</button>' +
      '<button type="button" class="btn btn--primary" data-action="confirm-clear">清除</button>' +
      '</div>';
    dom.overlayRoot.innerHTML = modalShell(inner, '清除演示数据');
  }

  function closeModal() {
    var modal = $('.modal-scrim', dom.overlayRoot);
    if (modal) modal.parentNode.removeChild(modal);
  }

  /* ============================================================
     埋惊喜 / 寻惊喜（与 apple/Shared/Core/Surprise.swift 对齐）
     ============================================================ */

  /* ---- dHash 感知哈希：9×8 灰度差分 → 64 位字符串 ---- */
  var DHASH_W = 9, DHASH_H = 8;
  var MATCH_PASS = 0.45;

  function photoToGray(image) {
    var canvas = document.createElement('canvas');
    canvas.width = DHASH_W;
    canvas.height = DHASH_H;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, DHASH_W, DHASH_H);
    var data = ctx.getImageData(0, 0, DHASH_W, DHASH_H).data;
    var gray = [];
    for (var i = 0; i < data.length; i += 4) {
      gray.push(Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]));
    }
    return gray;
  }

  function dHashFromGray(gray) {
    var bits = '';
    for (var row = 0; row < DHASH_H; row += 1) {
      for (var col = 0; col < DHASH_W - 1; col += 1) {
        var left = gray[row * DHASH_W + col];
        var right = gray[row * DHASH_W + col + 1];
        bits += (left < right ? '1' : '0');
      }
    }
    return bits;
  }

  function hammingDistance(a, b) {
    if (!a || !b || a.length !== b.length) return 64;
    var d = 0;
    for (var i = 0; i < a.length; i += 1) if (a[i] !== b[i]) d += 1;
    return d;
  }

  function photoSimilarity(hashA, hashB) {
    return Math.max(0, 1 - hammingDistance(hashA, hashB) / 32);
  }

  function matchVerdict(similarity) {
    if (similarity >= 0.85) return '几乎一模一样。你找到了 TA 的视角。';
    if (similarity >= 0.65) return '很像。你站的位置差不多就是那个点。';
    if (similarity >= 0.45) return '有点像。再往那边挪两步会更接近。';
    return '画面不太一样。不过这张也有你自己的意思。';
  }

  function hashDataURL(dataURL) {
    return new Promise(function (resolve) {
      if (!dataURL) { resolve(null); return; }
      var img = new Image();
      img.onload = function () { resolve(dHashFromGray(photoToGray(img))); };
      img.onerror = function () { resolve(null); };
      img.src = dataURL;
    });
  }

  function compressImageToDataURL(file, callback) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var maxSide = 900;
        var ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
        var w = Math.round(img.width * ratio);
        var h = Math.round(img.height * ratio);
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        callback(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = function () { callback(null); };
      img.src = reader.result;
    };
    reader.onerror = function () { callback(null); };
    reader.readAsDataURL(file);
  }

  /* ---- 定位：失败降级到演示坐标，并明确标注 ---- */
  function currentLocation(callback) {
    var fallback = { lat: D.SURPRISE_ORIGIN.lat, lng: D.SURPRISE_ORIGIN.lng,
                     lon: D.SURPRISE_ORIGIN.lng, demo: true, reason: 'no-fix' };
    if (!navigator.geolocation) { callback(fallback); return; }
    var done = false;
    var timer = window.setTimeout(function () {
      if (done) return;
      done = true;
      fallback.reason = 'timeout';
      callback(fallback);
    }, 6000);
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        callback({ lat: pos.coords.latitude, lng: pos.coords.longitude,
                   lon: pos.coords.longitude, demo: false });
      },
      function (err) {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        fallback.reason = (err && err.code === 1) ? 'denied' : 'no-fix';
        callback(fallback);
      },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 }
    );
  }

  function geoDistance(a, b) {
    if (!a || !b) return Infinity;
    var R = 6371000;
    var lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180;
    var dLat = (b.lat - a.lat) * Math.PI / 180;
    var dLon = (b.lng - a.lng) * Math.PI / 180;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
  }

  /* ---- 惊喜集合派生 ---- */
  function allSurprises() { return state.surprises || []; }

  function waitingSurprises() {
    return allSurprises().filter(function (s) { return s.status === 'waiting'; });
  }

  function myBuryCount() {
    return allSurprises().filter(function (s) { return s.authorName === state.profile.displayName; }).length;
  }

  function myFoundCount() {
    return allSurprises().filter(function (s) {
      return s.status === 'found' && s.finderName === state.profile.displayName;
    }).length;
  }

  function mySurprisesFoundCount() {
    return allSurprises().filter(function (s) {
      return s.status === 'found' && s.authorName === state.profile.displayName;
    }).length;
  }

  function explorableSurprises() {
    var me = state.profile.displayName;
    return waitingSurprises().filter(function (s) { return s.authorName !== me; });
  }

  function surpriseByID(id) {
    var list = allSurprises();
    for (var i = 0; i < list.length; i += 1) if (list[i].id === id) return list[i];
    return null;
  }

  function distanceToSurprise(s) {
    if (!ui.myLocation) return null;
    return geoDistance(ui.myLocation, s.location);
  }

  function formatDistance(meters) {
    if (meters === null || meters === undefined || !isFinite(meters)) return '很远';
    if (meters < 1000) return Math.round(meters) + ' m';
    return (meters / 1000).toFixed(1) + ' km';
  }

  /* ---- 埋下一个惊喜 ---- */
  function burySurprise(payload) {
    var item = {
      id: 'surprise-' + Date.now() + '-' + Math.floor(Math.random() * 999),
      authorName: state.profile.displayName,
      authorEmoji: '🫥',
      photoData: payload.photoData || null,
      photoHash: payload.photoHash || null,
      message: payload.message,
      location: payload.location,
      areaLabel: payload.areaLabel,
      clues: [
        '有人在这里放下了一张照片。先走近一点。',
        payload.hint || '找到能把眼前的画面装进取景框的位置。',
        '就是这儿。抬手机，拍一张和 TA 一样的。'
      ],
      radiusMeters: 60,
      seekerPoints: 80,
      authorPoints: 40,
      createdAt: Date.now(),
      status: 'waiting'
    };
    state.surprises = state.surprises || [];
    state.surprises.unshift(item);
    state.profile.xp = (state.profile.xp || 0) + 30;
    var newly = syncAchievements();
    save();
    return { surprise: item, achievements: newly };
  }

  /* ---- 完成一次「找到并复刻」 ---- */
  function completeSurpriseFind(id, photoData, photoHash, similarity) {
    var item = surpriseByID(id);
    if (!item || item.status !== 'waiting') return null;
    var passed = similarity >= MATCH_PASS;
    if (passed) {
      item.status = 'found';
      item.finderName = state.profile.displayName;
      item.foundAt = Date.now();
      item.finderPhotoData = photoData;
      item.finderPhotoHash = photoHash;
      item.matchScore = similarity;
      state.profile.xp = (state.profile.xp || 0) + item.seekerPoints;
      state.profile.surprisesSeeked = (state.profile.surprisesSeeked || 0) + 1;
    } else {
      state.profile.xp = (state.profile.xp || 0) + 10;
    }
    var newly = syncAchievements();
    save();
    return {
      passed: passed,
      seekerPoints: passed ? item.seekerPoints : 10,
      authorPoints: passed ? item.authorPoints : 0,
      similarity: similarity,
      verdict: matchVerdict(similarity),
      achievements: newly,
      surprise: item
    };
  }

  /* ---- 首页入口卡 ---- */
  function surpriseHubHTML() {
    var waiting = explorableSurprises().length;
    var buried = myBuryCount();
    var found = myFoundCount();
    return '<section class="hub" aria-label="惊喜社区">' +
      '<div class="hub__top"><span class="micro">惊喜社区</span>' +
      '<span class="hub__meta">我埋了 ' + buried + ' · 找到 ' + found + '</span></div>' +
      '<p class="hub__copy">留一张照片给陌生人，或者去找到别人的。</p>' +
      '<div class="hub__actions">' +
      '<button class="btn btn--primary hub__btn" data-action="go-bury" aria-label="埋下一个惊喜">埋下一个 ▲</button>' +
      '<button class="btn btn--ghost hub__btn" data-action="go-seek" aria-label="去寻宝">去寻宝 · ' + waiting + ' 个在等你</button>' +
      '</div></section>';
  }

  /* ---- 埋惊喜页 ---- */
  function buryHTML() {
    var pending = state.pendingBury || {};
    var loc = ui.buryLocation;
    var locText = loc
      ? (loc.demo ? '📍 演示位置 · 静安' : '📍 已定位 · 真实位置')
      : '📍 正在获取位置…';
    var photoPart = pending.photoData
      ? '<div class="shotwrap"><div class="shot__preview"><img src="' + pending.photoData +
        '" alt="你要埋下的照片" /><button class="btn btn--quiet shot__retake" data-action="pick-bury-photo">重选一张</button></div></div>'
      : '<button class="shot" data-action="pick-bury-photo" aria-label="拍一张或从相册选">' +
        '<span class="shot__icon" aria-hidden="true">📷</span>' +
        '<span class="shot__label">拍一张 / 从相册选</span>' +
        '<span class="shot__hint">这张会留在原地，等一个人来找到它。</span></button>';

    return '<section class="page">' +
      '<div class="page__bar"><button class="iconbtn" data-action="back-home" aria-label="返回">' + ICON.back + '</button></div>' +
      '<header class="page__hero"><h2>埋下一张照片</h2><p>它留在这里，等一个人来找到。</p></header>' +
      photoPart +
      '<div class="field"><span class="field__label">写一句话：为什么埋在这里</span>' +
      '<textarea id="bury-message" class="ta" maxlength="60" placeholder="比如：这张是我在等一杯咖啡时拍的。" aria-label="为什么埋在这里">' +
      esc(pending.message || '') + '</textarea>' +
      '<span class="field__count" id="bury-message-count">' + (pending.message || '').length + '/60</span></div>' +
      '<div class="field"><span class="field__label">（可选）给找它的人一句提示</span>' +
      '<textarea id="bury-hint" class="ta ta--short" maxlength="40" placeholder="不能直接说答案哦。" aria-label="给找它的人一句提示">' +
      esc(pending.hint || '') + '</textarea></div>' +
      '<div class="locline">' + esc(locText) + '</div>' +
      '<button class="btn btn--primary btn--block" data-action="submit-bury" aria-label="埋在这里">埋在这里</button>' +
      '<p class="page__note">埋下即得神秘值 +30。有人找到并拍出同款时，你还会再得 +40。</p>' +
      '</section>';
  }

  /* ---- 寻惊喜列表 ---- */
  function seekHTML() {
    var list = explorableSurprises();
    var items = list.map(function (s) {
      var dist = distanceToSurprise(s);
      return '<button class="scard" data-action="open-surprise" data-id="' + esc(s.id) +
        '" aria-label="查看' + esc(s.authorName) + '埋下的惊喜">' +
        '<span class="scard__emoji" aria-hidden="true">' + s.authorEmoji + '</span>' +
        '<span class="scard__body">' +
        '<span class="scard__who">' + esc(s.authorName) + ' 埋在 · ' + esc(s.areaLabel) + '</span>' +
        '<span class="scard__copy">一张照片，在某处等你。</span></span>' +
        '<span class="scard__dist">' + esc(formatDistance(dist)) + '</span>' +
        '<span class="scard__arrow" aria-hidden="true">' + ICON.chevron + '</span></button>';
    }).join('');

    var empty = '<div class="empty"><span class="empty__art" aria-hidden="true">🔍</span>' +
      '<p>这附近还没有人埋下惊喜。</p><p>要不要先埋一个？</p>' +
      '<button class="btn btn--primary" data-action="go-bury">埋下一个</button></div>';

    return '<section class="page">' +
      '<div class="page__bar"><button class="iconbtn" data-action="back-home" aria-label="返回">' + ICON.back + '</button></div>' +
      '<header class="page__hero"><h2>附近的惊喜</h2><p>' + list.length + ' 张照片在某个角落等你。</p></header>' +
      (list.length ? '<div class="slist">' + items + '</div>' : empty) +
      '<p class="page__note">找到后要拍一张同款才算数。先别急着看原图。</p>' +
      '</section>';
  }

  /* ---- 寻惊喜详情 ---- */
  function seekDetailHTML() {
    var item = state.pendingSeek || (ui.seekID ? surpriseByID(ui.seekID) : null) || explorableSurprises()[0] || null;
    state.pendingSeek = item;
    if (!item) {
      return '<section class="page"><div class="page__bar">' +
        '<button class="iconbtn" data-action="go-seek" aria-label="返回">' + ICON.back + '</button></div>' +
        '<div class="empty"><p>这个惊喜已经不在了。</p></div></section>';
    }
    var dist = distanceToSurprise(item);
    var inRange = dist !== null && dist <= item.radiusMeters;
    var inRangeDemo = !!ui.demoArrived;

    var unlocked = 1;
    if (dist !== null) {
      if (dist <= item.radiusMeters * 3) unlocked = 2;
      if (dist <= item.radiusMeters) unlocked = 3;
    }
    if (inRangeDemo) unlocked = 3;

    var clues = item.clues.map(function (text, index) {
      var on = index < unlocked;
      return '<div class="clue ' + (on ? '' : 'clue--locked') + '">' +
        '<span class="clue__mark" aria-hidden="true">' + (on ? '✓' : '🔒') + '</span>' +
        '<span class="clue__text">' + (on ? esc(text) : '再走近一点…') + '</span></div>';
    }).join('');

    var stage;
    if (ui.seekShot) {
      stage = seekCompareHTML(item);
    } else if (inRange || inRangeDemo) {
      stage = '<div class="shotwrap">' +
        '<p class="shotwrap__lead">你到了。抬手机，找到 TA 的角度。</p>' +
        '<button class="shot" data-action="pick-seek-photo" aria-label="这样拍一张">' +
        '<span class="shot__icon" aria-hidden="true">📷</span>' +
        '<span class="shot__label">这样拍一张</span>' +
        '<span class="shot__hint">先别急着看，找到你的角度。</span></button>' +
        (inRangeDemo ? '<p class="demo-tag">演示：已当作你走到了这里</p>' : '') +
        '</div>';
    } else {
      stage = '<div class="shotwrap">' +
        '<p class="shotwrap__lead">再走近 ' + esc(formatDistance(dist !== null ? dist - item.radiusMeters : null)) + '。</p>' +
        '<button class="btn btn--ghost btn--block" data-action="demo-arrive">当作到了（演示）</button>' +
        '</div>';
    }

    var mine = item.authorName === state.profile.displayName;
    var footer = mine
      ? '<p class="page__note">这是你自己埋下的惊喜，等别人来找到它。</p>'
      : '';

    return '<section class="page">' +
      '<div class="page__bar"><button class="iconbtn" data-action="go-seek" aria-label="返回">' + ICON.back + '</button></div>' +
      '<header class="authorbar">' +
      '<span class="authorbar__emoji" aria-hidden="true">' + item.authorEmoji + '</span>' +
      '<span class="authorbar__body"><span class="authorbar__who">' + esc(item.authorName) + ' 埋在 · ' + esc(item.areaLabel) + '</span>' +
      '<span class="authorbar__when">' + esc(relativeDay(item.createdAt)) + '</span></span>' +
      '<span class="authorbar__dist">' + esc(formatDistance(dist)) + '</span></header>' +
      '<div class="cluelist">' + clues + '</div>' +
      stage +
      footer +
      '</section>';
  }

  /* ---- 拍完之后的对比 ---- */
  function seekCompareHTML(item) {
    var shot = ui.seekShot;
    var similarity = shot.similarity;
    var percent = Math.round(similarity * 100);
    var passed = shot.passed;
    var authorPart = item.photoData
      ? '<div class="cmp__cell"><img src="' + item.photoData + '" alt="TA 拍的照片" /></div>'
      : '<div class="cmp__cell cmp__cell--demo"><span aria-hidden="true">🖼️</span><em>演示照片</em></div>';

    var resultBlock = passed
      ? '<div class="result result--pass">' +
        '<div class="result__big">找到 · 探索值 +' + shot.seekerPoints + '</div>' +
        '<p class="result__sub">作者 +' + shot.authorPoints + ' · 相似度 ' + percent + '%</div>' +
        '<p class="result__verdict">' + esc(shot.verdict) + '</p>' +
        '<button class="btn btn--primary btn--block" data-action="go-seek" aria-label="继续找别的">继续找别的</button>'
      : '<div class="result result--soft">' +
        '<div class="result__big">' + esc(shot.verdict) + '</div>' +
        '<p class="result__sub">相似度 ' + percent + '% · 给了 +10 辛苦分，惊喜继续等别人</p>' +
        '<div class="result__actions">' +
        '<button class="btn btn--primary result__btn" data-action="retake-seek-photo">重拍一张</button>' +
        '<button class="btn btn--ghost result__btn" data-action="go-seek">先走</button></div></div>';

    return '<div class="cmp">' +
      '<div class="cmp__row">' +
      '<div class="cmp__col"><span class="cmp__cap">TA 的</span>' + authorPart + '</div>' +
      '<div class="cmp__col"><span class="cmp__cap">你的</span>' +
      '<div class="cmp__cell"><img src="' + shot.dataURL + '" alt="你拍的照片" /></div></div>' +
      '</div>' +
      '<div class="cmp__score"><span class="badge ' + (passed ? 'badge--rare' : 'badge--common') + '">' +
      percent + '% 像</span>' + (item.photoData ? '' : '<span class="demo-tag">演示匹配 · 原图不在本机</span>') + '</div>' +
      resultBlock +
      '</div>';
  }

  /* ---- 我的惊喜页 ---- */
  function surprisesHTML() {
    var mine = allSurprises().filter(function (s) { return s.authorName === state.profile.displayName; });
    var found = allSurprises().filter(function (s) {
      return s.finderName === state.profile.displayName;
    });

    var mineRows = mine.map(function (s) {
      var state1 = s.status === 'found'
        ? '<span class="mine__state mine__state--on">被 ' + esc(s.finderName) + ' 找到 · ' + Math.round((s.matchScore || 0) * 100) + '%</span>'
        : '<span class="mine__state">等待被找到</span>';
      return '<div class="mine">' +
        '<span class="mine__emoji" aria-hidden="true">' + (s.photoData ? '🖼️' : '📷') + '</span>' +
        '<span class="mine__body"><span class="mine__msg">' + esc(s.message) + '</span>' + state1 + '</span></div>';
    }).join('');

    var foundRows = found.map(function (s) {
      return '<div class="mine">' +
        '<span class="mine__emoji" aria-hidden="true">' + s.authorEmoji + '</span>' +
        '<span class="mine__body"><span class="mine__msg">' + esc(s.authorName) + ' 埋的 · ' + esc(s.areaLabel) + '</span>' +
        '<span class="mine__state mine__state--on">相似度 ' + Math.round((s.matchScore || 0) * 100) + '%</span></span></div>';
    }).join('');

    var mineEmpty = '<div class="empty"><p>你还没埋过惊喜。</p><button class="btn btn--primary" data-action="go-bury">埋下一个</button></div>';
    var foundEmpty = '<div class="empty"><p>还没找到别人的惊喜。</p><button class="btn btn--ghost" data-action="go-seek">去寻宝</button></div>';

    return '<section class="page">' +
      '<div class="page__bar"><button class="iconbtn" data-action="back-home" aria-label="返回">' + ICON.back + '</button></div>' +
      '<header class="page__hero"><h2>我的惊喜</h2><p>你埋下的，和你找到的。</p></header>' +
      '<div class="section-head"><h2>我埋的</h2><span class="micro">' + mine.length + ' 个</span></div>' +
      (mine.length ? '<div class="minelist">' + mineRows + '</div>' : mineEmpty) +
      '<div class="section-head"><h2>我找到的</h2><span class="micro">' + found.length + ' 个</span></div>' +
      (found.length ? '<div class="minelist">' + foundRows + '</div>' : foundEmpty) +
      '</section>';
  }

  /* ---- 埋/寻 的交互流程 ---- */
  function pickPhoto(callback) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      document.body.removeChild(input);
      if (!file) return;
      compressImageToDataURL(file, function (dataURL) {
        if (!dataURL) { showToast('这张图读不出来，换一张试试', '⚠️'); return; }
        hashDataURL(dataURL).then(function (hash) { callback(dataURL, hash); });
      });
    });
    input.click();
  }

  function ensureBuryLocation() {
    if (ui.buryLocation) return;
    currentLocation(function (loc) {
      ui.buryLocation = loc;
      if (currentRoute() === '/bury') render();
    });
  }

  function submitBury() {
    var msgEl = $('#bury-message');
    var hintEl = $('#bury-hint');
    var message = msgEl ? msgEl.value.trim() : '';
    var hint = hintEl ? hintEl.value.trim() : '';
    var pending = state.pendingBury || {};
    if (!pending.photoData) { showToast('先拍一张照片', '📷'); return; }
    if (!message) { showToast('写一句话，为什么埋在这里', '✍️'); msgEl && msgEl.focus(); return; }

    var loc = ui.buryLocation || { lat: D.SURPRISE_ORIGIN.lat, lng: D.SURPRISE_ORIGIN.lng, demo: true };
    var result = burySurprise({
      photoData: pending.photoData,
      photoHash: pending.photoHash,
      message: message,
      hint: hint,
      location: { lat: loc.lat, lng: loc.lng },
      areaLabel: loc.demo ? '演示位置 · 静安' : '当前位置'
    });

    state.pendingBury = null;
    ui.buryLocation = null;
    showToast('已埋下 · 神秘值 +30', '🌱');
    result.achievements.forEach(function (def, index) {
      showToast('成就解锁 · ' + def.name, '🏅', { variant: 'amber', delay: 600 + index * 600 });
    });
    navigate('/surprises');
  }

  function openSurprise(id) {
    var item = surpriseByID(id);
    if (!item) { showToast('找不到这个惊喜', '⚠️'); return; }
    state.pendingSeek = item;
    ui.seekID = id;
    ui.seekShot = null;
    ui.demoArrived = false;
    navigate('/seek-detail');
  }

  /* 演示二选一：真实 dHash（两张都有像素）或明确标注的演示匹配 */
  function computeSeekSimilarity(item, myDataURL, myHash) {
    return hashDataURL(item.photoData).then(function (authorHash) {
      if (authorHash && myHash) {
        return { similarity: photoSimilarity(authorHash, myHash), demo: false };
      }
      /* 演示数据没有真实像素：给一个稳定的「演示」分数（标注清楚，不假装） */
      var seed = (item.id || '').split('').reduce(function (acc, ch) { return acc + ch.charCodeAt(0); }, 0);
      var pseudo = 0.62 + ((seed % 26) / 100);
      return { similarity: pseudo, demo: true };
    });
  }

  function onSeekShotChosen(dataURL, hash) {
    var item = state.pendingSeek;
    if (!item) return;
    computeSeekSimilarity(item, dataURL, hash).then(function (outcome) {
      var result = completeSurpriseFind(item.id, dataURL, hash, outcome.similarity);
      if (!result) { showToast('这个惊喜已经不在了', '⚠️'); return; }
      ui.seekShot = {
        dataURL: dataURL,
        similarity: outcome.similarity,
        passed: result.passed,
        seekerPoints: result.seekerPoints,
        authorPoints: result.authorPoints,
        verdict: result.verdict,
        demo: outcome.demo
      };
      render();
      // 结算卡已经写明点数，不再重复弹 toast（避免盖住评价文案）；只提示未达标
      if (!result.passed) {
        showToast('再看一眼，还能更接近', '🔎');
      }
      result.achievements.forEach(function (def, index) {
        showToast('成就解锁 · ' + def.name, '🏅', { variant: 'amber', delay: 700 + index * 600 });
      });
    });
  }

  /* ============================================================
     渲染 / 路由
     ============================================================ */
  function currentRoute() {
    var raw = (location.hash || '').replace(/^#/, '');
    if (!raw) return '/home';
    var path = raw.split('?')[0];
    if (path.charAt(0) !== '/') path = '/' + path;
    if (ROUTES.indexOf(path) === -1) return '/home';
    return path;
  }

  function clearTimers() {
    if (timers.journey) { clearInterval(timers.journey); timers.journey = null; }
    timers.reveal.forEach(function (id) { clearTimeout(id); });
    timers.reveal = [];
  }

  function setActiveTab(route) {
    $$('.tab', dom.tabbar).forEach(function (tab) {
      var active = tab.getAttribute('data-route') === route;
      tab.classList.toggle('is-active', active);
      if (active) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
  }

  function render() {
    clearTimers();
    var route = currentRoute();
    ui.route = route;
    var isReveal = route === '/reveal';

    if (!isReveal) {
      ui.revealPhase = null;
      dom.overlayRoot.innerHTML = '';
    }
    dom.sheetRoot.innerHTML = '';
    dom.screen.setAttribute('data-route', route.slice(1));
    dom.main.className = 'main';
    dom.tabbar.hidden = TAB_ROUTES.indexOf(route) === -1;
    setActiveTab(route);

    /* 首页/抽盒页提前取一次定位：点击摇盒时通常已就绪，不阻塞交互 */
    if ((route === '/home' || route === '/setup') && !ui.myLocation && !ui.geoAsked) {
      ui.geoAsked = true;
      currentLocation(function (loc) { ui.myLocation = loc; });
    }

    /* 埋/寻相关页面：确保拿到定位（失败降级演示坐标） */
    if ((route === '/bury' || route === '/seek' || route === '/seek-detail') && !ui.myLocation) {
      currentLocation(function (loc) {
        ui.myLocation = loc;
        if (currentRoute() === route) render();
      });
    }

    var html = '';
    switch (route) {
      case '/home':
        html = homeHTML();
        break;
      case '/setup':
        html = homeHTML();
        dom.sheetRoot.innerHTML = sheetHTML();
    document.body.setAttribute('data-sheet', '1');
        break;
      case '/journey':
        dom.main.className = 'main main--flush';
        html = journeyHTML();
        break;
      case '/reveal':
        dom.main.className = 'main main--flush';
        break;
      case '/cards':
        html = cardsHTML();
        break;
      case '/social':
        html = socialHTML();
        break;
      case '/profile':
        html = profileHTML();
        break;
      case '/achievements':
        html = achievementsHTML();
        break;
      case '/bury':
        html = buryHTML();
        if (!ui.buryLocation) ensureBuryLocation();
        break;
      case '/seek':
        html = seekHTML();
        break;
      case '/seek-detail':
        html = seekDetailHTML();
        break;
      case '/surprises':
        html = surprisesHTML();
        break;
      case '/watch':
        html = watchPreviewHTML();
        break;
      case '/debug':
        html = debugHTML();
        break;
      case '/account':
        html = accountHTML();
        break;
      case '/datasource':
        html = datasourceHTML();
        break;
      default:
        document.body.removeAttribute('data-sheet');
        html = homeHTML();
    }

    if (route === '/debug') {
      html = debugHTML();
    }

    dom.main.innerHTML = html;
    dom.main.scrollTop = 0;

    if (state.updatePending && route === '/home' && !window.__bwReloading) {
      state.updatePending = false;
      window.__bwReloading = true;
      location.reload();
      return;
    }

    if (route === '/journey') {
      startJourneyTimer();
      startRealTracking();
    } else {
      stopRealTracking();
    }

    // 从演示模式切回真实定位：渲染完抽盒页后自动摇一次
    if (ui.autoShake && route === '/setup') {
      ui.autoShake = false;
      window.requestAnimationFrame(function () {
        var shakeBtn = document.querySelector('[data-action="shake"]');
        if (shakeBtn) shakeBtn.click();
      });
    }
    if (route === '/reveal') renderReveal();
    if (!isReveal) dom.overlayRoot.innerHTML = '';
  }

  function navigate(path) {
    if (location.hash === '#' + path) render();
    else location.hash = '#' + path;
  }

  function renderJourney(preserveScroll) {
    if (currentRoute() !== '/journey') { render(); return; }
    clearTimers();
    dom.main.innerHTML = journeyHTML();
    if (!preserveScroll) dom.main.scrollTop = 0;
    startJourneyTimer();
    // 页面重建后立刻重绘导航与路径（路线是异步到的，不能等下一次 GPS 读数）
    ui.navPatchAt = 0;
    if (state.session) patchNav(state.session);
  }

  function startJourneyTimer() {
    startHeadingTracking();
    updateJourneyTimer();
    timers.journey = setInterval(updateJourneyTimer, 1000);
  }

  function updateJourneyTimer() {
    var node = $('.journey__timer');
    if (!node || !state.session) return;
    var elapsed = ui.paused ? ui.pausedElapsed : Math.max(0, Date.now() - state.session.startedAt);
    node.textContent = fmtElapsed(elapsed);
  }

  /* ============================================================
     交互
     ============================================================ */
  function setPressed(selector, value) {
    $$(selector, dom.sheetRoot).forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-value') === String(value)));
    });
  }

  function handleShake(button) {
    if (ui.shaking) return;
    requestHeadingPermission();   // 必须在用户手势里申请 iOS 罗盘权限
    ui.shaking = true;
    button.classList.add('is-shaking', 'is-busy');
    button.innerHTML = shakeGlyph() + '<span>摇盒中…</span>';

    var duration = D.DURATIONS.filter(function (d) { return d.id === ui.duration; })[0] || D.DURATIONS[1];

    /* 真实地理模式：先查附近真实 POI，失败才退回内置地点 */
    var finish = function (place, meta) {
      startSession(place, meta);
      ui.shaking = false;
      if (currentRoute() === '/setup') navigate('/journey');
      else render();
      if (place.source === 'curated') {
        showToast('这是编辑精选的地点', '✨', { duration: 1800 });
      } else if (place.source === 'wikipedia') {
        showToast('附近找到 ' + (meta && meta.poolSize ? meta.poolSize : 0) + ' 个真实地标', '📍', { duration: 1800 });
      } else if (place.source === 'osm') {
        showToast('附近找到 ' + (meta && meta.poolSize ? meta.poolSize : 0) + ' 个真实地点', '📍', { duration: 1800 });
        // 后台补真实街道名
        if (window.BW_GEO) {
          window.BW_GEO.enrichWithAddress(place).then(function (enriched) {
            if (enriched && enriched.address) {
              state.realPlaces[enriched.id] = enriched;
              save();
            }
          }).catch(function () {});
        }
      }
    };

    var failSearch = function (reason, report) {
      ui.shaking = false;
      ui.searchFailed = {
        reason: reason || 'no-real-place',
        at: Date.now(),
        report: report || (window.BW_PROVIDERS && window.BW_PROVIDERS.lastReport
          ? window.BW_PROVIDERS.lastReport() : null)
      };
      ui.searchScale = 1;
      render();
    };

    // 真实模式：来源必须是真实数据，且必须有坐标。这一道闸门兜住所有上游 bug。
    var finishReal = function (place, meta) {
      if (!place || !isRealSource(place.source) || !place.coordinate) {
        failSearch('not-real');
        return;
      }
      ui.searchFailed = null;
      finish(place, meta);
    };

    /* 三档搜索：同一批真实数据，只是"挑哪个"逐步放宽（绝不编造）。
       档位越高：搜索半径更大、允许更近、商业 POI 不再被大幅降权、无照片地标也能用 */
    var SEARCH_TIERS = [
      { relax: 0, radiusScale: 1,   hint: '' },
      { relax: 1, radiusScale: 1.8, hint: '附近点少，扩大范围再找…' },
      { relax: 2, radiusScale: 3.2, hint: '再放宽一次，把附近能走到的真实地点都算上…' }
    ];

    /* 判断这个真实地点"够不够格"：小区/驿站/包子铺这类属于最后兜底可用，不该优先抽中 */
    var isDullPlace = function (place) {
      try {
        var worth = window.BW_GEO.__debug && window.BW_GEO.__debug.scoreWalkworthy
          ? window.BW_GEO.__debug.scoreWalkworthy({ name: place.name })
          : { ok: true, penalty: 1 };
        return worth.penalty < 0.5;
      } catch (e) { return false; }
    };

    var searchAttempt = function (patch, tier, dullFallback) {
      var conf = SEARCH_TIERS[tier] || SEARCH_TIERS[SEARCH_TIERS.length - 1];
      return window.BW_GEO.findRealPlace(
        patch,
        ui.mood,
        duration.startMeters,
        { radiusScale: conf.radiusScale, relax: conf.relax }
      ).then(function (result) {
        var place = result && result.place;
        var real = place && isRealSource(place.source);

        if (real && !isDullPlace(place)) {
          ui.searchScale = 1;
          finishReal(place, { source: place.source, poolSize: result.poolSize, cached: result.cached });
          return;
        }
        // 够真实但不够格（商业铺子/小区）：先记下，继续往更宽的档位找更好的
        if (real && !dullFallback) dullFallback = { place: place, meta: result };

        if (tier + 1 < SEARCH_TIERS.length) {
          if (SEARCH_TIERS[tier + 1].hint && !real) {
            showToast(SEARCH_TIERS[tier + 1].hint, '🔎', { duration: 1800 });
          }
          return searchAttempt(patch, tier + 1, dullFallback);
        }
        // 所有档位都试过：有真实但普通的地点就用它（绝不编造），否则明确失败
        if (dullFallback) {
          finishReal(dullFallback.place, {
            source: dullFallback.place.source,
            poolSize: dullFallback.meta.poolSize,
            cached: dullFallback.meta.cached
          });
          return;
        }
        failSearch((result && result.reason) || 'no-real-place');
      });
    };

    var go = function (loc) {
      // 拿不到真实定位：不再静默退回虚构地点，而是明确告诉用户并提供出口
      //（重试 / 手动输入位置 / 明确选择演示）
      if (!loc || loc.demo || !window.BW_GEO) {
        ui.shaking = false;
        ui.locationBlocked = true;
        ui.locationReason = (loc && loc.reason) || 'no-fix';
        if (currentRoute() === '/setup') render(); else render();
        return;
      }
      ui.myLocation = ui.myLocation || loc;
      ui.searchFailed = null;
      var patch = { lat: loc.lat, lon: (loc.lon !== undefined ? loc.lon : loc.lng) };
      var startTier = ui.searchExtraWide ? SEARCH_TIERS.length - 1 : 0;
      ui.searchExtraWide = false;
      searchAttempt(patch, startTier).catch(function () {
        failSearch('network');
      });
    };

    /* 有定位就用真实位置；没有就现取一次，最多等 3 秒，超时降级不卡用户 */
    if (ui.myLocation) {
      go(ui.myLocation);
      return;
    }
    var settled = false;
    var waitTimer = window.setTimeout(function () {
      if (settled) return;
      settled = true;
      ui.shaking = false;
      ui.locationBlocked = true;
      ui.locationReason = 'timeout';
      render();
    }, 4000);
    currentLocation(function (loc) {
      if (settled) return;
      settled = true;
      window.clearTimeout(waitTimer);
      ui.myLocation = loc;
      go(loc);
    });
  }

  function toggleReaction(button) {
    var postID = button.getAttribute('data-post');
    var key = button.getAttribute('data-reaction');
    var post = null;
    state.feed.forEach(function (item) { if (item.id === postID) post = item; });
    if (!post) return;
    if (!post.reacted) post.reacted = {};
    if (post.reacted[key]) {
      post.reacted[key] = false;
      post.reactions[key] = Math.max(0, post.reactions[key] - 1);
    } else {
      post.reacted[key] = true;
      post.reactions[key] += 1;
    }
    button.setAttribute('aria-pressed', String(!!post.reacted[key]));
    var countNode = button.querySelector('span:last-child');
    if (countNode) countNode.textContent = String(post.reactions[key]);
    save();
  }

  function copyCode() {
    var code = D.TOGETHER_CODE;
    var fallback = function () { showToast('同频码 ' + code, '📋'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(function () {
        showToast('同频码已复制', '📋');
      }, fallback);
    } else {
      fallback();
    }
  }

  function toggleSetting(key) {
    state.settings[key] = !state.settings[key];
    save();
    var button = $('.setting[data-key="' + key + '"]');
    if (button) {
      var node = $('.switch', button);
      if (node) node.setAttribute('aria-checked', String(!!state.settings[key]));
    }
  }

  function clearData() {
    closeModal();
    seedFresh();
    ui.filter = 'all';
    ui.boardOpen = false;
    ui.newHint = -1;
    ui.revealPhase = null;
    ui.seekShot = null;
    ui.demoArrived = false;
    ui.buryLocation = null;
    state.pendingBury = null;
    state.pendingSeek = null;
    if (location.hash !== '#/home') navigate('/home');
    else render();
    showToast('演示数据已清除', '🧹');
  }

  function handleAction(action, target, event) {
    switch (action) {
      case 'open-setup':
        navigate('/setup');
        break;
      case 'close-setup':
        navigate('/home');
        break;
      case 'select-duration':
        ui.duration = Number(target.getAttribute('data-value'));
        setPressed('.segmented button', ui.duration);
        break;
      case 'select-mood':
        ui.mood = target.getAttribute('data-value');
        setPressed('.mood', ui.mood);
        break;
      case 'select-area':
        ui.area = target.getAttribute('data-value');
        setPressed('.areachips .chipbtn', ui.area);
        break;
      case 'shake':
        handleShake(target);
        break;
      case 'resume':
        navigate('/journey');
        break;
      case 'back-home':
        navigate('/home');
        break;
      case 'pause':
        if (!state.session) break;
        if (ui.paused) {
          ui.paused = false;
          state.session.startedAt = Date.now() - ui.pausedElapsed;
        } else {
          ui.paused = true;
          ui.pausedElapsed = Math.max(0, Date.now() - state.session.startedAt);
        }
        renderJourney(true);
        break;
      case 'walk':
        onWalk();
        break;
      case 'retry-photo': {
        var fig = document.querySelector('[data-photo-figure]');
        if (!fig) break;
        var im = fig.querySelector('[data-photo-img]');
        var url = fig.getAttribute('data-photo-url') || '';
        if (!im || !url) break;
        fig.classList.remove('is-broken');
        im.hidden = false;
        im.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'r=' + Date.now();
        var fb = fig.querySelector('[data-photo-fallback]');
        if (fb) fb.hidden = true;
        break;
      }
      case 'reveal-now': {
        // 真实定位下没走到也能直接揭晓：立刻进入到达态
        if (!state.session) { showToast('还没有进行中的盲盒', '🤔'); break; }
        if (state.session.phase !== 'walking') { goRevealFromSession(); break; }
        stopRealTracking();
        beginArrival();
        // 兜底：1.8 秒后还没揭晓，强制走一次（避免动画/定时器被打断后按钮“没反应”）
        window.setTimeout(function () {
          if (location.hash.indexOf('/reveal') < 0 && !state.reveal) {
            ui.arriving = false;
            goRevealFromSession();
          }
        }, 1800);
        break;
      }
      case 'arrive':
        beginArrival();
        break;
      case 'collect':
        onCollect();
        break;
      case 'share':
        onShare();
        break;
      case 'go-cards':
        navigate('/cards');
        break;
      case 'close-reveal':
        navigate('/home');
        break;
      case 'filter':
        ui.filter = target.getAttribute('data-value');
        render();
        break;
      case 'cycle-filter':
        var order = ['all', 'rare', 'hidden', 'area'];
        var index = order.indexOf(ui.filter);
        ui.filter = order[(index + 1) % order.length];
        render();
        break;
      case 'open-card':
        openCardModal(target.getAttribute('data-id'));
        break;
      case 'close-modal':
        if (event && event.target && event.target.closest && event.target.closest('.modal')) return;
        closeModal();
        break;
      case 'react':
        toggleReaction(target);
        break;
      case 'copy-code':
        copyCode();
        break;
      case 'board-more':
        ui.boardOpen = !ui.boardOpen;
        render();
        break;
      case 'toggle-setting':
        toggleSetting(target.getAttribute('data-key'));
        break;
      case 'privacy':
        openPrivacyModal();
        break;
      case 'about':
        openAboutModal();
        break;
      case 'clear-data':
        openClearModal();
        break;
      case 'confirm-clear':
        clearData();
        break;
      /* ---- 埋惊喜 / 寻惊喜 ---- */
      case 'go-bury':
        state.pendingBury = null;
        ui.buryLocation = null;
        navigate('/bury');
        ensureBuryLocation();
        break;
      case 'go-seek':
        ui.seekShot = null;
        ui.demoArrived = false;
        navigate('/seek');
        break;
      case 'pick-bury-photo':
        pickPhoto(function (dataURL, hash) {
          var msgEl = $('#bury-message');
          var hintEl = $('#bury-hint');
          state.pendingBury = {
            photoData: dataURL,
            photoHash: hash,
            message: msgEl ? msgEl.value : '',
            hint: hintEl ? hintEl.value : ''
          };
          render();
          showToast('照片已选好', '🖼️');
        });
        break;
      case 'submit-bury':
        submitBury();
        break;
      case 'open-surprise':
        openSurprise(target.getAttribute('data-id'));
        break;
      case 'pick-seek-photo':
      case 'retake-seek-photo':
        ui.seekShot = null;
        pickPhoto(onSeekShotChosen);
        render();
        break;
      case 'open-debug': {
        navigate('/debug');
        break;
      }
      case 'retry-location': {
        ui.locationBlocked = false;
        ui.myLocation = null;
        render();
        showToast('正在重新获取定位…', '📡', { duration: 1600 });
        currentLocation(function (loc) {
          if (loc && !loc.demo) {
            ui.myLocation = loc;
            ui.geoErrorShown = false;
            render();
            bwShakeNow();
          } else {
            ui.locationBlocked = true;
            ui.locationReason = (loc && loc.reason) || 'no-fix';
            render();
          }
        });
        break;
      }
      case 'search-wider': {
        ui.searchFailed = null;
        ui.searchExtraWide = true;   // 手动点过"扩大范围" → 直接从最宽档开搜
        render();
        bwShakeNow();
        break;
      }
      case 'manual-location': {
        var input = window.prompt('输入地址或坐标（例：南京市鼓楼区金银街 / 32.0597,118.7713）');
        if (!input) break;
        showToast('正在查这个位置…', '🔎', { duration: 2000 });
        window.BW_GEO.geocodeAddress(input).then(function (hit) {
          if (!hit) {
            showToast('没找到这个位置，换个写法试试', '😕', { duration: 2600 });
            return;
          }
          ui.myLocation = { lat: hit.lat, lng: hit.lon, lon: hit.lon, demo: false, manual: true };
          ui.locationBlocked = false;
          ui.locationReason = '';
          ui.searchFailed = null;
          ui.searchScale = 1;
          render();
          showToast('已用：' + hit.label, '📍', { duration: 2400 });
          bwShakeNow();
        }).catch(function () {
          showToast('位置查询失败，检查网络', '📴', { duration: 2400 });
        });
        break;
      }
      case 'start-demo': {
        // 用户明确选择演示：这才允许用虚构地点
        ui.locationBlocked = false;
        state.demoSeeded = true;
        var place = drawPlace();
        startSession(place, { source: 'catalog', fallback: true });
        navigate('/journey');
        showToast('演示模式 · 这是虚构地点', '🧪', { duration: 2400 });
        break;
      }
      case 'retry-real': {
        // 从演示模式切回真实定位：清掉演示会话，重新走一次「取定位 → 抽真实地点」
        ui.myLocation = null;
        ui.geoErrorShown = false;
        ui.geoErrorCount = 0;
        ui.lastFix = null;
        state.session = null;
        state.reveal = null;
        state.demoSeeded = false;
        save();
        ui.autoShake = true;
        navigate('/setup');
        showToast('正在重新获取定位…', '📡', { duration: 1600 });
        break;
      }
      case 'go-account':
        navigate('/account');
        break;
      case 'go-datasource':
        navigate('/datasource');
        break;
      case 'go-profile':
        navigate('/profile');
        break;
      case 'account-login': {
        var loginName = document.getElementById('acc-user').value.trim();
        var loginPass = document.getElementById('acc-pass').value;
        var baseEl = document.getElementById('acc-base');
        if (baseEl) { var cfg0 = accountConfig(); cfg0.baseUrl = baseEl.value.trim() || cfg0.baseUrl; saveAccountConfig(cfg0); }
        if (!loginName || !loginPass) { showToast('用户名和密码都要填', '✍️'); break; }
        showToast('正在登录…', '🔐', { duration: 1600 });
        accountApi('/api/auth/login', { method: 'POST', body: { username: loginName, password: loginPass } })
          .then(function (r) { onAccountChanged(r.user); showToast('已登录：' + r.user.username, '✅'); })
          .catch(function (e) { showToast(accountErrText(e), '⚠️', { duration: 3200 }); });
        break;
      }
      case 'account-register': {
        var regName = document.getElementById('acc-user').value.trim();
        var regPass = document.getElementById('acc-pass').value;
        var baseEl2 = document.getElementById('acc-base');
        if (baseEl2) { var cfg1 = accountConfig(); cfg1.baseUrl = baseEl2.value.trim() || cfg1.baseUrl; saveAccountConfig(cfg1); }
        if (!regName || !regPass) { showToast('用户名和密码都要填', '✍️'); break; }
        showToast('正在注册…', '🆕', { duration: 1600 });
        accountApi('/api/auth/register', { method: 'POST', body: { username: regName, password: regPass } })
          .then(function (r) { onAccountChanged(r.user); showToast('注册成功，已登录', '✅'); })
          .catch(function (e) { showToast(accountErrText(e), '⚠️', { duration: 3200 }); });
        break;
      }
      case 'account-logout': {
        accountApi('/api/auth/logout', { method: 'POST' }).catch(function () {}).then(function () {
          onAccountChanged(null);
          showToast('已退出登录', '👋');
        });
        break;
      }
      case 'account-sync': {
        showToast('正在同步到账号…', '☁️', { duration: 1800 });
        pushProfile().then(function (r) {
          var bytes = r.bytes || 0;
          var size = bytes >= 1024 ? (bytes / 1024).toFixed(1) + ' KB' : bytes + ' 字节';
          showToast('已同步 · ' + size, '☁️');
        }).catch(function (e) { showToast(accountErrText(e), '⚠️', { duration: 3200 }); });
        break;
      }
      case 'account-restore': {
        if (!window.confirm('用账号里的数据覆盖本机？本机当前进度会丢。')) break;
        showToast('正在恢复…', '⬇️', { duration: 1800 });
        pullProfile().then(function () {
          showToast('已从账号恢复', '✅');
          navigate('/home');
        }).catch(function (e) { showToast(accountErrText(e), '⚠️', { duration: 3200 }); });
        break;
      }
      case 'account-delete': {
        var pass = window.prompt('删除账号不可恢复。请输入密码确认：');
        if (!pass) break;
        accountApi('/api/me', { method: 'DELETE', body: { password: pass } })
          .then(function () {
            onAccountChanged(null);
            showToast('账号已删除', '🗑️');
          })
          .catch(function (e) { showToast(accountErrText(e), '⚠️', { duration: 3200 }); });
        break;
      }
      case 'reload-mapkeys': {
        showToast('正在从后台重新加载 Key…', '🔑', { duration: 1600 });
        loadMapKeys().then(function (ok) {
          showToast(ok ? 'Key 已更新' : '后台还没配置 Key（只用免费源）', ok ? '✅' : 'ℹ️');
          render();
        });
        break;
      }
      case 'ds-test': {
        var here = ui.myLocation || ui.lastFix;
        if (!here) { showToast('先给一次定位，或用「手动输入位置」', '📍'); break; }
        showToast('正在测试抓取…', '🔎', { duration: 2000 });
        if (!window.BW_PROVIDERS) { showToast('数据源模块没加载', '⚠️'); break; }
        window.BW_PROVIDERS.nearby({ lat: here.lat, lon: (here.lon !== undefined ? here.lon : here.lng), radius: 1200, limit: 20 })
          .then(function (list) {
            var withPhoto = list.filter(function (x) { return x.photoUrl; }).length;
            showToast('抓到 ' + list.length + ' 个 · 带图 ' + withPhoto + ' 个', '✅', { duration: 2600 });
            render();
          })
          .catch(function (e) { showToast('抓取失败：' + (e.message || e), '⚠️', { duration: 3200 }); });
        break;
      }
      case 'force-update': {
        showToast('正在清理缓存并重新加载…', '🔄', { duration: 2000 });
        Promise.all([
          window.caches && caches.keys ? caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (k) { return caches.delete(k); }));
          }) : Promise.resolve(),
          navigator.serviceWorker && navigator.serviceWorker.getRegistrations
            ? navigator.serviceWorker.getRegistrations().then(function (rs) {
                return Promise.all(rs.map(function (r) { return r.unregister(); }));
              })
            : Promise.resolve()
        ]).then(function () {
          window.__bwReloading = true;
          location.replace(location.pathname + '?fresh=1#/home');
        }).catch(function () {
          location.reload();
        });
        break;
      }
      case 'reset-demo': {
        seedDemo();
        save();
        navigate('/home');
        showToast('已重置为演示数据', '🧪', { duration: 1800 });
        break;
      }
      case 'demo-arrive':
        ui.demoArrived = true;
        render();
        showToast('已当作你走到了这里（演示）', '📍');
        break;
      case 'go-surprises':
        navigate('/surprises');
        break;
      default:
        break;
    }
  }


  /* ============================================================
     自动化测试 / 演示钩子
     用途：让 Playwright/CDP 直接驱动「选照片 → 埋下 → 拍摄 → 对比」，
     绕开 headless 下不稳定的系统文件选择器。正常使用不会走到这里。
     ============================================================ */
  window.__bw = {
    /** 注入埋惊喜用照片（dataURL） */
    setBuryPhoto: function (dataURL) {
      return hashDataURL(dataURL).then(function (hash) {
        var msgEl = $('#bury-message');
        var hintEl = $('#bury-hint');
        state.pendingBury = {
          photoData: dataURL,
          photoHash: hash,
          message: msgEl ? msgEl.value : '',
          hint: hintEl ? hintEl.value : ''
        };
        render();
        return hash;
      });
    },
    /** 注入寻惊喜的拍摄结果（会走真实 dHash 对比） */
    setSeekPhoto: function (dataURL) {
      return hashDataURL(dataURL).then(function (hash) {
        onSeekShotChosen(dataURL, hash);
        return hash;
      });
    },
    /** 等价于点击「当作到了（演示）」 */
    demoArrive: function () { ui.demoArrived = true; render(); },
    /** 读取当前关键状态，便于断言 */
    snapshot: function () {
      return {
        route: currentRoute(),
        xp: state.profile.xp,
        surprises: allSurprises().map(function (s) {
          return { id: s.id, status: s.status, author: s.authorName, finder: s.finderName || null, score: s.matchScore || null };
        }),
        pendingSeek: state.pendingSeek ? state.pendingSeek.id : null,
        seekShot: ui.seekShot ? { similarity: ui.seekShot.similarity, passed: ui.seekShot.passed } : null
      };
    }
  };

  /* ============================================================
     启动
     ============================================================ */
  function bindEvents() {
    document.addEventListener('click', function (event) {
      var target = event.target.closest ? event.target.closest('[data-action]') : null;
      if (!target) return;
      handleAction(target.getAttribute('data-action'), target, event);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if ($('.modal-scrim', dom.overlayRoot)) { closeModal(); return; }
      if ($('.sheet', dom.sheetRoot)) { navigate('/home'); return; }
      if (currentRoute() === '/reveal') { navigate('/home'); return; }
    });

    window.addEventListener('hashchange', function () {
      closeModal();
      render();
    });

    setInterval(function () {
      if (dom.clock) dom.clock.textContent = formatClock();
    }, 20000);
  }

  function boot() {
    /* 触摸设备标记：折叠屏（iPhone Duo）展开态要靠它走「大屏双列」而不是桌面假外框。
       pointer:coarse 在部分环境不可靠，用多条件兜底。 */
    try {
      var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      var touch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
      if (coarse || touch) document.documentElement.classList.add('is-touch');
    } catch (err) { /* ignore */ }

    dom.screen = $('#screen');
    dom.main = $('#main');
    dom.tabbar = $('#tabbar');
    dom.sheetRoot = $('#sheet-root');
    dom.overlayRoot = $('#overlay-root');
    dom.toastRoot = $('#toast-root');
    dom.clock = $('#clock');

    if (dom.clock) dom.clock.textContent = formatClock();

    var params = new URLSearchParams(location.search);
    var hashQuery = (location.hash.split('?')[1] || '');
    var hashParams = new URLSearchParams(hashQuery);
    var demo = params.get('demo') === '1' || hashParams.get('demo') === '1';
    var fresh = params.get('fresh') === '1' || hashParams.get('fresh') === '1';

    if (fresh) {
      seedFresh();
    } else if (demo) {
      seedDemo();
    } else {
      var saved = load();
      if (saved && saved.demoSeeded) {
        // 以前用 ?demo=1 打开过 → 存档里是演示数据。
        // 用户要的是真实地点，这里直接清掉演示存档，回到真实模式。
        seedFresh();
        state.autoExitedDemo = true;
      } else if (saved) {
        hydrate(saved);
      } else {
        seedFresh();
      }
    }

    // state 在 seedDemo/seedFresh/hydrate 里才创建，所以标记放在这之后
    state.bootMode = fresh ? 'fresh' : demo ? 'demo' : 'saved';

    // 历史遗留：以前真实模式会用虚构兜底点（source='geo'），把这类会话清掉，
    // 否则用户会一直看到同一个假地点（"路口的那个角落"）。
    if (state.session && !state.demoSeeded && !isRealSource(state.session.source)) {
      var staleName = (state.realPlaces[state.session.placeID] || {}).name;
      state.session = null;
      state.reveal = null;
      state.session = null;
      save();
      state.clearedStaleSession = staleName || true;
    }

    // demo / fresh 只是「这次打开」的开关，用完从 URL 去掉，
    // 否则用户把它加到桌面或分享出去，会永远是演示数据。
    if (demo || fresh) {
      try {
        var clean = location.pathname + (location.hash || '');
        history.replaceState(null, '', clean);
      } catch (e) { /* ignore */ }
    }

    // 自动化测试 / 诊断用：只暴露路线几何与进度，不含目的地名称
    window.__bwDebug = function () {
      return {
        session: state.session ? {
          phase: state.session.phase,
          source: state.session.source,
          remaining: state.session.remainingMeters,
          straight: state.session.straightMeters,
          total: state.session.totalMeters,
          hints: state.session.unlockedHintCount
        } : null,
        route: state.route ? {
          points: state.route.points,
          distance: state.route.distanceMeters,
          maneuvers: state.route.maneuvers.map(function (m) {
            return { direction: m.direction, label: m.label, cumulative: m.cumulative };
          })
        } : null,
        walked: state.routeWalkedMeters,
        offRoute: state.routeOffRoute,
        routeState: state.routeState,
        nav: state.navSnapshot || null
      };
    };

    // 地图 Key 由后台统一下发（不打扰用户；失败则只用免费源）
    state.mapKeysMeta = null;
    loadMapKeys();

    bindEvents();
    render();

    if (state.clearedStaleSession) {
      window.setTimeout(function () {
        showToast('之前那个"路口的角落"是程序的假地点，已清掉，重新抽吧', '🧹', { duration: 3600 });
      }, 700);
    }

    if (state.autoExitedDemo) {
      window.setTimeout(function () {
        showToast('已退出演示数据，抽的是真实地点', '📍', { duration: 2600 });
      }, 600);
    }

    /* Service Worker 自动更新：鸿蒙/微信等内置浏览器常把旧版本缓存很久，
       这里主动 update，并在新版本接管时自动刷新一次，避免用户长期跑旧代码。 */
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (window.__bwReloading) return;
        // 走路/揭晓途中的刷新会打断体验：只在「没有进行中的盲盒」时自动重载，
        // 否则挂起，回到首页再刷。
        var busy = state.session && state.session.phase === 'walking';
        if (busy || /^#\/(journey|reveal)/.test(location.hash)) {
          state.updatePending = true;
          showToast('有新版本，回到首页后自动更新', '🔄', { duration: 2600 });
          return;
        }
        window.__bwReloading = true;
        location.reload();
      });
      if (navigator.serviceWorker.register) {
        navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
          if (reg && reg.update) reg.update().catch(function () {});
        }).catch(function () {});
      }
      if (navigator.serviceWorker.getRegistration) {
        navigator.serviceWorker.getRegistration().then(function (reg) {
          if (reg && reg.update) reg.update().catch(function () {});
        }).catch(function () {});
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
