import Foundation

/// 真实地点数据源：把「附近真实存在的 POI」变成盲盒候选。
///
/// 设计约束（见 docs/real-geo.md）：
/// - 只取公共类别白名单（咖啡、书店、公园、长椅、桥、涂鸦墙、便利店…），
///   排除餐厅包间、住宅、公司等私人或不可达地点。
/// - 生成的线索**绝不含名称**（到达前不能剧透），由类别 + 方位 + 时段推导。
/// - 全部为纯函数 + 协议，方便 iOS（MapKit）与 Web（Photon）共用同一套映射规则。
public enum RealPlaceCategory: String, CaseIterable, Sendable {
    case cafe          // 咖啡
    case bookstore     // 书店
    case library       // 图书馆
    case park          // 公园
    case bench         // 长椅
    case bridge        // 桥
    case art           // 涂鸦/公共艺术
    case river         // 河岸/码头
    case convenience   // 便利店
    case viewpoint     // 观景点
    case garden        // 花园
    case plaza         // 广场
    case market        // 市集
    case temple        // 庙宇/教堂

    public var label: String {
        switch self {
        case .cafe: return "咖啡窗口"
        case .bookstore: return "书店"
        case .library: return "图书馆"
        case .park: return "公园"
        case .bench: return "长椅"
        case .bridge: return "桥"
        case .art: return "涂鸦墙"
        case .river: return "河岸"
        case .convenience: return "便利店"
        case .viewpoint: return "观景点"
        case .garden: return "花园"
        case .plaza: return "广场"
        case .market: return "市集"
        case .temple: return "老建筑"
        }
    }

    public var emoji: String {
        switch self {
        case .cafe: return "☕️"
        case .bookstore: return "📚"
        case .library: return "📖"
        case .park: return "🌳"
        case .bench: return "🪑"
        case .bridge: return "🌉"
        case .art: return "🎨"
        case .river: return "🌊"
        case .convenience: return "🥫"
        case .viewpoint: return "🔭"
        case .garden: return "🌷"
        case .plaza: return "⛲️"
        case .market: return "🧺"
        case .temple: return "🏛️"
        }
    }

    public var rarity: Rarity {
        switch self {
        case .cafe, .convenience, .bench, .plaza, .park:
            return .common
        case .bookstore, .library, .bridge, .garden, .market:
            return .rare
        case .art, .viewpoint, .river:
            return .epic
        case .temple:
            return .hidden
        }
    }

    /// 心情偏好：放空爱长椅/公园/河岸；发现爱书店/涂鸦/观景；热闹爱市集/广场/便利店
    public var moods: Set<Mood> {
        switch self {
        case .bench, .park, .river, .library, .garden:
            return [.drift]
        case .bookstore, .art, .viewpoint, .temple, .bridge:
            return [.discover]
        case .market, .plaza, .convenience, .cafe:
            return [.lively]
        }
    }

    /// 1 分钟小任务（按类别）
    public var task: String {
        switch self {
        case .cafe: return "点一杯最便宜的，问老板今天的豆子是哪里的。"
        case .bookstore: return "找一本封面是蓝色的书，翻开第 7 页读三行。"
        case .library: return "坐下，看十分钟别人进进出出。"
        case .park: return "找一张能看见最多树的长椅，坐三分钟。"
        case .bench: return "数一数这张长椅能坐几个人。"
        case .bridge: return "在桥上站满 60 秒，看一次水流的方向。"
        case .art: return "拍一张只有一个颜色的照片。"
        case .river: return "数一数河面上有几艘船。"
        case .convenience: return "买一样不超过 5 块钱的东西。"
        case .viewpoint: return "找一盏你能看见的最远的灯。"
        case .garden: return "找一盆你觉得活得最好的植物。"
        case .plaza: return "观察 30 秒，找出走得最慢的那个人。"
        case .market: return "挑一样你不认识的东西，问老板是什么。"
        case .temple: return "找一处你觉得最旧的痕迹。"
        }
    }

    /// 三阶线索（**不含名称**）
    public func hints(distanceMeters: Int) -> [String] {
        let far: String
        let mid: String
        switch self {
        case .cafe: far = "风里有一点烘焙的味道。"; mid = "跟着这个味道走，会经过一扇开着的窗。"
        case .bookstore: far = "前面会安静下来。"; mid = "找一扇窗很大、里面堆着纸的地方。"
        case .library: far = "往更安静的方向走。"; mid = "会看到很多台阶，很多人坐在上面。"
        case .park: far = "树会变多，声音会变少。"; mid = "找一片能听见叶子的地方。"
        case .bench: far = "适合坐下来。往有阴影的地方走。"; mid = "会看到一张面朝开阔处的长椅。"
        case .bridge: far = "脚下的声音会变。"; mid = "找一段水面在脚下经过的地方。"
        case .art: far = "颜色会突然变多。"; mid = "找一面不太平整的墙。"
        case .river: far = "空气会变凉，风会变大。"; mid = "往低处走，会听到水声。"
        case .convenience: far = "往灯最亮的地方走。"; mid = "会听到「欢迎光临」的电子音。"
        case .viewpoint: far = "往高处走。"; mid = "找一个能看见很远的地方。"
        case .garden: far = "空气会有一点甜。"; mid = "找一片被人照料过的绿。"
        case .plaza: far = "人会变多。"; mid = "找一块空着的石头或台阶。"
        case .market: far = "声音会变杂。"; mid = "找一个人挤人、但没人赶时间的地方。"
        case .temple: far = "会突然安静，也会突然古老。"; mid = "找一处门框比周围都旧的地方。"
        }
        return [far, mid, "就在前面。抬手机，慢慢看。"]
    }

    /// 「为什么是这里」——用类别 + 时段生成，不含名称
    public func why(mood: Mood, hour: Int) -> String {
        let timeWord: String
        switch hour {
        case 5..<9: timeWord = "清晨"
        case 9..<12: timeWord = "上午"
        case 12..<15: timeWord = "午后"
        case 15..<18: timeWord = "傍晚前"
        case 18..<21: timeWord = "入夜"
        default: timeWord = "夜里"
        }
        let moodWord: String
        switch mood {
        case .drift: moodWord = "你选了「放空」，这里适合什么都不想。"
        case .discover: moodWord = "你选了「发现」，这里通常不是本地人以外会注意到的地方。"
        case .lively: moodWord = "你选了「热闹」，这个时间这里不会太冷清。"
        }
        return "\(moodWord)\n\(timeWord)的\(label)，是城市里比较安静的一类角落。"
    }
}

/// 真实 POI 的原始数据（各数据源统一成这个结构）
public struct POICandidate: Hashable, Sendable {
    public let id: String
    public let name: String
    public let coordinate: GeoPoint
    public let address: String?
    public let category: RealPlaceCategory
    public let source: String

    public init(id: String, name: String, coordinate: GeoPoint, address: String?, category: RealPlaceCategory, source: String) {
        self.id = id
        self.name = name
        self.coordinate = coordinate
        self.address = address
        self.category = category
        self.source = source
    }
}

/// 把真实 POI 转成盲盒里的 `Place`：
/// - 名称只在到达后展示（`Place.name` 本身不参与线索生成）
/// - `mapPoint` 用相对起点的归一化近似值（给抽象地图用）
public enum RealPlaceFactory {

    public static func makePlace(
        from poi: POICandidate,
        origin: GeoPoint,
        mood: Mood,
        hour: Int,
        startMeters: Int
    ) -> Place {
        let distance = GeoMath.distance(from: origin, to: poi.coordinate)
        // 抽象地图上的位置：按真实方位与距离做极坐标投影（只用于画示意路线）
        let bearing = GeoMath.bearing(from: origin, to: poi.coordinate)
        let radius = Double(max(startMeters, 100))
        let normalized = min(0.42, distance / (radius * 2.2))
        let rad = bearing * .pi / 180
        let mapPoint = MapPoint(
            x: 0.5 + sin(rad) * normalized,
            y: 0.82 - cos(rad) * normalized
        )

        return Place(
            id: "real-\(poi.id)",
            name: poi.name,
            area: area(for: poi.category),
            category: poi.category.label,
            emoji: poi.category.emoji,
            rarity: poi.category.rarity,
            why: poi.category.why(mood: mood, hour: hour),
            task: poi.category.task,
            hints: poi.category.hints(distanceMeters: Int(distance)),
            mapPoint: mapPoint,
            radiusMeters: max(800, startMeters + 400),
            coordinate: poi.coordinate,
            address: poi.address,
            source: poi.source
        )
    }

    private static func area(for category: RealPlaceCategory) -> Area {
        switch category {
        case .river, .bridge: return .river
        case .bookstore, .library, .art, .temple, .market: return .oldtown
        default: return .near
        }
    }

    /// 线索里绝不能出现地点名（防止剧透）。生成后做一次断言式清洗。
    public static func scrub(_ place: Place) -> Place {
        let name = place.name
        guard !name.isEmpty else { return place }
        let cleaned = place.hints.map { hint in
            hint.replacingOccurrences(of: name, with: "那里")
        }
        guard cleaned != place.hints else { return place }
        return Place(
            id: place.id, name: place.name, area: place.area, category: place.category,
            emoji: place.emoji, rarity: place.rarity, why: place.why, task: place.task,
            hints: cleaned, mapPoint: place.mapPoint, radiusMeters: place.radiusMeters,
            coordinate: place.coordinate, address: place.address, source: place.source
        )
    }

    /// 从候选里按心情 + 距离加权挑一个（尽量在时长半径内）
    public static func pick(
        from candidates: [POICandidate],
        origin: GeoPoint,
        mood: Mood,
        startMeters: Int,
        seed: UInt64
    ) -> POICandidate? {
        guard !candidates.isEmpty else { return nil }
        var generator = SeededGenerator(seed: seed)
        let pool = candidates.filter { poi in
            let d = GeoMath.distance(from: origin, to: poi.coordinate)
            return d >= 80 && d <= Double(startMeters) * 1.6
        }
        let finalPool = pool.isEmpty ? candidates : pool
        // 心情匹配加权
        let weighted: [(POICandidate, Int)] = finalPool.map { poi in
            var weight = 10
            if poi.category.moods.contains(mood) { weight += 25 }
            weight += poi.category.rarity.weight / 10
            return (poi, weight)
        }
        let total = weighted.reduce(0) { $0 + $1.1 }
        guard total > 0 else { return finalPool.first }
        let ticket = Int.random(in: 0..<total, using: &generator)
        var running = 0
        for (poi, weight) in weighted {
            running += weight
            if ticket < running { return poi }
        }
        return weighted.last?.0
    }
}

/// 真实 POI 提供者（iOS 用 MapKit 实现，Web 用 Photon 实现）
public protocol NearbyPlaceProviding: Sendable {
    func nearbyPlaces(
        around origin: GeoPoint,
        radiusMeters: Int,
        moods: Set<Mood>
    ) async throws -> [POICandidate]
}
