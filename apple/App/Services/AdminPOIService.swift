import Foundation

// MARK: - 后台策展兴趣点（admin/docs/CONTRACT.md §4.6）
//
// 后台（admin）把审核通过的 POI 导出成 pois.json：
//   https://xiaoqiangch.github.io/walkaholic/pois.json
// App 抽盒时优先从这里挑一个「编辑精选」地点，失败/为空时再退回 MapKit 附近搜索。
//
// 设计约束：
// - 3 秒超时；失败静默（不阻塞抽盒、不弹错误、不崩）
// - 内存缓存 6 小时；UserDefaults 落盘兜底（断网也能用上次的数据）
// - 抽取规则对齐 prototype/web/geo.js 的 pickCurated：
//   距离区间 [max(110, 0.35×startMeters), 1.7×startMeters]，按心情加权，seed 可复现
// - 保密规则：Place.name / address / why / task / hints 只在到达后由 RevealView 展示；
//   本服务不参与「到达前」的任何 UI 文案
// - 照片是 App 层 side-channel：`Place`（Shared，Lead 拥有）没有 photoUrl 字段，
//   所以服务内部维护 placeID → CuratedPlaceInfo，RevealView 通过 info(for:) 取图。
//   数据随 pois.json 一起落盘，重启后仍能按 placeID 找回图片信息。

// MARK: - 原始数据结构

struct CuratedPoisFile: Decodable {
    let version: Int?
    let exportedAt: Int64?
    let count: Int?
    let pois: [CuratedPOI]
}

/// pois.json 里的一条兴趣点（字段与 admin CONTRACT §4.6 对齐）
struct CuratedPOI: Decodable, Hashable, Sendable {
    let id: String
    let name: String
    let lat: Double
    let lon: Double
    let category: String?
    let emoji: String?
    let rarity: Rarity?
    let area: Area?
    let address: String?
    let photoUrl: String?
    let photoCredit: String?
    let summary: String?
    let why: String?
    let task: String?
    let hints: [String]?

    var coordinate: GeoPoint {
        GeoPoint(latitude: lat, longitude: lon)
    }

    var placeID: String {
        "curated-\(id)"
    }
}

/// 只在 App 层使用的策展照片 / 文案信息（Place 里没有这些字段）
struct CuratedPlaceInfo: Hashable, Sendable {
    let placeID: String
    let sourceID: String
    let name: String
    let photoURL: URL?
    let photoCredit: String?
    let summary: String?
}

// MARK: - 服务

@MainActor
final class AdminPOIService {

    static let shared = AdminPOIService()

    /// 公网策展数据（可用 `WA_POIS_URL` 覆盖，调试/内网用）
    static let defaultEndpoint = "https://xiaoqiangch.github.io/walkaholic/pois.json"

    private static let memoryTTL: TimeInterval = 6 * 3600
    private static let diskDataKey = "walkaholic.adminPois.data.v1"
    private static let diskFetchedAtKey = "walkaholic.adminPois.fetchedAt.v1"

    private var pois: [CuratedPOI] = []
    private var infos: [String: CuratedPlaceInfo] = [:]
    private var fetchedAt: Date?
    private var isRefreshing = false
    /// 并发调用 prepare() 时排队等待同一次刷新，避免「预热还没回来就先抽盒」漏掉策展点
    private var refreshWaiters: [CheckedContinuation<Void, Never>] = []

    private init() {
        loadFromDisk()
    }

    // MARK: 读取 / 刷新

    /// 确保策展数据可用：内存 6h 内直接用；过期则后台拉取（最多 3s）。
    /// 拉取失败时保留内存/磁盘里的旧数据，永不抛错。
    func prepare() async {
        guard needsRefresh() else { return }
        await refresh()
    }

    /// 当前可用的策展 POI 数量（调试用）
    var cachedCount: Int { pois.count }

    /// 最近一次成功拉取时间（调试用）
    var lastUpdated: Date? { fetchedAt }

    private func needsRefresh() -> Bool {
        guard !pois.isEmpty, let fetchedAt else { return true }
        return Date().timeIntervalSince(fetchedAt) >= Self.memoryTTL
    }

    private func refresh() async {
        if isRefreshing {
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                refreshWaiters.append(continuation)
            }
            return
        }
        isRefreshing = true
        defer {
            isRefreshing = false
            let waiters = refreshWaiters
            refreshWaiters = []
            for waiter in waiters {
                waiter.resume()
            }
        }

        guard let url = Self.endpointURL() else { return }
        var request = URLRequest(url: url)
        request.timeoutInterval = 3
        request.cachePolicy = .reloadIgnoringLocalCacheData

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse,
                  (200..<300).contains(http.statusCode) else { return }

            let file = try JSONDecoder().decode(CuratedPoisFile.self, from: data)
            let valid = file.pois.filter { poi in
                poi.lat.isFinite && poi.lon.isFinite
                    && abs(poi.lat) <= 90 && abs(poi.lon) <= 180
                    && !poi.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            }

            // 导出为空（没有 approved 点）→ 清空，让抽盒完全退回 MapKit
            if valid.isEmpty {
                pois = []
                infos = [:]
                fetchedAt = Date()
                return
            }

            pois = valid
            fetchedAt = Date()
            rebuildInfos()
            saveToDisk(raw: data, fetchedAt: Date())
        } catch {
            // 静默：断网 / 超时 / 404 / JSON 坏掉都保留旧数据
        }
    }

    private static func endpointURL() -> URL? {
        let env = ProcessInfo.processInfo.environment["WA_POIS_URL"] ?? ""
        let raw = env.trimmingCharacters(in: .whitespacesAndNewlines)
        if !raw.isEmpty, let url = URL(string: raw) {
            return url
        }
        return URL(string: defaultEndpoint)
    }

    // MARK: 抽取

    /// 从策展数据里挑一个地点并映射成 `Place`。
    /// 规则对齐 prototype/web/geo.js 的 pickCurated（距离 + 心情加权 + seed 可复现）。
    func pickCuratedPlace(
        origin: GeoPoint,
        mood: Mood,
        startMeters: Int,
        seed: UInt64
    ) -> Place? {
        guard !pois.isEmpty else { return nil }

        let minDistance = max(110, Double(startMeters) * 0.35)
        let maxDistance = Double(startMeters) * 1.7
        var pool: [(poi: CuratedPOI, weight: Int)] = []

        for poi in pois {
            let distance = GeoMath.distance(from: origin, to: poi.coordinate)
            guard distance >= minDistance, distance <= maxDistance else { continue }
            let weight = Self.weight(for: poi, mood: mood)
            pool.append((poi, weight))
        }

        guard !pool.isEmpty else { return nil }

        var generator = SeededGenerator(seed: seed)
        let total = pool.reduce(0) { $0 + $1.weight }
        guard total > 0 else { return nil }
        let ticket = Int.random(in: 0..<total, using: &generator)
        var running = 0
        for entry in pool {
            running += entry.weight
            if ticket < running {
                return makePlace(from: entry.poi, origin: origin, startMeters: startMeters)
            }
        }
        return makePlace(from: pool[pool.count - 1].poi, origin: origin, startMeters: startMeters)
    }

    /// 心情加权（与 web geo.js pickCurated 一致）：
    /// drift → park/river/temple/historic；discover → art/library/viewpoint/museum；
    /// lively → plaza/market/cafe；其余权重 1。
    private static func weight(for poi: CuratedPOI, mood: Mood) -> Int {
        let category = (poi.category ?? "plaza").lowercased()
        var weight = 10
        switch mood {
        case .drift:
            if ["park", "river", "temple", "historic"].contains(category) { weight = 15 }
        case .discover:
            if ["art", "library", "viewpoint", "museum"].contains(category) { weight = 17 }
        case .lively:
            if ["plaza", "market", "cafe"].contains(category) { weight = 16 }
        }
        return weight
    }

    // MARK: 映射成 Place

    private func makePlace(from poi: CuratedPOI, origin: GeoPoint, startMeters: Int) -> Place {
        let coordinate = poi.coordinate
        let distance = GeoMath.distance(from: origin, to: coordinate)
        let bearing = GeoMath.bearing(from: origin, to: coordinate)
        let meta = Self.categoryMeta(poi.category)

        // 抽象地图坐标：与 web geo.js mapPointFor 一致（极坐标投影，仅画示意路线）
        let normalized = min(0.42, distance / max(200, Double(startMeters) * 2.2))
        let radians = bearing * .pi / 180
        let mapPoint = MapPoint(
            x: 0.5 + sin(radians) * normalized,
            y: 0.82 - cos(radians) * normalized
        )

        let why = nonEmpty(poi.why) ?? "「\(meta.label)」适合不赶时间地待一会儿。\n到了才知道是哪里，这个地点只为你亮一次。"
        let task = nonEmpty(poi.task) ?? meta.task
        let hints = resolvedHints(poi, meta: meta, name: poi.name)

        return Place(
            id: poi.placeID,
            name: poi.name,
            area: poi.area ?? meta.area,
            category: meta.label,
            emoji: nonEmpty(poi.emoji) ?? meta.emoji,
            rarity: poi.rarity ?? meta.rarity,
            why: why,
            task: task,
            hints: hints,
            mapPoint: mapPoint,
            radiusMeters: max(800, startMeters + 400),
            coordinate: coordinate,
            address: nonEmpty(poi.address),
            source: "curated"
        )
    }

    /// 线索：优先用后台策展的三条；不足 3 条时补默认线索；最后做一次去地名清洗。
    private func resolvedHints(_ poi: CuratedPOI, meta: CuratedCategory, name: String) -> [String] {
        var hints: [String] = []
        if let curated = poi.hints {
            hints = curated
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        }
        for fallback in meta.hints where hints.count < 3 {
            hints.append(fallback)
        }
        return scrubPlaceNames(Array(hints.prefix(3)), name: name)
    }

    /// 兜底再洗一遍：完整地名 + 前两个字都不能出现在线索里（后台已校验，这里是双保险）
    private func scrubPlaceNames(_ hints: [String], name: String) -> [String] {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return hints }
        let prefix = String(trimmed.prefix(2))
        return hints.map { hint in
            var value = hint
            if !trimmed.isEmpty {
                value = value.replacingOccurrences(of: trimmed, with: "那里")
            }
            if prefix.count >= 2 {
                value = value.replacingOccurrences(of: prefix, with: "那里")
            }
            return value
        }
    }

    private func nonEmpty(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    // MARK: 照片 / 文案（App 层 side-channel）

    /// `placeID` 形如 `curated-poi-xxx`；查不到返回 nil（调用方静默降级）。
    func info(for placeID: String) -> CuratedPlaceInfo? {
        infos[placeID]
    }

    func info(for place: Place) -> CuratedPlaceInfo? {
        guard place.source == "curated" else { return nil }
        return infos[place.id]
    }

    /// 按 placeID 还原策展 `Place`（图鉴 / 首页「上一次的惊喜」后续接入用）。
    /// 备注：`CardsView` / `HomeView` 目前仍只用 `PlaceCatalog`（不在本任务写作用域），
    /// 所以收录的策展卡片暂时不会出现在图鉴里；接入时把这里的结果和目录结果合并即可。
    func place(for placeID: String) -> Place? {
        guard let poi = pois.first(where: { $0.placeID == placeID }) else { return nil }
        return makePlace(from: poi, origin: poi.coordinate, startMeters: 480)
    }

    private func rebuildInfos() {
        var next: [String: CuratedPlaceInfo] = [:]
        for poi in pois {
            let photoURL: URL? = nonEmpty(poi.photoUrl).flatMap { URL(string: $0) }
            next[poi.placeID] = CuratedPlaceInfo(
                placeID: poi.placeID,
                sourceID: poi.id,
                name: poi.name,
                photoURL: photoURL,
                photoCredit: nonEmpty(poi.photoCredit),
                summary: nonEmpty(poi.summary)
            )
        }
        infos = next
    }

    // MARK: 落盘

    private func loadFromDisk() {
        let defaults = UserDefaults.standard
        guard let data = defaults.data(forKey: Self.diskDataKey),
              let file = try? JSONDecoder().decode(CuratedPoisFile.self, from: data) else {
            return
        }
        let valid = file.pois.filter { poi in
            poi.lat.isFinite && poi.lon.isFinite && !poi.name.isEmpty
        }
        guard !valid.isEmpty else { return }
        pois = valid
        let stamp = defaults.double(forKey: Self.diskFetchedAtKey)
        fetchedAt = stamp > 0 ? Date(timeIntervalSince1970: stamp) : nil
        rebuildInfos()
    }

    private func saveToDisk(raw: Data, fetchedAt date: Date) {
        let defaults = UserDefaults.standard
        defaults.set(raw, forKey: Self.diskDataKey)
        defaults.set(date.timeIntervalSince1970, forKey: Self.diskFetchedAtKey)
    }

    // MARK: 类别映射（admin CONTRACT §3，与 Web geo.js CATEGORY_META 对齐）

    private struct CuratedCategory {
        let label: String
        let emoji: String
        let rarity: Rarity
        let area: Area
        let task: String
        let hints: [String]
    }

    private static func categoryMeta(_ raw: String?) -> CuratedCategory {
        let key = (raw ?? "plaza").lowercased()
        let defaultHints = ["往人少的方向走，别急。", "会闻到一点不一样的味道。", "就在前面，慢慢看。"]
        switch key {
        case "cafe":
            return CuratedCategory(label: "咖啡窗口", emoji: "☕️", rarity: .common, area: .near,
                task: "点一杯最便宜的，问老板今天的豆子是哪里的。",
                hints: ["风里有一点烘焙的味道。", "跟着味道走，会经过一扇开着的窗。", "就在前面，慢慢看。"])
        case "bookstore":
            return CuratedCategory(label: "书店", emoji: "📚", rarity: .rare, area: .oldtown,
                task: "找一本封面是蓝色的书，翻开第 7 页读三行。",
                hints: ["前面会安静下来。", "找一扇窗很大、里面堆着纸的地方。", "就在前面，慢慢看。"])
        case "library":
            return CuratedCategory(label: "图书馆", emoji: "📖", rarity: .rare, area: .oldtown,
                task: "坐下，看十分钟别人进进出出。",
                hints: ["往更安静的方向走。", "会看到很多台阶，很多人坐在上面。", "就在前面，慢慢看。"])
        case "park":
            return CuratedCategory(label: "公园", emoji: "🌳", rarity: .common, area: .near,
                task: "找一张能看见最多树的长椅，坐三分钟。",
                hints: ["树会变多，声音会变少。", "找一片能听见叶子的地方。", "就在前面，慢慢看。"])
        case "bench":
            return CuratedCategory(label: "长椅", emoji: "🪑", rarity: .common, area: .near,
                task: "数一数这张长椅能坐几个人。",
                hints: ["适合坐下来。往有阴影的地方走。", "会看到一张面朝开阔处的长椅。", "就在前面，慢慢看。"])
        case "bridge":
            return CuratedCategory(label: "桥", emoji: "🌉", rarity: .rare, area: .river,
                task: "在桥上站满 60 秒，看一次水流的方向。",
                hints: ["脚下的声音会变。", "找一段水面在脚下经过的地方。", "就在前面，慢慢看。"])
        case "art":
            return CuratedCategory(label: "涂鸦墙", emoji: "🎨", rarity: .epic, area: .near,
                task: "拍一张只有一个颜色的照片。",
                hints: ["颜色会突然变多。", "找一面不太平整的墙。", "就在前面，慢慢看。"])
        case "river":
            return CuratedCategory(label: "河岸", emoji: "🌊", rarity: .epic, area: .river,
                task: "数一数河面上有几艘船。",
                hints: ["空气会变凉，风会变大。", "往低处走，会听到水声。", "就在前面，慢慢看。"])
        case "convenience":
            return CuratedCategory(label: "便利店", emoji: "🥫", rarity: .common, area: .near,
                task: "买一样不超过 5 块钱的东西。",
                hints: ["往灯最亮的地方走。", "会听到「欢迎光临」的电子音。", "就在前面，慢慢看。"])
        case "viewpoint":
            return CuratedCategory(label: "观景点", emoji: "🔭", rarity: .epic, area: .near,
                task: "找一盏你能看见的最远的灯。",
                hints: ["往高处走。", "找一个能看见很远的地方。", "就在前面，慢慢看。"])
        case "garden":
            return CuratedCategory(label: "花园", emoji: "🌷", rarity: .rare, area: .near,
                task: "找一盆你觉得活得最好的植物。",
                hints: ["空气会有一点甜。", "找一片被人照料过的绿。", "就在前面，慢慢看。"])
        case "plaza":
            return CuratedCategory(label: "广场", emoji: "⛲️", rarity: .common, area: .near,
                task: "观察 30 秒，找出走得最慢的那个人。",
                hints: ["人会变多。", "找一块空着的石头或台阶。", "就在前面，慢慢看。"])
        case "museum":
            return CuratedCategory(label: "博物馆", emoji: "🏛️", rarity: .rare, area: .oldtown,
                task: "找一个你愿意再看第二眼的展品，记住它的位置。",
                hints: ["会看到很多人排着队，也会突然安静。", "找一栋有很长台阶、门很高的建筑。", "就在前面，慢慢看。"])
        case "historic":
            return CuratedCategory(label: "老房子", emoji: "🏮", rarity: .rare, area: .oldtown,
                task: "找一处你觉得最旧的痕迹。",
                hints: ["会突然安静，也会突然古老。", "找一处门框比周围都旧的地方。", "就在前面，慢慢看。"])
        case "venue":
            return CuratedCategory(label: "演出场所", emoji: "🎻", rarity: .epic, area: .oldtown,
                task: "找一张你愿意看的演出海报，拍下来。",
                hints: ["傍晚会亮起一串灯。", "找一处门口贴着演出海报的地方。", "就在前面，慢慢看。"])
        case "temple":
            return CuratedCategory(label: "寺庙教堂", emoji: "⛩️", rarity: .rare, area: .oldtown,
                task: "找一处你觉得最旧的痕迹。",
                hints: ["会突然安静，也会突然古老。", "找一处门框比周围都旧的地方。", "就在前面，慢慢看。"])
        case "market":
            return CuratedCategory(label: "市集", emoji: "🛒", rarity: .common, area: .oldtown,
                task: "挑一样你不认识的东西，问老板是什么。",
                hints: ["声音会变杂。", "找一个人挤人、但没人赶时间的地方。", "就在前面，慢慢看。"])
        default:
            return CuratedCategory(label: "城市角落", emoji: "📍", rarity: .common, area: .near,
                task: "站一会儿，找一样只有这里才有的东西。",
                hints: defaultHints)
        }
    }
}
