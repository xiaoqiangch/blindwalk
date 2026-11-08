import Foundation
import CoreLocation

// MARK: - 定位权限

/// 简化后的定位权限三态（不把 CoreLocation 类型暴露给 SwiftUI 视图）。
enum LocationAuthorization: String {
    case notDetermined
    case denied
    case restricted
    case authorized

    var label: String {
        switch self {
        case .notDetermined:
            return "未询问"
        case .denied:
            return "已拒绝"
        case .restricted:
            return "受限制"
        case .authorized:
            return "已允许"
        }
    }

    var isAllowed: Bool {
        self == .authorized
    }
}

// MARK: - 定位抽象

/// 与 docs/architecture.md §2 的 `LocationProviding` 对齐：
/// - `remainingMeters`：距离目的地的剩余米数（nil = 还没拿到定位）
/// - `bearingDegrees`：指向目的地的方位角（0 = 正北，顺时针 0…360）
/// - `authorization`：当前定位权限
///
/// 演示默认用 `SimulatedLocationService`；真实步行切 `LiveLocationService`。
protocol LocationProviding: AnyObject {
    var remainingMeters: Int? { get }
    var bearingDegrees: Double? { get }
    var authorization: LocationAuthorization { get }
    var isSimulated: Bool { get }
    var statusText: String { get }

    /// 开始监听（真实实现会顺带请求权限）
    func start()
    /// 停止监听
    func stop()
    /// 演示专用：手动推进米数；真实实现返回 nil（不接受手动推进）
    @discardableResult
    func simulateAdvance(meters: Int) -> Int?
}

// MARK: - 演示实现（默认）

/// 模拟步行：不访问真实定位，配合 `BlindWalkStore.advance(byMeters:)` 演示整条链路。
///
/// 演示流程里 JourneyView 每按一次「模拟步行 +50m」会：
/// 1. `store.advance(byMeters: 50)` 推进业务状态（解锁线索 / 到达）
/// 2. `simulated.simulateAdvance(meters: 50)` 推进定位服务
/// 3. 用 `sync(remaining:)` 把 store 的剩余距离同步过来，保证两者一致
///
/// 换成 LiveLocationService 时，第 1 步由真实定位回调驱动（见 LiveLocationService 注释）。
final class SimulatedLocationService: LocationProviding {

    private(set) var remainingMeters: Int?
    private(set) var authorization: LocationAuthorization = .authorized
    let isSimulated = true

    init(startMeters: Int? = nil) {
        self.remainingMeters = startMeters
    }

    /// 演示用的方位：与 QuestSession.bearing 的箭头分段保持一致
    var bearingDegrees: Double? {
        guard let remaining = remainingMeters else { return nil }
        switch remaining {
        case 361...:
            return 315 // ↖
        case 241...360:
            return 0 // ↑
        case 121...240:
            return 45 // ↗
        default:
            return 90 // →
        }
    }

    var statusText: String {
        "演示模式 · 模拟步行，不读取真实定位"
    }

    func start() {}
    func stop() {}

    /// 用 store 推进后的剩余距离同步一次
    func sync(remaining: Int?) {
        remainingMeters = remaining
    }

    @discardableResult
    func simulateAdvance(meters: Int) -> Int? {
        guard let current = remainingMeters else { return nil }
        let next = max(0, current - abs(meters))
        remainingMeters = next
        return next
    }
}

// MARK: - 真实定位（CoreLocation 骨架）

/// CoreLocation 骨架实现。真正接入时按下面四步走：
///
/// 1. `start()` 请求 WhenInUse 权限并开始更新位置；
/// 2. 目的地真实经纬度由「抽盒结果 + 后端」注入 `targetCoordinate`
///    （MVP 地点库只有归一化抽象坐标，没有真实 POI，所以这里先留空）；
/// 3. 每次 `didUpdateLocations` 回调计算 `remainingMeters` / `bearingDegrees`，
///    UI 根据剩余距离调用 `store.advance(byMeters:)`（或直接 `store.arriveNow()`）；
/// 4. Info.plist 的权限文案已在 `apple/project.yml` 配好：
///    `NSLocationWhenInUseUsageDescription` + `UIBackgroundModes: location`。
///
/// 注意：本机无 Xcode / iOS SDK，未编译验证；API 均为 iOS 14+ 常见写法。
final class LiveLocationService: NSObject, LocationProviding, CLLocationManagerDelegate {

    /// 目的地真实坐标。真实版本从抽盒结果注入。
    var targetCoordinate: CLLocationCoordinate2D?

    private let manager = CLLocationManager()
    private(set) var lastLocation: CLLocation?

    private(set) var remainingMeters: Int?
    private(set) var bearingDegrees: Double?
    private(set) var authorization: LocationAuthorization = .notDetermined

    let isSimulated = false

    var statusText: String {
        "实时定位 · \(authorization.label)"
    }

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = 5
    }

    func start() {
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
        }
        manager.startUpdatingLocation()
    }

    func stop() {
        manager.stopUpdatingLocation()
    }

    @discardableResult
    func simulateAdvance(meters: Int) -> Int? {
        // 真实定位不接受手动推进
        nil
    }

    // MARK: CLLocationManagerDelegate

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorization = Self.mapAuthorization(manager.authorizationStatus)
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let latest = locations.last else { return }
        lastLocation = latest
        guard let target = targetCoordinate else { return }
        let targetLocation = CLLocation(latitude: target.latitude, longitude: target.longitude)
        remainingMeters = Int(latest.distance(from: targetLocation).rounded())
        bearingDegrees = Self.bearing(from: latest.coordinate, to: target)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // 保持上一次的距离值；真实版本可在这里把状态显示成「定位信号弱」。
        print("[BlindWalk] 定位失败：\(error.localizedDescription)")
    }

    // MARK: Helpers

    private static func mapAuthorization(_ status: CLAuthorizationStatus) -> LocationAuthorization {
        switch status {
        case .authorizedAlways, .authorizedWhenInUse:
            return .authorized
        case .denied:
            return .denied
        case .restricted:
            return .restricted
        case .notDetermined:
            return .notDetermined
        @unknown default:
            return .notDetermined
        }
    }

    /// 方位角：0 = 正北，顺时针
    private static func bearing(from: CLLocationCoordinate2D, to: CLLocationCoordinate2D) -> Double {
        let lat1 = from.latitude * Double.pi / 180
        let lat2 = to.latitude * Double.pi / 180
        let deltaLon = (to.longitude - from.longitude) * Double.pi / 180
        let y = sin(deltaLon) * cos(lat2)
        let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(deltaLon)
        let degrees = atan2(y, x) * 180 / Double.pi
        return (degrees + 360).truncatingRemainder(dividingBy: 360)
    }
}
