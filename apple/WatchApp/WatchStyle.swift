import Foundation
import SwiftUI

/// 手表通用版式（docs/design-system.md §5.9：
/// 黑底 + watchOS 系统风格 + 白色 SF 字体 + 彩色进度环，表盘 198×242）。
struct WatchScreenBackground: ViewModifier {

    var alignment: Alignment

    func body(content: Content) -> some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: alignment)
            .background(Color.black.ignoresSafeArea())
    }
}

extension View {

    /// 撑满表盘 + 黑底
    func watchScreen(_ alignment: Alignment = .center) -> some View {
        modifier(WatchScreenBackground(alignment: alignment))
    }
}

/// 手表上用到的格式化
enum WatchFormat {

    private static let clockFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    /// 旅程计时：00:12:34
    static func clock(from start: Date, to now: Date) -> String {
        let total = max(0, Int(now.timeIntervalSince(start)))
        return String(format: "%02d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60)
    }

    /// 同步时间：21:36
    static func time(_ date: Date) -> String {
        clockFormatter.string(from: date)
    }

    /// 百分比：62%
    static func percent(_ value: Double) -> String {
        "\(Int((value * 100).rounded()))%"
    }
}
