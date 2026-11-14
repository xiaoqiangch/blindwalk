import Foundation

/// 可复现的种子随机数（SplitMix64），保证同一 seed 抽出同一个盲盒，便于演示与测试。
public struct SeededGenerator: RandomNumberGenerator {
    private var state: UInt64

    public init(seed: UInt64) {
        self.state = seed &+ 0x9E37_79B9_7F4A_7C15
    }

    public mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

/// 盲盒抽取结果
public struct DrawResult: Hashable, Sendable {
    public let place: Place
    public let startMeters: Int
    public let seed: UInt64

    public init(place: Place, startMeters: Int, seed: UInt64) {
        self.place = place
        self.startMeters = startMeters
        self.seed = seed
    }
}

/// 抽盒规则引擎。
public struct BlindBoxEngine {

    public let catalog: [Place]
    /// 最近 7 天去过的地点，抽盒时避开
    public let recentPlaceIDs: Set<String>

    /// 默认从「真实地点目录」取候选：没有坐标的地点一律不进候选。
    /// （早期版本默认用内置虚构目录，那些地点没有真实经纬度，用户走到哪都对不上。）
    public init(catalog: [Place]? = nil, recentPlaceIDs: Set<String> = []) {
        self.catalog = (catalog ?? PlaceDirectory.shared.all).filter { $0.coordinate != nil }
        self.recentPlaceIDs = recentPlaceIDs
    }

    /// 按心情 / 时长 / 区域抽一个盲盒。候选不足时依次放宽：区域 → 最近去过。
    public func draw(
        mood: Mood,
        duration: WalkDuration,
        area: Area? = nil,
        seed: UInt64 = UInt64(Date().timeIntervalSince1970),
        calendar: Calendar = .current,
        now: Date = Date()
    ) -> DrawResult? {
        var generator = SeededGenerator(seed: seed)
        let candidates = eligibleCandidates(mood: mood, duration: duration, area: area, seed: seed)
        guard !candidates.isEmpty else { return nil }
        let picked = weightedPick(from: candidates, mood: mood, using: &generator)
        let meters = startDistance(for: picked, duration: duration)
        return DrawResult(place: picked, startMeters: meters, seed: seed)
    }

    /// 权重候选：区域匹配 > 时长半径 > 稀有度可用，且**排除已探索过的地点**。
    /// 只有当「所有可用地点都去过了」时才会退回已去过的（否则用户永远抽不到新地方，
    /// 因为候选池会一直被拒绝到空）。
    private func eligibleCandidates(mood: Mood, duration: WalkDuration, area: Area?, seed: UInt64) -> [Place] {
        func filter(area: Area?, excludeVisited: Bool) -> [Place] {
            catalog.filter { place in
                guard place.rarity.isAvailable(in: duration) else { return false }
                guard place.radiusMeters <= duration.radiusMeters else { return false }
                if let area, place.area != area { return false }
                if excludeVisited, recentPlaceIDs.contains(place.id) { return false }
                return true
            }
        }

        // 首选：区域内 + 没去过 → 任意区域 + 没去过 → （都去过了才）放宽到已去过的
        var result = filter(area: area, excludeVisited: true)
        if result.isEmpty { result = filter(area: nil, excludeVisited: true) }
        if result.isEmpty { result = filter(area: area, excludeVisited: false) }
        if result.isEmpty { result = filter(area: nil, excludeVisited: false) }
        return result
    }

    /// 还有没有「没去过」的地点可抽（UI 用来在抽完时给一句实话）
    public func hasUnvisited(mood: Mood, duration: WalkDuration, area: Area? = nil) -> Bool {
        eligibleCandidates(mood: mood, duration: duration, area: area, seed: 0)
            .contains { !recentPlaceIDs.contains($0.id) }
    }

    private func weight(for place: Place, mood: Mood) -> Int {
        let base = max(1, place.rarity.weight)
        return Self.moodAffinity[place.category]?.contains(mood) == true ? base * 3 : base
    }

    private func weightedPick(
        from places: [Place],
        mood: Mood,
        using generator: inout SeededGenerator
    ) -> Place {
        let weights = places.map { weight(for: $0, mood: mood) }
        let total = weights.reduce(0, +)
        let ticket = Int.random(in: 0..<max(1, total), using: &generator)
        var running = 0
        for (index, value) in weights.enumerated() {
            running += value
            if ticket < running { return places[index] }
        }
        return places[places.count - 1]
    }

    public func startDistance(for place: Place, duration: WalkDuration) -> Int {
        switch duration {
        case .m15: return 300
        case .m30: return 480
        case .m60: return 900
        }
    }

    /// 卡片编号：4 位数字，如 0247
    public static func serial(seed: UInt64) -> String {
        let number = Int(seed % 9999) + 1
        return String(format: "%04d", number)
    }

    /// 心情 → 偏好的地点类别
    public static let moodAffinity: [String: Set<Mood>] = [
        "长椅": [.drift],
        "石阶": [.drift],
        "栈道": [.drift],
        "棋盘": [.drift],
        "秋千": [.drift],
        "台阶": [.drift],
        "书店": [.drift, .discover],
        "涂鸦墙": [.discover],
        "灯塔": [.discover],
        "唱片店": [.drift, .discover],
        "修表摊": [.discover],
        "阳台": [.discover],
        "邮筒": [.discover],
        "水塔": [.discover],
        "咖啡窗口": [.drift],
        "风筝": [.lively],
        "洗车房": [.lively],
        "便利店": [.lively],
        "篮球场": [.lively],
        "三轮车": [.lively],
        "花店": [.lively],
        "馄饨摊": [.lively],
        "裁缝铺": [.drift],
        "洗衣店": [.lively]
    ]
}
