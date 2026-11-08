import SwiftUI

// MARK: - 纸面背景
// 「黄昏的旧地图」：奶油纸底 + 极低透明度纸纹（design-system §3）。

struct BWPaperBackground: View {
    var body: some View {
        ZStack {
            BWTheme.cream
            BWPaperTexture()
                .opacity(0.5)
        }
        .ignoresSafeArea()
    }
}

/// 简化纸纹：确定性伪随机噪点，替代 web 的 feTurbulence。
struct BWPaperTexture: View {
    var body: some View {
        Canvas { context, size in
            var random = BWPseudoRandom(seed: 0xB1_1D_2A_1C)
            let count = 120
            for _ in 0..<count {
                let x = random.nextDouble() * size.width
                let y = random.nextDouble() * size.height
                let radius = 0.6 + random.nextDouble() * 1.6
                let rect = CGRect(x: x, y: y, width: radius, height: radius)
                context.fill(Path(ellipseIn: rect), with: .color(BWTheme.ink.opacity(0.05)))
            }
        }
        .allowsHitTesting(false)
    }
}

/// 小工具：可复现的伪随机（保证每次重绘纹理一致）
struct BWPseudoRandom {
    private var state: UInt64

    init(seed: UInt64) {
        self.state = seed | 1
    }

    mutating func nextDouble() -> CGFloat {
        state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
        let value = (state >> 33) % 10_000
        return CGFloat(value) / 10_000
    }
}

// MARK: - 卡片

/// 奶油纸卡片：24pt 圆角 + 细描边 + 柔和阴影。
struct BWCard<Content: View>: View {
    private let padding: CGFloat
    private let background: Color
    private let content: Content

    init(padding: CGFloat = 20, background: Color = BWTheme.paper, @ViewBuilder content: () -> Content) {
        self.padding = padding
        self.background = background
        self.content = content()
    }

    var body: some View {
        content
            .padding(padding)
            .background(background)
            .clipShape(RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous)
                    .stroke(BWTheme.line, lineWidth: 1)
            )
            .shadow(color: BWTheme.ink.opacity(0.08), radius: 16, x: 0, y: 10)
    }
}

// MARK: - 文本

/// 微标：10pt + 字距（design-system §3 微标 10/12，大写 + 字距 .08em）
struct BWMicroLabel: View {
    private let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .semibold))
            .tracking(1.2)
            .foregroundStyle(BWTheme.ink3)
    }
}

/// 小节标题 + 右侧入口
struct BWSectionHeader: View {
    let title: String
    var trailingTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(title)
                .font(BWTheme.title(17))
                .foregroundStyle(BWTheme.ink)
            Spacer(minLength: 0)
            if let trailingTitle, let action {
                Button(action: action) {
                    HStack(spacing: 2) {
                        Text(trailingTitle).font(BWTheme.caption(12))
                        Image(systemName: "chevron.right")
                            .font(.system(size: 9, weight: .semibold))
                    }
                    .foregroundStyle(BWTheme.amberDeep)
                }
                .buttonStyle(BWPressEffectStyle())
            }
        }
    }
}

// MARK: - 按钮

struct BWPressEffectStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .animation(BWAnimation.quick, value: configuration.isPressed)
    }
}

/// 琥珀主 CTA（胶囊按钮）
struct BWPrimaryButton: View {
    let title: String
    var icon: String? = nil
    var caption: String? = nil
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 16, weight: .semibold))
                }
                Text(title)
                    .font(BWTheme.title(16))
                if let caption {
                    Text(caption)
                        .font(.system(size: 9, weight: .bold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(BWTheme.paper.opacity(0.6))
                        .clipShape(Capsule())
                }
            }
            .foregroundStyle(BWTheme.ink)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(
                LinearGradient(
                    colors: [BWTheme.amber, BWTheme.amberDeep],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .clipShape(Capsule())
            .shadow(color: BWTheme.amberDeep.opacity(0.28), radius: 12, x: 0, y: 8)
        }
        .buttonStyle(BWPressEffectStyle())
    }
}

/// 次级按钮：纸面 + 描边
struct BWSecondaryButton: View {
    let title: String
    var icon: String? = nil
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 13, weight: .semibold))
                }
                Text(title).font(BWTheme.title(15))
            }
            .foregroundStyle(BWTheme.ink2)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(BWTheme.paper2)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(BWTheme.line, lineWidth: 1))
        }
        .buttonStyle(BWPressEffectStyle())
    }
}

/// 圆形图标按钮
struct BWIconButton: View {
    let systemName: String
    var size: CGFloat = 34
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundStyle(BWTheme.ink2)
                .frame(width: size, height: size)
                .background(BWTheme.paper)
                .clipShape(Circle())
                .overlay(Circle().stroke(BWTheme.line, lineWidth: 1))
        }
        .buttonStyle(BWPressEffectStyle())
    }
}

/// 筛选 chip（胶囊小标签）
struct BWPill: View {
    let title: String
    var selected: Bool = false
    var action: () -> Void = {}

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(BWTheme.caption(12))
                .foregroundStyle(selected ? BWTheme.ink : BWTheme.ink2)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(selected ? BWTheme.amber.opacity(0.22) : BWTheme.paper)
                .clipShape(Capsule())
                .overlay(
                    Capsule().stroke(
                        selected ? BWTheme.amber.opacity(0.55) : BWTheme.line,
                        lineWidth: 1
                    )
                )
        }
        .buttonStyle(BWPressEffectStyle())
    }
}

// MARK: - 稀有度

struct BWRarityBadge: View {
    let rarity: Rarity

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(BWTheme.rarityColor(rarity))
                .frame(width: 6, height: 6)
            Text(rarity.label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(BWTheme.rarityColor(rarity))
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(BWTheme.raritySoft(rarity))
        .clipShape(Capsule())
        .overlay(
            Capsule().stroke(BWTheme.rarityColor(rarity).opacity(0.35), lineWidth: 1)
        )
    }
}

// MARK: - 统计

struct BWStatTile: View {
    let value: String
    let title: String

    var body: some View {
        VStack(spacing: 4) {
            Text(value)
                .font(BWTheme.display(22))
                .monospacedDigit()
                .foregroundStyle(BWTheme.ink)
            Text(title)
                .font(BWTheme.caption(11))
                .foregroundStyle(BWTheme.ink2)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - 盒子插画（线稿 + 「?」+ 暖光，Home / Reveal 共用）

struct BWBoxIllustration: View {
    var size: CGFloat = 120
    var floating: Bool = true
    var glow: Bool = true

    @State private var isFloating = false

    var body: some View {
        ZStack {
            if glow {
                Circle()
                    .fill(BWTheme.amber.opacity(0.22))
                    .frame(width: size * 0.95, height: size * 0.95)
                    .blur(radius: size * 0.16)
            }

            ZStack(alignment: .top) {
                // 盒体
                RoundedRectangle(cornerRadius: size * 0.08, style: .continuous)
                    .fill(BWTheme.paper2)
                    .overlay(
                        RoundedRectangle(cornerRadius: size * 0.08, style: .continuous)
                            .stroke(BWTheme.ink.opacity(0.55), lineWidth: 1.6)
                    )
                    .frame(width: size * 0.66, height: size * 0.48)
                    .overlay(
                        Text("?")
                            .font(.system(size: size * 0.24, weight: .bold, design: .rounded))
                            .foregroundStyle(BWTheme.amberDeep)
                            .offset(y: -size * 0.02)
                    )
                    .offset(y: size * 0.12)

                // 盒盖
                RoundedRectangle(cornerRadius: size * 0.04, style: .continuous)
                    .fill(BWTheme.amber.opacity(0.30))
                    .overlay(
                        RoundedRectangle(cornerRadius: size * 0.04, style: .continuous)
                            .stroke(BWTheme.ink.opacity(0.55), lineWidth: 1.6)
                    )
                    .frame(width: size * 0.72, height: size * 0.14)
                    .rotationEffect(.degrees(-1.5))
                    .offset(y: size * 0.02)

                // 盒缝里的暖光
                Capsule()
                    .fill(BWTheme.amber.opacity(0.75))
                    .frame(width: size * 0.56, height: 2)
                    .blur(radius: 1.5)
                    .offset(y: size * 0.10)
            }
            .offset(y: isFloating ? -size * 0.02 : size * 0.02)
        }
        .frame(width: size * 1.1, height: size * 1.05)
        .onAppear {
            guard floating else {
                isFloating = true
                return
            }
            withAnimation(.easeInOut(duration: 2.4).repeatForever(autoreverses: true)) {
                isFloating = true
            }
        }
    }
}

// MARK: - Toast

struct BWToast: Identifiable {
    let id: UUID
    let text: String
    let icon: String
    let tint: Color

    init(text: String, icon: String = "sparkles", tint: Color = BWTheme.amberDeep) {
        self.id = UUID()
        self.text = text
        self.icon = icon
        self.tint = tint
    }
}

struct BWToastView: View {
    let toast: BWToast
    var onDismiss: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: toast.icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(toast.tint)
            Text(toast.text)
                .font(BWTheme.caption(13))
                .foregroundStyle(BWTheme.ink)
                .lineLimit(2)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .background(BWTheme.paper)
        .clipShape(Capsule())
        .overlay(Capsule().stroke(BWTheme.line, lineWidth: 1))
        .shadow(color: BWTheme.ink.opacity(0.16), radius: 18, x: 0, y: 10)
        .onAppear {
            guard let onDismiss else { return }
            bwAfter(2.2) {
                onDismiss()
            }
        }
    }
}

struct BWAchievementToastView: View {
    let achievement: Achievement

    var body: some View {
        HStack(spacing: 12) {
            Text(achievement.icon)
                .font(.system(size: 22))
            VStack(alignment: .leading, spacing: 2) {
                Text("成就解锁")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(1)
                    .foregroundStyle(BWTheme.amberDeep)
                Text(achievement.name)
                    .font(BWTheme.title(14))
                    .foregroundStyle(BWTheme.ink)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(BWTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(BWTheme.amber.opacity(0.6), lineWidth: 1)
        )
        .shadow(color: BWTheme.ink.opacity(0.16), radius: 18, x: 0, y: 10)
    }
}

struct BWToastModifier: ViewModifier {
    @Binding var toast: BWToast?

    func body(content: Content) -> some View {
        let binding = $toast
        return content
            .overlay(alignment: .top) {
                if let toast {
                    BWToastView(
                        toast: toast,
                        onDismiss: {
                            withAnimation(BWAnimation.quick) {
                                if binding.wrappedValue?.id == toast.id {
                                    binding.wrappedValue = nil
                                }
                            }
                        }
                    )
                    .id(toast.id)
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .animation(BWAnimation.regular, value: toast?.id)
    }
}

extension View {
    func bwToast(_ toast: Binding<BWToast?>) -> some View {
        modifier(BWToastModifier(toast: toast))
    }
}
