import Foundation

/// 内置地点库（虚构演示数据，非真实 POI）。
/// 设计原则：全部是公共场所；文案只描述氛围，不暴露地名。
public enum PlaceCatalog {

    public static let all: [Place] = riverPlaces + oldTownPlaces + nearPlaces

    public static func place(id: String) -> Place? {
        all.first { $0.id == id }
    }

    public static func places(in area: Area) -> [Place] {
        all.filter { $0.area == area }
    }

    // MARK: 河岸

    private static let riverPlaces: [Place] = [
        Place(
            id: "river-bench-07",
            name: "河边的第七张长椅",
            area: .river,
            category: "长椅",
            emoji: "🪑",
            rarity: .common,
            why: "你选了「放空」。工作日的这个时间，这张长椅通常只有三个人路过。\n它面朝水面，背对马路——很适合什么都不想。",
            task: "数一数河面上有几艘船，记下数字。",
            hints: [
                "风里有水汽，往那个方向走会越来越凉。",
                "你会先经过一段没有路灯的栏杆。别怕，一直走。",
                "就在前面。灯很暗，慢慢看。"
            ],
            mapPoint: MapPoint(x: 0.30, y: 0.28),
            radiusMeters: 1100
        ),
        Place(
            id: "river-steps",
            name: "旧码头边的石阶",
            area: .river,
            category: "石阶",
            emoji: "🪜",
            rarity: .rare,
            why: "码头拆掉很多年了，石阶还在。水位高的时候，最下面两级会消失。\n今天水位不高，你可以坐在第三级。",
            task: "把手伸进水里，数到十再拿出来。",
            hints: [
                "往低处走。你会听到水拍石头的声音。",
                "有一段铁链护栏，摸上去是温的。",
                "台阶有点滑。慢一点。"
            ],
            mapPoint: MapPoint(x: 0.18, y: 0.40),
            radiusMeters: 1500
        ),
        Place(
            id: "river-graffiti",
            name: "桥洞下的小块涂鸦墙",
            area: .river,
            category: "涂鸦墙",
            emoji: "🎨",
            rarity: .epic,
            why: "桥洞把城市的噪音挡在外面，这里安静得不像话。\n墙上每隔几个月就会多一层新的颜色，今天这一层是橘色的。",
            task: "拍一张只有一个颜色的照片。",
            hints: [
                "找一个回声很大的地方。",
                "声音会从头顶传过来。",
                "往颜色最乱的那面墙走。"
            ],
            mapPoint: MapPoint(x: 0.42, y: 0.22),
            radiusMeters: 2200
        ),
        Place(
            id: "river-lighthouse",
            name: "河堤尽头的白色小灯塔",
            area: .river,
            category: "灯塔",
            emoji: "🗼",
            rarity: .hidden,
            why: "它其实只是个航标，但晚上亮起来的时候，像有人替你留了一盏灯。\n到这儿的人不多，风很大，记得拉上外套拉链。",
            task: "对着水面站满 60 秒，什么都不做。",
            hints: [
                "一直往水边走，走到没有路为止。",
                "你会看到一点白色，在很远的尽头。",
                "风会变大。就是那里。"
            ],
            mapPoint: MapPoint(x: 0.10, y: 0.16),
            radiusMeters: 2800
        ),
        Place(
            id: "river-boardwalk",
            name: "水杉林里的木栈道",
            area: .river,
            category: "栈道",
            emoji: "🌲",
            rarity: .common,
            why: "水杉长得很高，风穿过树顶的声音像有人在翻书。\n栈道有一块木板会响，你可以找找是哪一块。",
            task: "找出那块会响的木板，记住它的位置。",
            hints: [
                "找一片树比楼高的地方。",
                "脚下会从硬的变成软的。",
                "听。有块木板在等你。"
            ],
            mapPoint: MapPoint(x: 0.36, y: 0.46),
            radiusMeters: 1300
        ),
        Place(
            id: "river-kites",
            name: "防汛墙上的一排风筝",
            area: .river,
            category: "风筝",
            emoji: "🪁",
            rarity: .rare,
            why: "每天傍晚都有人在这儿放风筝，线轴插在墙缝里。\n风筝飞得不高，但一直在。",
            task: "找到飞得最低的那只风筝。",
            hints: [
                "抬头。这一路都值得抬头。",
                "你会看到几根细线，从墙上起飞。",
                "往线最密的地方走。"
            ],
            mapPoint: MapPoint(x: 0.55, y: 0.18),
            radiusMeters: 1600
        ),
        Place(
            id: "river-bookstore",
            name: "旧仓库改的书店",
            area: .river,
            category: "书店",
            emoji: "📚",
            rarity: .rare,
            why: "仓库的钢架还留着，书却已经堆到屋顶。\n靠窗那排书桌不许外借，但可以坐一整晚。",
            task: "找一本封面是蓝色的书，翻开第 7 页读三行。",
            hints: [
                "找一栋很高的旧房子，窗户很大。",
                "会闻到纸和木头混在一起的味道。",
                "门口没有招牌。推门就对了。"
            ],
            mapPoint: MapPoint(x: 0.62, y: 0.34),
            radiusMeters: 1700
        ),
        Place(
            id: "river-carwash",
            name: "夜间亮灯的洗车房旁",
            area: .river,
            category: "洗车房",
            emoji: "🚿",
            rarity: .common,
            why: "这家洗车房晚上十点还开着，白灯把水花照得很亮。\n蹲在马路牙子上看一会儿，会觉得城市运转得挺可爱。",
            task: "数一数十分钟内开进来几辆车。",
            hints: [
                "找一片特别亮的地面，湿的。",
                "会有水声，和吸尘器的声音。",
                "别站太近，会溅到。"
            ],
            mapPoint: MapPoint(x: 0.48, y: 0.56),
            radiusMeters: 1200
        )
    ]

    // MARK: 老城区

    private static let oldTownPlaces: [Place] = [
        Place(
            id: "old-watch-repair",
            name: "弄堂口修表摊",
            area: .oldtown,
            category: "修表摊",
            emoji: "⌚️",
            rarity: .rare,
            why: "老师傅在这儿坐了三十年。桌上那盏台灯比很多东西都老。\n他不太说话，但会给你看表壳背面的划痕。",
            task: "看一眼摊上的玻璃柜，找到最旧的那块表。",
            hints: [
                "往楼挨得最近的地方走。",
                "会有一盏很亮的台灯，在弄堂口。",
                "别急着说话，先看。"
            ],
            mapPoint: MapPoint(x: 0.72, y: 0.62),
            radiusMeters: 1400
        ),
        Place(
            id: "old-balcony",
            name: "老房子二楼的公共阳台",
            area: .oldtown,
            category: "阳台",
            emoji: "🪴",
            rarity: .epic,
            why: "这栋楼的二楼有个不对外的公共阳台，晾衣绳横在头顶。\n从下往上看，能看到五户人家的生活边角。",
            task: "找一盆你觉得活得最好的植物。",
            hints: [
                "抬头找晾衣绳。",
                "有一栋楼的窗户都是绿的。",
                "楼梯在侧面，很窄。"
            ],
            mapPoint: MapPoint(x: 0.82, y: 0.30),
            radiusMeters: 2100
        ),
        Place(
            id: "old-flower-shop",
            name: "菜场后门的花店",
            area: .oldtown,
            category: "花店",
            emoji: "💐",
            rarity: .common,
            why: "花店开在菜场后门，门口永远湿漉漉的。\n老板会把卖剩的花扎成一把，五块钱。",
            task: "买一把十块钱以内的花，或者闻三种花再走。",
            hints: [
                "找人多、声音杂的地方。",
                "会先闻到鱼腥味，然后是花香。",
                "往水最多的地方走。"
            ],
            mapPoint: MapPoint(x: 0.68, y: 0.44),
            radiusMeters: 1000
        ),
        Place(
            id: "old-chess",
            name: "梧桐树下那张褪色棋盘",
            area: .oldtown,
            category: "棋盘",
            emoji: "♟️",
            rarity: .common,
            why: "棋盘是直接画在水泥地上的，白漆快掉光了。\n下午总有人在这儿下棋，围观的人比下棋的多。",
            task: "看一局棋，猜猜谁会赢（不用等结果）。",
            hints: [
                "找树荫最大的地方。",
                "会有很多人站成一圈。",
                "低下头，地上有格子。"
            ],
            mapPoint: MapPoint(x: 0.76, y: 0.50),
            radiusMeters: 1200
        ),
        Place(
            id: "old-postbox",
            name: "旧邮局门口的绿色邮筒",
            area: .oldtown,
            category: "邮筒",
            emoji: "📮",
            rarity: .rare,
            why: "邮局搬走了，邮筒留了下来，投信口被焊死了。\n但它还是绿色的，还是站在原来的位置。",
            task: "把手掌贴在邮筒上，感受一下它的温度。",
            hints: [
                "找一栋门口有台阶的旧楼。",
                "会看到一点绿，很旧的那种绿。",
                "它在等一封寄不出去的信。"
            ],
            mapPoint: MapPoint(x: 0.60, y: 0.70),
            radiusMeters: 1500
        ),
        Place(
            id: "old-records",
            name: "藏在理发店后面的唱片架",
            area: .oldtown,
            category: "唱片店",
            emoji: "💿",
            rarity: .epic,
            why: "理发店的镜子后面有一道门，推开门是两排黑胶。\n老板只放他喜欢的歌，你可以在那儿站很久。",
            task: "记住现在放的这首歌的节奏，走出去哼两句。",
            hints: [
                "找一家有旋转灯柱的理发店。",
                "门在镜子后面，别不好意思推。",
                "会听到黑胶的沙沙声。"
            ],
            mapPoint: MapPoint(x: 0.88, y: 0.74),
            radiusMeters: 1900
        ),
        Place(
            id: "old-tailor-eave",
            name: "雨天的裁缝铺屋檐",
            area: .oldtown,
            category: "裁缝铺",
            emoji: "🧵",
            rarity: .common,
            why: "屋檐很宽，下雨天可以站四五个人躲雨。\n缝纫机的声音从里面传出来，哒、哒、哒。",
            task: "听三十秒缝纫机的声音，数一数它响了几下。",
            hints: [
                "找一条窄的、有屋檐的街。",
                "会有针脚一样的节拍。",
                "站到雨淋不到的地方。"
            ],
            mapPoint: MapPoint(x: 0.66, y: 0.82),
            radiusMeters: 1300
        ),
        Place(
            id: "old-wonton",
            name: "小馄饨摊的第三张塑料凳",
            area: .oldtown,
            category: "馄饨摊",
            emoji: "🥟",
            rarity: .rare,
            why: "三张塑料凳，第三张腿有点短，会轻轻晃。\n老板记得每个熟客要不要香菜。",
            task: "要一碗小馄饨，坐第三张凳子吃完。",
            hints: [
                "闻。有热汤的味道。",
                "找三张一样颜色的塑料凳。",
                "第三张凳子会晃。就是它。"
            ],
            mapPoint: MapPoint(x: 0.56, y: 0.38),
            radiusMeters: 1400
        )
    ]

    // MARK: 附近

    private static let nearPlaces: [Place] = [
        Place(
            id: "near-store-hotdrink",
            name: "楼下便利店的热饮柜前",
            area: .near,
            category: "便利店",
            emoji: "🥫",
            rarity: .common,
            why: "热饮柜的灯是暖的，站在前面会莫名其妙地想买点什么。\n今晚第二层第二排的豆浆还剩两瓶。",
            task: "买一样不超过 5 块钱的热的东西。",
            hints: [
                "往灯最亮的地方走。",
                "会听到「欢迎光临」的电子音。",
                "站在有热气的地方。"
            ],
            mapPoint: MapPoint(x: 0.44, y: 0.72),
            radiusMeters: 500
        ),
        Place(
            id: "near-swing",
            name: "小公园里会响的秋千",
            area: .near,
            category: "秋千",
            emoji: "🛝",
            rarity: .common,
            why: "第二个秋千的链条会响，吱呀、吱呀。\n大人坐上去有点丢人，但晚上没人看见。",
            task: "荡十下，什么都不想。",
            hints: [
                "找有滑梯的地方。",
                "会听到金属摩擦的声音。",
                "第二个。"
            ],
            mapPoint: MapPoint(x: 0.34, y: 0.66),
            radiusMeters: 800
        ),
        Place(
            id: "near-basketball",
            name: "社区篮球场的边线",
            area: .near,
            category: "篮球场",
            emoji: "🏀",
            rarity: .common,
            why: "这个点的球场只剩下投篮声，球在水泥地上弹得很响。\n边线上有几道粉笔画，是上周画的。",
            task: "站在边线上，看他们投进三个球再走。",
            hints: [
                "跟着拍球的声音走。",
                "会有高高的铁网。",
                "站在白线外面看就好。"
            ],
            mapPoint: MapPoint(x: 0.58, y: 0.58),
            radiusMeters: 900
        ),
        Place(
            id: "near-coffee-window",
            name: "那家只开半扇门的咖啡窗口",
            area: .near,
            category: "咖啡窗口",
            emoji: "☕️",
            rarity: .rare,
            why: "窗口只开半扇，点单要稍微踮脚。\n老板会多给你一小杯气泡水，不要钱。",
            task: "点一杯最便宜的，问老板今天豆子是哪里的。",
            hints: [
                "找一面墙上开了一个洞的店。",
                "会闻到烘焙的味道。",
                "半扇门。踮脚。"
            ],
            mapPoint: MapPoint(x: 0.50, y: 0.44),
            radiusMeters: 1100
        ),
        Place(
            id: "near-water-tower",
            name: "天台上的旧水塔",
            area: .near,
            category: "水塔",
            emoji: "🛢️",
            rarity: .epic,
            why: "楼顶的水塔早就不用了，铁皮上爬满锈。\n从这里看下去，整条街像一条发光的河。",
            task: "在楼顶找到能看见最远一盏灯的地方。",
            hints: [
                "找一栋可以上楼的旧楼。",
                "越来越安静，风越来越大。",
                "抬起头，看那个圆圆的东西。"
            ],
            mapPoint: MapPoint(x: 0.24, y: 0.58),
            radiusMeters: 2300
        ),
        Place(
            id: "near-flower-cart",
            name: "地铁口卖花的三轮车",
            area: .near,
            category: "三轮车",
            emoji: "🌷",
            rarity: .common,
            why: "三轮车上插着十几桶花，颜色挤在一起有点吵。\n阿姨会喊「最后一束了」，其实还有很多。",
            task: "挑一朵最不像花的花。",
            hints: [
                "找人多、有台阶的地方。",
                "会闻到很浓的甜味。",
                "往颜色最多的地方走。"
            ],
            mapPoint: MapPoint(x: 0.74, y: 0.16),
            radiusMeters: 700
        ),
        Place(
            id: "near-library-steps",
            name: "图书馆门口的台阶",
            area: .near,
            category: "台阶",
            emoji: "📖",
            rarity: .common,
            why: "台阶很宽，晚上总有人坐在上面看书、打电话、发呆。\n没人会问你为什么坐在这儿。",
            task: "坐下来，看十分钟别人进进出出。",
            hints: [
                "找一栋门口有大台阶的建筑。",
                "会很安静，只有翻书声。",
                "坐在最上面一级。"
            ],
            mapPoint: MapPoint(x: 0.38, y: 0.34),
            radiusMeters: 1000
        ),
        Place(
            id: "near-laundromat",
            name: "24 小时自助洗衣店",
            area: .near,
            category: "洗衣店",
            emoji: "🧺",
            rarity: .hidden,
            why: "店里只有洗衣机的嗡嗡声，和几把没人坐的塑料椅。\n凌晨两点，这里比任何地方都像一个暂停键。",
            task: "听一台洗衣机完整转完一个周期。",
            hints: [
                "找一块很亮的玻璃，里面在转。",
                "会听到水声，和滚筒转动的声音。",
                "别带衣服。就看看。"
            ],
            mapPoint: MapPoint(x: 0.86, y: 0.48),
            radiusMeters: 2600
        )
    ]
}
