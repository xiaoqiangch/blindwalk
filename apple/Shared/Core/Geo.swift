import Foundation

/// 真实地理坐标（与归一化 `MapPoint` 区分：这个是真实经纬度，那个只用于抽象地图绘制）
public struct GeoPoint: Codable, Hashable, Sendable {
    public var latitude: Double
    public var longitude: Double

    public init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }
}

/// 地理计算：距离、方位角、按方位偏移一个点。
///
/// 为什么需要：产品不接真实 POI 库，所以“目的地”不是固定地点，
/// 而是**从你当前位置出发、按盲盒抽出的距离和方向算出来的一个真实坐标**。
/// 这样在任何城市打开都能走，且天然保密（你不知道那个方向有什么）。
public enum GeoMath {

    public static let earthRadius = 6_371_000.0

    /// 两点间距离（米），Haversine 公式
    public static func distance(from origin: GeoPoint, to target: GeoPoint) -> Double {
        let lat1 = origin.latitude * .pi / 180
        let lat2 = target.latitude * .pi / 180
        let dLat = (target.latitude - origin.latitude) * .pi / 180
        let dLon = (target.longitude - origin.longitude) * .pi / 180
        let a = sin(dLat / 2) * sin(dLat / 2)
            + cos(lat1) * cos(lat2) * sin(dLon / 2) * sin(dLon / 2)
        let c = 2 * atan2(sqrt(a), sqrt(max(0, 1 - a)))
        return earthRadius * c
    }

    /// 从 origin 指向 target 的方位角（度）。0 = 正北，90 = 正东，逆时针为负。
    public static func bearing(from origin: GeoPoint, to target: GeoPoint) -> Double {
        let lat1 = origin.latitude * .pi / 180
        let lat2 = target.latitude * .pi / 180
        let dLon = (target.longitude - origin.longitude) * .pi / 180
        let y = sin(dLon) * cos(lat2)
        let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon)
        let degrees = atan2(y, x) * 180 / .pi
        return (degrees + 360).truncatingRemainder(dividingBy: 360)
    }

    /// 从 origin 出发、沿 bearing 走 meters 米后的坐标
    public static func offset(from origin: GeoPoint, meters: Double, bearingDegrees: Double) -> GeoPoint {
        let angular = meters / earthRadius
        let bearing = bearingDegrees * .pi / 180
        let lat1 = origin.latitude * .pi / 180
        let lon1 = origin.longitude * .pi / 180

        let lat2 = asin(sin(lat1) * cos(angular) + cos(lat1) * sin(angular) * cos(bearing))
        let lon2 = lon1 + atan2(
            sin(bearing) * sin(angular) * cos(lat1),
            cos(angular) - sin(lat1) * sin(lat2)
        )
        return GeoPoint(latitude: lat2 * 180 / .pi, longitude: lon2 * 180 / .pi)
    }

    /// 方位角 → 八方向文字（用于「往北走」这类文案）
    public static func compassLabel(_ degrees: Double) -> String {
        let normalized = (degrees + 360).truncatingRemainder(dividingBy: 360)
        switch normalized {
        case 337.5..., 0..<22.5: return "北"
        case 22.5..<67.5: return "东北"
        case 67.5..<112.5: return "东"
        case 112.5..<157.5: return "东南"
        case 157.5..<202.5: return "南"
        case 202.5..<247.5: return "西南"
        case 247.5..<292.5: return "西"
        default: return "西北"
        }
    }

    /// 方位角 → 箭头（相对「手机朝向」的旋转由 UI 处理；这里给绝对值兜底）
    public static func arrow(_ degrees: Double) -> String {
        let normalized = (degrees + 360).truncatingRemainder(dividingBy: 360)
        switch normalized {
        case 337.5..., 0..<22.5: return "↑"
        case 22.5..<67.5: return "↗"
        case 67.5..<112.5: return "→"
        case 112.5..<157.5: return "↘"
        case 157.5..<202.5: return "↓"
        case 202.5..<247.5: return "↙"
        case 247.5..<292.5: return "←"
        default: return "↖"
        }
    }
}

/// 抽盒时给目标分配的「真实坐标 + 行走参数」
public struct GeoQuestPlan: Hashable, Sendable {
    public let origin: GeoPoint
    public let target: GeoPoint
    public let startBearing: Double
    public let startMeters: Int

    public init(origin: GeoPoint, target: GeoPoint, startBearing: Double, startMeters: Int) {
        self.origin = origin
        self.target = target
        self.startBearing = startBearing
        self.startMeters = startMeters
    }
}
