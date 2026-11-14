import Foundation

// MARK: - 真实地点目录（唯一地点来源）
//
// 这个 App 不内置任何虚构地点。所有能出现在界面上的地点都必须有真实经纬度：
//   - 后台策展的 POI（admin 审核通过 → pois.json）
//   - 运行时从高德 / 百度 / OSM / 维基抓到的真实 POI
//
// 为什么需要它：
//   1. Shared 层（Profile 统计、卡片解析、手表摘要）不能依赖 App 层的 AdminPOIService；
//   2. 抽到过的真实 POI 必须能落盘 —— 否则第二天打开，已收录的卡会因为
//      「查不到这个 id 对应的地点」而显示不出来。
//
// 查不到就是查不到：返回 nil，绝不退回虚构地点。
public final class PlaceDirectory: @unchecked Sendable {

    public static let shared = PlaceDirectory()

    private static let storageKey = "walkaholic.places.v1"
    private static let maxRemembered = 400

    private var places: [String: Place] = [:]
    private var remembered: Set<String> = []
    private let lock = NSLock()
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        loadFromDisk()
    }

    // MARK: 写入

    /// 后台策展数据整批合并进来。已经 remembered 的历史地点不会被清掉
    /// （后台下架某个点后，用户已收录的卡片仍要能显示）。
    public func replaceCurated(_ list: [Place]) {
        lock.lock()
        defer { lock.unlock() }
        for place in list where place.coordinate != nil {
            places[place.id] = place
        }
        persist()
    }

    /// 记下一个真实地点（抽盒 / 探秘 / 收录时调用），并落盘
    public func remember(_ place: Place) {
        guard place.coordinate != nil else { return }
        lock.lock()
        defer { lock.unlock() }
        places[place.id] = place
        remembered.insert(place.id)
        persist()
    }

    // MARK: 读取

    public func place(id: String) -> Place? {
        lock.lock()
        defer { lock.unlock() }
        return places[id]
    }

    /// 只包含有真实坐标的地点
    public var all: [Place] {
        lock.lock()
        defer { lock.unlock() }
        return places.values.filter { $0.coordinate != nil }
    }

    public var isEmpty: Bool {
        lock.lock()
        defer { lock.unlock() }
        return places.isEmpty
    }

    /// 附近的真实地点（按距离升序）。图鉴用它列出「还没去过」的可探秘地点。
    public func nearby(_ origin: GeoPoint, within meters: Double) -> [(place: Place, distance: Double)] {
        lock.lock()
        let all = places.values.filter { $0.coordinate != nil }
        lock.unlock()
        return all
            .compactMap { place -> (Place, Double)? in
                guard let coordinate = place.coordinate else { return nil }
                let distance = GeoMath.distance(from: origin, to: coordinate)
                guard distance <= meters else { return nil }
                return (place, distance)
            }
            .sorted { $0.1 < $1.1 }
    }

    /// 清掉「不是真实地点」的历史数据。
    /// 没有坐标的一律删掉 —— 早期版本内置的 24 个虚构地点就是这种，不能被带进新版本。
    @discardableResult
    public func purgeNonReal() -> Int {
        lock.lock()
        defer { lock.unlock() }
        let before = places.count
        places = places.filter { $0.value.coordinate != nil }
        let removed = before - places.count
        if removed > 0 { persist() }
        return removed
    }

    /// 清空（仅「清除数据」用）
    public func removeAll() {
        lock.lock()
        defer { lock.unlock() }
        places = [:]
        remembered = []
        defaults.removeObject(forKey: Self.storageKey)
    }

    // MARK: 落盘（调用前必须已持锁）

    private func persist() {
        let list = places.values
            .filter { $0.coordinate != nil }
            .sorted { $0.id < $1.id }
        let trimmed = Array(list.suffix(Self.maxRemembered))
        guard let data = try? JSONEncoder().encode(trimmed) else { return }
        defaults.set(data, forKey: Self.storageKey)
    }

    private func loadFromDisk() {
        guard let data = defaults.data(forKey: Self.storageKey),
              let list = try? JSONDecoder().decode([Place].self, from: data) else { return }
        places = Dictionary(
            list.filter { $0.coordinate != nil }.map { ($0.id, $0) },
            uniquingKeysWith: { first, _ in first }
        )
        remembered = Set(places.keys)
    }
}
