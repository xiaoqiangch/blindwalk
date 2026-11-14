import Foundation

// MARK: - 真实 POI 选点（三端统一规格 docs/parity.md §1-§2）
//
// 纯逻辑，无 UI / 无网络依赖：
// - 三档放宽（距离区间 / 搜索半径）
// - 绝对黑名单 / 软降权 / 类别权重 / 来源与照片加权
// - 逐档质量门槛：先记下"够真实但不够格"的点，继续下一档找更好的
//
// 真实模式下唯一允许的兜底是「明确失败面板」，绝不编造地点。

/// 各数据源的一次查询报告（失败面板展示用）
public struct POISourceReport: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public let label: String
    public let ok: Bool
    public let count: Int
    public let error: String

    public init(id: String, label: String, ok: Bool, count: Int, error: String) {
        self.id = id
        self.label = label
        self.ok = ok
        self.count = count
        self.error = error
    }
}

public enum POISelection {

    // MARK: 三档放宽（parity.md §2）

    public struct Tier: Sendable {
        public let relax: Int
        public let radiusScale: Double
        public let minFactor: Double
        public let maxFactor: Double
        /// 档位内的最小距离硬门槛
        public let minFloor: Double
    }

    public static let tiers: [Tier] = [
        Tier(relax: 0, radiusScale: 1.0, minFactor: 0.35, maxFactor: 1.7, minFloor: 168),
        Tier(relax: 1, radiusScale: 1.8, minFactor: 0.25, maxFactor: 2.2, minFloor: 120),
        Tier(relax: 2, radiusScale: 3.2, minFactor: 0.18, maxFactor: 2.7, minFloor: 86)
    ]

    public static let hardCapMaxMeters: Double = 3500
    public static let hardCapFactor: Double = 3.4

    /// 每档都额外按「地标关键字」查一次，避免只抽到楼下包子铺/快递柜
    public static let landmarkKeywords = "公园|风景名胜|博物馆|展览馆|广场|图书馆|书店|体育馆|寺|教堂|古镇"

    public static func tier(relax: Int) -> Tier {
        tiers[max(0, min(tiers.count - 1, relax))]
    }

    /// 远程漫游的距离窗口：下限固定 10 公里，上限逐档放宽（45 → 55 → 65 公里）。
    ///
    /// 为什么下限不再往下掉：早年为了让「10 公里外一个点都没有」也能出结果，
    /// 第三档会掉到 6 公里 —— 那已经能走过去了，却还按「先开车」的流程展示，
    /// 用户会觉得被耍。宁可明确失败，也不把近距离的点伪装成漫游。
    public static func roamRange(relax: Int = 0) -> ClosedRange<Double> {
        let ups: [Double] = [ExploreScope.roamMaxMeters, 55_000, 65_000]
        let index = max(0, min(ups.count - 1, relax))
        return ExploreScope.roamMinMeters...ups[index]
    }

    /// 远程漫游的搜索半径（米）。高德/百度的 around 半径上限是 50000。
    public static func roamSearchRadius(relax: Int = 0) -> Int {
        let radius = roamRange(relax: relax).upperBound * 1.15
        return Int(min(50_000, max(12_000, radius)))
    }

    /// 搜索半径（各数据源查询用）
    public static func searchRadius(startMeters: Int, relax: Int) -> Int {
        let t = tier(relax: relax)
        return max(600, Int((Double(startMeters) * 1.8 * t.radiusScale).rounded()))
    }

    /// 当前档位的距离窗口（米）
    public static func distanceRange(startMeters: Int, relax: Int) -> ClosedRange<Double> {
        let t = tier(relax: relax)
        let start = Double(startMeters)
        let minDistance = max(t.minFloor, start * t.minFactor)
        let hardMax = min(hardCapMaxMeters, start * hardCapFactor)
        let maxDistance = min(hardMax, start * t.maxFactor)
        return minDistance...max(maxDistance, minDistance)
    }

    // MARK: 黑名单（parity.md §2）

    /// 第一级：绝对不适合步迷 → 直接排除
    private static let neverPattern =
        "公厕|厕所|垃圾|污水|变电|加油站|停车场|停车库|ATM|自助取款|售楼|工业园|物流|工厂|仓库|暂停开放|已关闭|停止营业|暂停营业|装修中|施工中"

    /// 第二级：没什么地点感 → ×0.22 降权，不排除
    private static let softPattern =
        "快递|丰巢|菜鸟|驿站|充电站|小区|公寓|宿舍|苑|号楼|包子|面馆|小吃|快餐|麻辣烫|烧饼|米线|律师事务所|事务所|旅行社|旅游|携程|营业厅|专卖店|旗舰店|培训|教育|诊所|门诊|医院|中介|地产|售楼|大厦|写字楼|美容|美发|理发|足浴|按摩|足疗|养生|汗蒸|银行|药房|大药房|超市|便利店|菜市场|五金|建材|汽修|洗车|驾校|打印|复印|网吧|棋牌|麻将|KTV|酒吧|夜总会"

    /// 有「散步/探索」价值的类别
    private static let goodCategories: Set<RealPlaceCategory> = [
        .park, .garden, .temple, .historic, .museum, .art, .library, .viewpoint,
        .river, .bridge, .cafe, .bookstore, .market, .plaza
    ]

    private static let distinctiveWeight: [RealPlaceCategory: Double] = [
        .park: 1.7, .museum: 1.7, .temple: 1.6, .historic: 1.6, .garden: 1.5,
        .viewpoint: 1.5, .art: 1.5, .library: 1.5, .venue: 1.4, .bookstore: 1.4,
        .bridge: 1.2, .river: 1.2, .market: 1.2, .plaza: 1.0
    ]

    public struct Walkworthy: Sendable {
        public let ok: Bool
        public let penalty: Double
    }

    public static func scoreWalkworthy(name: String) -> Walkworthy {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.count < 2 { return Walkworthy(ok: false, penalty: 0) }
        if trimmed.range(of: neverPattern, options: .regularExpression) != nil {
            return Walkworthy(ok: false, penalty: 0)
        }
        // 纯编号命名（3号楼 / A座 / 123）不像是「值得走的地点」
        if trimmed.range(of: "^[0-9A-Za-z\\-\\s]+$", options: .regularExpression) != nil {
            return Walkworthy(ok: false, penalty: 0)
        }
        let penalty = trimmed.range(of: softPattern, options: .regularExpression) != nil ? 0.22 : 1.0
        return Walkworthy(ok: true, penalty: penalty)
    }

    /// 够真实但「不够格」：只适合作为三档都失败后的最后选择
    public static func isDull(_ candidate: POICandidate) -> Bool {
        scoreWalkworthy(name: candidate.name).penalty < 0.5
    }

    // MARK: 类别映射（17 类）

    private static let categoryRules: [(RealPlaceCategory, String)] = [
        (.bench, "长椅|长凳|座椅|条凳|bench"),
        (.bridge, "桥|橋|大桥|天桥|廊桥|bridge"),
        (.cafe, "咖啡|咖啡馆|咖啡厅|cafe|星巴克|瑞幸|manner|seesaw|m stand"),
        (.bookstore, "书店|書店|书城|新华书店|bookstore|book shop"),
        (.library, "图书馆|圖書館|阅览室|library"),
        (.museum, "博物馆|博物館|纪念馆|展览馆|陈列馆|museum"),
        (.art, "美术馆|艺术馆|画廊|涂鸦|艺术墙|雕塑|art gallery"),
        (.park, "公园|公園|植物园|动物园|绿地|森林公园|park"),
        (.garden, "花园|花園|花圃|garden"),
        (.river, "河|江|湖|滨|码头|水岸|堤|river|lake|waterfront"),
        (.viewpoint, "观景|观景台|天台|瞭望|塔|电视塔|viewpoint|lookout|observation"),
        (.temple, "寺|庙|廟|教堂|会堂|清真|祠|道观|church|temple|cathedral|mosque"),
        (.venue, "音乐厅|剧院|剧场|戏院|大戏院|演奏厅|体育馆|体育场|影院|电影院|theatre|theater|concert|stadium"),
        (.convenience, "便利店|便利|超市|全家|罗森|7-11|seven-?eleven|convenience"),
        (.historic, "故居|旧址|会址|历史建筑|老房子|公馆|洋房|里弄|弄堂|遗址|historic"),
        (.market, "市集|集市|市场|菜场|菜市场|夜市|market"),
        (.plaza, "广场|步行街|plaza|square")
    ]

    /// 原始类别（高德 type / 百度 tag / OSM / 维基）→ 17 类之一
    public static func mapCategory(raw: String?, name: String) -> RealPlaceCategory {
        let text = (raw ?? "") + " " + name
        for (category, pattern) in categoryRules {
            if text.range(of: pattern, options: .regularExpression) != nil {
                return category
            }
        }
        return .plaza
    }

    // MARK: 权重与挑选

    public static func weight(
        candidate: POICandidate,
        mood: Mood,
        relax: Int,
        origin: GeoPoint,
        moment: DayMoment = .now
    ) -> Double {
        let category = candidate.category
        var weight: Double = 1

        // 心情偏好（与 Web pickProvider 一致）
        switch mood {
        case .drift:
            if [.park, .river, .temple, .historic].contains(category) { weight = 1.5 }
        case .discover:
            if [.art, .library, .viewpoint, .museum].contains(category) { weight = 1.7 }
        case .lively:
            if [.plaza, .market, .cafe].contains(category) { weight = 1.6 }
        }

        // 类别质量（relax 越大越不挑剔）
        var catPenalty = goodCategories.contains(category) ? (distinctiveWeight[category] ?? 1) : 0.35
        if relax >= 1 { catPenalty = goodCategories.contains(category) ? 1 : 0.6 }
        if relax >= 2 { catPenalty = goodCategories.contains(category) ? 1 : 0.85 }
        weight *= catPenalty

        // 软黑名单降权
        weight *= scoreWalkworthy(name: candidate.name).penalty
        // 时段偏好：环境性盲盒的核心 —— 黄昏往水边走，夜里避开公园
        weight *= moment.affinity(for: category)
        // 百科 / OSM 通常比商业 POI 更有「地点感」
        if candidate.source == "wiki" || candidate.source == "osm" { weight *= 1.25 }
        // 有照片的优先（揭晓体验更好）
        if candidate.photoUrl != nil { weight *= 1.15 }

        // 距离只作为极弱的偏好（避免近处全是店铺时永远抽最近）
        let distance = GeoMath.distance(from: origin, to: candidate.coordinate)
        weight *= max(0.5, 1.0 - min(0.3, distance / 10_000))
        return weight
    }

    /// 从候选里按权重降序取前 40%（至少 3 个）做加权随机
    public static func pick(
        from candidates: [POICandidate],
        origin: GeoPoint,
        mood: Mood,
        startMeters: Int,
        relax: Int,
        seed: UInt64,
        excluding excludedIDs: Set<String> = [],
        scope: ExploreScope = .walk,
        moment: DayMoment = .now
    ) -> POICandidate? {
        let range = scope == .roam
            ? roamRange(relax: relax)
            : distanceRange(startMeters: startMeters, relax: relax)
        var pool: [(candidate: POICandidate, weight: Double)] = []

        for candidate in candidates {
            // 已经探索过的点不再抽（真实 POI 的 id 是稳定的，能跨会话去重）
            guard !excludedIDs.contains(candidate.id) else { continue }
            let worth = scoreWalkworthy(name: candidate.name)
            guard worth.ok else { continue }
            let distance = GeoMath.distance(from: origin, to: candidate.coordinate)
            guard range.contains(distance) else { continue }
            pool.append((candidate, weight(candidate: candidate, mood: mood, relax: relax, origin: origin, moment: moment)))
        }
        guard !pool.isEmpty else { return nil }

        pool.sort { $0.weight > $1.weight }
        let keep = max(3, Int(ceil(Double(pool.count) * 0.4)))
        let best = Array(pool.prefix(keep))
        let total = best.reduce(0) { $0 + $1.weight }
        guard total > 0 else { return best.first?.candidate }

        var generator = SeededGenerator(seed: seed)
        let ticket = Double(Int.random(in: 0..<1_000_000, using: &generator)) / 1_000_000 * total
        var running = 0.0
        for entry in best {
            running += entry.weight
            if ticket <= running { return entry.candidate }
        }
        return best.last?.candidate
    }

    // MARK: 去重 / 多样性

    private static func nameKey(_ name: String) -> String {
        name.replacingOccurrences(of: "\\s+", with: "", options: .regularExpression).lowercased()
    }

    private static func qualityScore(_ candidate: POICandidate) -> Int {
        var score = 0
        if candidate.photoUrl != nil { score += 4 }
        if candidate.address != nil { score += 2 }
        if candidate.source == "amap" || candidate.source == "baidu" { score += 1 }
        return score
    }

    private static func mergeMissing(_ target: inout POICandidate, from other: POICandidate) {
        let needsPhoto = target.photoUrl == nil && other.photoUrl != nil
        let needsAddress = target.address == nil && other.address != nil
        let needsCategory = target.category == .plaza && other.category != .plaza
        guard needsPhoto || needsAddress || needsCategory else { return }
        target = POICandidate(
            id: target.id,
            name: target.name,
            coordinate: target.coordinate,
            address: needsAddress ? other.address : target.address,
            category: needsCategory ? other.category : target.category,
            source: target.source,
            photoUrl: needsPhoto ? other.photoUrl : target.photoUrl,
            photoCredit: needsPhoto ? other.photoCredit : target.photoCredit,
            summary: target.summary ?? other.summary
        )
    }

    /// 同名（忽略空白/大小写）或距离 < threshold 合并，优先有图/有地址/付费源
    public static func dedupe(_ list: [POICandidate], thresholdMeters: Double = 30) -> [POICandidate] {
        var out: [POICandidate] = []
        for candidate in list {
            guard !candidate.name.isEmpty else { continue }
            if let index = out.firstIndex(where: { existing in
                nameKey(existing.name) == nameKey(candidate.name)
                    || GeoMath.distance(from: existing.coordinate, to: candidate.coordinate) < thresholdMeters
            }) {
                if qualityScore(candidate) > qualityScore(out[index]) {
                    var replacement = candidate
                    mergeMissing(&replacement, from: out[index])
                    out[index] = replacement
                } else {
                    mergeMissing(&out[index], from: candidate)
                }
            } else {
                out.append(candidate)
            }
        }
        return out
    }

    /// 截断时保留类别多样性：每类最多 5 个，避免最近的全是店铺
    public static func trimDiverse(
        _ sorted: [POICandidate],
        origin: GeoPoint,
        limit: Int
    ) -> [POICandidate] {
        guard sorted.count > limit else { return sorted }
        var out: [POICandidate] = []
        var picked = Set<String>()
        var perCategory: [RealPlaceCategory: Int] = [:]

        func key(_ candidate: POICandidate) -> String {
            "\(candidate.source)|\(candidate.id)|\(candidate.name)"
        }

        for candidate in sorted where out.count < limit {
            let count = perCategory[candidate.category, default: 0]
            if count >= 5 { continue }
            let k = key(candidate)
            if picked.contains(k) { continue }
            picked.insert(k)
            perCategory[candidate.category] = count + 1
            out.append(candidate)
        }
        for candidate in sorted where out.count < limit {
            let k = key(candidate)
            if picked.contains(k) { continue }
            picked.insert(k)
            out.append(candidate)
        }
        return out.sorted {
            GeoMath.distance(from: origin, to: $0.coordinate) < GeoMath.distance(from: origin, to: $1.coordinate)
        }
    }
}

// MARK: - 演示 / 真实来源判定

public enum PlaceSource {
    /// 真实模式下只允许这些来源进入旅程
    public static func isReal(_ source: String?) -> Bool {
        guard let source else { return false }
        return ["curated", "amap", "baidu", "osm", "wiki", "apple"].contains(source)
    }

    public static func label(_ source: String?) -> String {
        switch source {
        case "curated": return "编辑精选"
        case "amap": return "高德地图"
        case "baidu": return "百度地图"
        case "wiki": return "维基百科"
        case "osm": return "OpenStreetMap"
        case "apple": return "真实地标"
        case "catalog": return "演示地点"
        default: return "真实地点"
        }
    }
}
