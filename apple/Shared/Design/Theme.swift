import SwiftUI

/// 共享视觉 Token（与 docs/design-system.md §3 一致）
///
/// v3 · 2026-11-14：中性底 + 靛蓝只做强调。
/// 上一版的问题是「什么都是紫的」——页面底色、卡片底色、渐变、阴影全由主色混出来，
/// 界面因此发虚、像网页。这一版把中性面独立成一条冷灰梯，主色只允许出现在
/// 一处主按钮、选中态、迷雾路径的「要走的那段」，以及一个关键数字上。
public enum WATheme {

    // MARK: 中性梯（唯一用于背景 / 卡片 / 分割线 / 文字的色板）
    /// 主文字
    public static let ink = Color(hex: 0x14161A)
    /// 次要文字
    public static let ink2 = Color(hex: 0x5A6068)
    /// 弱提示 / 占位
    public static let ink3 = Color(hex: 0x9BA1AA)

    /// 页面底色
    public static let cream = Color(hex: 0xF5F6F8)
    /// 卡片 / 面板
    public static let paper = Color(hex: 0xFFFFFF)
    /// 次级表面 / 输入框 / 凹槽
    public static let paper2 = Color(hex: 0xF0F1F4)
    /// 分割线 / 描边
    public static let line = Color(hex: 0xE4E6EA)

    // MARK: 强调色（整屏只允许出现三次以内）
    /// 历史名保留为 `amber`，实际是靛蓝主色；白字对比 5.2:1
    public static let amber = Color(hex: 0x4A5BF0)
    /// 按下态 / 深强调 / 正文用的小号强调字
    public static let amberDeep = Color(hex: 0x3546D6)
    /// 主色极淡底（选中行、chip 选中）
    public static let amberSoft = Color(hex: 0xEEF0FE)

    // MARK: 语义色
    public static let ember = Color(hex: 0xDC4C4C)
    public static let teal = Color(hex: 0x0E9384)
    public static let plum = Color(hex: 0x7C5CD6)
    public static let gold = Color(hex: 0xB8791A)

    // MARK: 尺寸
    public static let pagePadding: CGFloat = 20
    /// 卡片圆角：内层 = 外层 − 内边距，这里统一三档
    public static let controlRadius: CGFloat = 12
    public static let cardRadius: CGFloat = 16
    public static let panelRadius: CGFloat = 20
    public static let pillRadius: CGFloat = 999

    /// 卡片阴影：中性、极轻。深色阴影+彩色阴影会让界面发虚。
    public static func cardShadow(_ color: Color = WATheme.ink.opacity(0.05)) -> Color { color }

    // MARK: 折叠屏 / 宽屏断点
    // iPhone Duo 展开态 669×951pt、折叠态 466×678pt（见 docs/foldable.md）
    public static let wideBreakpoint: CGFloat = 600
    public static let contentMaxWidth: CGFloat = 620
    public static let shortHeightBreakpoint: CGFloat = 720

    public static func isWide(_ width: CGFloat) -> Bool { width >= wideBreakpoint }
    public static func isShort(_ height: CGFloat) -> Bool { height < shortHeightBreakpoint }

    // MARK: 字体
    // 只用一档字族的五个阶 + 两个字重（.semibold 仅用于标题与按钮）。
    // 不再用 .rounded —— 圆体是「可爱风」，和城市测绘的方向相反。
    public static func display(_ size: CGFloat = 34) -> Font {
        .system(size: size, weight: .semibold, design: .default)
    }

    public static func title(_ size: CGFloat = 20) -> Font {
        .system(size: size, weight: .semibold, design: .default)
    }

    public static func body(_ size: CGFloat = 14) -> Font {
        .system(size: size, weight: .regular, design: .default)
    }

    public static func caption(_ size: CGFloat = 12) -> Font {
        .system(size: size, weight: .regular, design: .default)
    }

    // MARK: 稀有度
    public static func rarityColor(_ rarity: Rarity) -> Color {
        switch rarity {
        case .common: return Color(hex: 0x8B939F)
        case .rare: return teal
        case .epic: return plum
        case .hidden: return gold
        }
    }

    public static func raritySoft(_ rarity: Rarity) -> Color {
        rarityColor(rarity).opacity(0.10)
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
