import Foundation

/// iPhone → Apple Watch 同步用的「一次旅程摘要」。
///
/// 只同步抬腕一眼需要的最小信息；整体 Codable，放进 WCSession 的
/// `applicationContext[WatchSessionSummary.applicationContextKey]` 里（Data(JSON)）。
///
/// 保密约定：`placeName` / `rarity` / `areaLabel` 只在
/// `phase == arrived / revealed / collected` 时才下发；走路途中为 nil——
/// 手表不该比用户更早知道目的地（design-system §5.3）。
///
/// 放在 Shared/Core 里的原因：iOS 发送端（v0.2）与 watchOS 接收端共用同一 Schema，
/// 避免两端各写一份字段对不上。
public struct WatchSessionSummary: Codable, Equatable, Sendable {

    public static let applicationContextKey = "blindwalk.watch.session.v1"

    // MARK: 旅程
    public var phase: String
    public var placeID: String
    /// 类别 emoji（走路途中可以下发，不泄露地名）
    public var placeEmoji: String
    /// 地点名：到达后才下发
    public var placeName: String?
    /// Rarity.rawValue：到达后才下发
    public var rarity: String?
    /// Area.label：到达后才下发
    public var areaLabel: String?
    public var totalMeters: Int
    public var remainingMeters: Int
    public var unlockedHintCount: Int
    /// 三条线索；未解锁的由手表按数量显示「…」
    public var hints: [String]
    public var startedAt: Date

    // MARK: 我的
    public var streakDays: Int
    public var boxesOpened: Int
    public var todayEmoji: String
    public var todayCardName: String

    // MARK: 元信息
    public var generatedAt: Date

    public init(
        phase: String,
        placeID: String,
        placeEmoji: String,
        placeName: String? = nil,
        rarity: String? = nil,
        areaLabel: String? = nil,
        totalMeters: Int,
        remainingMeters: Int,
        unlockedHintCount: Int,
        hints: [String],
        startedAt: Date,
        streakDays: Int,
        boxesOpened: Int,
        todayEmoji: String,
        todayCardName: String,
        generatedAt: Date = Date()
    ) {
        self.phase = phase
        self.placeID = placeID
        self.placeEmoji = placeEmoji
        self.placeName = placeName
        self.rarity = rarity
        self.areaLabel = areaLabel
        self.totalMeters = totalMeters
        self.remainingMeters = remainingMeters
        self.unlockedHintCount = unlockedHintCount
        self.hints = hints
        self.startedAt = startedAt
        self.streakDays = streakDays
        self.boxesOpened = boxesOpened
        self.todayEmoji = todayEmoji
        self.todayCardName = todayCardName
        self.generatedAt = generatedAt
    }

    // MARK: 派生

    /// 进度环 0…1
    public var progress: Double {
        guard totalMeters > 0 else { return 0 }
        return max(0, min(1, 1 - Double(remainingMeters) / Double(totalMeters)))
    }

    public var isArrived: Bool {
        phase == "arrived" || phase == "revealed" || phase == "collected"
    }

    /// 缺省按常见处理
    public var rarityValue: Rarity {
        Rarity(rawValue: rarity ?? "") ?? .common
    }

    // MARK: 编解码

    /// 变成 `updateApplicationContext(_:)` 可用的字典
    public func applicationContext() -> [String: Any] {
        guard let data = try? JSONEncoder().encode(self) else { return [:] }
        return [Self.applicationContextKey: data]
    }

    public init?(applicationContext: [String: Any]) {
        guard let data = applicationContext[Self.applicationContextKey] as? Data,
              let decoded = try? JSONDecoder().decode(WatchSessionSummary.self, from: data)
        else { return nil }
        self = decoded
    }

    // MARK: 构造

    /// 从 store 状态构造摘要（iOS 发送端与手表演示共用）。
    /// 未到达时自动隐藏地点名 / 稀有度 / 区域。
    public static func make(
        session: QuestSession,
        place: Place?,
        profile: Profile,
        todayCard: PlaceCard? = nil,
        now: Date = Date()
    ) -> WatchSessionSummary {
        let arrived = session.phase == .arrived || session.phase == .revealed || session.phase == .collected
        let resolvedToday = todayCard ?? profile.cards.max { $0.collectedAt < $1.collectedAt }
        let todayPlace = resolvedToday.flatMap { PlaceCatalog.place(id: $0.placeID) }
        return WatchSessionSummary(
            phase: session.phase.rawValue,
            placeID: session.placeID,
            placeEmoji: place?.emoji ?? "📦",
            placeName: arrived ? place?.name : nil,
            rarity: arrived ? place?.rarity.rawValue : nil,
            areaLabel: arrived ? place?.area.label : nil,
            totalMeters: session.totalMeters,
            remainingMeters: session.remainingMeters,
            unlockedHintCount: session.unlockedHintCount,
            hints: place?.hints ?? [],
            startedAt: session.startedAt,
            streakDays: profile.streakDays,
            boxesOpened: profile.boxesOpened,
            todayEmoji: todayPlace?.emoji ?? "📦",
            todayCardName: todayPlace?.name ?? "还没收录卡片",
            generatedAt: now
        )
    }

    /// 无 iPhone 连接时的本地演示兜底：直接取 Shared/Core 的 DemoData。
    public static func demo(now: Date = Date()) -> WatchSessionSummary {
        let session = DemoData.demoWatchSession(now: now)
        let place = PlaceCatalog.place(id: session.placeID)
        return make(
            session: session,
            place: place,
            profile: DemoData.demoProfile(now: now),
            now: now
        )
    }
}
