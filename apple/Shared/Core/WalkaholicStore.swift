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
    /// 抽盒范围：走路去 / 远程漫游（先开车到附近 1 公里内停车）。
    /// 落盘：用户选了漫游，下次打开抽盒页不该又变回步行。
    public var selectedScope: ExploreScope = .walk {
        didSet {
            guard selectedScope != oldValue else { return }
            UserDefaults.standard.set(selectedScope.rawValue, forKey: Self.scopeKey)
        }
    }

    private static let scopeKey = "wa.scope.v1"
    public var feed: [FeedPost]
    public var togetherCode: String

    /// 最近一次推进产生的事件（UI 用来播动画）
    public private(set) var lastEvents: [QuestEvent] = []

    /// 最近一次真实定位点。抽盒时若 `startQuest(origin:)` 未显式传，就用它当起点。
    /// 由 `LiveLocationService` / OneShotLocationService 在每次定位回调写入。
    ///
    /// **落盘**：以前只在内存里，冷启动必为 nil，导致「刚拿过定位、重启后又说没位置」。
    /// 现在写进 UserDefaults，下次启动先拿它当起点（真实取到新点会覆盖）。
    public var lastKnownOrigin: GeoPoint? = nil {
        didSet {
            Self.persistOrigin(lastKnownOrigin)
            rebaseSeedSurprisesIfNeeded()
        }
    }

    private static let originKey = "wa.lastOrigin.v1"

    private static func persistOrigin(_ point: GeoPoint?) {
        let defaults = UserDefaults.standard
        guard let point else {
            defaults.removeObject(forKey: originKey)
            return
        }
        defaults.set([point.latitude, point.longitude], forKey: originKey)
    }

    private static func loadOrigin() -> GeoPoint? {
        guard let pair = UserDefaults.standard.array(forKey: originKey) as? [Double],
              pair.count == 2,
              abs(pair[0]) <= 90, abs(pair[1]) <= 180 else { return nil }
        return GeoPoint(latitude: pair[0], longitude: pair[1])
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

    /// 服务端回来的「附近惊喜」合并进本机：
    /// - 远端条目替换掉上一次的远端条目（保留本机自己埋的、和已经被找到的）
    /// - 已经找到的远端惊喜不会因为服务端还在 waiting 而复活
    public func mergeRemoteSurprises(_ remote: [BuriedSurprise], near point: GeoPoint?, now: Date = Date()) {
        // 先把上一次的远端条目全部摘掉
        surprises.removeAll { $0.isRemote }
        // 本机已经找到过 / 已埋下的 id 不再重复加
        let known = Set(surprises.map(\.id))
        let fresh = remote.filter { !known.contains($0.id) }
        guard !fresh.isEmpty else {
            surprisePersistence.saveSurprises(surprises)
            return
        }
        surprises.append(contentsOf: fresh)
        surprisePersistence.saveSurprises(surprises)
    }

    /// 服务端回来的「被找到」回执：更新本机记录 + 维护入口红点。
    /// 返回是否出现了新的未读回执。
    @discardableResult
    public func applyReceipts(_ remote: [SurpriseReceipt], now: Date = Date()) -> Bool {
        guard !remote.isEmpty else { return false }
        // 本机的惊喜同步成「已被找到」：作者在自己的列表里能看到寻者与时间
        var changed = false
        for receipt in remote {
            guard let index = surprises.firstIndex(where: { $0.id == receipt.id }) else { continue }
            if surprises[index].status != .found
                || surprises[index].finderName != receipt.finderName {
                surprises[index].status = .found
                surprises[index].finderName = receipt.finderName
                surprises[index].foundAt = receipt.foundAt
                changed = true
            }
        }
        if changed { surprisePersistence.saveSurprises(surprises) }

        let result = SurpriseReceiptStore.shared.merge(remote)
        receipts = result.list
        return result.hasNew
    }

    /// 用户看过了「我的惊喜」：红点熄灭
    public func markReceiptsRead(now: Date = Date()) {
        SurpriseReceiptStore.shared.markAllRead(now: now)
        receipts = receipts.map { receipt in
            var copy = receipt
            if copy.readAt == nil { copy.readAt = now }
            return copy
        }
    }

    public private(set) var receipts: [SurpriseReceipt] = []

    /// 未读回执数（首页入口红点 / 数字用）
    public var unreadReceiptCount: Int {
        receipts.filter(\.isUnread).count
    }

    /// 最近一条未读回执（卡片上写「被谁找到了」）
    public var latestUnreadReceipt: SurpriseReceipt? {
        receipts.first(where: \.isUnread)
    }

    /// 标记本机某条惊喜已上传到账号服务
    public func markSurpriseUploaded(_ surpriseID: String) {        guard let index = surprises.firstIndex(where: { $0.id == surpriseID }) else { return }
        surprises[index].isUploaded = true
        surprisePersistence.saveSurprises(surprises)
    }

    /// 待上传（本机刚埋、还没成功传到服务端的）
    public var pendingUploadSurprises: [BuriedSurprise] {
        surprises.filter { $0.isMine && $0.isWaiting && !$0.isUploaded && !$0.isRemote }
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
        // 圈子只显示本机真实发布过的动态；没有后端就没有别人的动态，不编造。
        self.feed = feed ?? profile.posts.filter(\.isMine)
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
        // 上次的定位点直接复用：冷启动不该「忘掉自己刚在哪」
        self.lastKnownOrigin = Self.loadOrigin()
        self.receipts = SurpriseReceiptStore.shared.load()
        self.selectedScope = ExploreScope(
            rawValue: UserDefaults.standard.string(forKey: Self.scopeKey) ?? ""
        ) ?? .walk
        if stored.isEmpty && !surprises.isEmpty {
            surprisePersistence.saveSurprises(surprises)
        }
    }

    /// 演示模式：只在**截图 / 走查**里用。
    ///
    /// 两个硬约束：
    /// 1. 存档必须是内存的 —— 否则演示数据会写进真实 UserDefaults，覆盖用户自己的进度（曾经真的丢过数据）；
    /// 2. 演示行情的数字（连续天数、累计里程）可以有，但**地点必须是真实地点**：
    ///    收录记录只取当前真实目录里的点，内置虚构地点（PlaceCatalog）不再出现。
    public static func demo() -> WalkaholicStore {
        let memory = InMemoryProfileStore()
        // 只拿「附近的」真实地点做演示：目录里混着别的城市（上海/南京），
        // 全量塞进去会在截图上显示一堆走不到的地点，看起来就像假数据。
        let origin = Self.loadOrigin()
        let allReal = PlaceDirectory.shared.all
        let realPlaces: [Place]
        if let origin {
            realPlaces = allReal.filter { place in
                guard let coordinate = place.coordinate else { return false }
                return GeoMath.distance(from: origin, to: coordinate) <= 3_000
            }
        } else {
            realPlaces = Array(allReal.prefix(6))
        }
        let store = WalkaholicStore(
            profile: DemoData.demoProfile(places: realPlaces),
            persistence: memory,
            surprisePersistence: memory,
            surprises: []
        )
        if let first = realPlaces.first {
            let session = DemoData.demoSession(place: first)
            store.session = session
            store.currentPlace = first
        }
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
        // 已经收录过的地点不再出现：抽盒只从「没去过」的里面选。
        let visited = Set(profile.cards.map(\.placeID))
        // 候选池 = 真实地点目录（后台策展 + 运行时抓到的）。
        // 空目录时直接返回 nil，由调用方给「明确失败面板」，绝不用虚构地点填充。
        let engine = BlindBoxEngine(recentPlaceIDs: visited)
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

    /// 把到达时拍的照片挂到卡片上。
    /// 「先拍照再收进图鉴」和「先收进图鉴再补拍」都会走这里。
    public func attachCardPhoto(placeID: String, photoName: String?, remotePath: String?) {
        guard let index = profile.cards.firstIndex(where: { $0.placeID == placeID }) else { return }
        if let photoName { profile.cards[index].photoName = photoName }
        if let remotePath { profile.cards[index].photoRemotePath = remotePath }
        persistence.saveProfile(profile)
    }

    /// 这张卡到达时拍的照片（本地文件名 / 远端路径）
    public func cardPhoto(for placeID: String) -> (local: String?, remote: String?)? {
        guard let card = profile.cards.first(where: { $0.placeID == placeID }) else { return nil }
        guard card.photoName != nil || card.photoRemotePath != nil else { return nil }
        return (card.photoName, card.photoRemotePath)
    }

    /// 只建一趟「空会话」：目的地由调用方随后覆盖（见 BoxSetupSheet.adopt）。
    ///
    /// 为什么需要它：`startQuest(origin:)` 会先从目录里抽一个地点，
    /// 而抽盒页拿到的是**真实 POI 服务**给的地点，根本不需要目录。
    /// 之前复用 `startQuest(origin:)`，导致「附近的地点都去过了」时抽盒必然失败 ——
    /// 表现为无论换什么心情都弹「没有找到真实地点」（实际已经找到了）。
    @discardableResult
    public func beginQuest(origin: GeoPoint, startMeters: Int, now: Date = Date()) -> Bool {
        let total = max(startMeters, QuestSession.arriveThreshold + 1)
        session = QuestSession(
            placeID: "",
            startedAt: now,
            totalMeters: total,
            remainingMeters: total,
            phase: .walking,
            unlockedHintCount: 1,
            target: origin,
            currentBearing: nil,
            // 抽盒页随后会把剩余距离覆盖成真实 POI 距离；
            // scope 必须在这里就定下来，否则漫游旅程会被里程推断成普通散步。
            scope: selectedScope
        )
        currentPlace = nil
        reveal = nil
        lastEvents = []
        return true
    }

    // MARK: 探秘（从「未解锁」的地点直接出发）

    /// 点击未解锁地点 → 建立一趟以它为目的地的旅程。
    ///
    /// 只接受**有真实坐标**的地点。早期版本会给虚构地点用 `mapPoint` 反推一个方向，
    /// 那等于把用户往一个不存在的地方带 —— 现在直接返回 false，由调用方给出解释。
    @discardableResult
    public func startQuest(to place: Place, origin: GeoPoint, now: Date = Date()) -> Bool {
        guard let coordinate = place.coordinate else { return false }
        let distance = max(Double(QuestSession.arriveThreshold + 60),
                           GeoMath.distance(from: origin, to: coordinate))
        let bearing = GeoMath.bearing(from: origin, to: coordinate)

        let target = GeoMath.offset(from: origin, meters: distance, bearingDegrees: bearing)
        let total = max(Int(distance.rounded()), QuestSession.arriveThreshold + 1)
        session = QuestSession(
            placeID: place.id,
            startedAt: now,
            totalMeters: total,
            remainingMeters: total,
            phase: .walking,
            unlockedHintCount: 1,
            target: target,
            currentBearing: bearing,
            // 从图鉴点「去这里」：离得远就按漫游处理（先开车再走）
            scope: ExploreScope.isRoamJourney(totalMeters: total) ? .roam : .walk
        )
        currentPlace = place
        reveal = nil
        lastEvents = []
        return true
    }

    /// 记下这次真正去过的真实地点（图鉴、手表、历史卡都靠它）
    public func rememberPlace(_ place: Place) {
        PlaceDirectory.shared.remember(place)
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
        ).with(isMineFlag: true)
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

        // 收录时把这个真实地点记进目录并落盘。
        // 不记的话，运行时抓到的真实 POI 只活在这一趟旅程的内存里，
        // 下次打开图鉴就查不到这个 id，那张卡会静默消失（用户真实遇到过）。
        PlaceDirectory.shared.remember(place)

        // 同一个地方只收一次：重复收录会让「图鉴已收集」数字虚高，
        // 也让「抽盒避开已去过的地点」失效（历史数据里已有重复）。
        if !profile.cards.contains(where: { $0.placeID == place.id }) {
            profile.cards.append(card)
        }
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
        feed = []
        surprises = []
        receipts = []
        lastFind = nil
        persistence.clear()
        surprisePersistence.saveSurprises([])
        SurpriseReceiptStore.shared.removeAll()
        WalkTrackStore.shared.clear()
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
        PlaceDirectory.shared.place(id: card.placeID)
    }
}
