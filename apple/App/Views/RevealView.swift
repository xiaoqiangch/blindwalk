import SwiftUI
import Foundation

// MARK: - 揭晓 Reveal（design-system §5.4，全屏覆盖）
//
// 两段：
// 1. 开盒（深色 ink 背景，盒子抖动 → 盒盖弹飞 + 暖光 + 纸屑，1.2s）
// 2. 卡片（奶油纸上的地点卡，-1.2° 微倾；收进图鉴 / 分享）

struct RevealView: View {

    let store: BlindWalkStore
    var onCollected: (CollectResult) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var didStart = false
    @State private var showCard = false

    // 开盒动画
    @State private var boxShake = false
    @State private var lidUp = false
    @State private var lightOn = false
    @State private var particlesOut = false
    @State private var particlesFade = false

    // 卡片交互
    @State private var taskDone = false
    @State private var hasShared = false
    @State private var hasCollected = false
    @State private var isCollecting = false
    @State private var toast: BWToast?
    @State private var achievementToast: Achievement?

    private var place: Place? {
        store.reveal?.place ?? store.currentPlace
    }

    private var serialText: String {
        let seed = UInt64(max(0, store.session?.startedAt.timeIntervalSince1970 ?? 0))
        return "No.\(BlindBoxEngine.serial(seed: seed))"
    }

    var body: some View {
        ZStack {
            if showCard {
                cardStage
                    .transition(.opacity)
            } else {
                openingStage
                    .transition(.opacity)
            }

            toastLayer
        }
        .animation(BWAnimation.slow, value: showCard)
        .interactiveDismissDisabled(true)
        .onAppear(perform: startOpening)
    }

    // MARK: - 第一段：开盒

    private var openingStage: some View {
        ZStack {
            BWTheme.ink.ignoresSafeArea()

            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            BWTheme.amber.opacity(lightOn ? 0.55 : 0.0),
                            BWTheme.amber.opacity(0.0)
                        ],
                        center: .center,
                        startRadius: 2,
                        endRadius: 200
                    )
                )
                .frame(width: 420, height: 420)
                .blur(radius: 12)

            VStack(spacing: 30) {
                ZStack {
                    particles

                    // 盒盖
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(BWTheme.paper2)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .stroke(BWTheme.ink.opacity(0.6), lineWidth: 2)
                        )
                        .frame(width: 150, height: 34)
                        .rotationEffect(.degrees(lidUp ? -26 : 0))
                        .offset(x: lidUp ? 36 : 0, y: lidUp ? -150 : -42)

                    // 盒体
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(BWTheme.paper2)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(BWTheme.ink.opacity(0.6), lineWidth: 2)
                        )
                        .overlay(
                            Text("?")
                                .font(.system(size: 54, weight: .bold, design: .rounded))
                                .foregroundStyle(BWTheme.amberDeep)
                        )
                        .frame(width: 140, height: 120)
                        .offset(y: 24)
                }
                .frame(height: 250)
                .rotationEffect(.degrees(boxShake ? 6 : -6))

                Text("这次，城市选了这个地方。")
                    .font(BWTheme.title(18))
                    .foregroundStyle(BWTheme.paper.opacity(lightOn ? 1.0 : 0.65))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
            }
        }
    }

    /// 纸屑粒子：固定 12 个方向，开盒瞬间向外飞再淡出
    private var particles: some View {
        ZStack {
            ForEach(0..<12, id: \.self) { index in
                particle(index: index)
            }
        }
    }

    private func particle(index: Int) -> some View {
        let angle = Double(index) / 12.0 * Double.pi * 2.0
        let distance = 100.0 + Double(index % 3) * 28.0
        let factor = particlesOut ? 1.0 : 0.12
        let diameter = 5.0 + Double(index % 3) * 2.0

        return Circle()
            .fill(index % 2 == 0 ? BWTheme.amber : BWTheme.ember)
            .frame(width: CGFloat(diameter), height: CGFloat(diameter))
            .offset(
                x: CGFloat(cos(angle) * distance * factor),
                y: CGFloat(sin(angle) * distance * factor)
            )
            .opacity(particlesFade ? 0.0 : (particlesOut ? 1.0 : 0.0))
    }

    // MARK: - 第二段：卡片

    private var cardStage: some View {
        ZStack {
            BWPaperBackground()

            if let place = place {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 18) {
                        Text("这次，城市选了这个地方。")
                            .font(BWTheme.caption(12))
                            .foregroundStyle(BWTheme.ink3)
                            .padding(.top, 10)

                        revealCard(place)

                        Text("这个地点，只为你亮一次。")
                            .font(BWTheme.caption(11))
                            .foregroundStyle(BWTheme.ink3)
                            .padding(.bottom, 24)
                    }
                    .padding(.horizontal, 28)
                    .padding(.top, 18)
                    .padding(.bottom, 16)
                }
            } else {
                Text("今晚的盲盒还没准备好。")
                    .font(BWTheme.body(15))
                    .foregroundStyle(BWTheme.ink2)
            }
        }
    }

    private func revealCard(_ place: Place) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    BWMicroLabel("今夜揭晓")
                    Text(serialText)
                        .font(BWTheme.caption(12))
                        .monospacedDigit()
                        .foregroundStyle(BWTheme.ink3)
                }
                Spacer(minLength: 8)
                BWRarityBadge(rarity: place.rarity)
            }
            .padding(.bottom, 18)

            VStack(spacing: 8) {
                Text(place.emoji)
                    .font(.system(size: 46))
                Text(place.name)
                    .font(BWTheme.title(24))
                    .foregroundStyle(BWTheme.ink)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                Text(BWFormat.areaName(place.area))
                    .font(BWTheme.caption(12))
                    .foregroundStyle(BWTheme.ink3)
            }
            .frame(maxWidth: .infinity)
            .padding(.bottom, 18)

            Rectangle()
                .fill(BWTheme.line)
                .frame(height: 1)

            VStack(alignment: .leading, spacing: 6) {
                Text("为什么是这里：")
                    .font(BWTheme.caption(12))
                    .foregroundStyle(BWTheme.ink2)
                Text(place.why)
                    .font(BWTheme.body(14))
                    .foregroundStyle(BWTheme.ink)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.vertical, 16)

            Rectangle()
                .fill(BWTheme.line)
                .frame(height: 1)

            taskCard(place)
                .padding(.top, 16)

            buttons
                .padding(.top, 18)
        }
        .padding(20)
        .background(BWTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous)
                .stroke(BWTheme.line, lineWidth: 1)
        )
        .shadow(color: BWTheme.ink.opacity(0.10), radius: 20, x: 0, y: 14)
        .rotationEffect(.degrees(-1.2))
        .scaleEffect(isCollecting ? 0.26 : 1)
        .opacity(isCollecting ? 0 : 1)
        .offset(y: isCollecting ? 240 : 0)
    }

    private func taskCard(_ place: Place) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("🎯 小任务")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(BWTheme.ink2)

            Text(place.task)
                .font(BWTheme.body(14))
                .foregroundStyle(BWTheme.ink)
                .fixedSize(horizontal: false, vertical: true)

            Button {
                guard !isCollecting else { return }
                taskDone.toggle()
                BWHaptics.light()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: taskDone ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 13, weight: .semibold))
                    Text(taskDone ? "已完成 · 很轻的一下" : "完成后点一下")
                        .font(BWTheme.caption(11))
                }
                .foregroundStyle(taskDone ? BWTheme.teal : BWTheme.ink3)
            }
            .buttonStyle(.plain)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BWTheme.paper2)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(BWTheme.line, lineWidth: 1)
        )
    }

    private var buttons: some View {
        HStack(spacing: 10) {
            Button(action: collectCard) {
                Text(hasCollected ? "已收进图鉴" : "收进图鉴")
                    .font(BWTheme.title(15))
                    .foregroundStyle(BWTheme.ink)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(
                        LinearGradient(
                            colors: [BWTheme.amber, BWTheme.amberDeep],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .clipShape(Capsule())
                    .shadow(color: BWTheme.amberDeep.opacity(0.25), radius: 10, x: 0, y: 6)
            }
            .buttonStyle(BWPressEffectStyle())
            .disabled(isCollecting)

            Button(action: shareToCircle) {
                Text(hasShared ? "已分享" : "分享")
                    .font(BWTheme.title(14))
                    .foregroundStyle(BWTheme.ink2)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(BWTheme.paper2)
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(BWTheme.line, lineWidth: 1))
            }
            .buttonStyle(BWPressEffectStyle())
            .frame(maxWidth: 104)
            .disabled(isCollecting)
        }
    }

    // MARK: - Toast

    private var toastLayer: some View {
        let binding = $toast

        return VStack(spacing: 8) {
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
            }

            if let achievementToast {
                BWAchievementToastView(achievement: achievementToast)
            }
        }
        .padding(.horizontal, BWTheme.pagePadding)
        .padding(.top, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .animation(BWAnimation.regular, value: toast?.id)
    }

    // MARK: - 动画时序

    private func startOpening() {
        guard !didStart else { return }
        didStart = true
        BWHaptics.success()

        if reduceMotion {
            store.beginReveal()
            withAnimation(BWAnimation.regular) {
                showCard = true
            }
            return
        }

        // 盒子抖动 600ms（±6° 三次）
        withAnimation(.easeInOut(duration: 0.10).repeatCount(6, autoreverses: true)) {
            boxShake = true
        }

        // 盒盖弹开 + 暖光 + 纸屑
        bwAfter(0.7) {
            withAnimation(.spring(response: 0.45, dampingFraction: 0.65)) {
                lidUp = true
                lightOn = true
                particlesOut = true
            }
            bwAfter(0.35) {
                withAnimation(BWAnimation.slow) {
                    particlesFade = true
                }
            }
        }

        // 1.2s 后切到卡片
        bwAfter(1.2) {
            store.beginReveal()
            withAnimation(BWAnimation.slow) {
                showCard = true
            }
        }
    }

    // MARK: - 收进图鉴

    private func collectCard() {
        guard !isCollecting else { return }

        guard let result = store.collect() else {
            withAnimation(BWAnimation.regular) {
                toast = BWToast(text: "这张卡已经在图鉴里了。", icon: "checkmark.seal")
            }
            return
        }

        hasCollected = true
        BWHaptics.success()

        // 卡片缩小飞向 Tab 图鉴
        withAnimation(BWAnimation.openBox) {
            isCollecting = true
        }

        withAnimation(BWAnimation.regular) {
            toast = BWToast(
                text: "已收录 · 惊喜值 +\(result.xpGained)",
                icon: "sparkles"
            )
        }

        // 成就 toast 延后 600ms
        if let achievement = result.newAchievements.first {
            bwAfter(0.6) {
                withAnimation(BWAnimation.regular) {
                    achievementToast = achievement
                }
            }
        }

        // 留出看 toast 的时间，再回到图鉴
        bwAfter(1.7) {
            onCollected(result)
        }
    }

    // MARK: - 分享到圈子

    private func shareToCircle() {
        guard !isCollecting else { return }
        guard let place = place else { return }

        let caption = "今晚捡到一个地方：\(place.name)。"
        _ = store.share(caption: caption)
        hasShared = true
        BWHaptics.light()

        withAnimation(BWAnimation.regular) {
            toast = BWToast(
                text: "已分享到圈子",
                icon: "paperplane.fill",
                tint: BWTheme.teal
            )
        }

        bwAfter(2.0) {
            withAnimation(BWAnimation.quick) {
                toast = nil
            }
        }
    }
}
