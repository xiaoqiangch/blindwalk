import SwiftUI

/// 共享视觉 Token（与 docs/design-system.md §3 一致）
public enum BWTheme {

    // 颜色
    public static let ink = Color(hex: 0x111827)
    public static let ink2 = Color(hex: 0x4B5563)
    public static let ink3 = Color(hex: 0x9CA3AF)
    public static let cream = Color(hex: 0xF3F5FB)
    public static let paper = Color(hex: 0xFFFFFF)
    public static let paper2 = Color(hex: 0xEEF1F9)
    public static let line = Color(hex: 0xE2E7F2)
    public static let amber = Color(hex: 0x5B6CFF)
    public static let amberDeep = Color(hex: 0x3D4FE0)
    public static let ember = Color(hex: 0xFF6B6B)
    public static let teal = Color(hex: 0x14B8A6)
    public static let plum = Color(hex: 0x8B5CF6)
    public static let gold = Color(hex: 0xF59E0B)

    // 尺寸
    public static let pagePadding: CGFloat = 20
    public static let cardRadius: CGFloat = 24
    public static let panelRadius: CGFloat = 28
    public static let pillRadius: CGFloat = 999

    // 阴影
    public static func cardShadow(_ color: Color = BWTheme.ink.opacity(0.10)) -> Color { color }

    // MARK: 折叠屏 / 宽屏断点
    // iPhone Duo 展开态 669×951pt、折叠态 466×678pt（见 docs/foldable.md）
    /// 宽屏阈值：Duo 展开（669）走双列；任何 iPhone 常规宽度（402/440）都走单列
    public static let wideBreakpoint: CGFloat = 600
    /// 内容最大宽度：宽屏时居中，避免一行文字被拉到 669pt 那么长
    public static let contentMaxWidth: CGFloat = 620
    /// 矮屏阈值：Duo 折叠态 678pt 高，需要压缩纵向节奏
    public static let shortHeightBreakpoint: CGFloat = 720

    public static func isWide(_ width: CGFloat) -> Bool { width >= wideBreakpoint }
    public static func isShort(_ height: CGFloat) -> Bool { height < shortHeightBreakpoint }

    // 字体
    public static func display(_ size: CGFloat = 30) -> Font {
        .system(size: size, weight: .bold, design: .rounded)
    }

    public static func title(_ size: CGFloat = 22) -> Font {
        .system(size: size, weight: .semibold, design: .default)
    }

    public static func body(_ size: CGFloat = 15) -> Font {
        .system(size: size, weight: .regular, design: .default)
    }

    public static func caption(_ size: CGFloat = 13) -> Font {
        .system(size: size, weight: .medium, design: .default)
    }

    // 稀有度
    public static func rarityColor(_ rarity: Rarity) -> Color {
        switch rarity {
        case .common: return Color(hex: 0x94A3B8)
        case .rare: return teal
        case .epic: return plum
        case .hidden: return gold
        }
    }

    public static func raritySoft(_ rarity: Rarity) -> Color {
        rarityColor(rarity).opacity(0.14)
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
