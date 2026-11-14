import SwiftUI

/// 共享视觉 Token —— v4「原生 iOS」
///
/// 原则：一切颜色/字体/圆角都走系统语义 API。
/// - 背景用 systemGroupedBackground，卡片用 secondarySystemGroupedBackground
/// - 文字用 label / secondaryLabel / tertiaryLabel，自动支持深色模式与动态字体
/// - 强调色用系统 accentColor（iOS 默认蓝），与系统控件一致
/// - 不再自带阴影、描边、渐变；分层交给系统的分组列表与材质
public enum WATheme {

    // MARK: 文字
    #if os(watchOS)
    public static let ink = Color.white
    public static let ink2 = Color.white.opacity(0.70)
    public static let ink3 = Color.white.opacity(0.45)
    #else
    public static let ink = Color(.label)
    public static let ink2 = Color(.secondaryLabel)
    public static let ink3 = Color(.tertiaryLabel)
    #endif

    // MARK: 表面
    #if os(watchOS)
    public static let cream = Color.black
    public static let paper = Color(white: 0.14)
    public static let paper2 = Color(white: 0.22)
    public static let line = Color.white.opacity(0.14)
    #else
    /// 页面底色（分组列表背景）
    public static let cream = Color(.systemGroupedBackground)
    /// 卡片 / 分组行
    public static let paper = Color(.secondarySystemGroupedBackground)
    /// 输入框 / 凹槽 / 次级填充
    public static let paper2 = Color(.tertiarySystemFill)
    /// 分割线
    public static let line = Color(.separator)
    #endif

    // MARK: 强调色
    /// 主强调色（= 系统 accentColor，默认 iOS 蓝）
    public static let amber = Color.accentColor
    /// 深强调 / 链接字
    public static let amberDeep = Color.accentColor
    /// 选中底（系统会自己处理，这里只给需要自绘的地方用）
    public static let amberSoft = Color.accentColor.opacity(0.12)

    // MARK: 语义色
    #if os(watchOS)
    public static let ember = Color.red
    public static let teal = Color.green
    public static let plum = Color.purple
    public static let gold = Color.orange
    #else
    public static let ember = Color(.systemRed)
    public static let teal = Color(.systemGreen)
    public static let plum = Color(.systemPurple)
    public static let gold = Color(.systemOrange)
    #endif

    // MARK: 尺寸（对齐系统）
    public static let pagePadding: CGFloat = 16
    /// 分组列表 / 行内控件
    public static let controlRadius: CGFloat = 8
    /// 卡片
    public static let cardRadius: CGFloat = 12
    /// sheet / 面板
    public static let panelRadius: CGFloat = 16
    public static let pillRadius: CGFloat = 999

    /// 原生界面不使用投影。
    public static func cardShadow(_ color: Color = .clear) -> Color { .clear }

    // MARK: 断点
    public static let wideBreakpoint: CGFloat = 600
    public static let contentMaxWidth: CGFloat = 620
    public static let shortHeightBreakpoint: CGFloat = 720

    public static func isWide(_ width: CGFloat) -> Bool { width >= wideBreakpoint }
    public static func isShort(_ height: CGFloat) -> Bool { height < shortHeightBreakpoint }

    // MARK: 字体（系统文字样式，随动态字体缩放）
    public static func display(_ size: CGFloat = 34) -> Font {
        size >= 30 ? .largeTitle.weight(.bold) : .title2.weight(.semibold)
    }

    public static func title(_ size: CGFloat = 20) -> Font {
        size >= 20 ? .title3.weight(.semibold) : .headline
    }

    public static func body(_ size: CGFloat = 14) -> Font { .body }

    public static func caption(_ size: CGFloat = 12) -> Font { .footnote }

    // MARK: 稀有度
    public static func rarityColor(_ rarity: Rarity) -> Color {
        switch rarity {
        #if os(watchOS)
        case .common: return Color.white.opacity(0.6)
        case .rare: return Color.teal
        case .epic: return Color.purple
        case .hidden: return Color.orange
        #else
        case .common: return Color(.secondaryLabel)
        case .rare: return Color(.systemTeal)
        case .epic: return Color(.systemPurple)
        case .hidden: return Color(.systemOrange)
        #endif
        }
    }

    public static func raritySoft(_ rarity: Rarity) -> Color {
        rarityColor(rarity).opacity(0.12)
    }
}

public extension Color {
    init(hex: UInt32) {
        let red = Double((hex >> 16) & 0xFF) / 255
        let green = Double((hex >> 8) & 0xFF) / 255
        let blue = Double(hex & 0xFF) / 255
        self.init(red: red, green: green, blue: blue)
    }
}
