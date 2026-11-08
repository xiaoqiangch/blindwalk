/* 盲走 BlindWalk · Web 高保真原型（零依赖，file:// 可直接运行）
 * 单页 hash 路由 + localStorage 持久化 + 演示/新用户两种状态。
 * 视觉与文案依据：docs/design-system.md；数据：data.js（镜像 apple/Shared/Core）。
 */
(function () {
  'use strict';

  var D = window.BW_DATA;
  var STORE_KEY = 'blindwalk:v1';
  var ROUTES = ['/home', '/setup', '/journey', '/reveal', '/cards', '/social', '/profile', '/achievements', '/watch'];
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
    boardOpen: false
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
        settings: state.settings
      }));
    } catch (err) { /* file:// 隐私模式等场景忽略 */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || data.v !== 1 || !data.profile) return null;
      return data;
    } catch (err) { return null; }
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
      var place = D.PLACE_MAP[card.placeID];
      return place && place.rarity !== 'common';
    }).length;
  }

  function hiddenCount() {
    return state.profile.cards.filter(function (card) {
      var place = D.PLACE_MAP[card.placeID];
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
    var place = D.PLACE_MAP[placeID];
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
      settings: { sound: true, haptic: true }
    };
  }

  function seedFresh() {
    state = freshState();
    try { localStorage.removeItem(STORE_KEY); } catch (err) { /* ignore */ }
  }

  function seedDemo() {
    state = freshState();
    var now = Date.now();
    state.profile.xp = D.DEMO.xp;
    state.profile.streakDays = D.DEMO.streakDays;
    state.profile.totalKm = D.DEMO.totalKm;
    state.profile.boxesOpened = D.DEMO.boxesOpened;
    state.profile.togetherCount = D.DEMO.togetherCount;
    state.profile.displayName = D.DEMO.displayName;

    state.profile.cards = D.DEMO_ORDER.map(function (placeID) {
      var place = D.PLACE_MAP[placeID];
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

  function startSession(place) {
    var duration = D.DURATIONS.filter(function (d) { return d.id === ui.duration; })[0] || D.DURATIONS[1];
    state.session = {
      placeID: place.id,
      totalMeters: duration.startMeters,
      remainingMeters: duration.startMeters,
      unlockedHintCount: 1,
      phase: 'walking',
      startedAt: Date.now(),
      demo: false
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
    var next = clamp(session.remainingMeters - Math.abs(meters), 0, session.totalMeters);
    session.remainingMeters = next;

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

  function beginArrival() {
    if (!state.session || ui.arriving || state.reveal) return;
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
    var place = D.PLACE_MAP[session.placeID];
    if (!place) return;
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
    var place = D.PLACE_MAP[reveal.placeID];
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
    var place = D.PLACE_MAP[reveal.placeID];
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
      '<ellipse cx="60" cy="95" rx="35" ry="5.5" fill="#171410" opacity=".10"/>' +
      '<circle cx="60" cy="55" r="33" fill="#E89B4C" opacity=".14"/>' +
      '<path d="M29 53c0-14 8-24 17-27" stroke="#171410" stroke-width="1.3" opacity=".28" stroke-linecap="round"/>' +
      '<rect x="25" y="46" width="70" height="45" rx="7" fill="#DFC49B" stroke="#171410" stroke-width="1.7"/>' +
      '<rect x="21" y="33.5" width="78" height="17.5" rx="5" fill="#EAD6B2" stroke="#171410" stroke-width="1.7"/>' +
      '<path d="M25 53.5h70" stroke="#171410" stroke-width="1.1" opacity=".35"/>' +
      '<path d="M39.5 33.5c1.6-7.4 7.6-12.5 14.5-12.5M64 21c7 0 13 5.1 14.5 12.5" stroke="#171410" stroke-width="1.4" stroke-linecap="round" opacity=".5"/>' +
      '<path d="M60 21v12.5" stroke="#171410" stroke-width="1.4" stroke-linecap="round" opacity=".5"/>' +
      '<text x="60" y="81" text-anchor="middle" font-size="24" font-weight="700" fill="#171410" font-family="inherit">?</text>' +
      '<circle cx="75" cy="36" r="2.2" fill="#E89B4C"/>' +
      '<circle cx="31" cy="43" r="1.4" fill="#E89B4C" opacity=".8"/>' +
      '</svg>';
  }

  function revealBoxSVG() {
    return '<svg class="reveal-open__box" viewBox="0 0 120 106" fill="none" aria-hidden="true">' +
      '<ellipse cx="60" cy="97" rx="38" ry="5" fill="#000" opacity=".35"/>' +
      '<g id="box-body">' +
      '<rect x="25" y="46" width="70" height="46" rx="7" fill="#DFC49B" stroke="#171410" stroke-width="1.8"/>' +
      '<path d="M25 54h70" stroke="#171410" stroke-width="1.1" opacity=".3"/>' +
      '<g id="box-q"><text x="60" y="82" text-anchor="middle" font-size="25" font-weight="700" fill="#171410" font-family="inherit">?</text></g>' +
      '</g>' +
      '<g id="box-lid">' +
      '<rect x="21" y="33.5" width="78" height="17.5" rx="5" fill="#EAD6B2" stroke="#171410" stroke-width="1.8"/>' +
      '<path d="M39.5 33.5c1.6-7.4 7.6-12.5 14.5-12.5M64 21c7 0 13 5.1 14.5 12.5" stroke="#171410" stroke-width="1.5" stroke-linecap="round" opacity=".5"/>' +
      '<path d="M60 21v12.5" stroke="#171410" stroke-width="1.5" stroke-linecap="round" opacity=".5"/>' +
      '</g>' +
      '</svg>';
  }

  function shakeGlyph() {
    return '<svg class="shakebox" viewBox="0 0 22 22" fill="none" aria-hidden="true">' +
      '<rect x="4.5" y="8" width="13" height="10" rx="2" fill="#171410" opacity=".12" stroke="#171410" stroke-width="1.3"/>' +
      '<rect x="3" y="5" width="16" height="4.5" rx="1.4" fill="#171410" opacity=".2" stroke="#171410" stroke-width="1.3"/>' +
      '</svg>';
  }

  function emptyArtSVG() {
    return '<svg class="empty__art" viewBox="0 0 90 76" fill="none" aria-hidden="true">' +
      '<circle cx="45" cy="40" r="26" fill="#E89B4C" opacity=".13"/>' +
      '<rect x="22" y="32" width="46" height="32" rx="5" fill="#FFFBF3" stroke="#A69C8C" stroke-width="1.4" stroke-dasharray="4 4"/>' +
      '<rect x="19" y="24" width="52" height="12" rx="3.5" fill="#FFFBF3" stroke="#A69C8C" stroke-width="1.4" stroke-dasharray="4 4"/>' +
      '<text x="45" y="55" text-anchor="middle" font-size="16" font-weight="700" fill="#A69C8C" font-family="inherit">?</text>' +
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
    var destX = clamp(place.coords.x, 0.1, 0.9) * W;
    var destY = clamp(place.coords.y, 0.12, 0.78) * H;
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
      '<rect width="' + W + '" height="' + H + '" fill="#F5EEE2"/>' +
      /* 河流 */
      '<path d="M-30 74 C 60 116 142 56 236 94 C 306 122 356 98 420 116" stroke="#DCE7E1" stroke-width="46" fill="none" stroke-linecap="round"/>' +
      '<path d="M-30 74 C 60 116 142 56 236 94 C 306 122 356 98 420 116" stroke="#C9D8D1" stroke-width="1" fill="none" stroke-dasharray="5 9" opacity=".8"/>' +
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
    return '<button class="boxcard__resume" data-action="resume" aria-label="继续这趟盲走">继续 · ' +
      esc(session.remainingMeters) + ' m ›</button>';
  }

  function homeHTML() {
    var profile = state.profile;
    var pass = latestCard();
    var passPlace = pass ? D.PLACE_MAP[pass.placeID] : null;
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
    var text = [place.hint1, place.hint2, place.hint3][index];
    if (index < unlockedCount) {
      var fresh = ui.newHint === index ? ' clue--new' : '';
      return '<div class="clue' + fresh + '"><span class="clue__mark" aria-hidden="true">✅</span><span>' + esc(text) + '</span></div>';
    }
    var lockedText = index === 1
      ? '再走 ' + Math.max(0, remaining - D.HINT_THRESHOLDS[1]) + ' 米，解锁第二条线索'
      : '到了你就知道';
    return '<div class="clue clue--locked"><span class="clue__mark" aria-hidden="true">🔒</span><span>' + esc(lockedText) + '</span></div>';
  }

  function journeyHTML() {
    var session = state.session;
    var backBtn = '<button type="button" class="iconbtn" data-action="back-home" aria-label="返回首页">' + ICON.back + '</button>';

    if (!session || !D.PLACE_MAP[session.placeID]) {
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

    var place = D.PLACE_MAP[session.placeID];
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
      '<div class="journey__map">' + mapSVG(place) +
      '<span class="journey__mapcap">目的地保密中 · 还有 ' + remaining + ' 米</span>' +
      '</div>' +
      '<div class="journey__distance">' +
      '<div><span class="journey__digits">' + remaining + '</span><span class="journey__unit">米</span></div>' +
      '<div class="journey__bearing"><b aria-hidden="true">' + bearingFor(remaining) + '</b><span>' + esc(walkCopy) + '</span></div>' +
      '</div>' +
      '<div class="journey__clues" aria-label="线索">' + clues + '</div>' +
      '<div class="journey__actions">' +
      (arrived
        ? '<button type="button" class="btn btn--primary btn--block" data-action="collect" aria-label="揭晓盲盒">揭晓盲盒</button>'
        : '<button type="button" class="btn btn--primary btn--block" data-action="walk" aria-label="模拟步行 50 米">模拟步行 +50m<span class="demo-tag">演示</span></button>') +
      '<button type="button" class="btn btn--quiet" data-action="arrive" aria-label="我到了，直接揭晓">我到了</button>' +
      '</div>' +
      '</div>';
  }

  function revealCardHTML() {
    var reveal = state.reveal;
    var place = D.PLACE_MAP[reveal.placeID];
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
      '<div class="reveal-card__hero">' +
      '<span class="reveal-card__emoji" aria-hidden="true">' + place.categoryEmoji + '</span>' +
      '<h2 class="reveal-card__name">' + esc(place.name) + '</h2>' +
      '<p class="reveal-card__area">' + esc(placeAreaWord(place)) + ' · ' + esc(place.category) + '</p>' +
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
    var colors = ['#E89B4C', '#F5EEE2', '#D25C3A', '#2E7D78', '#B98A1F', '#FFFBF3'];
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

  function renderReveal() {
    var reveal = state.reveal;
    if (!reveal) {
      var placeID = D.DEMO.reveal.placeID;
      state.reveal = {
        placeID: placeID,
        serial: D.DEMO.reveal.serial,
        collected: false,
        shared: false,
        xpGained: 40 + D.RARITY[D.PLACE_MAP[placeID].rarity].xpBonus
      };
      reveal = state.reveal;
    }
    if (!D.PLACE_MAP[reveal.placeID]) {
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
  }

  function cardsHTML() {
    var profile = state.profile;
    var cardMap = {};
    profile.cards.forEach(function (card) { cardMap[card.placeID] = card; });

    var filtered = D.PLACES.filter(function (place) {
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
      return D.PLACES.indexOf(a) - D.PLACES.indexOf(b);
    });

    var grid = filtered.map(function (place) {
      var card = cardMap[place.id];
      if (!card) {
        return '<div class="fcard fcard--locked" aria-label="未解锁"><span class="fcard__q" aria-hidden="true">?</span>' +
          '<span class="fcard__lock" aria-hidden="true">🔒</span></div>';
      }
      return '<button type="button" class="fcard" data-action="open-card" data-id="' + esc(place.id) + '"' +
        ' aria-label="' + esc(place.name + '，' + D.RARITY[place.rarity].label) + '">' +
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
      '<button type="button" class="setting" data-action="about" aria-label="关于盲走">' +
      '<span class="setting__label">关于</span>' +
      '<span class="setting__chev" aria-hidden="true">' + ICON.chevron + '</span>' +
      '</button>' +
      '</div>';

    return '<div class="page">' +
      '<header class="pagehead"><h1>我的</h1></header>' +
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
      '<div><b>' + profile.totalKm.toFixed(1) + '<span style="font-size:8px;color:rgba(23,20,16,.45);margin-left:2px">km</span></b><span>累计里程</span></div>' +
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
      '<circle cx="99" cy="121" r="84" fill="none" stroke="#E89B4C" stroke-width="7" stroke-linecap="round" stroke-dasharray="527.8" stroke-dashoffset="200.6" transform="rotate(-90 99 121)"/>' +
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
    var place = D.PLACE_MAP[placeID];
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
      '<h3>盲走 BlindWalk</h3>' +
      '<div class="modal__body" style="margin-top:8px">' +
      '<p>不看见终点，才看得见路。</p>' +
      '<p>打开一个散步盲盒，它只带你走，不告诉你去哪；到了，才揭晓这个地方藏着的小惊喜。</p>' +
      '<p style="color:var(--ink-3);font-size:11px">原型 0.1 · 所有地点为虚构演示数据 · 数据只存在本机</p>' +
      '</div>' +
      '<div class="modal__actions"><button type="button" class="btn btn--primary" data-action="close-modal">好</button></div>';
    dom.overlayRoot.innerHTML = modalShell(inner, '关于盲走');
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

    var html = '';
    switch (route) {
      case '/home':
        html = homeHTML();
        break;
      case '/setup':
        html = homeHTML();
        dom.sheetRoot.innerHTML = sheetHTML();
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
      case '/watch':
        html = watchPreviewHTML();
        break;
      default:
        html = homeHTML();
    }

    dom.main.innerHTML = html;
    dom.main.scrollTop = 0;

    if (route === '/journey') startJourneyTimer();
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
  }

  function startJourneyTimer() {
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
    ui.shaking = true;
    button.classList.add('is-shaking', 'is-busy');
    button.innerHTML = shakeGlyph() + '<span>摇盒中…</span>';
    window.setTimeout(function () {
      var place = drawPlace();
      startSession(place);
      ui.shaking = false;
      if (currentRoute() === '/setup') navigate('/journey');
      else render();
    }, 600);
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
      default:
        break;
    }
  }

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
      if (saved) hydrate(saved);
      else seedFresh();
    }

    bindEvents();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
