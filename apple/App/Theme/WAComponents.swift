import SwiftUI

// MARK: - 纸面背景
// v3：底色是一条中性冷灰梯，不再叠噪点。
// 噪点纹理在 3x 屏上会因为缩放产生摩尔纹，视觉上就是「页面脏」。

struct WAPaperBackground: View {
    var body: some View {
        WATheme.cream.ignoresSafeArea()
    }
}

/// 保留旧名，避免改动其他页面的调用；v3 起它不再画任何噪点。
struct WAPaperTexture: View {
    var body: some View {
        Color.clear.allowsHitTesting(false)
    }
}

/// 小工具：可复现的伪随机（保留给插画使用）
struct WAPseudoRandom {
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

/// 分组卡片：系统卡片色 + 圆角。不加描边、不加投影——
/// 系统的「分组背景 / 卡片」两档色本身就分层，描边会让它重新变成网页卡片。
struct WACard<Content: View>: View {
    private let padding: CGFloat
    private let background: Color
    private let content: Content

    init(padding: CGFloat = 16, background: Color = WATheme.paper, @ViewBuilder content: () -> Content) {
        self.padding = padding
        self.background = background
        self.content = content()
    }

    var body: some View {
        content
            .padding(padding)
            .background(background)
            .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
    }
}

/// 发丝分割线（1 物理像素）
struct WAHairline: View {
    var body: some View {
        Rectangle()
            .fill(WATheme.line)
            .frame(height: 1 / UIScreen.main.scale)
    }
}

// MARK: - 文本

/// 小节微标：句首大写中文、不追踪。
/// v1 用的是「全大写 + 字距 .08em」的网页表单标签写法，中文上只会显得挤。
struct WAMicroLabel: View {
    private let text: String
    private let tint: Color

    init(_ text: String, tint: Color = WATheme.ink3) {
        self.text = text
        self.tint = tint
    }

    var body: some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(tint)
            .textCase(nil)
    }
}

/// 小节标题：与系统 Form section header 一致（小号、次要色、不追踪）
struct WASectionHeader: View {
    let title: String
    var trailingTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(title)
                .font(.headline)
                .foregroundStyle(WATheme.ink)

            Spacer(minLength: 0)

            if let trailingTitle, let action {
                Button(action: action) {
                    Text(trailingTitle)
                        .font(.subheadline)
                        .foregroundStyle(WATheme.amber)
                }
                .buttonStyle(.plain)
            } else if let trailingTitle {
                Text(trailingTitle)
                    .font(.subheadline)
                    .foregroundStyle(WATheme.ink2)
            }
        }
    }
}

// MARK: - 按钮

struct WAPressEffectStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.55 : 1)
    }
}

/// 主 CTA：系统填充按钮形态（tint 底 + 白字 + 高度 50 + 连续圆角）。
/// v4 去掉主色投影 —— iOS 的实心按钮不投影。
struct WAPrimaryButton: View {
    let title: String
    var icon: String? = nil
    var caption: String? = nil
    var height: CGFloat = 50
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 15, weight: .semibold))
                }
                Text(title)
                    .font(WAType.cta())
                if let caption {
                    Text(caption)
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1.5)
                        .background(Color.white.opacity(0.22))
                        .clipShape(Capsule())
                }
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .background(WATheme.amber)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(WAPressEffectStyle())
    }
}

/// 次级按钮：系统「灰色填充按钮」形态（secondarySystemFill 底 + 强调字）
struct WASecondaryButton: View {
    let title: String
    var icon: String? = nil
    var height: CGFloat = 46
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 14, weight: .semibold))
                }
                Text(title).font(WAType.cta(15))
            }
            .foregroundStyle(WATheme.amber)
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .background(Color(.secondarySystemFill))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(WAPressEffectStyle())
    }
}

/// 圆形图标按钮（导航栏里那种）：无描边、无底色，只有图标
struct WAIconButton: View {
    let systemName: String
    var size: CGFloat = 34
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: size * 0.46, weight: .regular))
                .foregroundStyle(WATheme.amber)
                .frame(width: size, height: size)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
    }
}

/// 筛选 chip：未选中 = 灰填充；选中 = 强调色填充 + 白字（系统 Segmented/Filter 的写法）
struct WAPill: View {
    let title: String
    var selected: Bool = false
    var action: () -> Void = {}

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(selected ? .semibold : .regular))
                .foregroundStyle(selected ? Color.white : WATheme.ink)
                .lineLimit(1)
                .padding(.horizontal, 14)
                .frame(height: 32)
                .background(selected ? WATheme.amber : Color(.secondarySystemFill))
                .clipShape(Capsule())
        }
        .buttonStyle(WAPressEffectStyle())
    }
}

// MARK: - 稀有度

/// 稀有度徽章：细描边 + 淡底，不用满圆药丸
struct WARarityBadge: View {
    let rarity: Rarity

    var body: some View {
        Text(rarity.label)
            .font(.caption2.weight(.medium))
            .foregroundStyle(WATheme.rarityColor(rarity))
            .padding(.horizontal, 6)
            .frame(height: 19)
            .background(WATheme.raritySoft(rarity))
            .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
    }
}

/// 稀有度小圆点
struct WARarityDot: View {
    let rarity: Rarity
    var size: CGFloat = 7

    var body: some View {
        Circle()
            .fill(WATheme.rarityColor(rarity))
            .frame(width: size, height: size)
    }
}

// MARK: - 统计

/// 首页快捷统计。v1 给每格加了一条左侧竖线（网页表格的写法），
/// v3 去掉竖线，改用间距分组 + 三档文字层级。
struct WAStatCell: View {
    let value: String
    let title: String

    var body: some View {
        VStack(alignment: .center, spacing: 2) {
            Text(value)
                .font(.title3.weight(.semibold))
                .foregroundStyle(WATheme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(title)
                .font(.caption)
                .foregroundStyle(WATheme.ink2)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
    }
}

/// 三栏统计：系统「分组卡片里的一行三列」形态
struct WAStatsRow: View {
    let items: [(String, String)]

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                WAStatCell(value: item.0, title: item.1)
                if index < items.count - 1 {
                    Divider().frame(height: 32)
                }
            }
        }
        .padding(.vertical, 14)
        .padding(.horizontal, 8)
        .background(WATheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
    }
}

// MARK: - 盒子线稿插画（与 web .boxart 同一套几何）
//
// viewBox 120 × 106：盒体 70×45 @(25,46)、盒盖 78×17.5 @(21,33.5)、
// 提绳两段贝塞尔 + 中缝竖线、盒面「?」、两粒琥珀点、背后暖光与地面投影。

struct WABoxIllustration: View {
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
            withAnimation(WAAnimation.floating) {
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
        let stroke = WATheme.ink.opacity(0.88)

        // 背后暖光
        if glow {
            context.fill(
                Path(ellipseIn: rect(27, 22, 66, 66)),
                with: .color(WATheme.amber.opacity(0.14))
            )
        }

        // 地面投影
        context.fill(
            Path(ellipseIn: rect(25, 89.5, 70, 11)),
            with: .color(WATheme.ink.opacity(0.08))
        )

        // 左侧提绳
        var leftCord = Path()
        leftCord.move(to: point(29, 53))
        leftCord.addCurve(
            to: point(46, 26),
            control1: point(29, 39),
            control2: point(37, 29)
        )
        context.stroke(leftCord, with: .color(WATheme.ink.opacity(0.28)), style: StrokeStyle(lineWidth: 1.3 * scale, lineCap: .round))

        // 盒体
        let body = RoundedRectangle(cornerRadius: 7 * scale, style: .continuous)
            .path(in: rect(25, 46, 70, 45))
        context.fill(body, with: .color(WAKraft.boxBody))
        context.stroke(body, with: .color(stroke), style: StrokeStyle(lineWidth: 1.7 * scale))

        // 盒盖
        let lid = RoundedRectangle(cornerRadius: 5 * scale, style: .continuous)
            .path(in: rect(21, 33.5, 78, 17.5))
        context.fill(lid, with: .color(WAKraft.boxLid))
        context.stroke(lid, with: .color(stroke), style: StrokeStyle(lineWidth: 1.7 * scale))

        // 盒体与盒盖之间的缝
        var seam = Path()
        seam.move(to: point(25, 53.5))
        seam.addLine(to: point(95, 53.5))
        context.stroke(seam, with: .color(WATheme.ink.opacity(0.30)), style: StrokeStyle(lineWidth: 1.1 * scale))

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
            with: .color(WATheme.ink.opacity(0.5)),
            style: StrokeStyle(lineWidth: 1.4 * scale, lineCap: .round)
        )

        // 「?」
        let question = context.resolve(
            Text("?")
                .font(.system(size: 24 * scale, weight: .bold))
                .foregroundStyle(WATheme.ink)
        )
        context.draw(question, at: point(60, 72), anchor: .center)

        // 两粒琥珀点
        context.fill(
            Path(ellipseIn: rect(72.8, 33.8, 4.4, 4.4)),
            with: .color(WATheme.amber)
        )
        context.fill(
            Path(ellipseIn: rect(29.6, 41.6, 2.8, 2.8)),
            with: .color(WATheme.amber.opacity(0.8))
        )
    }
}

// MARK: - 空状态插画（web .empty__art：虚线纸盒 + 「?」）

struct WAEmptyArt: View {
    var body: some View {
        ZStack {
            Circle()
                .fill(WATheme.amber.opacity(0.13))
                .frame(width: 54, height: 54)

            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .strokeBorder(
                    WATheme.ink3.opacity(0.85),
                    style: StrokeStyle(lineWidth: 1.4, dash: [4, 4])
                )
                .frame(width: 46, height: 32)
                .offset(y: 7)

            RoundedRectangle(cornerRadius: 3.5, style: .continuous)
                .strokeBorder(
                    WATheme.ink3.opacity(0.85),
                    style: StrokeStyle(lineWidth: 1.4, dash: [4, 4])
                )
                .frame(width: 52, height: 12)
                .offset(y: -9)

            Text("?")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(WATheme.ink3)
                .offset(y: 7)
        }
        .frame(width: 72, height: 62)
        .accessibilityHidden(true)
    }
}

/// 空状态（文案由调用方给，不在这里自创）
struct WAEmptyState: View {
    let title: String
    var subtitle: String? = nil
    var showsArt: Bool = true

    var body: some View {
        VStack(spacing: 7) {
            if showsArt {
                WAEmptyArt()
                    .padding(.bottom, 4)
            }
            Text(title)
                .font(WAType.body(13))
                .foregroundStyle(WATheme.ink2)
                .multilineTextAlignment(.center)
            if let subtitle {
                Text(subtitle)
                    .font(WAType.caption(11))
                    .foregroundStyle(WATheme.ink3)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 26)
        .padding(.horizontal, 20)
    }
}

// MARK: - Toast（web .toast：墨色药丸，贴底；成就 toast 用琥珀变体）

struct WAToast: Identifiable {
    let id: UUID
    let text: String
    let icon: String
    let tint: Color
    let isAmber: Bool

    init(text: String, icon: String = "sparkles", tint: Color = WATheme.amberDeep, isAmber: Bool = false) {
        self.id = UUID()
        self.text = text
        self.icon = icon
        self.tint = tint
        self.isAmber = isAmber
    }
}

struct WAToastView: View {
    let toast: WAToast
    var onDismiss: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 8) {
            if toast.icon.count <= 2, toast.icon.unicodeScalars.contains(where: { $0.properties.isEmoji }) {
                Text(toast.icon)
                    .font(.subheadline)
            } else {
                Image(systemName: toast.icon)
                    .font(.subheadline.weight(.semibold))
            }

            Text(toast.text)
                .font(.subheadline.weight(.medium))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(WATheme.amber)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .shadow(color: Color.black.opacity(0.18), radius: 12, x: 0, y: 6)
        .onAppear {
            guard let onDismiss else { return }
            waAfter(2.4) {
                onDismiss()
            }
        }
    }
}

/// 成就 toast：与普通 toast 同一造型，琥珀底（web variant: amber）
struct WAAchievementToastView: View {
    let achievement: Achievement

    var body: some View {
        WAToastView(
            toast: WAToast(
                text: "成就解锁 · \(achievement.name)",
                icon: achievement.icon,
                isAmber: true
            )
        )
    }
}

struct WAToastModifier: ViewModifier {
    @Binding var toast: WAToast?

    func body(content: Content) -> some View {
        let binding = $toast
        return content
            .overlay(alignment: .bottom) {
                if let toast {
                    WAToastView(
                        toast: toast,
                        onDismiss: {
                            withAnimation(WAAnimation.quick) {
                                if binding.wrappedValue?.id == toast.id {
                                    binding.wrappedValue = nil
                                }
                            }
                        }
                    )
                    .id(toast.id)
                    .padding(.horizontal, WATheme.pagePadding)
                    .padding(.bottom, 10)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(WAAnimation.regular, value: toast?.id)
    }
}

extension View {
    func waToast(_ toast: Binding<WAToast?>) -> some View {
        modifier(WAToastModifier(toast: toast))
    }
}
