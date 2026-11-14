import Foundation
import CoreLocation

// MARK: - 定位权限

/// 简化后的定位权限四态（不把 CoreLocation 类型暴露给 SwiftUI 视图）。
enum LocationAuthorization: String, Equatable {
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

    /// 系统层面已经不给定位了，只能去「设置」里改
    var isBlocked: Bool {
        self == .denied || self == .restricted
    }
}

// MARK: - 定位读数

/// 一次定位读数（真实 GPS / 演示模式共用同一种结构，View 只认它）。
///
/// 注意：`remainingMeters` / `bearingDegrees` 只有在「拿到真实目的地坐标」时才有值；
/// `origin` 始终会给（真实定位一直能拿到自己的坐标），JourneyView 用它补目的地坐标。
struct LocationReading: Equatable {
    var timestamp: Date = Date()
    /// 当前真实坐标（演示模式为 nil）
    var origin: GeoPoint?
    /// 到目的地的剩余距离（米）
    var remainingMeters: Double?
    /// 指向目的地的绝对方位角（度，0 = 正北）
    var bearingDegrees: Double?
    /// 手机朝向（度，0 = 正北）；只有真机才有
    var headingDegrees: Double?
    /// 朝向精度（度，越小越准；负数 = 无效，需要用户做 8 字校准）
    var headingAccuracy: Double?
    /// 水平精度（米，越小越好；负数表示无效）
    var horizontalAccuracy: Double?
}

// MARK: - 定位抽象

/// 与 docs/architecture.md §2 的 `LocationProviding` 对齐：
/// - `remainingMeters`：距离目的地的剩余米数（nil = 还没拿到定位）
/// - `bearingDegrees`：指向目的地的方位角（0 = 正北，顺时针 0…360）
/// - `headingDegrees`：手机朝向（真机才有，用于把箭头转成「相对你」的方向）
/// - `authorizationStatus`：当前定位权限
///
/// 演示默认用 `SimulatedLocationService`；真实步行用 `LiveLocationService`。
protocol LocationProviding: AnyObject {
    var remainingMeters: Int? { get }
    var bearingDegrees: Double? { get }
    var headingDegrees: Double? { get }
    var authorizationStatus: LocationAuthorization { get }
    var isSimulated: Bool { get }
    var statusText: String { get }

    /// 每次定位/朝向变化都会回调，View 据此刷新界面
    var onUpdate: ((LocationReading) -> Void)? { get set }
    /// 权限变化回调（首次授权 / 被拒绝 / 从设置返回）
    var onAuthorizationChange: ((LocationAuthorization) -> Void)? { get set }

    /// 开始监听（真实实现会顺带请求权限）
    func start()
    /// 停止监听
    func stop()
    /// 演示专用：手动推进米数；真实实现返回 nil（不接受手动推进）
    @discardableResult
    func simulateAdvance(meters: Int) -> Int?
}

extension LocationProviding {
    /// 兼容旧命名
    var authorization: LocationAuthorization { authorizationStatus }
}

// MARK: - 演示实现（兜底）

/// 模拟步行：不访问真实定位，配合 `WalkaholicStore.advance(byMeters:)` 演示整条链路。
///
/// 演示流程里 JourneyView 每按一次「模拟步行 +50m」会：
/// 1. `store.advance(byMeters: 50)` 推进业务状态（解锁线索 / 到达）
/// 2. `simulateAdvance(meters: 50)` 推进定位服务
/// 3. 用 `sync(remaining:)` 把 store 的剩余距离同步过来，保证两者一致
///
/// 真实定位不可用（没授权 / 模拟器没信号 / 用户主动切演示）时走这里，保证能走通。
final class SimulatedLocationService: LocationProviding {

    private(set) var remainingMeters: Int?
    private(set) var authorizationStatus: LocationAuthorization = .authorized
    let isSimulated = true

    var onUpdate: ((LocationReading) -> Void)?
    var onAuthorizationChange: ((LocationAuthorization) -> Void)?

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

    var headingDegrees: Double? { nil }

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
        publish()
        return next
    }

    private func publish() {
        let reading = LocationReading(
            timestamp: Date(),
            origin: nil,
            remainingMeters: remainingMeters.map(Double.init),
            bearingDegrees: bearingDegrees,
            headingDegrees: nil,
            horizontalAccuracy: nil
        )
        onUpdate?(reading)
    }
}

// MARK: - 真实定位（CoreLocation）

/// 真实 GPS 实现。链路：
///
/// 1. `start()`：请求 WhenInUse 权限 → 开启持续定位 + 朝向；
/// 2. `didUpdateLocations`：拿到自己坐标 → 用 `GeoMath.distance/bearing`
///    算到目的地的距离与方位 → `onUpdate` 回调给 JourneyView；
/// 3. JourneyView 把读数写进 `WalkaholicStore.updateLocation(...)`，
///    由 Shared 层推进线索解锁 / 到达判定（≤30m 自动开盒）；
/// 4. 目的地坐标由 `target` 注入（JourneyView 从 `store.session.target` 同步）。
///
/// 后台定位：`allowsBackgroundLocationUpdates = true` + `pausesLocationUpdatesAutomatically = false`，
/// Info.plist 已配 `UIBackgroundModes: location`。**真机注意**：WhenInUse 也能在后台继续收点
/// （状态栏蓝条），但如果要 App 被彻底杀掉后仍能恢复，需要用户选「始终允许」；
/// `requestAlwaysAuthorization()` 已实现但**不自动弹**，避免首次启动连弹两个系统弹窗。
final class LiveLocationService: NSObject, LocationProviding, CLLocationManagerDelegate {

    // MARK: 回调

    var onUpdate: ((LocationReading) -> Void)?
    var onAuthorizationChange: ((LocationAuthorization) -> Void)?

    /// 目的地真实坐标。由 JourneyView 从 `store.session.target` 同步过来。
    var target: GeoPoint?

    // MARK: 状态

    private let manager = CLLocationManager()
    private(set) var lastLocation: CLLocation?
    private(set) var remainingMeters: Int?
    private(set) var bearingDegrees: Double?
    private(set) var headingDegrees: Double?
    /// 罗盘精度（度）。>25 时基本不可用：室内 / 未校准，导航里不能拿它转地图。
    private(set) var headingAccuracy: Double?
    private var fixWatchdog: Timer?
    private var lastFixAt = Date()
    /// 用连续两个定位点推算的行进方向（真机没罗盘/罗盘未就绪时用）
    private var moveHeading: Double?
    private var previousPoint: GeoPoint?
    private(set) var authorizationStatus: LocationAuthorization = .notDetermined
    private(set) var horizontalAccuracy: Double?
    /// 是否已经拿到过至少一个有效定位点
    private(set) var hasFix = false

    let isSimulated = false

    private var isRunning = false
    private var didRequestAlways = false
    private var issueText: String?

    var statusText: String {
        if let issueText { return "实时定位 · \(issueText)" }
        switch authorizationStatus {
        case .authorized:
            return hasFix ? "实时定位 · 已连接" : "实时定位 · 正在搜星"
        case .notDetermined:
            return "实时定位 · 等待授权"
        case .denied, .restricted:
            return "实时定位 · 无权限（已降级演示）"
        }
    }

    // MARK: 生命周期

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 3
        manager.activityType = .fitness
        manager.headingFilter = 5
        manager.headingOrientation = .portrait
        authorizationStatus = Self.map(manager.authorizationStatus)
    }

    deinit {
        manager.delegate = nil
    }

    func start() {
        isRunning = true
        prepareBackgroundUpdatesIfNeeded()

        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            beginUpdates()
        case .denied:
            updateAuthorization(.denied)
        case .restricted:
            updateAuthorization(.restricted)
        @unknown default:
            break
        }
    }

    func stop() {
        isRunning = false
        manager.stopUpdatingLocation()
        manager.stopUpdatingHeading()
        fixWatchdog?.invalidate()
        fixWatchdog = nil
    }

    @discardableResult
    func simulateAdvance(meters: Int) -> Int? {
        // 真实定位不接受手动推进
        nil
    }

    /// 可选：升级到「始终允许」（例如用户希望锁屏后仍完整记录）。
    /// 不自动调用——避免首次进入旅程连弹两个系统弹窗。
    func requestAlwaysAuthorization() {
        guard !didRequestAlways else { return }
        guard manager.authorizationStatus == .authorizedWhenInUse else { return }
        didRequestAlways = true
        manager.requestAlwaysAuthorization()
    }

    // MARK: 内部

    private func beginUpdates() {
        guard isRunning else { return }
        manager.startUpdatingLocation()
        if CLLocationManager.headingAvailable() {
            manager.startUpdatingHeading()
        }
        startFixWatchdog()
    }

    /// 定位看门狗：CoreLocation 在静止/信号差时可能长时间不回调，
    /// 用户已经走了很远但界面不动。超过 5 秒没有新定位就主动 requestLocation 一次。
    private func startFixWatchdog() {
        fixWatchdog?.invalidate()
        lastFixAt = Date()
        fixWatchdog = Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { [weak self] _ in
            guard let self, self.isRunning else { return }
            guard Date().timeIntervalSince(self.lastFixAt) > 5 else { return }
            self.manager.requestLocation()
            self.lastFixAt = Date()
        }
    }

    /// 后台定位开关：只有 Info.plist 里有 `UIBackgroundModes: location` 才能打开，
    /// 否则 CoreLocation 会直接抛 `NSInternalInconsistencyException`。
    private func prepareBackgroundUpdatesIfNeeded() {
        let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
        guard modes.contains("location") else {
            manager.allowsBackgroundLocationUpdates = false
            return
        }
        manager.allowsBackgroundLocationUpdates = true
        manager.pausesLocationUpdatesAutomatically = false
        manager.showsBackgroundLocationIndicator = true
    }

    private func updateAuthorization(_ status: LocationAuthorization) {
        let changed = status != authorizationStatus
        authorizationStatus = status
        if changed {
            onAuthorizationChange?(status)
        }
    }

    /// 用最新坐标 + 目的地坐标算「还剩多远、往哪走」
    private func recompute(for location: CLLocation) {
        guard let target else {
            remainingMeters = nil
            bearingDegrees = nil
            return
        }
        let origin = GeoPoint(
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude
        )
        remainingMeters = Int(GeoMath.distance(from: origin, to: target).rounded())
        bearingDegrees = GeoMath.bearing(from: origin, to: target)
    }

    private func publish() {
        guard let location = lastLocation else { return }
        let origin = GeoPoint(
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude
        )
        // 朝向优先级：设备罗盘（真机）> CoreLocation course（移动中有效）> 两点推算
        var upHeading = headingDegrees
        if upHeading == nil || upHeading == -1 {
            let course = location.course
            if course >= 0 && course.isFinite {
                upHeading = course
            } else {
                upHeading = moveHeading
            }
        }
        let reading = LocationReading(
            timestamp: Date(),
            origin: origin,
            remainingMeters: remainingMeters.map(Double.init),
            bearingDegrees: bearingDegrees,
            headingDegrees: upHeading,
            headingAccuracy: headingAccuracy,
            horizontalAccuracy: horizontalAccuracy
        )

        if Thread.isMainThread {
            onUpdate?(reading)
        } else {
            DispatchQueue.main.async { [weak self] in
                self?.onUpdate?(reading)
            }
        }
    }

    // MARK: CLLocationManagerDelegate

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let mapped = Self.map(manager.authorizationStatus)
        updateAuthorization(mapped)

        switch mapped {
        case .authorized:
            beginUpdates()
        case .denied, .restricted:
            manager.stopUpdatingLocation()
            manager.stopUpdatingHeading()
            remainingMeters = nil
            bearingDegrees = nil
        case .notDetermined:
            break
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let latest = locations.last else { return }
        lastFixAt = Date()

        // 移动方向：走了 ≥2.5m 才更新，避免站着时抖动
        let point = GeoPoint(latitude: latest.coordinate.latitude, longitude: latest.coordinate.longitude)
        if let previous = previousPoint {
            let moved = GeoMath.distance(from: previous, to: point)
            if moved >= 2.5 {
                let raw = GeoMath.bearing(from: previous, to: point)
                if let current = moveHeading {
                    let delta = ((raw - current + 540).truncatingRemainder(dividingBy: 360)) - 180
                    moveHeading = (current + delta * 0.6 + 360).truncatingRemainder(dividingBy: 360)
                } else {
                    moveHeading = raw
                }
            }
        }
        previousPoint = point

        // 精度为负 = 无效点；时间太旧 = 缓存兜底点，直接丢
        guard latest.horizontalAccuracy >= 0 else { return }
        guard abs(latest.timestamp.timeIntervalSinceNow) < 30 else { return }

        lastLocation = latest
        horizontalAccuracy = latest.horizontalAccuracy
        hasFix = true
        issueText = nil
        recompute(for: latest)
        publish()
    }

    func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        guard newHeading.headingAccuracy >= 0 else { return }
        let raw = newHeading.trueHeading >= 0
            ? newHeading.trueHeading
            : newHeading.magneticHeading

        // 罗盘噪声低通：0.25 的系数在 5° headingFilter 下体感跟手，但不会让箭头抖个不停
        // （站着不动时磁力计会来回跳 3–8°，不滤波的话圆点箭头会像在乱转）
        if let current = headingDegrees {
            let delta = ((raw - current + 540).truncatingRemainder(dividingBy: 360)) - 180
            // 转动很快时（>25°/次）直接跟，不要被滤波拖住
            headingDegrees = abs(delta) > 25
                ? raw
                : (current + delta * 0.25 + 360).truncatingRemainder(dividingBy: 360)
        } else {
            headingDegrees = raw
        }
        headingAccuracy = newHeading.headingAccuracy
        publish()
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if let clError = error as? CLError, clError.code == .denied {
            updateAuthorization(.denied)
            manager.stopUpdatingLocation()
            manager.stopUpdatingHeading()
            return
        }
        if let clError = error as? CLError, clError.code == .locationUnknown {
            issueText = "信号弱"
        } else {
            issueText = "定位失败"
        }
        // 保留上一次有效距离，不把界面打回原点
    }

    // MARK: Helpers

    private static func map(_ status: CLAuthorizationStatus) -> LocationAuthorization {
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
}
