/**
 * 盲走 BlindWalk · HarmonyOS 逻辑层 — 地点库与枚举展示属性
 *
 * 数据来源（逐字镜像）：
 * - 24 个内置地点：apple/Shared/Core/PlaceCatalog.swift
 * - 枚举展示属性：apple/Shared/Core/Models.swift
 * - 真实地点映射（精简版）：apple/Shared/Core/RealPlace.swift
 *
 * 保密规则：内置地点的 hints 不含地点名（含前 2 字）；真实地点生成后用 scrub 清洗。
 */

import { bearing as bearingBetween, distance as distanceBetween } from './geo';
import {
  Area,
  GeoPoint,
  MapPoint,
  Mood,
  Place,
  Rarity,
  WalkDuration
} from './types';

// ============================================================
// 枚举展示属性（Models.swift）
// ============================================================

export function rarityLabel(rarity: Rarity): string {
  switch (rarity) {
    case Rarity.Common: return '常见';
    case Rarity.Rare: return '稀有';
    case Rarity.Epic: return '史诗';
    case Rarity.Hidden: return '隐藏';
    default: return '常见';
  }
}

/** 收录卡片时额外获得的惊喜值 */
export function rarityXpBonus(rarity: Rarity): number {
  switch (rarity) {
    case Rarity.Common: return 0;
    case Rarity.Rare: return 10;
    case Rarity.Epic: return 20;
    case Rarity.Hidden: return 40;
    default: return 0;
  }
}

/** 抽盒权重：常见 70 / 稀有 22 / 史诗 6 / 隐藏 2 */
export function rarityWeight(rarity: Rarity): number {
  switch (rarity) {
    case Rarity.Common: return 70;
    case Rarity.Rare: return 22;
    case Rarity.Epic: return 6;
    case Rarity.Hidden: return 2;
    default: return 1;
  }
}

/** 隐藏款只在 60 分钟档开放（Models.swift Rarity.isAvailable） */
export function rarityAvailableIn(rarity: Rarity, duration: WalkDuration): boolean {
  if (rarity !== Rarity.Hidden) return true;
  return duration === WalkDuration.M60;
}

export function moodTitle(mood: Mood): string {
  switch (mood) {
    case Mood.Drift: return '放空';
    case Mood.Discover: return '发现';
    case Mood.Lively: return '热闹';
    default: return '放空';
  }
}

export function moodEmoji(mood: Mood): string {
  switch (mood) {
    case Mood.Drift: return '🌫️';
    case Mood.Discover: return '🔍';
    case Mood.Lively: return '🥁';
    default: return '🌫️';
  }
}

export function moodSubtitle(mood: Mood): string {
  switch (mood) {
    case Mood.Drift: return '不想讲话，只想走走';
    case Mood.Discover: return '我想看点没见过的';
    case Mood.Lively: return '去哪儿都行，人多一点';
    default: return '';
  }
}

export function durationTitle(duration: WalkDuration): string {
  switch (duration) {
    case WalkDuration.M15: return '15 分钟 · 一小圈';
    case WalkDuration.M30: return '30 分钟 · 刚好';
    case WalkDuration.M60: return '60 分钟 · 走远点';
    default: return '';
  }
}

/** 演示起始距离（米） */
export function durationStartMeters(duration: WalkDuration): number {
  switch (duration) {
    case WalkDuration.M15: return 300;
    case WalkDuration.M30: return 480;
    case WalkDuration.M60: return 900;
    default: return 480;
  }
}

/** 抽盒半径（米） */
export function durationRadiusMeters(duration: WalkDuration): number {
  switch (duration) {
    case WalkDuration.M15: return 900;
    case WalkDuration.M30: return 1600;
    case WalkDuration.M60: return 3000;
    default: return 1600;
  }
}

export function areaLabel(area: Area): string {
  switch (area) {
    case Area.Near: return '附近';
    case Area.River: return '河边';
    case Area.OldTown: return '老城区';
    default: return '附近';
  }
}

// ============================================================
// 24 个内置地点（PlaceCatalog.swift 逐字镜像）
// ============================================================

function catalogPlace(
  id: string,
  name: string,
  area: Area,
  category: string,
  emoji: string,
  rarity: Rarity,
  why: string,
  task: string,
  hints: string[],
  x: number,
  y: number,
  radiusMeters: number
): Place {
  const point: MapPoint = { x: x, y: y };
  const place: Place = {
    id: id,
    name: name,
    area: area,
    category: category,
    emoji: emoji,
    rarity: rarity,
    why: why,
    task: task,
    hints: hints,
    mapPoint: point,
    radiusMeters: radiusMeters,
    source: 'catalog'
  };
  return place;
}

/** 河岸 8 个 */
const RIVER_PLACES: Place[] = [
  catalogPlace(
    'river-bench-07', '河边的第七张长椅', Area.River, '长椅', '🪑', Rarity.Common,
    '你选了「放空」。工作日的这个时间，这张长椅通常只有三个人路过。\n它面朝水面，背对马路——很适合什么都不想。',
    '数一数河面上有几艘船，记下数字。',
    [
      '风里有水汽，往那个方向走会越来越凉。',
      '你会先经过一段没有路灯的栏杆。别怕，一直走。',
      '就在前面。灯很暗，慢慢看。'
    ],
    0.30, 0.28, 1100
  ),
  catalogPlace(
    'river-steps', '旧码头边的石阶', Area.River, '石阶', '🪜', Rarity.Rare,
    '码头拆掉很多年了，石阶还在。水位高的时候，最下面两级会消失。\n今天水位不高，你可以坐在第三级。',
    '把手伸进水里，数到十再拿出来。',
    [
      '往低处走。你会听到水拍石头的声音。',
      '有一段铁链护栏，摸上去是温的。',
      '台阶有点滑。慢一点。'
    ],
    0.18, 0.40, 1500
  ),
  catalogPlace(
    'river-graffiti', '桥洞下的小块涂鸦墙', Area.River, '涂鸦墙', '🎨', Rarity.Epic,
    '桥洞把城市的噪音挡在外面，这里安静得不像话。\n墙上每隔几个月就会多一层新的颜色，今天这一层是橘色的。',
    '拍一张只有一个颜色的照片。',
    [
      '找一个回声很大的地方。',
      '声音会从头顶传过来。',
      '往颜色最乱的那面墙走。'
    ],
    0.42, 0.22, 2200
  ),
  catalogPlace(
    'river-lighthouse', '河堤尽头的白色小灯塔', Area.River, '灯塔', '🗼', Rarity.Hidden,
    '它其实只是个航标，但晚上亮起来的时候，像有人替你留了一盏灯。\n到这儿的人不多，风很大，记得拉上外套拉链。',
    '对着水面站满 60 秒，什么都不做。',
    [
      '一直往水边走，走到没有路为止。',
      '你会看到一点白色，在很远的尽头。',
      '风会变大。就是那里。'
    ],
    0.10, 0.16, 2800
  ),
  catalogPlace(
    'river-boardwalk', '水杉林里的木栈道', Area.River, '栈道', '🌲', Rarity.Common,
    '水杉长得很高，风穿过树顶的声音像有人在翻书。\n栈道有一块木板会响，你可以找找是哪一块。',
    '找出那块会响的木板，记住它的位置。',
    [
      '找一片树比楼高的地方。',
      '脚下会从硬的变成软的。',
      '听。有块木板在等你。'
    ],
    0.36, 0.46, 1300
  ),
  catalogPlace(
    'river-kites', '防汛墙上的一排风筝', Area.River, '风筝', '🪁', Rarity.Rare,
    '每天傍晚都有人在这儿放风筝，线轴插在墙缝里。\n风筝飞得不高，但一直在。',
    '找到飞得最低的那只风筝。',
    [
      '抬头。这一路都值得抬头。',
      '你会看到几根细线，从墙上起飞。',
      '往线最密的地方走。'
    ],
    0.55, 0.18, 1600
  ),
  catalogPlace(
    'river-bookstore', '旧仓库改的书店', Area.River, '书店', '📚', Rarity.Rare,
    '仓库的钢架还留着，书却已经堆到屋顶。\n靠窗那排书桌不许外借，但可以坐一整晚。',
    '找一本封面是蓝色的书，翻开第 7 页读三行。',
    [
      '找一栋很高的旧房子，窗户很大。',
      '会闻到纸和木头混在一起的味道。',
      '门口没有招牌。推门就对了。'
    ],
    0.62, 0.34, 1700
  ),
  catalogPlace(
    'river-carwash', '夜间亮灯的洗车房旁', Area.River, '洗车房', '🚿', Rarity.Common,
    '这家洗车房晚上十点还开着，白灯把水花照得很亮。\n蹲在马路牙子上看一会儿，会觉得城市运转得挺可爱。',
    '数一数十分钟内开进来几辆车。',
    [
      '找一片特别亮的地面，湿的。',
      '会有水声，和吸尘器的声音。',
      '别站太近，会溅到。'
    ],
    0.48, 0.56, 1200
  )
];

/** 老城区 8 个 */
const OLD_TOWN_PLACES: Place[] = [
  catalogPlace(
    'old-watch-repair', '弄堂口修表摊', Area.OldTown, '修表摊', '⌚️', Rarity.Rare,
    '老师傅在这儿坐了三十年。桌上那盏台灯比很多东西都老。\n他不太说话，但会给你看表壳背面的划痕。',
    '看一眼摊上的玻璃柜，找到最旧的那块表。',
    [
      '往楼挨得最近的地方走。',
      // 苹果版原文是「会有一盏很亮的台灯，在弄堂口。」，但 line 泄露地名前 2 字「弄堂」，
      // 按本次任务硬性保密规则（线索不得含地名，含前 2 字）改为「路口」。
      '会有一盏很亮的台灯，就在路口。',
      '别急着说话，先看。'
    ],
    0.72, 0.62, 1400
  ),
  catalogPlace(
    'old-balcony', '老房子二楼的公共阳台', Area.OldTown, '阳台', '🪴', Rarity.Epic,
    '这栋楼的二楼有个不对外的公共阳台，晾衣绳横在头顶。\n从下往上看，能看到五户人家的生活边角。',
    '找一盆你觉得活得最好的植物。',
    [
      '抬头找晾衣绳。',
      '有一栋楼的窗户都是绿的。',
      '楼梯在侧面，很窄。'
    ],
    0.82, 0.30, 2100
  ),
  catalogPlace(
    'old-flower-shop', '菜场后门的花店', Area.OldTown, '花店', '💐', Rarity.Common,
    '花店开在菜场后门，门口永远湿漉漉的。\n老板会把卖剩的花扎成一把，五块钱。',
    '买一把十块钱以内的花，或者闻三种花再走。',
    [
      '找人多、声音杂的地方。',
      '会先闻到鱼腥味，然后是花香。',
      '往水最多的地方走。'
    ],
    0.68, 0.44, 1000
  ),
  catalogPlace(
    'old-chess', '梧桐树下那张褪色棋盘', Area.OldTown, '棋盘', '♟️', Rarity.Common,
    '棋盘是直接画在水泥地上的，白漆快掉光了。\n下午总有人在这儿下棋，围观的人比下棋的多。',
    '看一局棋，猜猜谁会赢（不用等结果）。',
    [
      '找树荫最大的地方。',
      '会有很多人站成一圈。',
      '低下头，地上有格子。'
    ],
    0.76, 0.50, 1200
  ),
  catalogPlace(
    'old-postbox', '旧邮局门口的绿色邮筒', Area.OldTown, '邮筒', '📮', Rarity.Rare,
    '邮局搬走了，邮筒留了下来，投信口被焊死了。\n但它还是绿色的，还是站在原来的位置。',
    '把手掌贴在邮筒上，感受一下它的温度。',
    [
      '找一栋门口有台阶的旧楼。',
      '会看到一点绿，很旧的那种绿。',
      '它在等一封寄不出去的信。'
    ],
    0.60, 0.70, 1500
  ),
  catalogPlace(
    'old-records', '藏在理发店后面的唱片架', Area.OldTown, '唱片店', '💿', Rarity.Epic,
    '理发店的镜子后面有一道门，推开门是两排黑胶。\n老板只放他喜欢的歌，你可以在那儿站很久。',
    '记住现在放的这首歌的节奏，走出去哼两句。',
    [
      '找一家有旋转灯柱的理发店。',
      '门在镜子后面，别不好意思推。',
      '会听到黑胶的沙沙声。'
    ],
    0.88, 0.74, 1900
  ),
  catalogPlace(
    'old-tailor-eave', '雨天的裁缝铺屋檐', Area.OldTown, '裁缝铺', '🧵', Rarity.Common,
    '屋檐很宽，下雨天可以站四五个人躲雨。\n缝纫机的声音从里面传出来，哒、哒、哒。',
    '听三十秒缝纫机的声音，数一数它响了几下。',
    [
      '找一条窄的、有屋檐的街。',
      '会有针脚一样的节拍。',
      '站到雨淋不到的地方。'
    ],
    0.66, 0.82, 1300
  ),
  catalogPlace(
    'old-wonton', '小馄饨摊的第三张塑料凳', Area.OldTown, '馄饨摊', '🥟', Rarity.Rare,
    '三张塑料凳，第三张腿有点短，会轻轻晃。\n老板记得每个熟客要不要香菜。',
    '要一碗小馄饨，坐第三张凳子吃完。',
    [
      '闻。有热汤的味道。',
      '找三张一样颜色的塑料凳。',
      '第三张凳子会晃。就是它。'
    ],
    0.56, 0.38, 1400
  )
];

/** 附近 8 个 */
const NEAR_PLACES: Place[] = [
  catalogPlace(
    'near-store-hotdrink', '楼下便利店的热饮柜前', Area.Near, '便利店', '🥫', Rarity.Common,
    '热饮柜的灯是暖的，站在前面会莫名其妙地想买点什么。\n今晚第二层第二排的豆浆还剩两瓶。',
    '买一样不超过 5 块钱的热的东西。',
    [
      '往灯最亮的地方走。',
      '会听到「欢迎光临」的电子音。',
      '站在有热气的地方。'
    ],
    0.44, 0.72, 500
  ),
  catalogPlace(
    'near-swing', '小公园里会响的秋千', Area.Near, '秋千', '🛝', Rarity.Common,
    '第二个秋千的链条会响，吱呀、吱呀。\n大人坐上去有点丢人，但晚上没人看见。',
    '荡十下，什么都不想。',
    [
      '找有滑梯的地方。',
      '会听到金属摩擦的声音。',
      '第二个。'
    ],
    0.34, 0.66, 800
  ),
  catalogPlace(
    'near-basketball', '社区篮球场的边线', Area.Near, '篮球场', '🏀', Rarity.Common,
    '这个点的球场只剩下投篮声，球在水泥地上弹得很响。\n边线上有几道粉笔画，是上周画的。',
    '站在边线上，看他们投进三个球再走。',
    [
      '跟着拍球的声音走。',
      '会有高高的铁网。',
      '站在白线外面看就好。'
    ],
    0.58, 0.58, 900
  ),
  catalogPlace(
    'near-coffee-window', '那家只开半扇门的咖啡窗口', Area.Near, '咖啡窗口', '☕️', Rarity.Rare,
    '窗口只开半扇，点单要稍微踮脚。\n老板会多给你一小杯气泡水，不要钱。',
    '点一杯最便宜的，问老板今天豆子是哪里的。',
    [
      '找一面墙上开了一个洞的店。',
      '会闻到烘焙的味道。',
      '半扇门。踮脚。'
    ],
    0.50, 0.44, 1100
  ),
  catalogPlace(
    'near-water-tower', '天台上的旧水塔', Area.Near, '水塔', '🛢️', Rarity.Epic,
    '楼顶的水塔早就不用了，铁皮上爬满锈。\n从这里看下去，整条街像一条发光的河。',
    '在楼顶找到能看见最远一盏灯的地方。',
    [
      '找一栋可以上楼的旧楼。',
      '越来越安静，风越来越大。',
      '抬起头，看那个圆圆的东西。'
    ],
    0.24, 0.58, 2300
  ),
  catalogPlace(
    'near-flower-cart', '地铁口卖花的三轮车', Area.Near, '三轮车', '🌷', Rarity.Common,
    '三轮车上插着十几桶花，颜色挤在一起有点吵。\n阿姨会喊「最后一束了」，其实还有很多。',
    '挑一朵最不像花的花。',
    [
      '找人多、有台阶的地方。',
      '会闻到很浓的甜味。',
      '往颜色最多的地方走。'
    ],
    0.74, 0.16, 700
  ),
  catalogPlace(
    'near-library-steps', '图书馆门口的台阶', Area.Near, '台阶', '📖', Rarity.Common,
    '台阶很宽，晚上总有人坐在上面看书、打电话、发呆。\n没人会问你为什么坐在这儿。',
    '坐下来，看十分钟别人进进出出。',
    [
      '找一栋门口有大台阶的建筑。',
      '会很安静，只有翻书声。',
      '坐在最上面一级。'
    ],
    0.38, 0.34, 1000
  ),
  catalogPlace(
    'near-laundromat', '24 小时自助洗衣店', Area.Near, '洗衣店', '🧺', Rarity.Hidden,
    '店里只有洗衣机的嗡嗡声，和几把没人坐的塑料椅。\n凌晨两点，这里比任何地方都像一个暂停键。',
    '听一台洗衣机完整转完一个周期。',
    [
      '找一块很亮的玻璃，里面在转。',
      '会听到水声，和滚筒转动的声音。',
      '别带衣服。就看看。'
    ],
    0.86, 0.48, 2600
  )
];

/** 内置 24 个地点（顺序：河岸 → 老城区 → 附近，与 PlaceCatalog.all 一致） */
export const PLACES: Place[] = RIVER_PLACES.concat(OLD_TOWN_PLACES).concat(NEAR_PLACES);

/** 按 id 查内置地点 */
export function placeByID(id: string): Place | undefined {
  for (let i = 0; i < PLACES.length; i += 1) {
    if (PLACES[i].id === id) return PLACES[i];
  }
  return undefined;
}

/** 按区域过滤 */
export function placesInArea(area: Area): Place[] {
  return PLACES.filter((place: Place): boolean => place.area === area);
}

// ============================================================
// 保密工具：线索不得含地点名（含前 2 字）
// ============================================================

/** 判断一段文案是否泄露地点名（含前 2 个字） */
export function leaksPlaceName(text: string, placeName: string): boolean {
  if (placeName.length === 0) return false;
  if (text.indexOf(placeName) >= 0) return true;
  if (placeName.length >= 2 && text.indexOf(placeName.substring(0, 2)) >= 0) return true;
  return false;
}

/** 把泄露的线索清洗成「那里」；用于真实地点（内置地点本就不含） */
export function scrubHints(hints: string[], placeName: string): string[] {
  const result: string[] = [];
  for (let i = 0; i < hints.length; i += 1) {
    let hint: string = hints[i];
    if (placeName.length >= 2) {
      hint = hint.split(placeName).join('那里');
      hint = hint.split(placeName.substring(0, 2)).join('那里');
    } else if (placeName.length === 1) {
      hint = hint.split(placeName).join('那里');
    }
    result.push(hint);
  }
  return result;
}

/** 深拷贝一个地点（快照/返回值用，避免 UI 改内部对象） */
export function clonePlace(place: Place): Place {
  const point: MapPoint = { x: place.mapPoint.x, y: place.mapPoint.y };
  const hints: string[] = place.hints.slice();
  const coordinate: GeoPoint | undefined = place.coordinate === undefined
    ? undefined
    : { latitude: place.coordinate.latitude, longitude: place.coordinate.longitude };
  const copy: Place = {
    id: place.id,
    name: place.name,
    area: place.area,
    category: place.category,
    emoji: place.emoji,
    rarity: place.rarity,
    why: place.why,
    task: place.task,
    hints: hints,
    mapPoint: point,
    radiusMeters: place.radiusMeters,
    source: place.source
  };
  if (coordinate !== undefined) copy.coordinate = coordinate;
  if (place.address !== undefined) copy.address = place.address;
  if (place.photoUrl !== undefined) copy.photoUrl = place.photoUrl;
  if (place.photoCredit !== undefined) copy.photoCredit = place.photoCredit;
  if (place.summary !== undefined) copy.summary = place.summary;
  return copy;
}

/** 保密：到达前把地点名与地址抹掉（其余字段保留，供地图/线索使用） */
/**
 * 到达前的「安全版地点」：把一切可能暴露目的地的字段抹掉。
 *
 * 为什么 why / task 也要抹：它们虽然不含完整地名，但会描述地点特征
 * （例如 why = "花店开在菜场后门，门口永远湿漉漉的"，name = "菜场后门的花店"，
 *  抹掉 name 之后 why 仍然把「花店 + 菜场后门」交代清楚了）。
 * 产品的核心规则是「到了才知道」，所以到达前只保留与地点无关的字段
 * （emoji / category / rarity / mapPoint / 坐标由调用方决定是否保留）。
 *
 * hints 保留但强制再过一遍 scrubHints（线索本来就是为保密设计的，
 * 这里是防止真实地点名恰好出现在模板文案里）。
 */
export function maskPlaceForWalking(place: Place): Place {
  const copy: Place = clonePlace(place);
  copy.name = '';
  copy.address = undefined;
  copy.why = '';
  copy.task = '';
  copy.hints = scrubHints(copy.hints, place.name);
  // 照片也是剧透：到了才给看
  copy.photoUrl = undefined;
  copy.photoCredit = undefined;
  copy.summary = '';
  return copy;
}

// ============================================================
// 真实地点（RealPlace.swift 精简版）
// ============================================================

export enum RealPlaceCategory {
  Cafe = 'cafe',
  Bookstore = 'bookstore',
  Library = 'library',
  Park = 'park',
  Bench = 'bench',
  Bridge = 'bridge',
  Art = 'art',
  River = 'river',
  Convenience = 'convenience',
  Viewpoint = 'viewpoint',
  Garden = 'garden',
  Plaza = 'plaza',
  Market = 'market',
  Temple = 'temple',
  Museum = 'museum',
  Historic = 'historic',
  Venue = 'venue',
}

/**
 * 17 类 POI key → RealPlaceCategory（parity.md §1 的类别表）
 * 未知 key 回退 Plaza。
 */
export function realCategoryFromKey(key: string): RealPlaceCategory {
  switch (key) {
    case 'cafe': return RealPlaceCategory.Cafe;
    case 'bookstore': return RealPlaceCategory.Bookstore;
    case 'library': return RealPlaceCategory.Library;
    case 'park': return RealPlaceCategory.Park;
    case 'bench': return RealPlaceCategory.Bench;
    case 'bridge': return RealPlaceCategory.Bridge;
    case 'art': return RealPlaceCategory.Art;
    case 'river': return RealPlaceCategory.River;
    case 'convenience': return RealPlaceCategory.Convenience;
    case 'viewpoint': return RealPlaceCategory.Viewpoint;
    case 'garden': return RealPlaceCategory.Garden;
    case 'plaza': return RealPlaceCategory.Plaza;
    case 'market': return RealPlaceCategory.Market;
    case 'temple': return RealPlaceCategory.Temple;
    case 'museum': return RealPlaceCategory.Museum;
    case 'historic': return RealPlaceCategory.Historic;
    case 'venue': return RealPlaceCategory.Venue;
    default: return RealPlaceCategory.Plaza;
  }
}

export function realCategoryLabel(category: RealPlaceCategory): string {
  switch (category) {
    case RealPlaceCategory.Cafe: return '咖啡窗口';
    case RealPlaceCategory.Bookstore: return '书店';
    case RealPlaceCategory.Library: return '图书馆';
    case RealPlaceCategory.Park: return '公园';
    case RealPlaceCategory.Bench: return '长椅';
    case RealPlaceCategory.Bridge: return '桥';
    case RealPlaceCategory.Art: return '涂鸦墙';
    case RealPlaceCategory.River: return '河岸';
    case RealPlaceCategory.Convenience: return '便利店';
    case RealPlaceCategory.Viewpoint: return '观景点';
    case RealPlaceCategory.Garden: return '花园';
    case RealPlaceCategory.Plaza: return '广场';
    case RealPlaceCategory.Market: return '市集';
    case RealPlaceCategory.Temple: return '老建筑';
    case RealPlaceCategory.Museum: return '博物馆';
    case RealPlaceCategory.Historic: return '老房子';
    case RealPlaceCategory.Venue: return '剧场';
    default: return '街角';
  }
}

export function realCategoryEmoji(category: RealPlaceCategory): string {
  switch (category) {
    case RealPlaceCategory.Cafe: return '☕️';
    case RealPlaceCategory.Bookstore: return '📚';
    case RealPlaceCategory.Library: return '📖';
    case RealPlaceCategory.Park: return '🌳';
    case RealPlaceCategory.Bench: return '🪑';
    case RealPlaceCategory.Bridge: return '🌉';
    case RealPlaceCategory.Art: return '🎨';
    case RealPlaceCategory.River: return '🌊';
    case RealPlaceCategory.Convenience: return '🥫';
    case RealPlaceCategory.Viewpoint: return '🔭';
    case RealPlaceCategory.Garden: return '🌷';
    case RealPlaceCategory.Plaza: return '⛲️';
    case RealPlaceCategory.Market: return '🧺';
    case RealPlaceCategory.Temple: return '🏛️';
    case RealPlaceCategory.Museum: return '🖼️';
    case RealPlaceCategory.Historic: return '🏚️';
    case RealPlaceCategory.Venue: return '🎭';
    default: return '📍';
  }
}

export function realCategoryRarity(category: RealPlaceCategory): Rarity {
  switch (category) {
    case RealPlaceCategory.Cafe:
    case RealPlaceCategory.Convenience:
    case RealPlaceCategory.Bench:
    case RealPlaceCategory.Plaza:
    case RealPlaceCategory.Park:
      return Rarity.Common;
    case RealPlaceCategory.Bookstore:
    case RealPlaceCategory.Library:
    case RealPlaceCategory.Bridge:
    case RealPlaceCategory.Garden:
    case RealPlaceCategory.Market:
      return Rarity.Rare;
    case RealPlaceCategory.Art:
    case RealPlaceCategory.Viewpoint:
    case RealPlaceCategory.River:
      return Rarity.Epic;
    case RealPlaceCategory.Temple:
      return Rarity.Hidden;
    case RealPlaceCategory.Museum:
    case RealPlaceCategory.Venue:
      return Rarity.Rare;
    case RealPlaceCategory.Historic:
      return Rarity.Epic;
    default:
      return Rarity.Common;
  }
}

/** 真实地点的区域（用于抽象地图分块） */
export function realCategoryArea(category: RealPlaceCategory): Area {
  switch (category) {
    case RealPlaceCategory.River:
    case RealPlaceCategory.Bridge:
      return Area.River;
    case RealPlaceCategory.Bookstore:
    case RealPlaceCategory.Library:
    case RealPlaceCategory.Art:
    case RealPlaceCategory.Temple:
    case RealPlaceCategory.Market:
    case RealPlaceCategory.Museum:
    case RealPlaceCategory.Historic:
      return Area.OldTown;
    default:
      return Area.Near;
  }
}

/** 1 分钟小任务（按类别） */
export function realCategoryTask(category: RealPlaceCategory): string {
  switch (category) {
    case RealPlaceCategory.Cafe: return '点一杯最便宜的，问老板今天的豆子是哪里的。';
    case RealPlaceCategory.Bookstore: return '找一本封面是蓝色的书，翻开第 7 页读三行。';
    case RealPlaceCategory.Library: return '坐下，看十分钟别人进进出出。';
    case RealPlaceCategory.Park: return '找一张能看见最多树的长椅，坐三分钟。';
    case RealPlaceCategory.Bench: return '数一数这张长椅能坐几个人。';
    case RealPlaceCategory.Bridge: return '在桥上站满 60 秒，看一次水流的方向。';
    case RealPlaceCategory.Art: return '拍一张只有一个颜色的照片。';
    case RealPlaceCategory.River: return '数一数河面上有几艘船。';
    case RealPlaceCategory.Convenience: return '买一样不超过 5 块钱的东西。';
    case RealPlaceCategory.Viewpoint: return '找一盏你能看见的最远的灯。';
    case RealPlaceCategory.Garden: return '找一盆你觉得活得最好的植物。';
    case RealPlaceCategory.Plaza: return '观察 30 秒，找出走得最慢的那个人。';
    case RealPlaceCategory.Market: return '挑一样你不认识的东西，问老板是什么。';
    case RealPlaceCategory.Temple: return '找一处你觉得最旧的痕迹。';
    case RealPlaceCategory.Museum: return '挑一件最不起眼的展品，看满一分钟。';
    case RealPlaceCategory.Historic: return '摸一摸这栋房子的墙，猜它多少岁了。';
    case RealPlaceCategory.Venue: return '看一眼今天演什么，再决定要不要进去。';
    default: return '站一会儿，看看这附近。';
  }
}

/** 三阶线索（不含名称） */
export function realCategoryHints(category: RealPlaceCategory): string[] {
  let far: string = '往前再走一点。';
  let mid: string = '放慢脚步，注意周围的变化。';
  switch (category) {
    case RealPlaceCategory.Cafe: far = '风里有一点烘焙的味道。'; mid = '跟着这个味道走，会经过一扇开着的窗。'; break;
    case RealPlaceCategory.Bookstore: far = '前面会安静下来。'; mid = '找一扇窗很大、里面堆着纸的地方。'; break;
    case RealPlaceCategory.Library: far = '往更安静的方向走。'; mid = '会看到很多台阶，很多人坐在上面。'; break;
    case RealPlaceCategory.Park: far = '树会变多，声音会变少。'; mid = '找一片能听见叶子的地方。'; break;
    case RealPlaceCategory.Bench: far = '适合坐下来。往有阴影的地方走。'; mid = '会看到一张面朝开阔处的长椅。'; break;
    case RealPlaceCategory.Bridge: far = '脚下的声音会变。'; mid = '找一段水面在脚下经过的地方。'; break;
    case RealPlaceCategory.Art: far = '颜色会突然变多。'; mid = '找一面不太平整的墙。'; break;
    case RealPlaceCategory.River: far = '空气会变凉，风会变大。'; mid = '往低处走，会听到水声。'; break;
    case RealPlaceCategory.Convenience: far = '往灯最亮的地方走。'; mid = '会听到「欢迎光临」的电子音。'; break;
    case RealPlaceCategory.Viewpoint: far = '往高处走。'; mid = '找一个能看见很远的地方。'; break;
    case RealPlaceCategory.Garden: far = '空气会有一点甜。'; mid = '找一片被人照料过的绿。'; break;
    case RealPlaceCategory.Plaza: far = '人会变多。'; mid = '找一块空着的石头或台阶。'; break;
    case RealPlaceCategory.Market: far = '声音会变杂。'; mid = '找一个人挤人、但没人赶时间的地方。'; break;
    case RealPlaceCategory.Temple: far = '会突然安静，也会突然古老。'; mid = '找一处门框比周围都旧的地方。'; break;
    case RealPlaceCategory.Museum: far = '前面会变得安静，而且有空调的味道。'; mid = '找一扇很大的门，里面挂着画。'; break;
    case RealPlaceCategory.Historic: far = '砖的颜色会变旧。'; mid = '找一栋比周围矮、但比周围老的房子。'; break;
    case RealPlaceCategory.Venue: far = '会开始听到人声和音乐。'; mid = '找一扇亮着灯、贴着海报的门。'; break;
    default: break;
  }
  return [far, mid, '就在前面。抬手机，慢慢看。'];
}

/** 「为什么是这里」——用类别 + 时段 + 心情生成，不含名称 */
export function realCategoryWhy(category: RealPlaceCategory, mood: Mood, hour: number): string {
  let timeWord: string = '夜里';
  if (hour >= 5 && hour < 9) timeWord = '清晨';
  else if (hour >= 9 && hour < 12) timeWord = '上午';
  else if (hour >= 12 && hour < 15) timeWord = '午后';
  else if (hour >= 15 && hour < 18) timeWord = '傍晚前';
  else if (hour >= 18 && hour < 21) timeWord = '入夜';

  let moodWord: string = '你选了「放空」，这里适合什么都不想。';
  if (mood === Mood.Discover) moodWord = '你选了「发现」，这里通常不是本地人以外会注意到的地方。';
  else if (mood === Mood.Lively) moodWord = '你选了「热闹」，这个时间这里不会太冷清。';

  return moodWord + '\n' + timeWord + '的' + realCategoryLabel(category) + '，是城市里比较安静的一类角落。';
}

/** 真实 POI 原始数据（MapKit / Photon / 兜底数据源统一成这个结构） */
export interface POICandidate {
  id: string;
  name: string;
  coordinate: GeoPoint;
  address?: string;
  category: RealPlaceCategory;
  source: string;
}

/**
 * 真实 POI → Place：
 * - name 只在到达后展示；hints/why 里做一次清洗，确保不含名称
 * - mapPoint 用相对起点的极坐标近似（抽象地图示意路线）
 */
export function makeRealPlace(
  poi: POICandidate,
  origin: GeoPoint,
  mood: Mood,
  hour: number,
  startMeters: number
): Place {
  const distanceMeters: number = distanceBetween(origin, poi.coordinate);
  const bearingDegrees: number = bearingBetween(origin, poi.coordinate);
  const radius: number = Math.max(startMeters, 100);
  const normalized: number = Math.min(0.42, distanceMeters / (radius * 2.2));
  const rad: number = bearingDegrees * Math.PI / 180;
  const point: MapPoint = {
    x: 0.5 + Math.sin(rad) * normalized,
    y: 0.82 - Math.cos(rad) * normalized
  };
  const hints: string[] = scrubHints(realCategoryHints(poi.category), poi.name);
  const why: string = realCategoryWhy(poi.category, mood, hour);
  const coordinate: GeoPoint = { latitude: poi.coordinate.latitude, longitude: poi.coordinate.longitude };
  const place: Place = {
    id: 'real-' + poi.id,
    name: poi.name,
    area: realCategoryArea(poi.category),
    category: realCategoryLabel(poi.category),
    emoji: realCategoryEmoji(poi.category),
    rarity: realCategoryRarity(poi.category),
    why: why,
    task: realCategoryTask(poi.category),
    hints: hints,
    mapPoint: point,
    radiusMeters: Math.max(800, startMeters + 400),
    coordinate: coordinate,
    source: poi.source
  };
  if (poi.address !== undefined) place.address = poi.address;
  return place;
}
