import Foundation
import CoreLocation

/// 抽盒页的一次性定位：真实模式下打开 setup 就先拿一个当前位置，
/// 这样用户第一次打开 App 也能抽到真实地点（不必先走完一段旅程）。
@MainActor
final class OneShotLocationService: NSObject, CLLocationManagerDelegate {

    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<GeoPoint?, Never>?
    private var settled = false

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    func request() async -> GeoPoint? {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            let status = manager.authorizationStatus
            if status == .notDetermined {
                manager.requestWhenInUseAuthorization()
            } else if status == .denied || status == .restricted {
                finish(nil)
            } else {
                manager.requestLocation()
            }
            // 5 秒拿不到就放弃，不阻塞抽盒
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                self.finish(nil)
            }
        }
    }

    private func finish(_ point: GeoPoint?) {
        guard !settled else { return }
        settled = true
        continuation?.resume(returning: point)
        continuation = nil
        manager.stopUpdatingLocation()
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways {
            manager.requestLocation()
        } else if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
            finish(nil)
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last, location.horizontalAccuracy >= 0, location.horizontalAccuracy <= 200 else {
            finish(nil)
            return
        }
        finish(GeoPoint(latitude: location.coordinate.latitude, longitude: location.coordinate.longitude))
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        finish(nil)
    }
}
