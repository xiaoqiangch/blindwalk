import Foundation
import Observation

/// 揭晓数据：地点 + 本次惊喜值 + 新解锁成就
public struct Reveal: Hashable {
    public let place: Place
    public let xpGained: Int
    public var newAchievements: [Achievement]

    public init(place: Place, xpGained: Int, newAchievements: [Achievement] = []) {
        self.place = place
        self.xpGained = xpGained
        self.newAchievements = newAchievements
    }
}

public struct CollectResult {
    public let card: PlaceCard
    public let xpGained: Int
    public let newAchievements: [Achievement]

    public init(card: PlaceCard, xpGained: Int, newAchievements: [Achievement]) {
        self.card = card
        self.xpGained = xpGained
        self.newAchievements = newAchievements
    }
}

/// 全局应用状态（iOS / watchOS 共用）。
@Observable
@MainActor
public final class WalkaholicStore {

    // MARK: 可变状态

    public var profile: Profile
    public var session: QuestSession?
    public var currentPlace: Place?
    public var reveal: Reveal?
    public var selectedMood: Mood = .drift
    public var selectedDuration: WalkDuration = .m30
    public var selectedArea: Area?
    public var feed: [FeedPost]
    public var togetherCode: String

    /// 最近一次推进产生的事件（UI 用来播动画）
    public private(set) var lastEvents: [QuestEvent] = []

    /// 最近一次真实定位点。抽盒时若 `startQuest(origin:)` 未显式传，就用它当起点。
    /// 由 `LiveLocationService` 在每次定位回调写入。
    public var lastKnownOrigin: GeoPoint? = nil {
        didSet { rebaseSeedSurprisesIfNeeded() }
    }

    /// 演示惊喜是否还锚在默认坐标（人民广场）——只重定位一次
    private var seedSurprisesRebased = false

    /// 从账号恢复：整包覆盖本机 Profile / 惊喜，并落盘。
    /// 只是把「账号里的事实」换到本机，不动正在进行的旅程。
    public func applyRemote(profile remoteProfile: Profile, surprises remoteSurprises: [BuriedSurprise]?) {
        profile = remoteProfile
        if let remoteSurprises {
            surprises = remoteSurprises
            surprisePersistence.saveSurprises(remoteSurprises)
        }
        persistence.saveProfile(remoteProfile)
        lastEvents = []
    }

    /// 埋下的惊喜（作者与寻者的双向社区）
    public var surprises: [BuriedSurprise]

    /// 最近一次寻惊喜的结果（UI 用来放结算动画）
    public var lastFind: SurpriseFindResult?

    private let persistence: ProfilePersisting
    /// 埋惊喜单独持久化（杀 App 不能丢）
    private let surprisePersistence: SurprisePersisting

    // MARK: 初始化

    public init(
        profile: Profile = Profile(),
        feed: [FeedPost]? = nil,
        togetherCode: String = SocialFeed.makeTogetherCode(),
        persistence: ProfilePersisting = UserDefaultsProfileStore(),
        surprisePersistence: SurprisePersisting = UserDefaultsSurpriseStore(),
        surprises: [BuriedSurprise] = []
    ) {
        self.profile = profile
        self.feed = feed ?? (SocialFeed.mockPosts() + profile.posts.filter(\.isMine))
        self.togetherCode = togetherCode
        self.persistence = persistence
        self.surprisePersistence = surprisePersistence
        // 优先用已持久化的惊喜（杀 App 后仍在），否则用传入的种子数据
        let stored = surprisePersistence.loadSurprises()
        self.surprises = stored.isEmpty ? surprises : stored
        self.session = nil
        self.currentPlace = nil
        self.reveal = nil
        self.lastFind = nil
        if stored.isEmpty && !surprises.isEmpty {
            surprisePersistence.saveSurprises(surprises)
        }
    }

    /// 演示模式：预置 18 张卡、连续 12 天、正在走第 3 个盲盒
    public static func demo() -> WalkaholicStore {
        let store = WalkaholicStore(
            profile: DemoData.demoProfile(),
            surprises: DemoData.demoSurprises()
        )
        let session = DemoData.demoSession()
        store.session = session
        store.currentPlace = PlaceCatalog.place(id: session.placeID)
        return store
    }

    // MARK: 抽盒

    /// 从设置页开始一次新旅程（目的地保密）。
    /// - Parameter origin: 真实定位起点。给了就生成**真实目的地坐标**（真实 GPS 模式）；
    ///   不给则进入纯演示模式（用「模拟步行 +50m」推进）。
    @discardableResult
    public func startQuest(
        seed: UInt64 = UInt64(Date().timeIntervalSince1970),
        now: Date = Date(),
        origin: GeoPoint? = nil
    ) -> Place? {
        let recent = Set(profile.cards
            .filter { now.timeIntervalSince($0.collectedAt) < 7 * 86_400 }
            .map(\.placeID))
        let engine = BlindBoxEngine(recentPlaceIDs: recent)
        guard let draw = engine.draw(mood: selectedMood, duration: selectedDuration, area: selectedArea, seed: seed, now: now) else {
            return nil
        }
        var target: GeoPoint?
        var bearing: Double?
        if let resolvedOrigin = origin ?? lastKnownOrigin {
            // 有真实定位 → 生成真实目的地坐标
            // 方向由 seed 决定：同一 seed 同一方向，便于测试与复现
            var generator = SeededGenerator(seed: seed &+ 0xA5A5)
            let degrees = Double(Int.random(in: 0..<360, using: &generator))
            bearing = degrees
            target = GeoMath.offset(from: resolvedOrigin, meters: Double(draw.startMeters), bearingDegrees: degrees)
        }

        let session = QuestSession(
            placeID: draw.place.id,
            startedAt: now,
            totalMeters: draw.startMeters,
            remainingMeters: draw.startMeters,
            phase: .walking,
            unlockedHintCount: 1,
            target: target,
            currentBearing: bearing
        )
        self.session = session
        self.currentPlace = draw.place
        self.reveal = nil
        self.lastEvents = []
        return draw.place
    }

    // MARK: 旅程推进

    /// 模拟步行：减少剩余米数，返回事件（线索解锁 / 到达）
    @discardableResult
    public func advance(byMeters meters: Int, now: Date = Date()) -> [QuestEvent] {
        guard var session, session.phase == .walking else { return [] }
        let events = session.update(remainingMeters: session.remainingMeters - abs(meters))
        self.session = session
        self.lastEvents = events
        if events.contains(.arrived) {
            prepareReveal(now: now)
        }
        return events
    }

    /// 真实定位推进：根据「到目的地的距离 + 方位角」更新会话。
    /// 由 `LiveLocationService` 在每次定位回调里调用。
    @discardableResult
    public func updateLocation(distanceMeters: Double, bearingDegrees: Double?, now: Date = Date()) -> [QuestEvent] {
        guard var session, session.phase == .walking else { return [] }
        let events = session.updateGeo(distanceMeters: distanceMeters, bearingDegrees: bearingDegrees)
        self.session = session
        self.lastEvents = events
        if events.contains(.arrived) {
            prepareReveal(now: now)
        }
        return events
    }

    /// 「我到了」：直接触发揭晓
    @discardableResult
    public func arriveNow(now: Date = Date()) -> [QuestEvent] {
        guard var session, session.phase == .walking else { return [] }
        let events = session.forceArrive()
        self.session = session
        self.lastEvents = events
        if events.contains(.arrived) {
            prepareReveal(now: now)
        }
        return events
    }

    /// 播放完开盒动画后调用，进入卡片展示
    public func beginReveal() {
        guard var session else { return }
        session.confirmReveal()
        self.session = session
    }

    private func prepareReveal(now: Date) {
        guard let place = currentPlace else { return }
        reveal = Reveal(place: place, xpGained: 40 + place.rarity.xpBonus)
    }

    // MARK: 埋惊喜 / 寻惊喜（双向奖励）

    /// 在当前位置埋下一个惊喜。
    /// - Parameters:
    ///   - message: 作者写的一句话（为什么埋在这里）
    ///   - photoName: 本地照片文件名
    ///   - location: 埋下的真实坐标
    ///   - areaLabel: 展示用区域名
    ///   - hint: 可选的一句提示（不能泄露照片内容）
    @discardableResult
    public func burySurprise(
        message: String,
        photoName: String,
        location: GeoPoint,
        areaLabel: String,
        hint: String? = nil,
        now: Date = Date()
    ) -> BuriedSurprise {
        let surprise = BuriedSurprise(
            authorName: profile.displayName,
            authorEmoji: "🫥",
            photoName: photoName,
            message: message,
            location: location,
            areaLabel: areaLabel,
            clues: BuriedSurprise.makeClues(from: message, hint: hint),
            createdAt: now
        )
        surprises.insert(surprise, at: 0)
        profile.surprisesBuried += 1
        // 埋下一个送 30 点（鼓励给予）
        profile.xp += 30
        _ = AchievementEngine.sync(profile: &profile, now: now)
        persistence.saveProfile(profile)
        surprisePersistence.saveSurprises(surprises)
        return surprise
    }

    /// 真机上用户几乎不会正好在上海人民广场：
    /// 一旦拿到真实定位，就把「还没被人动过」的演示惊喜整体平移到用户附近，
    /// 保证「320 米外有一个惊喜」在杭州/成都也同样成立。
    private func rebaseSeedSurprisesIfNeeded() {
        guard !seedSurprisesRebased, let origin = lastKnownOrigin else { return }
        let seeds = surprises.filter { $0.isWaiting && !$0.isMine }
        // 只在「全部演示条目仍锚在默认点」时重定位，避免覆盖用户真实埋下的
        guard !seeds.isEmpty else { seedSurprisesRebased = true; return }
        let anchor = GeoPoint(latitude: 31.2304, longitude: 121.4737)
        let allAtAnchor = seeds.allSatisfy { GeoMath.distance(from: anchor, to: $0.location) < 5000 }
        seedSurprisesRebased = true
        guard allAtAnchor else { return }

        let offsets: [(Double, Double)] = [(320, 24), (540, 118), (760, 300)]
        var index = 0
        for i in surprises.indices where surprises[i].isWaiting && !surprises[i].isMine {
            let (meters, bearing) = offsets[index % offsets.count]
            surprises[i].location = GeoMath.offset(from: origin, meters: meters, bearingDegrees: bearing)
            index += 1
        }
        surprisePersistence.saveSurprises(surprises)
    }

    /// 我能探索的惊喜（附近、未被找到、不是自己埋的）
    public func explorableSurprises(near point: GeoPoint?, within meters: Double = 5000) -> [BuriedSurprise] {
        guard let point else {
            return surprises.filter { $0.isWaiting && !$0.isMine }
        }
        return surprises
            .filter { $0.isWaiting && !$0.isMine && GeoMath.distance(from: point, to: $0.location) <= meters }
            .sorted { GeoMath.distance(from: point, to: $0.location) < GeoMath.distance(from: point, to: $1.location) }
    }

    /// 结算一次「找到并复刻」。
    /// - Parameters:
    ///   - surpriseID: 目标惊喜
    ///   - finderPhotoName: 寻者拍摄的照片
    ///   - matchScore: 复刻度（由 PhotoMatcher 计算，0…1）
    @discardableResult
    public func completeSurpriseFind(
        surpriseID: String,
        finderPhotoName: String,
        matchScore: Double,
        now: Date = Date()
    ) -> SurpriseFindResult? {
        guard let index = surprises.firstIndex(where: { $0.id == surpriseID }) else { return nil }
        guard surprises[index].isWaiting else { return nil }

        let passed = matchScore >= PhotoMatcher.passThreshold
        surprises[index].status = passed ? .found : .waiting
        surprises[index].finderName = passed ? profile.displayName : nil
        surprises[index].foundAt = passed ? now : nil
        surprises[index].finderPhotoName = passed ? finderPhotoName : nil
        surprises[index].matchScore = matchScore

        let result: SurpriseFindResult
        if passed {
            let seeker = surprises[index].seekerPoints
            let author = surprises[index].authorPoints
            profile.xp += seeker
            profile.surprisesSeeked += 1
            // 作者这边（本地优先时作者也在同一份数据里）
            if surprises[index].isMine { profile.surprisesFound += 1 }
            let newAchievements = AchievementEngine.sync(profile: &profile, now: now)
            result = SurpriseFindResult(
                seekerPoints: seeker,
                authorPoints: author,
                matchScore: matchScore,
                verdict: PhotoMatcher.verdict(for: matchScore),
                newAchievements: newAchievements
            )
        } else {
            // 没达到阈值：给一点辛苦分，但不算找到，惊喜继续等别人
            profile.xp += 10
            result = SurpriseFindResult(
                seekerPoints: 10,
                authorPoints: 0,
                matchScore: matchScore,
                verdict: PhotoMatcher.verdict(for: matchScore),
                newAchievements: []
            )
        }

        lastFind = result
        persistence.saveProfile(profile)
        surprisePersistence.saveSurprises(surprises)
        return result
    }

    /// 我的埋惊喜统计（作者视角）
    public var mySurprises: [BuriedSurprise] { surprises.filter(\.isMine) }

    public var mySurprisesFoundCount: Int {
        surprises.filter { $0.isMine && $0.status == .found }.count
    }

    // MARK: 收录 / 分享

    /// 收进图鉴：写卡片、加 XP、更新连续天数、判定成就
    @discardableResult
    public func collect(now: Date = Date()) -> CollectResult? {
        guard var session, let place = currentPlace,
              session.phase == .arrived || session.phase == .revealed
        else { return nil }

        let xp = 40 + place.rarity.xpBonus
        let card = PlaceCard(
            placeID: place.id,
            serial: BlindBoxEngine.serial(seed: UInt64(now.timeIntervalSince1970)),
            collectedAt: now
        )

        profile.cards.append(card)
        profile.boxesOpened += 1
        profile.totalKm += Double(session.totalMeters) / 1000
        profile.xp += xp
        profile.walkArrivalTimes.append(now)
        if profile.walkArrivalTimes.count > 100 {
            profile.walkArrivalTimes.removeFirst(profile.walkArrivalTimes.count - 100)
        }
        updateStreak(now: now)

        let newAchievements = AchievementEngine.sync(profile: &profile, now: now)
        session.markCollected()
        self.session = session
        self.reveal?.newAchievements = newAchievements
        persistence.saveProfile(profile)
        return CollectResult(card: card, xpGained: xp, newAchievements: newAchievements)
    }

    /// 发布动态到圈子
    @discardableResult
    public func share(caption: String, now: Date = Date()) -> FeedPost? {
        guard let place = reveal?.place ?? currentPlace else { return nil }
        let post = FeedPost(
            authorName: profile.displayName,
            authorEmoji: "🫥",
            placeName: place.name,
            categoryEmoji: place.emoji,
            rarity: place.rarity,
            caption: caption,
            createdAt: now,
            reactions: ["羡慕": 0, "一起": 0, "下次带我": 0],
            isMine: true
        )
        profile.posts.insert(post, at: 0)
        feed.insert(post, at: 0)
        _ = AchievementEngine.sync(profile: &profile, now: now)
        persistence.saveProfile(profile)
        return post
    }

    /// 给动态点一个反应
    public func react(to postID: String, reaction: String) {
        guard let index = feed.firstIndex(where: { $0.id == postID }) else { return }
        feed[index].reactions[reaction, default: 0] += 1
    }

    // MARK: 工具

    public var journeyPlace: Place? { currentPlace }

    public var weeklySurprise: Int { profile.weeklySurprise }

    public var hasActiveQuest: Bool {
        guard let session else { return false }
        return session.phase == .walking || session.phase == .arrived
    }

    public func card(for placeID: String) -> PlaceCard? {
        profile.cards.first { $0.placeID == placeID }
    }

    public func reset(now: Date = Date()) {
        profile = Profile()
        session = nil
        currentPlace = nil
        reveal = nil
        lastEvents = []
        feed = SocialFeed.mockPosts(now: now)
        surprises = []
        lastFind = nil
        persistence.clear()
        surprisePersistence.saveSurprises([])
    }

    /// 连续天数：昨天走 → +1；今天走过 → 不变；断开 → 重置为 1
    private func updateStreak(now: Date, calendar: Calendar = .current) {
        guard let last = profile.lastWalkAt else {
            profile.streakDays = 1
            profile.lastWalkAt = now
            return
        }
        let lastDay = calendar.startOfDay(for: last)
        let today = calendar.startOfDay(for: now)
        let gap = calendar.dateComponents([.day], from: lastDay, to: today).day ?? 0
        if gap == 0 {
            // 同一天，不变
        } else if gap == 1 {
            profile.streakDays += 1
        } else {
            profile.streakDays = 1
        }
        profile.lastWalkAt = now
    }
}

// MARK: - 便利扩展

public extension PlaceCard {
    var serialDisplay: String { "No.\(serial)" }
}

public extension Profile {
    func place(for card: PlaceCard) -> Place? {
        PlaceCatalog.place(id: card.placeID)
    }
}
