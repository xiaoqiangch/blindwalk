import SwiftUI

// MARK: - 纸面背景
// 「黄昏的旧地图」：奶油纸底 + 极低透明度纸纹（design-system §3）。

struct BWPaperBackground: View {
    var body: some View {
        ZStack {
            BWTheme.cream
            BWPaperTexture()
        }
        .ignoresSafeArea()
    }
}

/// 简化纸纹：确定性伪随机噪点，替代 web 的 feTurbulence。
/// web 纸纹 opacity .035，这里只取极淡的一层，避免页面「脏」。
struct BWPaperTexture: View {
    var body: some View {
        Canvas { context, size in
            var random = BWPseudoRandom(seed: 0xB1_1D_2A_1C)
            let count = 90
            for _ in 0..<count {
                let x = random.nextDouble() * size.width
                let y = random.nextDouble() * size.height
                let radius = 0.5 + random.nextDouble() * 1.3
                let rect = CGRect(x: x, y: y, width: radius, height: radius)
                context.fill(Path(ellipseIn: rect), with: .color(BWTheme.ink.opacity(0.035)))
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

/// 纸卡：24pt 圆角 + 发丝描边 + 极轻阴影（web 卡片的阴影几乎不可见）。
struct BWCard<Content: View>: View {
    private let padding: CGFloat
    private let background: Color
    private let content: Content

    init(padding: CGFloat = 18, background: Color = BWTheme.paper, @ViewBuilder content: () -> Content) {
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
            .shadow(color: BWTheme.ink.opacity(0.05), radius: 10, x: 0, y: 6)
    }
}

/// 发丝分割线
struct BWHairline: View {
    var body: some View {
        Rectangle()
            .fill(BWTheme.line)
            .frame(height: 1)
    }
}

// MARK: - 文本

/// 微标：10pt + 字距（design-system §3 微标 10/12，字距 .08em）
struct BWMicroLabel: View {
    private let text: String
    private let tint: Color

    init(_ text: String, tint: Color = BWTheme.ink3) {
        self.text = text
        self.tint = tint
    }

    var body: some View {
        Text(text)
            .font(BWType.micro())
            .tracking(0.9)
            .foregroundStyle(tint)
    }
}

/// 小节标题：web 里所有分节标题都是一枚很小的灰色追踪标签，
/// 而不是粗体大标题 —— 这是「像设计稿」和「像 AI 生成」的分界线。
struct BWSectionHeader: View {
    let title: String
    var trailingTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(title)
                .font(BWType.micro())
                .tracking(1.1)
                .foregroundStyle(BWTheme.ink3)

            Spacer(minLength: 0)

            if let trailingTitle, let action {
                Button(action: action) {
                    HStack(spacing: 2) {
                        Text(trailingTitle).font(BWType.caption(10.5))
                        Image(systemName: "chevron.right")
                            .font(.system(size: 8, weight: .semibold))
                    }
                    .foregroundStyle(BWTheme.ink3)
                }
                .buttonStyle(BWPressEffectStyle())
            } else if let trailingTitle {
                Text(trailingTitle)
                    .font(BWType.caption(10.5))
                    .foregroundStyle(BWTheme.ink3)
            }
        }
    }
}

// MARK: - 按钮

struct BWPressEffectStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .opacity(configuration.isPressed ? 0.88 : 1)
            .animation(BWAnimation.quick, value: configuration.isPressed)
    }
}

/// 琥珀主 CTA（web .btn--primary：纯色、贴纸感、不堆渐变）
struct BWPrimaryButton: View {
    let title: String
    var icon: String? = nil
    var caption: String? = nil
    var height: CGFloat = 52
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 15, weight: .semibold))
                }
                Text(title)
                    .font(BWType.cta())
                if let caption {
                    Text(caption)
                        .font(.system(size: 8.5, weight: .bold))
                        .tracking(0.4)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1.5)
                        .background(BWTheme.ink.opacity(0.10))
                        .clipShape(Capsule())
                }
            }
            .foregroundStyle(BWTheme.ink)
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .background(BWTheme.amber)
            .clipShape(Capsule())
            .shadow(color: BWTheme.amberDeep.opacity(0.35), radius: 14, x: 0, y: 8)
        }
        .buttonStyle(BWPressEffectStyle())
    }
}

/// 次级按钮：透明底 + 发丝描边（web .btn--ghost）
struct BWSecondaryButton: View {
    let title: String
    var icon: String? = nil
    var height: CGFloat = 46
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 13, weight: .semibold))
                }
                Text(title).font(BWType.cta(14))
            }
            .foregroundStyle(BWTheme.ink2)
            .frame(maxWidth: .infinity)
            .frame(height: height)
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
                .font(.system(size: size * 0.42, weight: .semibold))
                .foregroundStyle(BWTheme.ink2)
                .frame(width: size, height: size)
                .background(BWTheme.paper)
                .clipShape(Circle())
                .overlay(Circle().stroke(BWTheme.line, lineWidth: 1))
        }
        .buttonStyle(BWPressEffectStyle())
    }
}

/// 筛选 chip（web .chipbtn：选中 = 墨色底 + 奶油字）
struct BWPill: View {
    let title: String
    var selected: Bool = false
    var action: () -> Void = {}

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 12.5, weight: .semibold))
                .foregroundStyle(selected ? BWTheme.cream : BWTheme.ink2)
                .lineLimit(1)
                .padding(.horizontal, 16)
                .frame(height: 34)
                .background(selected ? BWTheme.ink : BWTheme.paper)
                .clipShape(Capsule())
                .overlay(
                    Capsule().stroke(selected ? BWTheme.ink : BWTheme.line, lineWidth: 1)
                )
        }
        .buttonStyle(BWPressEffectStyle())
    }
}

// MARK: - 稀有度

/// 稀有度徽章（web .badge：22 高、10.5 / 700、淡底 + 细描边）
struct BWRarityBadge: View {
    let rarity: Rarity

    var body: some View {
        Text(rarity.label)
            .font(.system(size: 10.5, weight: .bold))
            .tracking(0.2)
            .foregroundStyle(BWTheme.rarityColor(rarity))
            .padding(.horizontal, 9)
            .frame(height: 22)
            .background(BWTheme.raritySoft(rarity))
            .clipShape(Capsule())
            .overlay(
                Capsule().stroke(BWTheme.rarityColor(rarity).opacity(0.34), lineWidth: 1)
            )
    }
}

/// 稀有度小圆点
struct BWRarityDot: View {
    let rarity: Rarity
    var size: CGFloat = 7

    var body: some View {
        Circle()
            .fill(BWTheme.rarityColor(rarity))
            .frame(width: size, height: size)
    }
}

// MARK: - 统计

/// 首页快捷统计（web .stat：无卡片底、左侧发丝分隔、数字 19/700）
struct BWStatCell: View {
    let value: String
    let title: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(value)
                .font(BWType.number(19))
                .monospacedDigit()
                .foregroundStyle(BWTheme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(title)
                .font(BWType.caption(10.5))
                .foregroundStyle(BWTheme.ink3)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, 14)
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(BWTheme.line)
                .frame(width: 1)
                .padding(.vertical, 2)
        }
    }
}

/// 三栏统计行（第一栏不带左侧分隔线）
struct BWStatsRow: View {
    let items: [(String, String)]

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            VStack(alignment: .leading, spacing: 3) {
                Text(items[0].0)
                    .font(BWType.number(19))
                    .monospacedDigit()
                    .foregroundStyle(BWTheme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(items[0].1)
                    .font(BWType.caption(10.5))
                    .foregroundStyle(BWTheme.ink3)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            ForEach(1..<items.count, id: \.self) { index in
                BWStatCell(value: items[index].0, title: items[index].1)
            }
        }
    }
}

// MARK: - 盒子线稿插画（与 web .boxart 同一套几何）
//
// viewBox 120 × 106：盒体 70×45 @(25,46)、盒盖 78×17.5 @(21,33.5)、
// 提绳两段贝塞尔 + 中缝竖线、盒面「?」、两粒琥珀点、背后暖光与地面投影。

struct BWBoxIllustration: View {
    var width: CGFloat = 118
    var floating: Bool = true
    var glow: Bool = true

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var floatOffset: CGFloat = 0

    var body: some View {
        Canvas { context, size in
            let scale = min(size.width / 120, size.height / 106)
            let origin = CGPoint(
                x: (size.width - 120 * scale) / 2,
                y: (size.height - 106 * scale) / 2
            )
            draw(in: &context, origin: origin, scale: scale)
        }
        .frame(width: width, height: width * 106 / 120)
        .offset(y: floatOffset)
        .onAppear {
            guard floating, !reduceMotion else { return }
            withAnimation(BWAnimation.floating) {
                floatOffset = -3.5
            }
        }
        .accessibilityHidden(true)
    }

    private func draw(in context: inout GraphicsContext, origin: CGPoint, scale: CGFloat) {
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: origin.x + x * scale, y: origin.y + y * scale)
        }
        func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> CGRect {
            CGRect(x: origin.x + x * scale, y: origin.y + y * scale, width: w * scale, height: h * scale)
        }
        let stroke = BWTheme.ink.opacity(0.88)

        // 背后暖光
        if glow {
            context.fill(
                Path(ellipseIn: rect(27, 22, 66, 66)),
                with: .color(BWTheme.amber.opacity(0.14))
            )
        }

        // 地面投影
        context.fill(
            Path(ellipseIn: rect(25, 89.5, 70, 11)),
            with: .color(BWTheme.ink.opacity(0.08))
        )

        // 左侧提绳
        var leftCord = Path()
        leftCord.move(to: point(29, 53))
        leftCord.addCurve(
            to: point(46, 26),
            control1: point(29, 39),
            control2: point(37, 29)
        )
        context.stroke(leftCord, with: .color(BWTheme.ink.opacity(0.28)), style: StrokeStyle(lineWidth: 1.3 * scale, lineCap: .round))

        // 盒体
        let body = RoundedRectangle(cornerRadius: 7 * scale, style: .continuous)
            .path(in: rect(25, 46, 70, 45))
        context.fill(body, with: .color(BWKraft.boxBody))
        context.stroke(body, with: .color(stroke), style: StrokeStyle(lineWidth: 1.7 * scale))

        // 盒盖
        let lid = RoundedRectangle(cornerRadius: 5 * scale, style: .continuous)
            .path(in: rect(21, 33.5, 78, 17.5))
        context.fill(lid, with: .color(BWKraft.boxLid))
        context.stroke(lid, with: .color(stroke), style: StrokeStyle(lineWidth: 1.7 * scale))

        // 盒体与盒盖之间的缝
        var seam = Path()
        seam.move(to: point(25, 53.5))
        seam.addLine(to: point(95, 53.5))
        context.stroke(seam, with: .color(BWTheme.ink.opacity(0.30)), style: StrokeStyle(lineWidth: 1.1 * scale))

        // 提绳：两段拱 + 中缝
        var handle = Path()
        handle.move(to: point(39.5, 33.5))
        handle.addCurve(to: point(54, 21), control1: point(41.1, 26.1), control2: point(47.1, 21))
        handle.move(to: point(64, 21))
        handle.addCurve(to: point(78.5, 33.5), control1: point(71, 21), control2: point(77, 26.1))
        handle.move(to: point(60, 21))
        handle.addLine(to: point(60, 33.5))
        context.stroke(
            handle,
            with: .color(BWTheme.ink.opacity(0.5)),
            style: StrokeStyle(lineWidth: 1.4 * scale, lineCap: .round)
        )

        // 「?」
        let question = context.resolve(
            Text("?")
                .font(.system(size: 24 * scale, weight: .bold))
                .foregroundStyle(BWTheme.ink)
        )
        context.draw(question, at: point(60, 72), anchor: .center)

        // 两粒琥珀点
        context.fill(
            Path(ellipseIn: rect(72.8, 33.8, 4.4, 4.4)),
            with: .color(BWTheme.amber)
        )
        context.fill(
            Path(ellipseIn: rect(29.6, 41.6, 2.8, 2.8)),
            with: .color(BWTheme.amber.opacity(0.8))
        )
    }
}

// MARK: - 空状态插画（web .empty__art：虚线纸盒 + 「?」）

struct BWEmptyArt: View {
    var body: some View {
        ZStack {
            Circle()
                .fill(BWTheme.amber.opacity(0.13))
                .frame(width: 54, height: 54)

            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .strokeBorder(
                    BWTheme.ink3.opacity(0.85),
                    style: StrokeStyle(lineWidth: 1.4, dash: [4, 4])
                )
                .frame(width: 46, height: 32)
                .offset(y: 7)

            RoundedRectangle(cornerRadius: 3.5, style: .continuous)
                .strokeBorder(
                    BWTheme.ink3.opacity(0.85),
                    style: StrokeStyle(lineWidth: 1.4, dash: [4, 4])
                )
                .frame(width: 52, height: 12)
                .offset(y: -9)

            Text("?")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(BWTheme.ink3)
                .offset(y: 7)
        }
        .frame(width: 72, height: 62)
        .accessibilityHidden(true)
    }
}

/// 空状态（文案由调用方给，不在这里自创）
struct BWEmptyState: View {
    let title: String
    var subtitle: String? = nil
    var showsArt: Bool = true

    var body: some View {
        VStack(spacing: 7) {
            if showsArt {
                BWEmptyArt()
                    .padding(.bottom, 4)
            }
            Text(title)
                .font(BWType.body(13))
                .foregroundStyle(BWTheme.ink2)
                .multilineTextAlignment(.center)
            if let subtitle {
                Text(subtitle)
                    .font(BWType.caption(11))
                    .foregroundStyle(BWTheme.ink3)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 26)
        .padding(.horizontal, 20)
    }
}

// MARK: - Toast（web .toast：墨色药丸，贴底；成就 toast 用琥珀变体）

struct BWToast: Identifiable {
    let id: UUID
    let text: String
    let icon: String
    let tint: Color
    let isAmber: Bool

    init(text: String, icon: String = "sparkles", tint: Color = BWTheme.amberDeep, isAmber: Bool = false) {
        self.id = UUID()
        self.text = text
        self.icon = icon
        self.tint = tint
        self.isAmber = isAmber
    }
}

struct BWToastView: View {
    let toast: BWToast
    var onDismiss: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 9) {
            if toast.icon.count <= 2, toast.icon.unicodeScalars.contains(where: { $0.properties.isEmoji }) {
                Text(toast.icon)
                    .font(.system(size: 13))
            } else {
                Image(systemName: toast.icon)
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(toast.isAmber ? BWTheme.ink : BWTheme.amber)
            }

            Text(toast.text)
                .font(.system(size: 12.5, weight: .semibold))
                .foregroundStyle(toast.isAmber ? BWTheme.ink : BWTheme.cream)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .background {
            if toast.isAmber {
                LinearGradient(
                    colors: [BWTheme.amber, BWTheme.amberDeep],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            } else {
                BWTheme.ink
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        // 深色舞台（揭晓页）上墨色药丸会和底色混在一起，加一道极淡亮边分离；
        // 奶油纸底上这条边几乎不可见，不影响克制感。
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(BWTheme.cream.opacity(0.16), lineWidth: 1)
        )
        .shadow(color: BWTheme.ink.opacity(0.28), radius: 18, x: 0, y: 10)
        .onAppear {
            guard let onDismiss else { return }
            bwAfter(2.4) {
                onDismiss()
            }
        }
    }
}

/// 成就 toast：与普通 toast 同一造型，琥珀底（web variant: amber）
struct BWAchievementToastView: View {
    let achievement: Achievement

    var body: some View {
        BWToastView(
            toast: BWToast(
                text: "成就解锁 · \(achievement.name)",
                icon: achievement.icon,
                isAmber: true
            )
        )
    }
}

struct BWToastModifier: ViewModifier {
    @Binding var toast: BWToast?

    func body(content: Content) -> some View {
        let binding = $toast
        return content
            .overlay(alignment: .bottom) {
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
                    .padding(.horizontal, BWTheme.pagePadding)
                    .padding(.bottom, 10)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
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
