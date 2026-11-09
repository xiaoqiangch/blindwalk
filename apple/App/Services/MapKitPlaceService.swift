import Foundation
import MapKit
import CoreLocation

/// MapKit 真实 POI 服务：把「附近真实存在的地点」变成盲盒候选。
///
/// 设计（docs/real-geo.md）：
/// - 多组中文 query 并发搜索，覆盖咖啡/书店/公园/长椅/桥/便利店/观景等类别
/// - 只收 `pointOfInterest` 类型，排除住宅/公司
/// - 24 小时内存缓存（按 0.01° 网格），减少重复请求
/// - 3 秒超时：超时就返回空，由调用方降级到内置地点（不能卡住用户）
/// - 目的地名称**不**参与线索生成（由 RealPlaceFactory 统一处理）
@MainActor
public final class MapKitPlaceService {

    public static let shared = MapKitPlaceService()

    /// 搜索半径（米）→ MKCoordinateRegion 的 span
    private let cacheTTL: TimeInterval = 24 * 3600
    private var cache: [String: (date: Date, poi: [POICandidate])] = [:]

    private init() {}

    /// 查询附近真实地点
    /// - Parameters:
    ///   - origin: 用户当前位置
    ///   - radiusMeters: 搜索半径（米）
    ///   - moods: 心情（决定查询词偏重）
    public func nearbyPlaces(
        around origin: GeoPoint,
        radiusMeters: Int,
        moods: Set<Mood>
    ) async -> [POICandidate] {
        let key = gridKey(origin)
        if let entry = cache[key], Date().timeIntervalSince(entry.date) < cacheTTL {
            return entry.poi
        }

        let queries = Self.queries(for: moods)
        let region = MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: origin.latitude, longitude: origin.longitude),
            latitudinalMeters: Double(radiusMeters) * 2.0,
            longitudinalMeters: Double(radiusMeters) * 2.0
        )

        // 并发搜索，整体最多 3 秒
        let results = await withTaskGroup(of: [POICandidate].self) { group in
            for query in queries {
                group.addTask { [region] in
                    await Self.search(query: query, region: region)
                }
            }
            var all: [POICandidate] = []
            let deadline = Date().addingTimeInterval(3.0)
            for await list in group {
                all.append(contentsOf: list)
                if Date() > deadline { break }
            }
            return all
        }

        // 去重 + 按距离过滤
        var seen: Set<String> = []
        var unique: [POICandidate] = []
        for poi in results where !seen.contains(poi.id) {
            seen.insert(poi.id)
            let d = GeoMath.distance(from: origin, to: poi.coordinate)
            guard d >= 30, d <= Double(radiusMeters) * 2.2 else { continue }
            unique.append(poi)
        }

        cache[key] = (Date(), unique)
        return unique
    }

    /// 反向地理编码：坐标 → 「区 · 街道」中文名（失败返回 nil，不影响主流程）
    public func areaLabel(for origin: GeoPoint) async -> String? {
        let location = CLLocation(latitude: origin.latitude, longitude: origin.longitude)
        let geocoder = CLGeocoder()
        do {
            let placemarks = try await geocoder.reverseGeocodeLocation(location, preferredLocale: Locale(identifier: "zh_CN"))
            guard let p = placemarks.first else { return nil }
            let district = p.subLocality ?? p.locality ?? p.administrativeArea ?? ""
            let street = p.thoroughfare ?? ""
            let joined = [district, street].filter { !$0.isEmpty }.joined(separator: " · ")
            return joined.isEmpty ? nil : joined
        } catch {
            return nil
        }
    }

    // MARK: - 内部

    private static func queries(for moods: Set<Mood>) -> [String] {
        var base = ["咖啡", "书店", "公园", "长椅", "便利店", "广场"]
        if moods.contains(.discover) {
            base += ["美术馆", "桥", "观景台", "古建筑"]
        }
        if moods.contains(.drift) {
            base += ["河边", "花园", "图书馆"]
        }
        if moods.contains(.lively) {
            base += ["市集", "商场", "面包店"]
        }
        return base
    }

    private static func search(query: String, region: MKCoordinateRegion) async -> [POICandidate] {
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = query
        request.region = region
        request.resultTypes = [.pointOfInterest]

        let search = MKLocalSearch(request: request)
        do {
            let response = try await search.start()
            return response.mapItems.compactMap { item -> POICandidate? in
                guard let name = item.name, !name.isEmpty else { return nil }
                let coord = item.placemark.coordinate
                // 排除没有坐标的异常结果
                guard CLLocationCoordinate2DIsValid(coord), coord.latitude != 0 || coord.longitude != 0 else { return nil }
                let category = Self.category(for: item)
                let address = [item.placemark.subLocality, item.placemark.thoroughfare]
                    .compactMap { $0 }
                    .filter { !$0.isEmpty }
                    .joined(separator: " · ")
                return POICandidate(
                    id: "apple-\(Self.stableID(item))",
                    name: name,
                    coordinate: GeoPoint(latitude: coord.latitude, longitude: coord.longitude),
                    address: address.isEmpty ? nil : address,
                    category: category,
                    source: "apple"
                )
            }
        } catch {
            return []
        }
    }

    private static func category(for item: MKMapItem) -> RealPlaceCategory {
        if let poi = item.pointOfInterestCategory {
            switch poi {
            case .cafe, .bakery: return .cafe
            case .library: return .library
            case .park, .nationalPark: return .park
            case .museum: return .art
            case .store, .foodMarket: return .convenience
            case .restaurant: return .market
            default: break
            }
        }
        // 名称兜底映射（国内 POI 分类有时为空）
        let name = item.name ?? ""
        if name.contains("咖啡") || name.lowercased().contains("cafe") { return .cafe }
        if name.contains("书店") { return .bookstore }
        if name.contains("图书") { return .library }
        if name.contains("公园") { return .park }
        if name.contains("桥") { return .bridge }
        if name.contains("广场") { return .plaza }
        if name.contains("花") { return .garden }
        if name.contains("便利") { return .convenience }
        if name.contains("市集") || name.contains("市场") { return .market }
        if name.contains("寺") || name.contains("庙") || name.contains("教堂") || name.contains("故居") { return .temple }
        if name.contains("观景") || name.contains("塔") || name.contains("天台") { return .viewpoint }
        if name.contains("河") || name.contains("江") || name.contains("湖") { return .river }
        return .plaza
    }

    private static func stableID(_ item: MKMapItem) -> String {
        let coord = item.placemark.coordinate
        let lat = String(format: "%.5f", coord.latitude)
        let lon = String(format: "%.5f", coord.longitude)
        return "\(lat)_\(lon)"
    }

    private func gridKey(_ p: GeoPoint) -> String {
        let lat = (p.latitude / 0.01).rounded() * 0.01
        let lon = (p.longitude / 0.01).rounded() * 0.01
        return String(format: "%.2f,%.2f", lat, lon)
    }
}
