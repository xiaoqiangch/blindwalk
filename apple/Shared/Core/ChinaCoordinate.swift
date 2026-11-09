import Foundation

/// 中国坐标系转换（WGS-84 / GCJ-02 / BD-09）。
///
/// 高德周边搜索的入参和返回值都是 GCJ-02，百度是 BD-09；
/// 本 App 内部（定位、距离、到达判定、迷雾路径）统一用 WGS-84。
/// 不转换会整体偏移 300~500 米，30 米到达判定直接失效。
public enum ChinaCoordinate {

    private static let a = 6_378_245.0
    private static let ee = 0.006_693_421_622_965_943

    public static func isOutOfChina(lat: Double, lon: Double) -> Bool {
        lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271
    }

    private static func transformLat(_ x: Double, _ y: Double) -> Double {
        var ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * sqrt(abs(x))
        ret += (20.0 * sin(6.0 * x * .pi) + 20.0 * sin(2.0 * x * .pi)) * 2.0 / 3.0
        ret += (20.0 * sin(y * .pi) + 40.0 * sin(y / 3.0 * .pi)) * 2.0 / 3.0
        ret += (160.0 * sin(y / 12.0 * .pi) + 320 * sin(y * .pi / 30.0)) * 2.0 / 3.0
        return ret
    }

    private static func transformLon(_ x: Double, _ y: Double) -> Double {
        var ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * sqrt(abs(x))
        ret += (20.0 * sin(6.0 * x * .pi) + 20.0 * sin(2.0 * x * .pi)) * 2.0 / 3.0
        ret += (20.0 * sin(x * .pi) + 40.0 * sin(x / 3.0 * .pi)) * 2.0 / 3.0
        ret += (150.0 * sin(x / 12.0 * .pi) + 300.0 * sin(x / 30.0 * .pi)) * 2.0 / 3.0
        return ret
    }

    public static func wgs84ToGcj02(_ point: GeoPoint) -> GeoPoint {
        if isOutOfChina(lat: point.latitude, lon: point.longitude) { return point }
        let lat = point.latitude
        let lon = point.longitude
        var dLat = transformLat(lon - 105.0, lat - 35.0)
        var dLon = transformLon(lon - 105.0, lat - 35.0)
        let radLat = lat / 180.0 * .pi
        var magic = sin(radLat)
        magic = 1 - ee * magic * magic
        let sqrtMagic = sqrt(magic)
        dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * .pi)
        dLon = (dLon * 180.0) / (a / sqrtMagic * cos(radLat) * .pi)
        return GeoPoint(latitude: lat + dLat, longitude: lon + dLon)
    }

    public static func gcj02ToWgs84(_ point: GeoPoint) -> GeoPoint {
        if isOutOfChina(lat: point.latitude, lon: point.longitude) { return point }
        var wgsLat = point.latitude
        var wgsLon = point.longitude
        for _ in 0..<3 {
            let forward = wgs84ToGcj02(GeoPoint(latitude: wgsLat, longitude: wgsLon))
            wgsLat += point.latitude - forward.latitude
            wgsLon += point.longitude - forward.longitude
        }
        return GeoPoint(latitude: wgsLat, longitude: wgsLon)
    }

    public static func gcj02ToBd09(_ point: GeoPoint) -> GeoPoint {
        let x = point.longitude
        let y = point.latitude
        let z = sqrt(x * x + y * y) + 0.00002 * sin(y * .pi * 3000.0 / 180.0)
        let theta = atan2(y, x) + 0.000003 * cos(x * .pi * 3000.0 / 180.0)
        return GeoPoint(latitude: z * sin(theta) + 0.006, longitude: z * cos(theta) + 0.0065)
    }

    public static func bd09ToGcj02(_ point: GeoPoint) -> GeoPoint {
        let x = point.longitude - 0.0065
        let y = point.latitude - 0.006
        let z = sqrt(x * x + y * y) - 0.00002 * sin(y * .pi * 3000.0 / 180.0)
        let theta = atan2(y, x) - 0.000003 * cos(x * .pi * 3000.0 / 180.0)
        return GeoPoint(latitude: z * sin(theta), longitude: z * cos(theta))
    }

    public static func wgs84ToBd09(_ point: GeoPoint) -> GeoPoint {
        gcj02ToBd09(wgs84ToGcj02(point))
    }

    public static func bd09ToWgs84(_ point: GeoPoint) -> GeoPoint {
        let gcj = bd09ToGcj02(point)
        return gcj02ToWgs84(gcj)
    }
}
