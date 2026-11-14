/* 步迷 · 兴趣点后台 — 开发用 Mock 服务（仅 ?mock=1 时生效）
 *
 * 用途：服务端并行开发期间，用假数据把界面和截图先跑通。
 * 开启方式：
 *   /admin/?mock=1          → 10 条假数据，离线规则模式（LLM 未配置）
 *   /admin/?mock=empty      → 空列表（看空状态）
 *   /admin/?mock=llm        → 假数据 + 大模型「已就绪」
 *
 * 只在 window.location.search 带 mock 参数时拦截 fetch；线上不受影响。
 * 数据与字段严格按 admin/docs/CONTRACT.md。
 */
(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  if (!params.has('mock')) return;

  const mockMode = params.get('mock');
  const isEmpty = mockMode === 'empty';
  const llmReady = mockMode === 'llm' || params.get('llm') === 'ready';

  const realFetch = window.fetch.bind(window);
  const NOW = Date.now();
  const HOUR = 3600 * 1000;
  const DAY = 24 * HOUR;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ============================================================
  // 假图片：内联 SVG data URI（不依赖外网，截图可用）
  // ============================================================
  function svgPhoto(emoji, from, to) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + from + '"/><stop offset="1" stop-color="' + to + '"/>' +
      '</linearGradient></defs>' +
      '<rect width="96" height="96" fill="url(#g)"/>' +
      '<circle cx="18" cy="76" r="30" fill="#FFFBF3" fill-opacity="0.16"/>' +
      '<circle cx="80" cy="20" r="20" fill="#FFFBF3" fill-opacity="0.12"/>' +
      '<text x="48" y="60" font-size="32" text-anchor="middle">' + emoji + '</text>' +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function base(over) {
    return Object.assign({
      id: 'poi-000000',
      name: '未命名地点',
      lat: 31.2304,
      lon: 121.4737,
      category: 'park',
      emoji: '🌳',
      rarity: 'common',
      area: 'near',
      address: null,
      photoUrl: null,
      photoCredit: null,
      summary: '',
      why: '',
      task: '',
      hints: ['', '', ''],
      tags: [],
      safety: { score: 3, walkable: true, crowded: 'medium', notes: '' },
      llm: { normalizedAt: 0, analyzedAt: 0, model: '', mode: 'offline' },
      status: 'draft',
      source: 'manual',
      createdAt: NOW - 3 * DAY,
      updatedAt: NOW - 3 * DAY
    }, over || {});
  }

  const SEED = [
    base({
      id: 'poi-7f3a9c', name: '上海音乐厅', lat: 31.22888889, lon: 121.47333333,
      category: 'venue', emoji: '🎻', rarity: 'epic', area: 'near',
      address: '黄浦区 · 延安东路', photoUrl: svgPhoto('🎻', '#E7C79B', '#C97B2E'),
      photoCredit: 'Wikimedia Commons',
      summary: '原名南京大戏院，1930 年落成的欧式建筑，现在是听室内乐的地方。',
      why: '你选了「放空」。工作日的傍晚，门口的石阶比大厅安静。',
      task: '数一数门口有几根柱子，记住从左边数第三根。',
      hints: ['找一栋门口有柱子的老建筑。', '会听到有人在调音，断断续续。', '灯亮起来的时候，就是它。'],
      tags: ['历史建筑', '音乐'],
      safety: { score: 5, walkable: true, crowded: 'low', notes: '人行道宽，入口在支路一侧' },
      llm: { normalizedAt: NOW - 26 * HOUR, analyzedAt: NOW - 26 * HOUR, model: 'deepseek-chat', mode: 'llm' },
      status: 'approved', source: 'wikipedia', createdAt: NOW - 9 * DAY, updatedAt: NOW - 26 * HOUR
    }),
    base({
      id: 'poi-2b81de', name: '人民公园', lat: 31.2325, lon: 121.4712,
      category: 'park', emoji: '🌳', rarity: 'common', area: 'near',
      address: '黄浦区 · 南京西路', photoUrl: svgPhoto('🌳', '#B7C9A8', '#2E7D78'),
      photoCredit: 'Wikimedia Commons',
      summary: '市中心的一块绿，早上是打太极的人，下午是相亲角。',
      why: '你选了「热闹」。这里的声音一层叠一层，但不吵。',
      task: '找一张写着字的纸，读完再走。',
      hints: ['跟着最密的树荫走。', '会听到很多人同时说话。', '有长椅的地方就对了。'],
      tags: ['公园', '市民生活'],
      safety: { score: 5, walkable: true, crowded: 'high', notes: '主入口人流大，靠湖一侧安静' },
      llm: { normalizedAt: NOW - 2 * DAY, analyzedAt: NOW - 2 * DAY, model: 'deepseek-chat', mode: 'llm' },
      status: 'approved', source: 'wikipedia', createdAt: NOW - 12 * DAY, updatedAt: NOW - 2 * DAY
    }),
    base({
      id: 'poi-9c4f10', name: '上海博物馆', lat: 31.2303, lon: 121.4757,
      category: 'museum', emoji: '🏛️', rarity: 'rare', area: 'near',
      address: '黄浦区 · 人民大道', photoUrl: svgPhoto('🏛️', '#D9CBB4', '#8B9484'),
      photoCredit: 'Wikimedia Commons',
      summary: '天圆地方的屋顶下面，青铜和瓷器占了整整三层。',
      why: '你选了「发现」。这里的每件东西都比这座城市老。',
      task: '找一件你觉得最不像文物的东西。',
      hints: ['找一个圆顶压着方块的建筑。', '门口要排队，但很快。', '进去以后往上走，别停在第一层。'],
      tags: ['博物馆', '青铜'],
      safety: { score: 4, walkable: true, crowded: 'medium', notes: '广场台阶较滑，雨天注意' },
      llm: { normalizedAt: NOW - 3 * DAY, analyzedAt: 0, model: 'deepseek-chat', mode: 'llm' },
      status: 'review', source: 'wikipedia', createdAt: NOW - 7 * DAY, updatedAt: NOW - 5 * HOUR
    }),
    base({
      id: 'poi-31aa07', name: '外滩天文台', lat: 31.2397, lon: 121.4903,
      category: 'viewpoint', emoji: '🔭', rarity: 'epic', area: 'river',
      address: '黄浦区 · 中山东一路', photoUrl: svgPhoto('🔭', '#E8B98A', '#D25C3A'),
      photoCredit: 'Wikimedia Commons',
      summary: '1898 年建的气象信号台，现在站在江边看对岸。',
      why: '你选了「放空」。风从江面上来，比人先到。',
      task: '数一数对岸亮着几栋楼，记下最亮的那栋。',
      hints: ['往江边走，走到栏杆边。', '会看到一个尖顶的小楼。', '风最大的地方就是它。'],
      tags: ['历史建筑', '江景'],
      safety: { score: 4, walkable: true, crowded: 'medium', notes: '观景平台夜间照明充足' },
      llm: { normalizedAt: NOW - 4 * DAY, analyzedAt: NOW - 4 * DAY, model: 'deepseek-chat', mode: 'llm' },
      status: 'approved', source: 'wikipedia', createdAt: NOW - 15 * DAY, updatedAt: NOW - 4 * DAY
    }),
    base({
      id: 'poi-a07d33', name: '旧市府大楼', lat: 31.2299, lon: 121.4729,
      category: 'historic', emoji: '🏮', rarity: 'rare', area: 'oldtown',
      address: '黄浦区 · 江西中路', photoUrl: svgPhoto('🏮', '#D8BFA0', '#B98A1F'),
      photoCredit: 'Wikimedia Commons',
      summary: '1922 年的市政厅，现在门口的石狮子比楼里更热闹。',
      why: '你选了「发现」。这栋楼的窗户是给另一种天气设计的。',
      task: '看一扇窗户，数一数上面有几块玻璃。',
      hints: ['找一栋楼比街宽的旧房子。', '门口有两只石头做的东西。', '抬头的角度最好。'],
      tags: ['历史建筑', '老城厢'],
      safety: { score: 3, walkable: true, crowded: 'low', notes: '临街无护栏，注意车流' },
      llm: { normalizedAt: 0, analyzedAt: 0, model: '', mode: 'offline' },
      status: 'draft', source: 'wikipedia', createdAt: NOW - 2 * DAY, updatedAt: NOW - 40 * 60 * 1000
    }),
    base({
      id: 'poi-5d2e18', name: '福州路外文书店', lat: 31.2351, lon: 121.4781,
      category: 'bookstore', emoji: '📚', rarity: 'rare', area: 'near',
      address: '黄浦区 · 福州路', photoUrl: null, photoCredit: null,
      summary: '四层楼，英文书在顶层，窗边有几张旧沙发。',
      why: '你选了「放空」。这里翻书的声音比说话多。',
      task: '找一本封面是蓝色的书，翻开第 7 页读三行。',
      hints: ['找一条书店比饭店多的街。', '会闻到纸张和旧木头。', '上到最高一层，靠窗。'],
      tags: ['书店', '安静'],
      safety: { score: 4, walkable: true, crowded: 'low', notes: '门口人行道窄，注意自行车' },
      llm: { normalizedAt: NOW - 6 * HOUR, analyzedAt: 0, model: 'offline', mode: 'offline' },
      status: 'draft', source: 'osm', createdAt: NOW - 5 * DAY, updatedAt: NOW - 6 * HOUR
    }),
    base({
      id: 'poi-88f0c4', name: '南京东路步行街广场', lat: 31.2375, lon: 121.4756,
      category: 'plaza', emoji: '⛲️', rarity: 'common', area: 'near',
      address: '黄浦区 · 南京东路', photoUrl: svgPhoto('⛲️', '#CBB79B', '#8B9484'),
      photoCredit: 'Wikimedia Commons',
      summary: '步行街最挤的一段，喷泉在中间，卖气球的人绕着圈走。',
      why: '你选了「热闹」。这里没有安静的时刻。',
      task: '找到一个不低头看手机的人。',
      hints: ['跟着人流走，别拐弯。', '会听到很多种口音。', '有水的地方就是中间。'],
      tags: ['步行街', '人多'],
      safety: { score: 2, walkable: true, crowded: 'high', notes: '人流高峰期拥挤，注意随身物品' },
      llm: { normalizedAt: NOW - 2 * DAY, analyzedAt: NOW - 2 * DAY, model: 'deepseek-chat', mode: 'llm' },
      status: 'rejected', source: 'osm', createdAt: NOW - 6 * DAY, updatedAt: NOW - 2 * DAY
    }),
    base({
      id: 'poi-c1a55b', name: '苏州河乍浦路桥', lat: 31.2449, lon: 121.4817,
      category: 'bridge', emoji: '🌉', rarity: 'rare', area: 'river',
      address: '虹口区 · 乍浦路', photoUrl: svgPhoto('🌉', '#BCCBC6', '#2E7D78'),
      photoCredit: 'Wikimedia Commons',
      summary: '1927 年的桥，桥面不宽，站在中间能看到两边水面的颜色不一样。',
      why: '你选了「放空」。桥上的风比岸上凉两度。',
      task: '站在桥中间，看哪边的水面更亮。',
      hints: ['找一座能走人的桥。', '桥两头都有人钓鱼。', '站在中间，别靠边。'],
      tags: ['桥', '河岸'],
      safety: { score: 3, walkable: true, crowded: 'medium', notes: '非机动车多，桥面人行道窄' },
      llm: { normalizedAt: 0, analyzedAt: 0, model: '', mode: 'offline' },
      status: 'draft', source: 'osm', createdAt: NOW - 1 * DAY, updatedAt: NOW - 22 * HOUR
    }),
    base({
      id: 'poi-e4b209', name: '田子坊艺术墙', lat: 31.2101, lon: 121.4687,
      category: 'art', emoji: '🎨', rarity: 'epic', area: 'oldtown',
      address: '黄浦区 · 泰康路', photoUrl: svgPhoto('🎨', '#D9B7A0', '#6B5B9E'),
      photoCredit: 'Wikimedia Commons',
      summary: '弄堂深处的一面墙，每隔几个月换一次颜色，现在这一面是橘色。',
      why: '你选了「发现」。这里拐三个弯才能看见颜色。',
      task: '拍一张只有一个颜色的照片。',
      hints: ['往巷子里走，别走大路。', '会先闻到咖啡，再看到颜色。', '最乱的那面就是。'],
      tags: ['涂鸦', '弄堂'],
      safety: { score: 3, walkable: true, crowded: 'medium', notes: '弄堂狭窄，人流对冲严重' },
      llm: { normalizedAt: NOW - 20 * HOUR, analyzedAt: NOW - 20 * HOUR, model: 'deepseek-chat', mode: 'llm' },
      status: 'review', source: 'wikipedia', createdAt: NOW - 4 * DAY, updatedAt: NOW - 20 * HOUR
    }),
    base({
      id: 'poi-6f0c72', name: '老城厢葱油饼摊', lat: 31.2217, lon: 121.4923,
      category: 'market', emoji: '🛒', rarity: 'common', area: 'oldtown',
      address: '黄浦区 · 乔家路', photoUrl: null, photoCredit: null,
      summary: '一个小推车，下午三点出摊，排队的人比饼多。',
      why: '你选了「热闹」。热油的声音比叫卖声好听。',
      task: '买一个，站在路边吃完再走。',
      hints: ['闻。有热油的味道。', '跟着排队的人走。', '找那个没有招牌的推车。'],
      tags: ['小吃', '街边'],
      safety: { score: 2, walkable: true, crowded: 'high', notes: '占道经营，行人需绕行机动车道' },
      llm: { normalizedAt: 0, analyzedAt: 0, model: '', mode: 'offline' },
      status: 'draft', source: 'osm', createdAt: NOW - 3 * DAY, updatedAt: NOW - 3 * DAY
    })
  ];

  const store = {
    pois: isEmpty ? [] : SEED.slice()
  };

  // 地图 Key（仅 Mock：保存在内存，方便开发界面联调）
  const mockMapKeys = { amap: '', baidu: '', updatedAt: 0 };

  function maskMockKey(value) {
    const text = String(value || '');
    if (!text) return '';
    if (text.length >= 8) return text.slice(0, 4) + '…' + text.slice(-4);
    return '…';
  }

  function mockMapKeysView() {
    const keys = {};
    ['amap', 'baidu'].forEach(function (provider) {
      if (mockMapKeys[provider]) {
        keys[provider] = {
          configured: true,
          hint: maskMockKey(mockMapKeys[provider]),
          updatedAt: mockMapKeys.updatedAt
        };
      } else {
        keys[provider] = { configured: false };
      }
    });
    return { ok: true, keys: keys, publicUrl: '/api/public/mapkeys' };
  }

  // ============================================================
  // 工具
  // ============================================================
  function computeStats() {
    const byStatus = { draft: 0, review: 0, approved: 0, rejected: 0 };
    const byCategory = {};
    let withPhoto = 0;
    let withHints = 0;
    store.pois.forEach(function (poi) {
      if (byStatus[poi.status] !== undefined) byStatus[poi.status] += 1;
      byCategory[poi.category] = (byCategory[poi.category] || 0) + 1;
      if (poi.photoUrl) withPhoto += 1;
      if (Array.isArray(poi.hints) && poi.hints.filter(function (h) { return h && h.trim(); }).length === 3) withHints += 1;
    });
    return {
      total: store.pois.length,
      byStatus: byStatus,
      byCategory: byCategory,
      withPhoto: withPhoto,
      withHints: withHints
    };
  }

  function findIndex(id) {
    for (let i = 0; i < store.pois.length; i++) {
      if (store.pois[i].id === id) return i;
    }
    return -1;
  }

  function makeId() {
    let hex = '';
    for (let i = 0; i < 6; i++) hex += Math.floor(Math.random() * 16).toString(16);
    return 'poi-' + hex;
  }

  function photoAsset(emoji, from, to) {
    return svgPhoto(emoji, from, to);
  }

  // ============================================================
  // 离线规则模板（契约 §6）
  // ============================================================
  const OFFLINE_COPY = {
    venue: {
      why: '这里的声音比你想象的大。站在门口听一会儿，再决定要不要进去。',
      task: '找一张今晚的演出海报，记住上面的第一个字。',
      hints: ['找一栋门口有灯的老建筑。', '会听到有人在试音。', '灯亮得最晚的那扇门。']
    },
    park: {
      why: '公园把城市的声音压低了一点。你可以慢下来。',
      task: '找一张长椅，坐满一分钟再走。',
      hints: ['跟着树荫走。', '会听到很多人在说话。', '颜色最深的那片草地。']
    },
    museum: {
      why: '这里的每件东西都比这座城市老。慢慢看。',
      task: '找一件你觉得最不像文物的东西。',
      hints: ['找一个屋顶很高的建筑。', '门口要排队，但很快。', '往上走，别停在第一层。']
    },
    cafe: {
      why: '窗口只开半扇，热气一直往外跑。',
      task: '点一杯最便宜的，问一句今天的豆子。',
      hints: ['找一面墙上开了一个洞的店。', '会闻到烘焙的味道。', '半扇窗，踮脚。']
    },
    bookstore: {
      why: '这里翻书的声音比说话多。',
      task: '找一本封面是蓝色的书，翻开第 7 页读三行。',
      hints: ['找一条书店比饭店多的街。', '会闻到纸张和旧木头。', '靠窗的位置。']
    },
    river: {
      why: '水把城市的噪音带走了一部分。',
      task: '对着水面站满 60 秒，什么都不做。',
      hints: ['往低处走。', '会听到水拍石头的声音。', '风变大的地方。']
    },
    bridge: {
      why: '桥上比岸上凉。两边水面颜色不一样。',
      task: '站在桥中间，看哪边的水面更亮。',
      hints: ['找一座能走人的桥。', '桥两头都有人钓鱼。', '站在中间，别靠边。']
    },
    viewpoint: {
      why: '站高一点，城市会变得像一张地图。',
      task: '找一盏最远的灯，记住它的方向。',
      hints: ['往上走。', '风会变大。', '能看见很远的地方。']
    },
    default: {
      why: '这里不显眼，但值得停一下。',
      task: '站一会儿，找一样只有这里才有的东西。',
      hints: ['往人少的方向走。', '会闻到一点不一样的味道。', '就在前面，慢慢看。']
    }
  };

  function offlineCopy(category) {
    return OFFLINE_COPY[category] || OFFLINE_COPY.default;
  }

  function containsPlaceName(text, name) {
    if (!text || !name) return false;
    const t = String(text).replace(/\s+/g, '');
    const n = String(name).replace(/\s+/g, '');
    if (n.length < 2) return t.indexOf(n) >= 0;
    if (t.indexOf(n) >= 0) return true;
    return t.indexOf(n.slice(0, 2)) >= 0;
  }

  function analyzeOne(poi) {
    let score = 3;
    if (poi.photoUrl) score += 1;
    if (['park', 'river', 'viewpoint', 'garden'].indexOf(poi.category) >= 0) score += 1;
    if (!poi.why || !poi.task) score -= 1;
    let leaking = false;
    (poi.hints || []).forEach(function (hint) {
      if (containsPlaceName(hint, poi.name)) leaking = true;
    });
    if (leaking) score -= 3;
    score = Math.max(1, Math.min(5, score));
    const verdict = score >= 4 ? 'good' : (score >= 2 ? 'risky' : 'reject');
    const suggestions = {
      good: '适合作为盲盒目的地：可步行、有独特性，建议保持线索不含地名。',
      risky: '可以作候选，但需要复核安全与可达性；线索建议更含蓄一点。',
      reject: '不建议上架：人流/交通/保密风险偏高，或文案缺失。'
    };
    return {
      safety: {
        score: score,
        walkable: score >= 2,
        crowded: ['market', 'plaza'].indexOf(poi.category) >= 0 ? 'high' : 'medium',
        notes: leaking ? '线索疑似含地名，发布前必须改掉。' : '演示规则打分（离线模式）。'
      },
      verdict: verdict,
      suggestion: suggestions[verdict]
    };
  }

  // ============================================================
  // 路由实现
  // ============================================================
  function json(payload, status) {
    return { status: status || 200, payload: payload };
  }

  function fail(message, code, status) {
    const error = new Error(message);
    error.code = code || 'BAD_REQUEST';
    error.status = status || 400;
    throw error;
  }

  function listPois(search) {
    const status = search.get('status');
    const category = search.get('category');
    const q = (search.get('q') || '').trim().toLowerCase();
    const limit = parseInt(search.get('limit') || '100', 10) || 100;
    const offset = parseInt(search.get('offset') || '0', 10) || 0;

    let items = store.pois.slice();
    if (status && status !== 'all') {
      items = items.filter(function (p) { return p.status === status; });
    }
    if (category) {
      items = items.filter(function (p) { return p.category === category; });
    }
    if (q) {
      items = items.filter(function (p) {
        const haystack = [p.name, p.summary, (p.tags || []).join(' ')].join(' ').toLowerCase();
        return haystack.indexOf(q) >= 0;
      });
    }
    items.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    const total = items.length;
    return json({ total: total, items: items.slice(offset, offset + limit) });
  }

  function route(pathname, method, body, search) {
    // 地图 Key（Mock）
    if (pathname === '/api/mapkeys' && method === 'GET') {
      return json(mockMapKeysView());
    }
    if (pathname === '/api/mapkeys' && method === 'PUT') {
      const keys = body && body.keys;
      if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
        return fail('keys 必须是对象（含 amap / baidu）', 'BAD_REQUEST', 400);
      }
      let changed = false;
      ['amap', 'baidu'].forEach(function (provider) {
        if (!Object.prototype.hasOwnProperty.call(keys, provider)) return;
        if (typeof keys[provider] !== 'string') {
          return fail('keys.' + provider + ' 必须是字符串', 'BAD_REQUEST', 400);
        }
        mockMapKeys[provider] = keys[provider].trim();
        changed = true;
      });
      if (!changed) return fail('没有可更新的 Key', 'BAD_REQUEST', 400);
      mockMapKeys.updatedAt = Date.now();
      return json(mockMapKeysView());
    }
    if (pathname === '/api/mapkeys/test' && method === 'POST') {
      const provider = body && body.provider;
      if (provider !== 'amap' && provider !== 'baidu') {
        return fail('provider 必须是 amap 或 baidu', 'BAD_REQUEST', 400);
      }
      if (!mockMapKeys[provider]) {
        return json({ ok: false, provider: provider, count: 0, error: '未配置 Key（Mock）' });
      }
      return json({ ok: true, provider: provider, count: 3 });
    }

    // 统计
    if (pathname === '/api/stats' && method === 'GET') {
      return json(computeStats());
    }

    // LLM 状态
    if (pathname === '/api/llm/status' && method === 'GET') {
      return json({
        mode: llmReady ? 'llm' : 'offline',
        model: llmReady ? 'deepseek-chat' : 'offline',
        baseUrl: llmReady ? 'https://api.deepseek.com/v1' : '',
        ready: llmReady
      });
    }

    // 列表
    if (pathname === '/api/pois' && method === 'GET') {
      return listPois(search);
    }

    // 新建
    if (pathname === '/api/pois' && method === 'POST') {
      const now = Date.now();
      const poi = Object.assign({}, body || {});
      poi.id = makeId();
      poi.createdAt = now;
      poi.updatedAt = now;
      poi.status = poi.status || 'draft';
      poi.source = poi.source || 'manual';
      poi.hints = Array.isArray(poi.hints) && poi.hints.length ? poi.hints : ['', '', ''];
      poi.tags = Array.isArray(poi.tags) ? poi.tags : [];
      store.pois.push(poi);
      return json(poi, 200);
    }

    // 单条
    const match = pathname.match(/^\/api\/pois\/([^/]+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const index = findIndex(id);
      if (index < 0) return fail('找不到兴趣点：' + id, 'NOT_FOUND', 404);
      if (method === 'GET') return json(store.pois[index]);
      if (method === 'PUT') {
        const next = Object.assign({}, store.pois[index], body || {});
        next.id = store.pois[index].id;
        next.createdAt = store.pois[index].createdAt;
        next.updatedAt = Date.now();
        store.pois[index] = next;
        return json(next);
      }
      if (method === 'DELETE') {
        store.pois.splice(index, 1);
        return json({ ok: true });
      }
    }

    // 抓取
    if (pathname === '/api/ingest' && method === 'POST') {
      const now = Date.now();
      const lat = Number(body && body.lat);
      const lon = Number(body && body.lon);
      const added = [];
      const candidates = [
        { name: '转角咖啡窗口', category: 'cafe', emoji: '☕️', rarity: 'common' },
        { name: '河边旧书摊', category: 'bookstore', emoji: '📚', rarity: 'rare' },
        { name: '弄堂口花店', category: 'garden', emoji: '🌷', rarity: 'rare' }
      ];
      candidates.forEach(function (candidate, index) {
        const template = offlineCopy(candidate.category);
        added.push(base({
          id: makeId(),
          name: candidate.name,
          lat: (isNaN(lat) ? 31.2304 : lat) + index * 0.0006,
          lon: (isNaN(lon) ? 121.4737 : lon) + index * 0.0006,
          category: candidate.category,
          emoji: candidate.emoji,
          rarity: candidate.rarity,
          area: 'near',
          address: '演示抓取结果',
          summary: '（Mock）从公开数据抓取到的候选地点。',
          why: template.why,
          task: template.task,
          hints: template.hints.slice(),
          tags: ['抓取', '待整理'],
          status: 'draft',
          source: index === 0 ? 'wikipedia' : 'osm',
          createdAt: now,
          updatedAt: now - index * 1000
        }));
      });
      store.pois = added.concat(store.pois);
      return json({ added: added.length, skipped: 2, items: added, source: 'mixed' });
    }

    // AI 整理
    if (pathname === '/api/llm/normalize' && method === 'POST') {
      const index = findIndex(body && body.id);
      if (index < 0) return fail('找不到兴趣点：' + (body && body.id), 'NOT_FOUND', 404);
      const poi = store.pois[index];
      const template = offlineCopy(poi.category);
      const changed = [];
      if (!poi.why || poi.why !== template.why) { poi.why = template.why; changed.push('why'); }
      if (!poi.task || poi.task !== template.task) { poi.task = template.task; changed.push('task'); }
      poi.hints = template.hints.slice();
      changed.push('hints');
      poi.llm = {
        normalizedAt: Date.now(),
        analyzedAt: poi.llm ? poi.llm.analyzedAt || 0 : 0,
        model: llmReady ? 'deepseek-chat' : 'offline',
        mode: llmReady ? 'llm' : 'offline'
      };
      poi.updatedAt = Date.now();
      return json({ poi: poi, changed: changed, mode: llmReady ? 'llm' : 'offline' });
    }

    // AI 编辑
    if (pathname === '/api/llm/edit' && method === 'POST') {
      if (!llmReady) {
        return fail('未配置大模型（WA_LLM_API_KEY），无法用指令改写。', 'LLM_UNAVAILABLE', 400);
      }
      const index = findIndex(body && body.id);
      if (index < 0) return fail('找不到兴趣点：' + (body && body.id), 'NOT_FOUND', 404);
      const poi = store.pois[index];
      const instruction = (body && body.instruction) || '';
      poi.why = '这一带比看上去安静。' + (instruction ? '（按指令重写：' + instruction + '）' : '');
      poi.task = '站一会儿，找一样只有这里才有的东西。';
      poi.hints = ['往人少的方向走。', '会闻到一点不一样的味道。', '就在前面，慢慢看。'];
      poi.llm = {
        normalizedAt: poi.llm ? poi.llm.normalizedAt || 0 : 0,
        analyzedAt: poi.llm ? poi.llm.analyzedAt || 0 : 0,
        model: 'deepseek-chat',
        mode: 'llm'
      };
      poi.updatedAt = Date.now();
      return json({ poi: poi, changed: ['why', 'task', 'hints'], mode: 'llm' });
    }

    // AI 分析（单条 / 多条）
    if (pathname === '/api/llm/analyze' && method === 'POST') {
      const ids = (body && body.ids) || [];
      if (!Array.isArray(ids) || ids.length === 0) return fail('ids 不能为空', 'BAD_REQUEST', 400);
      const items = [];
      ids.forEach(function (id) {
        const index = findIndex(id);
        if (index < 0) return;
        const poi = store.pois[index];
        const result = analyzeOne(poi);
        poi.safety = result.safety;
        poi.llm = {
          normalizedAt: poi.llm ? poi.llm.normalizedAt || 0 : 0,
          analyzedAt: Date.now(),
          model: llmReady ? 'deepseek-chat' : 'offline',
          mode: llmReady ? 'llm' : 'offline'
        };
        poi.updatedAt = Date.now();
        items.push({
          id: id,
          safety: result.safety,
          suggestion: result.suggestion,
          verdict: result.verdict,
          name: poi.name
        });
      });
      return json({ items: items, mode: llmReady ? 'llm' : 'offline' });
    }

    // 批量分析
    if (pathname === '/api/llm/analyze-all' && method === 'POST') {
      const status = (body && body.status) || 'draft';
      const targets = store.pois.filter(function (poi) { return poi.status === status; });
      const items = [];
      targets.forEach(function (poi) {
        const result = analyzeOne(poi);
        poi.safety = result.safety;
        poi.llm = {
          normalizedAt: poi.llm ? poi.llm.normalizedAt || 0 : 0,
          analyzedAt: Date.now(),
          model: llmReady ? 'deepseek-chat' : 'offline',
          mode: llmReady ? 'llm' : 'offline'
        };
        poi.updatedAt = Date.now();
        items.push({ id: poi.id, safety: result.safety, suggestion: result.suggestion, verdict: result.verdict, name: poi.name });
      });
      return json({ analyzed: items.length, items: items, mode: llmReady ? 'llm' : 'offline' });
    }

    // 导出
    if (pathname === '/api/export' && method === 'POST') {
      const approved = store.pois.filter(function (poi) { return poi.status === 'approved'; });
      return json({ ok: true, path: '../prototype/web/pois.json', count: approved.length });
    }

    return fail('未知接口：' + method + ' ' + pathname, 'NOT_FOUND', 404);
  }

  // ============================================================
  // 拦截 fetch
  // ============================================================
  window.fetch = async function (input, init) {
    const raw = typeof input === 'string' ? input : (input && input.url ? input.url : '');
    let url;
    try {
      url = new URL(raw, window.location.origin);
    } catch (_) {
      return realFetch(input, init);
    }
    if (url.pathname.indexOf('/api/') !== 0) {
      return realFetch(input, init);
    }
    await sleep(140 + Math.floor(Math.random() * 180));
    const method = (init && init.method ? init.method : 'GET').toUpperCase();
    let body = null;
    if (init && init.body) {
      try { body = JSON.parse(init.body); } catch (_) { body = null; }
    }
    try {
      const result = route(url.pathname, method, body, url.searchParams);
      return new Response(JSON.stringify(result.payload), {
        status: result.status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    } catch (error) {
      return new Response(JSON.stringify({
        error: error.message || 'Mock 服务错误',
        code: error.code || 'INTERNAL'
      }), {
        status: error.status || 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }
  };

  window.__WA_MOCK__ = { mode: mockMode, llmReady: llmReady, store: store };
})();
