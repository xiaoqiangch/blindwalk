import Foundation
import CoreLocation

// MARK: - 一次性定位（取一个当前位置就够）
//
// 用途：抽盒前、图鉴算距离、探秘出发。都不需要持续定位，只要一个点。
//
// 两个曾经的真实故障，这里一并修掉：
// 1. `settled` 只置 true 从不复位 → **第二次调用永远不返回**（continuation 永不 resume，
//    调用方 await 到天荒地老）。现在每次 request 都复位状态。
// 2. 未授权时会先要权限，然后靠 `locationManagerDidChangeAuthorization` 再发起定位；
//    如果用户在系统弹窗里点了「一次」/「使用期间」，回调可能晚于我们的 8 秒超时，
//    旧实现会把这次请求判死。现在授权通过后会重新发起，并把超时放宽。

@MainActor
final class OneShotLocationService: NSObject, CLLocationManagerDelegate {

    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<GeoPoint?, Never>?
    private var settled = false
    private var timeoutTask: Task<Void, Never>?
    /// 授权通过后要补发一次定位请求（requestLocation 必须在有权限时调用才有效）
    private var wantsLocationAfterAuth = false

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = kCLDistanceFilterNone
    }

    /// 当前定位权限（UI 用来解释「为什么拿不到位置」）
    var authorizationStatus: LocationAuthorization {
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: return .authorized
        case .denied: return .denied
        case .restricted: return .restricted
        case .notDetermined: return .notDetermined
        @unknown default: return .notDetermined
        }
    }

    /// 取一次当前位置。`timeout` 秒内拿不到就返回 nil（不阻塞界面）。
    func request(timeout: TimeInterval = 8) async -> GeoPoint? {
        // 关键：每次调用都重置，否则第二次永远不返回
        settled = false
        timeoutTask?.cancel()

        return await withCheckedContinuation { continuation in
            self.continuation = continuation

            switch manager.authorizationStatus {
            case .notDetermined:
                // 先要权限；真正的 requestLocation 放到授权回调里
                wantsLocationAfterAuth = true
                manager.requestWhenInUseAuthorization()
            case .denied, .restricted:
                finish(nil)
            default:
                wantsLocationAfterAuth = false
                manager.requestLocation()
            }

            timeoutTask = Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(max(1, timeout) * 1_000_000_000))
                guard !Task.isCancelled else { return }
                self?.finish(nil)
            }
        }
    }

    private func finish(_ point: GeoPoint?) {
        guard !settled else { return }
        settled = true
        timeoutTask?.cancel()
        timeoutTask = nil
        wantsLocationAfterAuth = false
        manager.stopUpdatingLocation()
        continuation?.resume(returning: point)
        continuation = nil
    }

    // MARK: CLLocationManagerDelegate

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            if wantsLocationAfterAuth {
                wantsLocationAfterAuth = false
                manager.requestLocation()
            }
        case .denied, .restricted:
            finish(nil)
        case .notDetermined:
            break
        @unknown default:
            break
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last, location.horizontalAccuracy >= 0 else {
            finish(nil)
            return
        }
        finish(GeoPoint(latitude: location.coordinate.latitude, longitude: location.coordinate.longitude))
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // kCLErrorLocationUnknown 是「暂时取不到」，不要立刻判死；其余错误直接结束
        if let clError = error as? CLError, clError.code == .locationUnknown {
            return
        }
        finish(nil)
    }
}

// MARK: - App 级定位引导

/// 冷启动时拿一次定位，把 `store.lastKnownOrigin` 填上。
/// 没有这个点，图鉴的「距离」和「去探秘」都只能显示「位置未知」——
/// 用户会以为定位坏了。
@MainActor
enum LocationBootstrap {

    private static var isRunning = false

    /// 只在还没有位置时取一次（幂等，可多处调用）
    static func seedIfNeeded(_ store: WalkaholicStore) async {
        guard store.lastKnownOrigin == nil, !isRunning else { return }
        isRunning = true
        defer { isRunning = false }

        let service = OneShotLocationService()
        if let point = await service.request(timeout: 8) {
            store.lastKnownOrigin = point
        }
    }
}
