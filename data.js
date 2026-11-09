/* 盲走 BlindWalk · Web 原型数据（零依赖，可直接 file:// 打开）
 * 地点 / 成就 / 动态 / 周榜 逐字镜像自：
 *   apple/Shared/Core/PlaceCatalog.swift
 *   apple/Shared/Core/AchievementEngine.swift
 *   apple/Shared/Core/SocialFeed.swift
 *   apple/Shared/Core/DemoData.swift
 * 演示数值对齐 docs/design-system.md §7。
 * 注：demo 卡片日期取「index + 3 天前」，使首页「已是 3 天前」与 design-system §5.1 文案一致
 *     （DemoData.swift 的 dayOffset 为 index + 2，仅差一天，展示层以 design-system 为准）。
 */
(function () {
  'use strict';

  var DAY = 86400000;

  /** 本地时区的「N 天前」日期串（YYYY-MM-DD）。
   *  不能用 toISOString()：它是 UTC，东八区早上时段会退回前一天，
   *  导致首页「上一次的惊喜 · 已是 N 天前」多算一天。*/
  function isoDaysAgo(days) {
    var d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - days);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  /* MARK: - 24 个地点（河岸 8 / 老城区 8 / 附近 8）
   * 契约字段：id, name, area, category, categoryEmoji, rarity, why, task,
   *          hint1, hint2, hint3, coords{x,y}, date, collected
   * date / collected / serial 由下方 DEMO_ORDER 回填。
   */
  var PLACES = [
    // MARK: 河岸
    {
      id: 'river-bench-07',
      name: '河边的第七张长椅',
      area: 'river',
      category: '长椅',
      categoryEmoji: '🪑',
      rarity: 'common',
      why: '你选了「放空」。工作日的这个时间，这张长椅通常只有三个人路过。\n它面朝水面，背对马路——很适合什么都不想。',
      task: '数一数河面上有几艘船，记下数字。',
      hint1: '风里有水汽，往那个方向走会越来越凉。',
      hint2: '你会先经过一段没有路灯的栏杆。别怕，一直走。',
      hint3: '就在前面。灯很暗，慢慢看。',
      coords: { x: 0.30, y: 0.28 },
      radiusMeters: 1100
    },
    {
      id: 'river-steps',
      name: '旧码头边的石阶',
      area: 'river',
      category: '石阶',
      categoryEmoji: '🪜',
      rarity: 'rare',
      why: '码头拆掉很多年了，石阶还在。水位高的时候，最下面两级会消失。\n今天水位不高，你可以坐在第三级。',
      task: '把手伸进水里，数到十再拿出来。',
      hint1: '往低处走。你会听到水拍石头的声音。',
      hint2: '有一段铁链护栏，摸上去是温的。',
      hint3: '台阶有点滑。慢一点。',
      coords: { x: 0.18, y: 0.40 },
      radiusMeters: 1500
    },
    {
      id: 'river-graffiti',
      name: '桥洞下的小块涂鸦墙',
      area: 'river',
      category: '涂鸦墙',
      categoryEmoji: '🎨',
      rarity: 'epic',
      why: '桥洞把城市的噪音挡在外面，这里安静得不像话。\n墙上每隔几个月就会多一层新的颜色，今天这一层是橘色的。',
      task: '拍一张只有一个颜色的照片。',
      hint1: '找一个回声很大的地方。',
      hint2: '声音会从头顶传过来。',
      hint3: '往颜色最乱的那面墙走。',
      coords: { x: 0.42, y: 0.22 },
      radiusMeters: 2200
    },
    {
      id: 'river-lighthouse',
      name: '河堤尽头的白色小灯塔',
      area: 'river',
      category: '灯塔',
      categoryEmoji: '🗼',
      rarity: 'hidden',
      why: '它其实只是个航标，但晚上亮起来的时候，像有人替你留了一盏灯。\n到这儿的人不多，风很大，记得拉上外套拉链。',
      task: '对着水面站满 60 秒，什么都不做。',
      hint1: '一直往水边走，走到没有路为止。',
      hint2: '你会看到一点白色，在很远的尽头。',
      hint3: '风会变大。就是那里。',
      coords: { x: 0.10, y: 0.16 },
      radiusMeters: 2800
    },
    {
      id: 'river-boardwalk',
      name: '水杉林里的木栈道',
      area: 'river',
      category: '栈道',
      categoryEmoji: '🌲',
      rarity: 'common',
      why: '水杉长得很高，风穿过树顶的声音像有人在翻书。\n栈道有一块木板会响，你可以找找是哪一块。',
      task: '找出那块会响的木板，记住它的位置。',
      hint1: '找一片树比楼高的地方。',
      hint2: '脚下会从硬的变成软的。',
      hint3: '听。有块木板在等你。',
      coords: { x: 0.36, y: 0.46 },
      radiusMeters: 1300
    },
    {
      id: 'river-kites',
      name: '防汛墙上的一排风筝',
      area: 'river',
      category: '风筝',
      categoryEmoji: '🪁',
      rarity: 'rare',
      why: '每天傍晚都有人在这儿放风筝，线轴插在墙缝里。\n风筝飞得不高，但一直在。',
      task: '找到飞得最低的那只风筝。',
      hint1: '抬头。这一路都值得抬头。',
      hint2: '你会看到几根细线，从墙上起飞。',
      hint3: '往线最密的地方走。',
      coords: { x: 0.55, y: 0.18 },
      radiusMeters: 1600
    },
    {
      id: 'river-bookstore',
      name: '旧仓库改的书店',
      area: 'river',
      category: '书店',
      categoryEmoji: '📚',
      rarity: 'rare',
      why: '仓库的钢架还留着，书却已经堆到屋顶。\n靠窗那排书桌不许外借，但可以坐一整晚。',
      task: '找一本封面是蓝色的书，翻开第 7 页读三行。',
      hint1: '找一栋很高的旧房子，窗户很大。',
      hint2: '会闻到纸和木头混在一起的味道。',
      hint3: '门口没有招牌。推门就对了。',
      coords: { x: 0.62, y: 0.34 },
      radiusMeters: 1700
    },
    {
      id: 'river-carwash',
      name: '夜间亮灯的洗车房旁',
      area: 'river',
      category: '洗车房',
      categoryEmoji: '🚿',
      rarity: 'common',
      why: '这家洗车房晚上十点还开着，白灯把水花照得很亮。\n蹲在马路牙子上看一会儿，会觉得城市运转得挺可爱。',
      task: '数一数十分钟内开进来几辆车。',
      hint1: '找一片特别亮的地面，湿的。',
      hint2: '会有水声，和吸尘器的声音。',
      hint3: '别站太近，会溅到。',
      coords: { x: 0.48, y: 0.56 },
      radiusMeters: 1200
    },

    // MARK: 老城区
    {
      id: 'old-watch-repair',
      name: '弄堂口修表摊',
      area: 'oldtown',
      category: '修表摊',
      categoryEmoji: '⌚️',
      rarity: 'rare',
      why: '老师傅在这儿坐了三十年。桌上那盏台灯比很多东西都老。\n他不太说话，但会给你看表壳背面的划痕。',
      task: '看一眼摊上的玻璃柜，找到最旧的那块表。',
      hint1: '往楼挨得最近的地方走。',
      hint2: '会有一盏很亮的台灯，在弄堂口。',
      hint3: '别急着说话，先看。',
      coords: { x: 0.72, y: 0.62 },
      radiusMeters: 1400
    },
    {
      id: 'old-balcony',
      name: '老房子二楼的公共阳台',
      area: 'oldtown',
      category: '阳台',
      categoryEmoji: '🪴',
      rarity: 'epic',
      why: '这栋楼的二楼有个不对外的公共阳台，晾衣绳横在头顶。\n从下往上看，能看到五户人家的生活边角。',
      task: '找一盆你觉得活得最好的植物。',
      hint1: '抬头找晾衣绳。',
      hint2: '有一栋楼的窗户都是绿的。',
      hint3: '楼梯在侧面，很窄。',
      coords: { x: 0.82, y: 0.30 },
      radiusMeters: 2100
    },
    {
      id: 'old-flower-shop',
      name: '菜场后门的花店',
      area: 'oldtown',
      category: '花店',
      categoryEmoji: '💐',
      rarity: 'common',
      why: '花店开在菜场后门，门口永远湿漉漉的。\n老板会把卖剩的花扎成一把，五块钱。',
      task: '买一把十块钱以内的花，或者闻三种花再走。',
      hint1: '找人多、声音杂的地方。',
      hint2: '会先闻到鱼腥味，然后是花香。',
      hint3: '往水最多的地方走。',
      coords: { x: 0.68, y: 0.44 },
      radiusMeters: 1000
    },
    {
      id: 'old-chess',
      name: '梧桐树下那张褪色棋盘',
      area: 'oldtown',
      category: '棋盘',
      categoryEmoji: '♟️',
      rarity: 'common',
      why: '棋盘是直接画在水泥地上的，白漆快掉光了。\n下午总有人在这儿下棋，围观的人比下棋的多。',
      task: '看一局棋，猜猜谁会赢（不用等结果）。',
      hint1: '找树荫最大的地方。',
      hint2: '会有很多人站成一圈。',
      hint3: '低下头，地上有格子。',
      coords: { x: 0.76, y: 0.50 },
      radiusMeters: 1200
    },
    {
      id: 'old-postbox',
      name: '旧邮局门口的绿色邮筒',
      area: 'oldtown',
      category: '邮筒',
      categoryEmoji: '📮',
      rarity: 'rare',
      why: '邮局搬走了，邮筒留了下来，投信口被焊死了。\n但它还是绿色的，还是站在原来的位置。',
      task: '把手掌贴在邮筒上，感受一下它的温度。',
      hint1: '找一栋门口有台阶的旧楼。',
      hint2: '会看到一点绿，很旧的那种绿。',
      hint3: '它在等一封寄不出去的信。',
      coords: { x: 0.60, y: 0.70 },
      radiusMeters: 1500
    },
    {
      id: 'old-records',
      name: '藏在理发店后面的唱片架',
      area: 'oldtown',
      category: '唱片店',
      categoryEmoji: '💿',
      rarity: 'epic',
      why: '理发店的镜子后面有一道门，推开门是两排黑胶。\n老板只放他喜欢的歌，你可以在那儿站很久。',
      task: '记住现在放的这首歌的节奏，走出去哼两句。',
      hint1: '找一家有旋转灯柱的理发店。',
      hint2: '门在镜子后面，别不好意思推。',
      hint3: '会听到黑胶的沙沙声。',
      coords: { x: 0.88, y: 0.74 },
      radiusMeters: 1900
    },
    {
      id: 'old-tailor-eave',
      name: '雨天的裁缝铺屋檐',
      area: 'oldtown',
      category: '裁缝铺',
      categoryEmoji: '🧵',
      rarity: 'common',
      why: '屋檐很宽，下雨天可以站四五个人躲雨。\n缝纫机的声音从里面传出来，哒、哒、哒。',
      task: '听三十秒缝纫机的声音，数一数它响了几下。',
      hint1: '找一条窄的、有屋檐的街。',
      hint2: '会有针脚一样的节拍。',
      hint3: '站到雨淋不到的地方。',
      coords: { x: 0.66, y: 0.82 },
      radiusMeters: 1300
    },
    {
      id: 'old-wonton',
      name: '小馄饨摊的第三张塑料凳',
      area: 'oldtown',
      category: '馄饨摊',
      categoryEmoji: '🥟',
      rarity: 'rare',
      why: '三张塑料凳，第三张腿有点短，会轻轻晃。\n老板记得每个熟客要不要香菜。',
      task: '要一碗小馄饨，坐第三张凳子吃完。',
      hint1: '闻。有热汤的味道。',
      hint2: '找三张一样颜色的塑料凳。',
      hint3: '第三张凳子会晃。就是它。',
      coords: { x: 0.56, y: 0.38 },
      radiusMeters: 1400
    },

    // MARK: 附近
    {
      id: 'near-store-hotdrink',
      name: '楼下便利店的热饮柜前',
      area: 'near',
      category: '便利店',
      categoryEmoji: '🥫',
      rarity: 'common',
      why: '热饮柜的灯是暖的，站在前面会莫名其妙地想买点什么。\n今晚第二层第二排的豆浆还剩两瓶。',
      task: '买一样不超过 5 块钱的热的东西。',
      hint1: '往灯最亮的地方走。',
      hint2: '会听到「欢迎光临」的电子音。',
      hint3: '站在有热气的地方。',
      coords: { x: 0.44, y: 0.72 },
      radiusMeters: 500
    },
    {
      id: 'near-swing',
      name: '小公园里会响的秋千',
      area: 'near',
      category: '秋千',
      categoryEmoji: '🛝',
      rarity: 'common',
      why: '第二个秋千的链条会响，吱呀、吱呀。\n大人坐上去有点丢人，但晚上没人看见。',
      task: '荡十下，什么都不想。',
      hint1: '找有滑梯的地方。',
      hint2: '会听到金属摩擦的声音。',
      hint3: '第二个。',
      coords: { x: 0.34, y: 0.66 },
      radiusMeters: 800
    },
    {
      id: 'near-basketball',
      name: '社区篮球场的边线',
      area: 'near',
      category: '篮球场',
      categoryEmoji: '🏀',
      rarity: 'common',
      why: '这个点的球场只剩下投篮声，球在水泥地上弹得很响。\n边线上有几道粉笔画，是上周画的。',
      task: '站在边线上，看他们投进三个球再走。',
      hint1: '跟着拍球的声音走。',
      hint2: '会有高高的铁网。',
      hint3: '站在白线外面看就好。',
      coords: { x: 0.58, y: 0.58 },
      radiusMeters: 900
    },
    {
      id: 'near-coffee-window',
      name: '那家只开半扇门的咖啡窗口',
      area: 'near',
      category: '咖啡窗口',
      categoryEmoji: '☕️',
      rarity: 'rare',
      why: '窗口只开半扇，点单要稍微踮脚。\n老板会多给你一小杯气泡水，不要钱。',
      task: '点一杯最便宜的，问老板今天豆子是哪里的。',
      hint1: '找一面墙上开了一个洞的店。',
      hint2: '会闻到烘焙的味道。',
      hint3: '半扇门。踮脚。',
      coords: { x: 0.50, y: 0.44 },
      radiusMeters: 1100
    },
    {
      id: 'near-water-tower',
      name: '天台上的旧水塔',
      area: 'near',
      category: '水塔',
      categoryEmoji: '🛢️',
      rarity: 'epic',
      why: '楼顶的水塔早就不用了，铁皮上爬满锈。\n从这里看下去，整条街像一条发光的河。',
      task: '在楼顶找到能看见最远一盏灯的地方。',
      hint1: '找一栋可以上楼的旧楼。',
      hint2: '越来越安静，风越来越大。',
      hint3: '抬起头，看那个圆圆的东西。',
      coords: { x: 0.24, y: 0.58 },
      radiusMeters: 2300
    },
    {
      id: 'near-flower-cart',
      name: '地铁口卖花的三轮车',
      area: 'near',
      category: '三轮车',
      categoryEmoji: '🌷',
      rarity: 'common',
      why: '三轮车上插着十几桶花，颜色挤在一起有点吵。\n阿姨会喊「最后一束了」，其实还有很多。',
      task: '挑一朵最不像花的花。',
      hint1: '找人多、有台阶的地方。',
      hint2: '会闻到很浓的甜味。',
      hint3: '往颜色最多的地方走。',
      coords: { x: 0.74, y: 0.16 },
      radiusMeters: 700
    },
    {
      id: 'near-library-steps',
      name: '图书馆门口的台阶',
      area: 'near',
      category: '台阶',
      categoryEmoji: '📖',
      rarity: 'common',
      why: '台阶很宽，晚上总有人坐在上面看书、打电话、发呆。\n没人会问你为什么坐在这儿。',
      task: '坐下来，看十分钟别人进进出出。',
      hint1: '找一栋门口有大台阶的建筑。',
      hint2: '会很安静，只有翻书声。',
      hint3: '坐在最上面一级。',
      coords: { x: 0.38, y: 0.34 },
      radiusMeters: 1000
    },
    {
      id: 'near-laundromat',
      name: '24 小时自助洗衣店',
      area: 'near',
      category: '洗衣店',
      categoryEmoji: '🧺',
      rarity: 'hidden',
      why: '店里只有洗衣机的嗡嗡声，和几把没人坐的塑料椅。\n凌晨两点，这里比任何地方都像一个暂停键。',
      task: '听一台洗衣机完整转完一个周期。',
      hint1: '找一块很亮的玻璃，里面在转。',
      hint2: '会听到水声，和滚筒转动的声音。',
      hint3: '别带衣服。就看看。',
      coords: { x: 0.86, y: 0.48 },
      radiusMeters: 2600
    }
  ];

  /* DemoData.collectedPlaceIDs —— 18 张已收集（顺序即 demo 日期/编号顺序） */
  var DEMO_ORDER = [
    'river-bench-07', 'river-boardwalk', 'river-carwash',
    'near-store-hotdrink', 'near-swing', 'near-basketball', 'near-library-steps',
    'near-flower-cart', 'old-flower-shop', 'old-chess', 'old-tailor-eave',
    'river-steps', 'river-kites', 'river-bookstore', 'old-watch-repair',
    'river-graffiti', 'old-records',
    'near-laundromat'
  ];

  PLACES.forEach(function (place) {
    var index = DEMO_ORDER.indexOf(place.id);
    place.collected = index >= 0;
    place.demoIndex = index;
    place.date = index >= 0 ? isoDaysAgo(index + 3) : null;
    /* DemoData: String(format: "%04d", 101 + index * 37 % 9000) */
    place.serial = index >= 0 ? String(101 + (index * 37) % 9000).padStart(4, '0') : null;
    place.taskDone = index >= 0 ? index % 3 !== 0 : false;
  });

  /* MARK: - 稀有度 / 心情 / 时长 / 区域（Models.swift） */
  var RARITY = {
    common: { id: 'common', label: '常见', color: '#8B9484', xpBonus: 0, weight: 70 },
    rare: { id: 'rare', label: '稀有', color: '#2E7D78', xpBonus: 10, weight: 22 },
    epic: { id: 'epic', label: '史诗', color: '#6B5B9E', xpBonus: 20, weight: 6 },
    hidden: { id: 'hidden', label: '隐藏', color: '#B98A1F', xpBonus: 40, weight: 2 }
  };

  var MOODS = [
    { id: 'drift', title: '放空', emoji: '🌫️', subtitle: '不想讲话，只想走走' },
    { id: 'discover', title: '发现', emoji: '🔍', subtitle: '我想看点没见过的' },
    { id: 'lively', title: '热闹', emoji: '🥁', subtitle: '去哪儿都行，人多一点' }
  ];

  var DURATIONS = [
    { id: 15, title: '15 分钟 · 一小圈', main: '15 分钟', sub: '一小圈', startMeters: 300, radiusMeters: 900 },
    { id: 30, title: '30 分钟 · 刚好', main: '30 分钟', sub: '刚好', startMeters: 480, radiusMeters: 1600 },
    { id: 60, title: '60 分钟 · 走远点', main: '60 分钟', sub: '走远点', startMeters: 900, radiusMeters: 3000 }
  ];

  /* label：设置页与筛选 chip（design-system §5.2）；word：揭晓页小字（§5.4「河岸」） */
  var AREAS = [
    { id: 'near', label: '附近', word: '附近' },
    { id: 'river', label: '河边', word: '河岸' },
    { id: 'oldtown', label: '老城区', word: '老城区' }
  ];

  /* 旅程方向副文案（demo 河岸场景固定为 design-system §5.3 原文） */
  var WALK_COPY = {
    river: '沿河往北走，别急',
    oldtown: '往巷子深处走，别急',
    near: '跟着最近的灯走，别急'
  };

  /* MARK: - 成就（AchievementEngine.swift，与 design-system §5.8 一致） */
  var ACHIEVEMENTS = [
    { id: 'first_box', name: '第一次拆盒', icon: '🎁', detail: '完成第 1 次盲走', target: 1 },
    { id: 'walker_10', name: '城市漫游者', icon: '🚶', detail: '完成 10 次盲走', target: 10 },
    { id: 'rare_first', name: '稀有体质', icon: '💎', detail: '首次获得稀有卡', target: 1 },
    { id: 'hidden_first', name: '挖到隐藏款', icon: '🗝️', detail: '首次获得隐藏卡', target: 1 },
    { id: 'early_bird', name: '早起的鸟', icon: '🌅', detail: '07:00 前到达', target: 1 },
    { id: 'night_owl', name: '夜行动物', icon: '🌙', detail: '22:00 后到达', target: 1 },
    { id: 'streak_7', name: '七日不断', icon: '🔥', detail: '连续 7 天开盒', target: 7 },
    { id: 'together_1', name: '同频共振', icon: '📡', detail: '完成 1 次同频散步', target: 1 },
    { id: 'share_3', name: '分享欲', icon: '📣', detail: '发布 3 条动态', target: 3 },
    { id: 'km_100', name: '盲走百公里', icon: '🧭', detail: '累计 100 km', target: 100 },
    { id: 'bury_1', name: '埋下一颗', icon: '🌱', detail: '第一次给别人埋下惊喜', target: 1 },
    { id: 'seek_3', name: '寻光者', icon: '🔎', detail: '找到 3 个别人埋的惊喜', target: 3 },
    { id: 'found_5', name: '被找到的人', icon: '💌', detail: '你埋的惊喜被找到 5 次', target: 5 }
  ];

  /* MARK: - 圈子 mock（SocialFeed.swift） */
  var MOCK_POSTS = [
    {
      id: 'mock-1',
      authorName: '小满',
      authorEmoji: '🐱',
      placeName: '旧仓库改的书店',
      categoryEmoji: '📚',
      rarity: 'rare',
      caption: '本来只想路过，结果在里面坐了一个小时。',
      agoSeconds: 12 * 60,
      reactions: { eyes: 12, heart: 3, next: 5 },
      isMine: false
    },
    {
      id: 'mock-2',
      authorName: '阿岛',
      authorEmoji: '🎧',
      placeName: '桥洞下的小块涂鸦墙',
      categoryEmoji: '🎨',
      rarity: 'epic',
      caption: '桥洞里回声很大，我对着墙说了句「你好」，它回了我三遍。',
      agoSeconds: 48 * 60,
      reactions: { eyes: 21, heart: 6, next: 9 },
      isMine: false
    },
    {
      id: 'mock-3',
      authorName: '77',
      authorEmoji: '🌙',
      placeName: '24 小时自助洗衣店',
      categoryEmoji: '🧺',
      rarity: 'hidden',
      caption: '凌晨两点，洗衣机转起来像宇宙飞船。',
      agoSeconds: 3 * 3600,
      reactions: { eyes: 31, heart: 2, next: 14 },
      isMine: false
    },
    {
      id: 'mock-4',
      authorName: '老陈',
      authorEmoji: '🍜',
      placeName: '小馄饨摊的第三张塑料凳',
      categoryEmoji: '🥟',
      rarity: 'rare',
      caption: '第三张凳子真的会晃。老板说那是他故意的。',
      agoSeconds: 6 * 3600,
      reactions: { eyes: 8, heart: 4, next: 2 },
      isMine: false
    }
  ];

  /* DemoData.madePosts —— 本人 2 条动态 */
  var DEMO_MINE_POSTS = [
    {
      id: 'mine-1',
      authorName: '阿澈',
      authorEmoji: '🫥',
      placeName: '旧仓库改的书店',
      categoryEmoji: '📚',
      rarity: 'rare',
      caption: '本来只想路过，结果在里面坐了一个小时。',
      agoSeconds: 26 * 60,
      reactions: { eyes: 9, heart: 2, next: 4 },
      isMine: true
    },
    {
      id: 'mine-2',
      authorName: '阿澈',
      authorEmoji: '🫥',
      placeName: '河边的第七张长椅',
      categoryEmoji: '🪑',
      rarity: 'common',
      caption: '坐了一会儿，什么也没想。',
      agoSeconds: 2 * 86400,
      reactions: { eyes: 4, heart: 1, next: 0 },
      isMine: true
    }
  ];

  /* 周榜（SocialFeed.leaderboard；按 design-system §7「本人第 4（305 分）」调整老陈分数） */
  var LEADERBOARD = [
    { id: 'u1', name: '小满', emoji: '🐱', score: 520 },
    { id: 'u2', name: '阿岛', emoji: '🎧', score: 465 },
    { id: 'u3', name: '77', emoji: '🌙', score: 400 },
    { id: 'u4', name: '老陈', emoji: '🍜', score: 285 }
  ];

  var FRIENDS = [
    { name: '小满', emoji: '🐱', online: false },
    { name: '阿岛', emoji: '🎧', online: false },
    { name: '77', emoji: '🌙', online: true },
    { name: '老陈', emoji: '🍜', online: false }
  ];

  /* MARK: - 演示态（design-system §7 / DemoData.swift） */
  var DEMO = {
    displayName: '阿澈',
    xp: 4240,
    streakDays: 12,
    totalKm: 42.6,
    boxesOpened: 18,
    togetherCount: 0,
    session: {
      placeID: 'river-steps',
      totalMeters: 1260,
      remainingMeters: 480,
      unlockedHintCount: 1,
      phase: 'walking',
      startedAgoSeconds: 12 * 60 + 34
    },
    reveal: { placeID: 'river-steps', serial: '0247' },
    /* DemoData：12 天每天到达一次，含一次清晨（第 5 天 06:12）与一次深夜（第 8 天 22:40）。
       daysAgo 从 0 开始 = 今天也走过，最近 7 个自然日各 1 次 → 本周惊喜值 7×20=140。
       今天那次若还没到 19:12，会被 app.js 夹到「现在之前一分钟」，仍算今天。 */
    arrivals: (function () {
      var list = [];
      for (var day = 0; day < 12; day += 1) {
        list.push({
          daysAgo: day,
          hour: day === 5 ? 6 : (day === 8 ? 22 : 19),
          minute: day === 8 ? 40 : 12
        });
      }
      return list;
    })(),
    minePosts: DEMO_MINE_POSTS
  };

  /* MARK: - 埋惊喜 / 寻惊喜（Surprise.swift 的 web 镜像）
   * 演示坐标围绕人民广场铺开；真实使用时用 navigator.geolocation。
   * 照片用 dataURL（真实使用时由用户拍摄，这里用占位）。
   */
  var SURPRISE_ORIGIN = { lat: 31.2304, lng: 121.4737 };

  /* 把「相对原点的米数 + 方位角」换算成经纬度（与 GeoMath.offset 同思路） */
  function geoOffset(meters, bearingDeg) {
    var R = 6371000;
    var ang = meters / R;
    var brg = bearingDeg * Math.PI / 180;
    var lat1 = SURPRISE_ORIGIN.lat * Math.PI / 180;
    var lon1 = SURPRISE_ORIGIN.lng * Math.PI / 180;
    var lat2 = Math.asin(Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(brg));
    var lon2 = lon1 + Math.atan2(Math.sin(brg) * Math.sin(ang) * Math.cos(lat1),
                                 Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2));
    return { lat: lat2 * 180 / Math.PI, lng: lon2 * 180 / Math.PI };
  }

  var DEMO_SURPRISES = [
    {
      id: 'surprise-seed-1',
      authorName: '小满', authorEmoji: '🐱',
      photoData: null,  /* null = 演示占位，走「演示匹配」 */
      message: '这张是我在等一杯咖啡时拍的。柜台后面那盏灯，晚上会有很软的一圈光。',
      location: geoOffset(320, 24),
      areaLabel: '静安 · 街角',
      clues: ['有人在这里放下了一张照片。先走近一点。', '往灯最暖的那扇窗走。', '就是这儿。抬手机，拍一张和 TA 一样的。'],
      radiusMeters: 60, seekerPoints: 80, authorPoints: 40,
      createdAt: Date.now() - 3 * 86400000,
      status: 'waiting'
    },
    {
      id: 'surprise-seed-2',
      authorName: '阿岛', authorEmoji: '🎧',
      photoData: null,
      message: '桥洞下的那面墙，早上七点没有人，光会斜着打进来。',
      location: geoOffset(540, 118),
      areaLabel: '河岸 · 桥洞',
      clues: ['有人在这里放下了一张照片。先走近一点。', '找一块回声很大的地方。', '就是这儿。抬手机，拍一张和 TA 一样的。'],
      radiusMeters: 60, seekerPoints: 80, authorPoints: 40,
      createdAt: Date.now() - 5 * 86400000,
      status: 'waiting'
    },
    {
      id: 'surprise-seed-3',
      authorName: '77', authorEmoji: '🌙',
      photoData: null,
      message: '二十四小时的洗衣店，凌晨两点最像宇宙飞船。我拍了它转起来的那个瞬间。',
      location: geoOffset(760, 300),
      areaLabel: '附近 · 街口',
      clues: ['有人在这里放下了一张照片。先走近一点。', '找一块很亮的玻璃，里面在转。', '就是这儿。抬手机，拍一张和 TA 一样的。'],
      radiusMeters: 60, seekerPoints: 80, authorPoints: 40,
      createdAt: Date.now() - 8 * 86400000,
      status: 'waiting'
    },
    {
      id: 'surprise-seed-4',
      authorName: '老陈', authorEmoji: '🍜',
      photoData: null,
      message: '第三张塑料凳，腿短一截。老板故意留的。',
      location: geoOffset(210, 200),
      areaLabel: '老城区 · 街口',
      clues: ['有人在这里放下了一张照片。先走近一点。', '闻，有热汤的味道。', '就是这儿。抬手机，拍一张和 TA 一样的。'],
      radiusMeters: 60, seekerPoints: 80, authorPoints: 40,
      createdAt: Date.now() - 11 * 86400000,
      status: 'found',
      finderName: '小满', foundAt: Date.now() - 9 * 86400000, matchScore: 0.78
    }
  ];

  window.BW_DATA = {
    PLACES: PLACES,
    PLACE_MAP: PLACES.reduce(function (map, place) {
      map[place.id] = place;
      return map;
    }, {}),
    DEMO_ORDER: DEMO_ORDER,
    DEMO_SURPRISES: DEMO_SURPRISES,
    SURPRISE_ORIGIN: SURPRISE_ORIGIN,
    geoOffset: geoOffset,
    RARITY: RARITY,
    MOODS: MOODS,
    DURATIONS: DURATIONS,
    AREAS: AREAS,
    AREA_MAP: AREAS.reduce(function (map, area) {
      map[area.id] = area;
      return map;
    }, {}),
    WALK_COPY: WALK_COPY,
    ACHIEVEMENTS: ACHIEVEMENTS,
    MOCK_POSTS: MOCK_POSTS,
    LEADERBOARD: LEADERBOARD,
    FRIENDS: FRIENDS,
    DEMO: DEMO,
    TOGETHER_CODE: 'K7M2QX',
    ARRIVE_THRESHOLD: 30,
    HINT_THRESHOLDS: [400, 200, 60]
  };
})();
