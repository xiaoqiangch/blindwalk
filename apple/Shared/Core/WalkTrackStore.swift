import Foundation

// MARK: - 走路轨迹（个人城市地图的数据层）
//
// 为什么要有它：卡片是「平台给的」，走过的路是「我自己留下的」。
// 把每天的轨迹累积下来，用户就有一份别人拿不走的资产 —— 这是这个产品最能建立
// 情感连接的东西，也是唯一能让人过一个月还愿意回来的理由。
//
// 存储策略：
//   - 只记「移动超过 25 米」的点（GPS 抖动不会画出毛线团）
//   - 上限 12000 个点，超过就按天抽样压缩（保留每天首尾与均匀采样）
//   - 落盘在 UserDefaults，JSON 数组，约 40 字节/点 → 最坏 ~500KB
public struct WalkPoint: Codable, Hashable, Sendable {
    public let latitude: Double
    public let longitude: Double
    public let time: Date

    public init(latitude: Double, longitude: Double, time: Date) {
        self.latitude = latitude
        self.longitude = longitude
        self.time = time
    }

    public var coordinate: GeoPoint { GeoPoint(latitude: latitude, longitude: longitude) }
}

public final class WalkTrackStore: @unchecked Sendable {

    public static let shared = WalkTrackStore()

    private static let key = "walkaholic.track.v2"
    private static let maxPoints = 12_000
    /// 相邻采样点的最小间距：小于它就不记（站着不动不会产生垃圾点）
    public static let minSpacingMeters: Double = 25
    /// 探索格子边长（米）：用于算「走过多少块地方」
    public static let cellMeters: Double = 200

    private let defaults: UserDefaults
    private let lock = NSLock()
    public private(set) var points: [WalkPoint] = []

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        load()
    }

    // MARK: 写入

    /// 追加一个轨迹点；间距太近会被忽略。返回是否真的记下了。
    @discardableResult
    public func append(_ point: GeoPoint, at time: Date = Date()) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if let last = points.last {
            let moved = GeoMath.distance(from: last.coordinate, to: point)
            // 同一天内 25 米以内不记；跨天则总是记（用来切分“这一天走过哪”）
            if moved < Self.minSpacingMeters, Calendar.current.isDate(last.time, inSameDayAs: time) {
                return false
            }
        }
        points.append(WalkPoint(latitude: point.latitude, longitude: point.longitude, time: time))
        if points.count > Self.maxPoints { compressLocked() }
        persistLocked()
        return true
    }

    public func clear() {
        lock.lock()
        defer { lock.unlock() }
        points = []
        defaults.removeObject(forKey: Self.key)
    }

    // MARK: 读取

    /// 按天分组（用于在地图上按“第几天”画不同深浅的线）
    public func days() -> [(day: Date, points: [WalkPoint])] {
        lock.lock()
        let snapshot = points
        lock.unlock()
        let calendar = Calendar.current
        var buckets: [Date: [WalkPoint]] = [:]
        for point in snapshot {
            let day = calendar.startOfDay(for: point.time)
            buckets[day, default: []].append(point)
        }
        return buckets
            .map { (day: $0.key, points: $0.value.sorted { $0.time < $1.time }) }
            .sorted { $0.day > $1.day }
    }

    /// 走过的格子数（200 米一格），用来算「探索了多少块地方」
    public var exploredCellCount: Int {
        lock.lock()
        let snapshot = points
        lock.unlock()
        var cells = Set<String>()
        for point in snapshot {
            cells.insert(Self.cellKey(point.coordinate))
        }
        return cells.count
    }

    /// 走过的天的数量
    public var walkedDayCount: Int {
        lock.lock()
        let snapshot = points
        lock.unlock()
        return Set(snapshot.map { Calendar.current.startOfDay(for: $0.time) }).count
    }

    /// 轨迹总长度（米）
    public var totalMeters: Double {
        lock.lock()
        let snapshot = points
        lock.unlock()
        guard snapshot.count > 1 else { return 0 }
        var total: Double = 0
        for i in 1..<snapshot.count {
            let gap = GeoMath.distance(from: snapshot[i-1].coordinate, to: snapshot[i].coordinate)
            // 断开超过 3 公里视为「换了地点」，不计入里程（否则开车里程会被算进散步）
            if gap < 3_000 { total += gap }
        }
        return total
    }

    public var isEmpty: Bool {
        lock.lock()
        defer { lock.unlock() }
        return points.isEmpty
    }

    /// 包围盒（画布归一化用）；没有轨迹返回 nil
    public func boundingBox() -> (minLat: Double, maxLat: Double, minLon: Double, maxLon: Double)? {
        lock.lock()
        let snapshot = points
        lock.unlock()
        guard let first = snapshot.first else { return nil }
        var minLat = first.latitude, maxLat = first.latitude
        var minLon = first.longitude, maxLon = first.longitude
        for point in snapshot {
            minLat = min(minLat, point.latitude)
            maxLat = max(maxLat, point.latitude)
            minLon = min(minLon, point.longitude)
            maxLon = max(maxLon, point.longitude)
        }
        return (minLat, maxLat, minLon, maxLon)
    }

    static func cellKey(_ point: GeoPoint) -> String {
        let latStep = cellMeters / 110_540.0
        let lonStep = cellMeters / (111_320.0 * max(0.2, cos(point.latitude * .pi / 180)))
        return "\(Int((point.latitude / latStep).rounded(.down)))_\(Int((point.longitude / lonStep).rounded(.down)))"
    }

    // MARK: 落盘

    private func persistLocked() {
        guard let data = try? JSONEncoder().encode(points) else { return }
        defaults.set(data, forKey: Self.key)
    }

    private func load() {
        guard let data = defaults.data(forKey: Self.key),
              let list = try? JSONDecoder().decode([WalkPoint].self, from: data) else { return }
        points = list
    }

    /// 超过上限：按天均匀抽样，保留每天首尾（否则地图上的线会断成一截一截）
    private func compressLocked() {
        let calendar = Calendar.current
        var byDay: [Date: [WalkPoint]] = [:]
        for point in points {
            byDay[calendar.startOfDay(for: point.time), default: []].append(point)
        }
        let keepPerDay = max(40, Self.maxPoints / max(1, byDay.count))
        var kept: [WalkPoint] = []
        for (_, list) in byDay {
            if list.count <= keepPerDay {
                kept.append(contentsOf: list)
                continue
            }
            let stride = Double(list.count) / Double(keepPerDay)
            for i in 0..<keepPerDay {
                let index = min(list.count - 1, Int(Double(i) * stride))
                kept.append(list[index])
            }
            if let last = list.last, kept.last != last { kept.append(last) }
        }
        points = kept.sorted { $0.time < $1.time }
    }
}
