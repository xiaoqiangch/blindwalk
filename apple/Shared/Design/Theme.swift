import SwiftUI

/// 共享视觉 Token（与 docs/design-system.md §3 一致）
public enum BWTheme {

    // 颜色
    public static let ink = Color(hex: 0x171410)
    public static let ink2 = Color(hex: 0x6B6357)
    public static let ink3 = Color(hex: 0xA69C8C)
    public static let cream = Color(hex: 0xF5EEE2)
    public static let paper = Color(hex: 0xFFFBF3)
    public static let paper2 = Color(hex: 0xFBF4E9)
    public static let line = Color(hex: 0xE8DECC)
    public static let amber = Color(hex: 0xE89B4C)
    public static let amberDeep = Color(hex: 0xC97B2E)
    public static let ember = Color(hex: 0xD25C3A)
    public static let teal = Color(hex: 0x2E7D78)
    public static let plum = Color(hex: 0x6B5B9E)
    public static let gold = Color(hex: 0xB98A1F)

    // 尺寸
    public static let pagePadding: CGFloat = 20
    public static let cardRadius: CGFloat = 24
    public static let panelRadius: CGFloat = 28
    public static let pillRadius: CGFloat = 999

    // 阴影
    public static func cardShadow(_ color: Color = BWTheme.ink.opacity(0.10)) -> Color { color }

    // 字体
    public static func display(_ size: CGFloat = 40) -> Font {
        .system(size: size, weight: .bold, design: .rounded)
    }

    public static func title(_ size: CGFloat = 22) -> Font {
        .system(size: size, weight: .semibold, design: .default)
    }

    public static func body(_ size: CGFloat = 15) -> Font {
        .system(size: size, weight: .regular, design: .default)
    }

    public static func caption(_ size: CGFloat = 12) -> Font {
        .system(size: size, weight: .medium, design: .default)
    }

    // 稀有度
    public static func rarityColor(_ rarity: Rarity) -> Color {
        switch rarity {
        case .common: return Color(hex: 0x8B9484)
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
