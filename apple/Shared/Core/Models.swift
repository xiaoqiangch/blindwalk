import Foundation

// MARK: - 基础枚举

/// 稀有度。常见 / 稀有 / 史诗 / 隐藏
public enum Rarity: String, Codable, CaseIterable, Identifiable, Sendable {
    case common, rare, epic, hidden

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .common: return "常见"
        case .rare: return "稀有"
        case .epic: return "史诗"
        case .hidden: return "隐藏"
        }
    }

    /// 收录卡片时额外获得的惊喜值
    public var xpBonus: Int {
        switch self {
        case .common: return 0
        case .rare: return 10
        case .epic: return 20
        case .hidden: return 40
        }
    }

    /// 抽盒权重（隐藏款只在 60 分钟档开放，见 BlindBoxEngine）
    public var weight: Int {
        switch self {
        case .common: return 70
        case .rare: return 22
        case .epic: return 6
        case .hidden: return 2
        }
    }

    /// 允许出现在哪些时长里
    public func isAvailable(in duration: WalkDuration) -> Bool {
        guard self == .hidden else { return true }
        return duration == .m60
    }
}

/// 心情
public enum Mood: String, Codable, CaseIterable, Identifiable, Sendable {
    case drift, discover, lively

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .drift: return "放空"
        case .discover: return "发现"
        case .lively: return "热闹"
        }
    }

    public var emoji: String {
        switch self {
        case .drift: return "🌫️"
        case .discover: return "🔍"
        case .lively: return "🥁"
        }
    }

    public var subtitle: String {
        switch self {
        case .drift: return "不想讲话，只想走走"
        case .discover: return "我想看点没见过的"
        case .lively: return "去哪儿都行，人多一点"
        }
    }

    /// 界面里用的 SF Symbol。emoji 在小字号下字重不一，🌫️ 还会渲染成一团灰雾，
    /// 所以心情这一层用线图标，emoji 只留给地点卡片（那是内容本身）。
    public var symbol: String {
        switch self {
        case .drift: return "wind"
        case .discover: return "binoculars"
        case .lively: return "flame"
        }
    }
}

/// 时长
public enum WalkDuration: Int, Codable, CaseIterable, Identifiable, Sendable {
    case m15 = 15, m30 = 30, m60 = 60

    public var id: Int { rawValue }

    public var title: String {
        switch self {
        case .m15: return "15 分钟 · 一小圈"
        case .m30: return "30 分钟 · 刚好"
        case .m60: return "60 分钟 · 走远点"
        }
    }

    public var shortTitle: String { "\(rawValue) 分钟" }

    /// 演示起始距离（米）
    public var startMeters: Int {
        switch self {
        case .m15: return 300
        case .m30: return 480
        case .m60: return 900
        }
    }

    /// 抽盒半径（米）
    public var radiusMeters: Int {
        switch self {
        case .m15: return 900
        case .m30: return 1600
        case .m60: return 3000
        }
    }
}

/// 区域
public enum Area: String, Codable, CaseIterable, Identifiable, Sendable {
    case near, river, oldtown

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .near: return "附近"
        case .river: return "河边"
        case .oldtown: return "老城区"
        }
    }
}

/// 抽象地图上的归一化坐标（0…1），两端按各自画布尺寸映射
public struct MapPoint: Codable, Hashable, Sendable {
    public var x: Double
    public var y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

// MARK: - 地点

public struct Place: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let area: Area
    public let category: String
    public let emoji: String
    public let rarity: Rarity
    /// 「为什么是这里」两行文案
    public let why: String
    /// 1 分钟小任务
    public let task: String
    /// 三阶线索，永不包含地名
    public let hints: [String]
    public let mapPoint: MapPoint
    public let radiusMeters: Int
    /// 真实经纬度（真实地理模式；内置虚构地点为 nil）
    public var coordinate: GeoPoint?
    /// 真实地址（到达后展示）
    public var address: String?
    /// 数据来源标记：catalog = 内置虚构 / osm = 真实 OSM / apple = MapKit
    public var source: String

    public init(
        id: String,
        name: String,
        area: Area,
        category: String,
        emoji: String,
        rarity: Rarity,
        why: String,
        task: String,
        hints: [String],
        mapPoint: MapPoint,
        radiusMeters: Int,
        coordinate: GeoPoint? = nil,
        address: String? = nil,
        source: String = "catalog"
    ) {
        self.id = id
        self.name = name
        self.area = area
        self.category = category
        self.emoji = emoji
        self.rarity = rarity
        self.why = why
        self.task = task
        self.hints = hints
        self.mapPoint = mapPoint
        self.radiusMeters = radiusMeters
        self.coordinate = coordinate
        self.address = address
        self.source = source
    }
}

// MARK: - 卡片 / 会话

public struct PlaceCard: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let placeID: String
    public let serial: String
    public let collectedAt: Date
    public var taskDone: Bool

    public init(id: String = UUID().uuidString, placeID: String, serial: String, collectedAt: Date = Date(), taskDone: Bool = false) {
        self.id = id
        self.placeID = placeID
        self.serial = serial
        self.collectedAt = collectedAt
        self.taskDone = taskDone
    }
}

public enum QuestPhase: String, Codable, Sendable {
    case idle, walking, arrived, revealed, collected
}

public struct QuestSession: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let placeID: String
    public let startedAt: Date
    public let totalMeters: Int
    public var remainingMeters: Int
    public var phase: QuestPhase
    /// 已解锁线索数量 0…3
    public var unlockedHintCount: Int
    /// 真实目的地坐标（真实定位模式下有值；纯演示为 nil）
    public var target: GeoPoint?
    /// 最近一次定位算出的方位角（度，0=正北）；演示模式为 nil
    public var currentBearing: Double?

    public init(
        id: String = UUID().uuidString,
        placeID: String,
        startedAt: Date = Date(),
        totalMeters: Int,
        remainingMeters: Int,
        phase: QuestPhase = .walking,
        unlockedHintCount: Int = 0,
        target: GeoPoint? = nil,
        currentBearing: Double? = nil
    ) {
        self.id = id
        self.placeID = placeID
        self.startedAt = startedAt
        self.totalMeters = totalMeters
        self.remainingMeters = remainingMeters
        self.phase = phase
        self.unlockedHintCount = unlockedHintCount
        self.target = target
        self.currentBearing = currentBearing
    }

    public static let arriveThreshold = 30
    public static let hintThresholds = [400, 200, 60]

    /// 是否应解锁下一条线索
    public var nextHintThreshold: Int? {
        guard unlockedHintCount < Self.hintThresholds.count else { return nil }
        return Self.hintThresholds[unlockedHintCount]
    }

    public var progress: Double {
        guard totalMeters > 0 else { return 0 }
        return max(0, min(1, 1 - Double(remainingMeters) / Double(totalMeters)))
    }
}

// MARK: - 成就

public struct Achievement: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let icon: String
    public let detail: String
    public let target: Int
    public var progress: Int
    public var unlockedAt: Date?

    public init(id: String, name: String, icon: String, detail: String, target: Int, progress: Int = 0, unlockedAt: Date? = nil) {
        self.id = id
        self.name = name
        self.icon = icon
        self.detail = detail
        self.target = target
        self.progress = progress
        self.unlockedAt = unlockedAt
    }

    public var isUnlocked: Bool { unlockedAt != nil }
    public var fraction: Double {
        guard target > 0 else { return 1 }
        return min(1, Double(progress) / Double(target))
    }
}

// MARK: - 社交

public struct FeedPost: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public var authorName: String
    public var authorEmoji: String
    public var placeName: String
    public var categoryEmoji: String
    public var rarity: Rarity
    public var caption: String
    public var createdAt: Date
    public var reactions: [String: Int]
    public var isMine: Bool

    public init(
        id: String = UUID().uuidString,
        authorName: String,
        authorEmoji: String,
        placeName: String,
        categoryEmoji: String,
        rarity: Rarity,
        caption: String,
        createdAt: Date = Date(),
        reactions: [String: Int] = ["羡慕": 0, "一起": 0, "下次带我": 0],
        isMine: Bool = false
    ) {
        self.id = id
        self.authorName = authorName
        self.authorEmoji = authorEmoji
        self.placeName = placeName
        self.categoryEmoji = categoryEmoji
        self.rarity = rarity
        self.caption = caption
        self.createdAt = createdAt
        self.reactions = reactions
        self.isMine = isMine
    }
}

public struct LeaderboardEntry: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let emoji: String
    public let score: Int
    public let isMe: Bool

    public init(id: String, name: String, emoji: String, score: Int, isMe: Bool = false) {
        self.id = id
        self.name = name
        self.emoji = emoji
        self.score = score
        self.isMe = isMe
    }
}

// MARK: - 用户档案

public struct Profile: Codable, Sendable {
    public var xp: Int
    public var streakDays: Int
    public var totalKm: Double
    public var boxesOpened: Int
    public var cards: [PlaceCard]
    public var achievements: [Achievement]
    public var posts: [FeedPost]
    public var lastWalkAt: Date?
    public var walkArrivalTimes: [Date]
    public var togetherCount: Int
    public var displayName: String
    /// 埋下的惊喜总数（作者视角）
    public var surprisesBuried: Int
    /// 自己埋下的惊喜被找到次数
    public var surprisesFound: Int
    /// 自己找到别人的惊喜次数
    public var surprisesSeeked: Int

    public init(
        xp: Int = 0,
        streakDays: Int = 0,
        totalKm: Double = 0,
        boxesOpened: Int = 0,
        cards: [PlaceCard] = [],
        achievements: [Achievement] = [],
        posts: [FeedPost] = [],
        lastWalkAt: Date? = nil,
        walkArrivalTimes: [Date] = [],
        togetherCount: Int = 0,
        displayName: String = "阿澈",
        surprisesBuried: Int = 0,
        surprisesFound: Int = 0,
        surprisesSeeked: Int = 0
    ) {
        self.xp = xp
        self.streakDays = streakDays
        self.totalKm = totalKm
        self.boxesOpened = boxesOpened
        self.cards = cards
        self.achievements = achievements
        self.posts = posts
        self.lastWalkAt = lastWalkAt
        self.walkArrivalTimes = walkArrivalTimes
        self.togetherCount = togetherCount
        self.displayName = displayName
        self.surprisesBuried = surprisesBuried
        self.surprisesFound = surprisesFound
        self.surprisesSeeked = surprisesSeeked
    }

    public var level: Int { max(1, xp / 800 + 1) }
    public var levelFloorXP: Int { (level - 1) * 800 }
    public var levelProgress: Double {
        let into = xp - levelFloorXP
        return min(1, Double(into) / 800)
    }

    public var levelName: String { Self.levelNames[min(level - 1, Self.levelNames.count - 1)] }

    public static let levelNames = [
        "出门新手", "街角观察员", "城市漫游者", "惊喜收藏家", "迷雾探险家",
        "黄昏猎人", "夜路诗人", "散步大师", "城市传说", "盲盒之神"
    ]

    /// 已收集地点 ID 集合
    public var collectedPlaceIDs: Set<String> { Set(cards.map(\.placeID)) }

    /// 收藏进度（按全库 24 个地点）
    public var collectionProgress: Double {
        guard !PlaceCatalog.all.isEmpty else { return 0 }
        return Double(collectedPlaceIDs.count) / Double(PlaceCatalog.all.count)
    }

    public var rareCount: Int {
        cards.filter { card in
            guard let place = PlaceCatalog.place(id: card.placeID) else { return false }
            return place.rarity != .common
        }.count
    }

    public var hiddenCount: Int {
        cards.filter { PlaceCatalog.place(id: $0.placeID)?.rarity == .hidden }.count
    }

    /// 本周惊喜值（简化：按最近 7 天到达次数 × 20 + 稀有 + 任务）
    public var weeklySurprise: Int {
        // 按「自然日」比较而不是「7×24 小时」：今天 06:33 打开时，
        // 若用小时差，7 天前的 19:12 那次会被算进窗口（8 次），数值就会从 305 漂到 325。
        // 用日粒度后，窗口恒为最近 7 个自然日（含今天）。
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        var countedDays = Set<Date>()
        for arrival in walkArrivalTimes where countedDays.count < 7 {
            let day = calendar.startOfDay(for: arrival)
            let gap = calendar.dateComponents([.day], from: day, to: today).day ?? 99
            guard gap >= 0 && gap < 7 else { continue }
            countedDays.insert(day)
        }
        return countedDays.count * 20 + rareCount * 15 + cards.filter(\.taskDone).count * 5
    }
}
