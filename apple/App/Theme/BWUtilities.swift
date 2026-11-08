import Foundation
import SwiftUI
import UIKit

// MARK: - 动效
// 对齐 docs/design-system.md §3：主缓动 cubic-bezier(.22,1,.36,1)，
// 快 180ms / 常规 320ms / 慢 520ms / 摇盒 600ms / 开盒 900ms / 呼吸光点 2.4s。

enum BWAnimation {
    static let quick = Animation.timingCurve(0.22, 1, 0.36, 1, duration: 0.18)
    static let regular = Animation.timingCurve(0.22, 1, 0.36, 1, duration: 0.32)
    static let slow = Animation.timingCurve(0.22, 1, 0.36, 1, duration: 0.52)
    static let openBox = Animation.timingCurve(0.22, 1, 0.36, 1, duration: 0.9)

    /// 呼吸光点：2.4s 一个来回
    static var breathing: Animation {
        Animation.easeInOut(duration: 1.2).repeatForever(autoreverses: true)
    }
}

// MARK: - 延迟执行
/// 统一封装「等一会儿再做」（用于动画时序）。回调保证在主线程执行。
@MainActor
func bwAfter(_ seconds: Double, _ action: @escaping @MainActor () -> Void) {
    Task { @MainActor in
        let clamped = max(0, seconds)
        try? await Task.sleep(nanoseconds: UInt64(clamped * 1_000_000_000))
        action()
    }
}

// MARK: - 文案 / 数字格式化

enum BWFormat {

    /// 顶栏问候：早上好 / 下午好 / 晚上好（按系统时间，design-system §5.1）
    static func greeting(name: String, date: Date = Date(), calendar: Calendar = .current) -> String {
        let hour = calendar.component(.hour, from: date)
        let prefix: String
        if hour < 5 {
            prefix = "夜深了"
        } else if hour < 12 {
            prefix = "早上好"
        } else if hour < 18 {
            prefix = "下午好"
        } else {
            prefix = "晚上好"
        }
        return "\(prefix)，\(name)"
    }

    /// 旅程计时：00:12:34
    static func clock(seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds.rounded(.down)))
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let secondPart = total % 60
        return String(format: "%02d:%02d:%02d", hours, minutes, secondPart)
    }

    /// 卡片日期：11月8日
    static func shortDate(_ date: Date) -> String {
        shortDateFormatter.string(from: date)
    }

    /// 上一次的惊喜：已是 3 天前 / 就是今天
    static func dayPhrase(since date: Date, now: Date = Date(), calendar: Calendar = .current) -> String {
        let days = daysSince(date, now: now, calendar: calendar)
        return days == 0 ? "就是今天" : "已是 \(days) 天前"
    }

    static func daysSince(_ date: Date, now: Date = Date(), calendar: Calendar = .current) -> Int {
        let from = calendar.startOfDay(for: date)
        let to = calendar.startOfDay(for: now)
        let days = calendar.dateComponents([.day], from: from, to: to).day ?? 0
        return max(0, days)
    }

    /// 好友动态时间：12 分钟前
    static func relative(_ date: Date, now: Date = Date()) -> String {
        let seconds = max(0, now.timeIntervalSince(date))
        if seconds < 60 {
            return "刚刚"
        }
        if seconds < 3600 {
            return "\(Int(seconds / 60)) 分钟前"
        }
        if seconds < 86_400 {
            return "\(Int(seconds / 3600)) 小时前"
        }
        return "\(Int(seconds / 86_400)) 天前"
    }

    /// 距离：1.6 km
    static func distanceKilometers(_ meters: Int) -> String {
        String(format: "%.1f km", Double(meters) / 1000.0)
    }

    /// 一位小数：42.6
    static func decimal1(_ value: Double) -> String {
        String(format: "%.1f", value)
    }

    /// 区域显示名（design-system §5.4 用「河岸」而不是「河边」）
    static func areaName(_ area: Area) -> String {
        switch area {
        case .river:
            return "河岸"
        case .oldtown:
            return "老城区"
        case .near:
            return "附近"
        }
    }

    /// 1 -> 一
    static func chineseIndex(_ index: Int) -> String {
        let numerals = ["一", "二", "三"]
        guard index >= 0, index < numerals.count else { return "\(index + 1)" }
        return numerals[index]
    }

    private static let shortDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "M月d日"
        return formatter
    }()
}

// MARK: - 触感
// design-system §3：轻触 = light，解锁线索 = medium，揭晓 = success/pattern。

enum BWHaptics {
    /// 设置页「触感」开关会同步这里
    static var isEnabled = true

    static func light() {
        guard isEnabled else { return }
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.prepare()
        generator.impactOccurred()
    }

    static func medium() {
        guard isEnabled else { return }
        let generator = UIImpactFeedbackGenerator(style: .medium)
        generator.prepare()
        generator.impactOccurred()
    }

    static func success() {
        guard isEnabled else { return }
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(.success)
    }
}
