import Foundation

// MARK: - 迷雾路径几何（三端统一 docs/parity.md §3 / docs/navigation.md §3.6）
//
// 输入：Valhalla 步行路线折线 + 当前定位
// 输出：heading-up 画布坐标系里的线段 / 箭头 / 你 / 偏离量
//
// 保密约束：窗口长度永远小于「剩余里程」，最后 60 米整段隐藏；
// 绝不输出终点、街道名。

public struct WalkingRoute: Hashable, Sendable {
    public let points: [GeoPoint]
    public let distanceMeters: Double
    public let cumulative: [Double]

    public init(points: [GeoPoint]) {
        self.points = points
        var cumulative: [Double] = [0]
        if points.count > 1 {
            for index in 0..<(points.count - 1) {
                cumulative.append(cumulative[index] + GeoMath.distance(from: points[index], to: points[index + 1]))
            }
        }
        self.cumulative = cumulative
        self.distanceMeters = cumulative.last ?? 0
    }
}

public struct RouteProgress: Hashable, Sendable {
    public let walked: Double
    public let remaining: Double
    public let snapped: GeoPoint
    /// 路线在 snap 处的行进方位角（heading-up 的「上」）
    public let bearing: Double
    /// 当前位置相对路线的有符号横向偏移（米，左正右负）
    public let lateral: Double
}

public enum RouteMath {

    public static func point(atAlong s: Double, route: WalkingRoute) -> GeoPoint {
        guard let first = route.points.first else {
            return GeoPoint(latitude: 0, longitude: 0)
        }
        if s <= 0 { return first }
        let points = route.points
        let cumulative = route.cumulative
        for index in 0..<max(0, points.count - 1) {
            if s <= cumulative[index + 1] {
                let segment = cumulative[index + 1] - cumulative[index]
                let t = segment > 0 ? (s - cumulative[index]) / segment : 0
                return GeoPoint(
                    latitude: points[index].latitude + (points[index + 1].latitude - points[index].latitude) * t,
                    longitude: points[index].longitude + (points[index + 1].longitude - points[index].longitude) * t
                )
            }
        }
        return points[points.count - 1]
    }

    /// 把当前位置投影到路线折线上（本地等距投影，步行尺度精度足够）
    public static func progress(route: WalkingRoute, here: GeoPoint) -> RouteProgress {
        guard let first = route.points.first else {
            return RouteProgress(walked: 0, remaining: 0, snapped: here, bearing: 0, lateral: 0)
        }
        if route.points.count == 1 {
            return RouteProgress(
                walked: 0,
                remaining: 0,
                snapped: first,
                bearing: GeoMath.bearing(from: first, to: here),
                lateral: GeoMath.distance(from: first, to: here)
            )
        }

        var best: (segmentIndex: Int, along: Double, lateral: Double, distance: Double) = (0, 0, 0, .greatestFiniteMagnitude)
        for index in 0..<(route.points.count - 1) {
            let start = route.points[index]
            let end = route.points[index + 1]
            let kx = cos(start.latitude * .pi / 180) * 111_320.0
            let ky = 110_540.0
            let ax = (end.longitude - start.longitude) * kx
            let ay = (end.latitude - start.latitude) * ky
            let bx = (here.longitude - start.longitude) * kx
            let by = (here.latitude - start.latitude) * ky
            let lengthSquared = ax * ax + ay * ay
            guard lengthSquared > 0 else { continue }
            var t = (bx * ax + by * ay) / lengthSquared
            t = max(0, min(1, t))
            let px = ax * t
            let py = ay * t
            let distance = hypot(bx - px, by - py)
            if distance < best.distance {
                let along = route.cumulative[index] + t * (route.cumulative[index + 1] - route.cumulative[index])
                let cross = ax * by - ay * bx
                let lateral = (cross >= 0 ? 1 : -1) * distance
                best = (index, along, lateral, distance)
            }
        }

        let segment = route.points[best.segmentIndex]
        let next = route.points[best.segmentIndex + 1]
        let bearing = GeoMath.bearing(from: segment, to: next)
        let snapped = point(atAlong: best.along, route: route)
        let remaining = max(0, route.distanceMeters - best.along)
        return RouteProgress(
            walked: best.along,
            remaining: remaining,
            snapped: snapped,
            bearing: bearing,
            lateral: best.lateral
        )
    }
}

// MARK: - 迷雾窗口

public struct FogSegment: Hashable, Sendable {
    public let along: Double
    public let lateral: Double
    public let opacity: Double
    public let isBehind: Bool
}

public struct FogChevron: Hashable, Sendable {
    public let along: Double
    public let lateral: Double
    public let opacity: Double
}

public struct FogFrame: Hashable, Sendable {
    public static let aheadMeters: Double = 260
    public static let behindMeters: Double = 140
    public static let fadeMeters: Double = 46
    public static let chevronSpacing: Double = 55
    public static let hideBelowMeters: Double = 60
    public static let deviationMeters: Double = 18

    public let ahead: Double
    public let behind: Double
    public let bearing: Double
    public let walked: Double
    public let routeRemaining: Double
    public let userLateral: Double
    public let segments: [FogSegment]
    public let chevrons: [FogChevron]
    public let isHidden: Bool

    /// 剩余 < 60m 时返回 isHidden=true 的空 frame（只显示「就在附近」），不画任何路径
    public static func make(route: WalkingRoute, here: GeoPoint) -> FogFrame? {
        guard route.points.count >= 2 else { return nil }
        let progress = RouteMath.progress(route: route, here: here)
        if progress.remaining < hideBelowMeters || progress.remaining <= 25 {
            return FogFrame(
                ahead: 0, behind: 0, bearing: progress.bearing, walked: progress.walked,
                routeRemaining: progress.remaining, userLateral: 0,
                segments: [], chevrons: [], isHidden: true
            )
        }

        let ahead = max(0, min(aheadMeters, progress.remaining - 25))
        let behind = max(0, min(behindMeters, progress.walked - 5))
        if ahead <= 0 {
            return FogFrame(
                ahead: 0, behind: 0, bearing: progress.bearing, walked: progress.walked,
                routeRemaining: progress.remaining, userLateral: 0,
                segments: [], chevrons: [], isHidden: true
            )
        }

        let start = max(0, progress.walked - behind)
        let end = min(route.distanceMeters, progress.walked + ahead)
        let radians = progress.bearing * .pi / 180
        let sinB = sin(radians)
        let cosB = cos(radians)
        let kx = cos(progress.snapped.latitude * .pi / 180) * 111_320.0
        let ky = 110_540.0

        func local(_ point: GeoPoint) -> (along: Double, lateral: Double) {
            let east = (point.longitude - progress.snapped.longitude) * kx
            let north = (point.latitude - progress.snapped.latitude) * ky
            return (east * sinB + north * cosB, east * cosB - north * sinB)
        }

        var segments: [FogSegment] = []
        var s = start
        while s <= end + 0.001 {
            let routePoint = RouteMath.point(atAlong: s, route: route)
            let coord = local(routePoint)
            let edgeDistance = min(s - start, end - s)
            let opacity = min(1, max(0, edgeDistance / fadeMeters))
            if opacity > 0.02 {
                segments.append(FogSegment(
                    along: coord.along,
                    lateral: coord.lateral,
                    opacity: opacity,
                    isBehind: s < progress.walked
                ))
            }
            s += 3
        }

        var chevrons: [FogChevron] = []
        var offset = 40.0
        while offset <= ahead - 10 {
            let routePoint = RouteMath.point(atAlong: progress.walked + offset, route: route)
            let coord = local(routePoint)
            let opacity = min(1, max(0, (ahead - offset) / fadeMeters))
            chevrons.append(FogChevron(along: coord.along, lateral: coord.lateral, opacity: opacity))
            offset += chevronSpacing
        }

        let user = local(here)
        return FogFrame(
            ahead: ahead,
            behind: behind,
            bearing: progress.bearing,
            walked: progress.walked,
            routeRemaining: progress.remaining,
            userLateral: user.lateral,
            segments: segments,
            chevrons: chevrons,
            isHidden: false
        )
    }
}
