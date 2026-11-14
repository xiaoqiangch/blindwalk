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

    /// 盒插画轻浮动：web `float 4.6s ease-in-out infinite`
    static var floating: Animation {
        Animation.easeInOut(duration: 2.3).repeatForever(autoreverses: true)
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

// MARK: - 颜色派生
// 设计稿里有些「中间色」（牛皮纸渐层、徽章深字）不是独立 token，
// 这里只在既有 token 之间做插值，不引入任何新的硬编码色值。

extension Color {
    /// 在 a / b 两个既有 token 之间按 t（0…1）插值。
    static func bwMix(_ a: Color, _ b: Color, _ t: CGFloat) -> Color {
        let clamped = min(1, max(0, t))
        let ca = UIColor(a).bwRGBA
        let cb = UIColor(b).bwRGBA
        return Color(
            red: ca.0 + (cb.0 - ca.0) * clamped,
            green: ca.1 + (cb.1 - ca.1) * clamped,
            blue: ca.2 + (cb.2 - ca.2) * clamped
        )
    }
}

private extension UIColor {
    var bwRGBA: (CGFloat, CGFloat, CGFloat, CGFloat) {
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0
        if getRed(&red, green: &green, blue: &blue, alpha: &alpha) {
            return (red, green, blue, alpha)
        }
        var white: CGFloat = 0
        if getWhite(&white, alpha: &alpha) {
            return (white, white, white, alpha)
        }
        return (0, 0, 0, 1)
    }
}

/// 卡片面材色板。
///
/// v3：不再用「主色混出来」的渐变。原来那三档（paper2 → 主色 10/20/30%）让整张卡片
/// 变成淡紫，一屏里出现三张就变成「满屏紫」——这是界面发虚的主因。
/// 现在只保留一条中性面材梯，渐变仅作为同一中性内部的极轻微tone shift，
/// 层次靠「面材 + 发丝描边」拉开，不靠色相。
enum BWKraft {
    /// 面材三档（中性冷灰，自上而下略深）
    static let light = Color(hex: 0xFFFFFF)
    static let mid = Color(hex: 0xFAFAFB)
    static let deep = Color(hex: 0xF2F3F5)

    /// 盒体 / 盒盖：中性面 + 一点主色（只在插画内部出现，不当背景）
    static let boxBody = Color(hex: 0xF0F2FB)
    static let boxLid = Color(hex: 0xF8F9FD)

    /// 主卡面材：仍是中性，只在内部 tone shift
    static var cardGradient: LinearGradient {
        LinearGradient(
            colors: [light, mid],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    /// 等级卡面材
    static var levelGradient: LinearGradient {
        LinearGradient(
            colors: [light, mid, deep],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    /// 缩略图面材
    static var thumbGradient: LinearGradient {
        LinearGradient(
            colors: [BWTheme.paper2, BWTheme.paper],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

// MARK: - 字体层级
// 与 docs/design-system.md §3 的 Display / Title / Body / Caption / 微标 对应，
// 具体字号按 Web 原型（390pt 稿）实测取值。

enum BWType {
    /// 页面标题：一屏只有一个（回忆册 / 圈子 / 我的）
    static func pageTitle() -> Font { .system(size: 28, weight: .semibold) }

    /// 首页主标题
    static func hero() -> Font { .system(size: 30, weight: .semibold) }

    /// 主按钮文字
    static func cta(_ size: CGFloat = 16) -> Font { .system(size: size, weight: .semibold) }

    /// 卡片 / 列表主标题
    static func rowTitle(_ size: CGFloat = 15) -> Font { .system(size: size, weight: .medium) }

    /// 正文
    static func body(_ size: CGFloat = 14) -> Font { .system(size: size, weight: .regular) }

    /// 辅助文字
    static func caption(_ size: CGFloat = 12.5) -> Font { .system(size: size, weight: .regular) }

    /// 小节标题：句首大写、不追踪、不用全大写
    static func micro(_ size: CGFloat = 13) -> Font { .system(size: size, weight: .medium) }

    /// 数字（等宽）
    static func number(_ size: CGFloat = 22) -> Font { .system(size: size, weight: .semibold).monospacedDigit() }
}

// MARK: - 动态字体
extension View {
    /// 版式按 390pt 固定稿还原（与 Web 一致）。这里把 Dynamic Type 收敛到
    /// xxL：系统控件仍然可读地缩放，但极端字号不会把纸卡与筛选条撑破。
    func bwTypeBounds() -> some View {
        dynamicTypeSize(.xSmall ... .xxLarge)
    }
}

// MARK: - 底栏外观（iOS 26/27 Liquid Glass 兜底）
// 系统默认的悬浮玻璃 tab bar 会在奶油纸底上透出滚动内容、和纸底混成一片灰。
// iOS 27 上 UITabBarAppearance 对浮动底栏不生效，所以改用两层兜底：
// 1. 在玻璃底栏后面垫一条「纸面 + 顶部发丝线」，玻璃透出来的是纸而不是卡片；
// 2. 把选中项底下那团系统灰玻璃换成品牌琥珀的极淡底，克制、不发光。
// web 原型的底栏是平底纸栏，这样处理后与之一致。

@MainActor
enum BWTabBarChrome {
    static func install() {
        guard let window = keyWindow() else { return }
        window.backgroundColor = UIColor(BWTheme.cream)

        guard let tabBar = tabBar(in: window.rootViewController) else { return }
        tabBar.tintColor = UIColor(BWTheme.amberDeep)
        tabBar.unselectedItemTintColor = UIColor(BWTheme.ink3)

        // 底栏背后的系统底色（iOS 26/27 是 systemBackground 白），换成奶油纸。
        window.rootViewController?.view.backgroundColor = UIColor(BWTheme.cream)
        addPaperStrip(around: tabBar)
    }

    /// 在浮动玻璃底栏后面垫一条纸面 + 顶部发丝线：
    /// 玻璃透出的是纸，而不是滚动中的卡片内容（对齐 web 的平底 tab bar）。
    private static func addPaperStrip(around tabBar: UITabBar) {
        guard let plate = tabBar.superview,
              let container = plate.superview else { return }

        let strip = container.viewWithTag(0x8B1B) ?? {
            let view = UIView()
            view.tag = 0x8B1B
            view.isUserInteractionEnabled = false
            view.autoresizingMask = [.flexibleWidth, .flexibleTopMargin]
            container.insertSubview(view, at: 0)
            return view
        }()

        let hairline = strip.viewWithTag(0x8B1C) ?? {
            let view = UIView()
            view.tag = 0x8B1C
            view.autoresizingMask = [.flexibleWidth]
            strip.addSubview(view)
            return view
        }()

        softenSelectionPlatter(in: tabBar)

        let barFrame = tabBar.convert(tabBar.bounds, to: container)
        strip.frame = CGRect(x: 0, y: barFrame.minY, width: container.bounds.width, height: container.bounds.height - barFrame.minY)
        strip.backgroundColor = UIColor(BWTheme.paper)
        let hairlineHeight = 1 / UIScreen.main.scale
        hairline.frame = CGRect(x: 0, y: 0, width: strip.bounds.width, height: hairlineHeight)
        hairline.backgroundColor = UIColor(BWTheme.line)
        container.bringSubviewToFront(plate)
    }

    /// 只在选中项底下的「玻璃药丸」上做减法：把它的底色压到几乎透明，
    /// 玻璃本身和图标 portal 保留（否则图标会一起消失）。
    private static func softenSelectionPlatter(in view: UIView) {
        for sub in view.subviews {
            let name = String(describing: type(of: sub))
            if name.contains("_UITabSelectionView") {
                // 选中态用中性面，而不是带主色的淡底：
                // 底栏一天要被看几百次，它是 chrome，不该是整屏第二个彩色元素
                sub.backgroundColor = UIColor(BWTheme.paper2)
                sub.alpha = 1
            }
            if name.contains("_UITabBarItemPlatterView") {
                sub.backgroundColor = .clear
            }
            softenSelectionPlatter(in: sub)
        }
    }

    private static func keyWindow() -> UIWindow? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        for scene in scenes {
            if let window = scene.windows.first(where: { $0.isKeyWindow }) { return window }
            if let window = scene.windows.first { return window }
        }
        return nil
    }

    private static func tabBar(in controller: UIViewController?) -> UITabBar? {
        guard let controller else { return nil }
        if let tabController = controller as? UITabBarController { return tabController.tabBar }
        for child in controller.children {
            if let found = tabBar(in: child) { return found }
        }
        return tabBar(in: controller.presentedViewController)
    }
}

private struct BWTabBarChromeModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .onAppear {
                BWTabBarChrome.install()
                // 系统底栏在首次布局后才稳定，补一次（幂等）
                bwAfter(0.6) { BWTabBarChrome.install() }
            }
    }
}

extension View {
    /// 给系统底栏套上纸面外观（每个 tab 根视图各挂一次，幂等）。
    func bwTabBarChrome() -> some View {
        modifier(BWTabBarChromeModifier())
    }
}

// MARK: - 文案 / 数字格式化

enum BWFormat {

    /// 顶栏问候：早上好 / 下午好 / 晚上好（按系统时间，design-system §5.1）
    static func greeting(name: String, date: Date = Date(), calendar: Calendar = .current) -> String {
        let hour = calendar.component(.hour, from: date)
        // design-system §5.1 只定义了 早上好 / 下午好 / 晚上好 三档，不额外造词。
        let prefix: String
        if hour < 12 {
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

    /// 图鉴小卡日期：11.05（web .fcard__date，等宽数字）
    static func compactDate(_ date: Date) -> String {
        compactDateFormatter.string(from: date)
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

    /// 千分位：4,240
    static func grouped(_ value: Int) -> String {
        groupedFormatter.string(from: NSNumber(value: value)) ?? "\(value)"
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

    private static let compactDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "MM.dd"
        return formatter
    }()

    private static let groupedFormatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.groupingSeparator = ","
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
