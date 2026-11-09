import Foundation

// MARK: - 步行路线（Valhalla 公共实例）——迷雾路径的形状来源
//
// docs/navigation.md：公开、无需 Key、CORS 全开。
// iOS 原生不存在 CORS，直接 URLSession POST。
// 路线只用于画「当前位置前后一段」，绝不画终点、不画街道名。

@MainActor
final class RouteService {

    static let shared = RouteService()

    private struct CacheEntry {
        let route: WalkingRoute
        let date: Date
    }

    private var cache: [String: CacheEntry] = [:]
    private let cacheTTL: TimeInterval = 10 * 60

    private init() {}

    func walkingRoute(from origin: GeoPoint, to target: GeoPoint) async -> WalkingRoute? {
        let key = String(
            format: "%.4f,%.4f->%.4f,%.4f",
            origin.latitude, origin.longitude,
            target.latitude, target.longitude
        )
        if let entry = cache[key], Date().timeIntervalSince(entry.date) < cacheTTL {
            return entry.route
        }

        guard let url = URL(string: "https://valhalla1.openstreetmap.de/route") else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 8
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "locations": [
                ["lat": origin.latitude, "lon": origin.longitude],
                ["lat": target.latitude, "lon": target.longitude]
            ],
            "costing": "pedestrian",
            "directions_options": ["language": "zh-CN"]
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
            guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let trip = root["trip"] as? [String: Any],
                  let legs = trip["legs"] as? [[String: Any]],
                  let shape = legs.first?["shape"] as? String else { return nil }
            let coordinates = Self.decodePolyline6(shape)
            guard coordinates.count >= 2 else { return nil }
            let route = WalkingRoute(points: coordinates)
            guard route.distanceMeters > 0 else { return nil }
            cache[key] = CacheEntry(route: route, date: Date())
            return route
        } catch {
            return nil
        }
    }

    /// Valhalla 的 shape 是 polyline6（精度 1e-6）
    private static func decodePolyline6(_ encoded: String) -> [GeoPoint] {
        var coordinates: [GeoPoint] = []
        var index = encoded.startIndex
        var latitude = 0
        var longitude = 0

        func nextValue() -> Int? {
            var result = 0
            var shift = 0
            while index < encoded.endIndex {
                let byte = Int(encoded[index].asciiValue ?? 63) - 63
                index = encoded.index(after: index)
                result |= (byte & 0x1f) << shift
                shift += 5
                if byte < 0x20 { break }
            }
            guard shift > 0 else { return nil }
            return (result & 1) != 0 ? ~(result >> 1) : (result >> 1)
        }

        while index < encoded.endIndex {
            guard let dLat = nextValue(), let dLon = nextValue() else { break }
            latitude += dLat
            longitude += dLon
            coordinates.append(GeoPoint(
                latitude: Double(latitude) / 1_000_000,
                longitude: Double(longitude) / 1_000_000
            ))
        }
        return coordinates
    }
}
