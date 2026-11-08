import WatchKit

/// 手表触感封装（docs/design-system.md §3 动效 / §8 native 契约）
///
/// - 线索解锁 → `.click`
/// - 到达目的地 → `.notification`
/// - 轻点打卡 → `.success`
///
/// 统一走 `WKInterfaceDevice.current().play(_:)`，视图层不直接碰 WatchKit。
enum Haptics {

    /// 线索解锁：轻轻「咔哒」一下（§5.3 线索时间线）
    static func hintUnlocked() {
        play(.click)
    }

    /// 到达：来一个明确的提示感（§5.3 到达 ≤30m）
    static func arrival() {
        play(.notification)
    }

    /// 打卡成功（§5.9 揭晓「轻点打卡」）
    static func checkIn() {
        play(.success)
    }

    /// 通用入口，方便后续补「轻触 / 失败」等场景
    static func play(_ type: WKHapticType) {
        WKInterfaceDevice.current().play(type)
    }
}
