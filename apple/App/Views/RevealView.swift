import SwiftUI
import Foundation

// MARK: - 揭晓 Reveal（design-system §5.4，全屏覆盖；视觉基准：web 原型 #/reveal）
//
// 两段：
// 1. 开盒（深色 ink 背景，盒子抖动 → 盒盖弹飞 + 暖光 + 纸屑，1.2s）
// 2. 卡片（奶油纸上的地点卡，-1.2° 微倾；收进图鉴 / 分享）

struct RevealView: View {

    let store: BlindWalkStore
    var onCollected: (CollectResult) -> Void
    /// 可选：右上角「关闭」的回调。
    /// 由于揭晓页是从旅程页全屏推入的，只有调用方（JourneyView）能真正收起它；
    /// 没传就不显示关闭按钮，避免出现按了没反应 / 误跳到图鉴的路径。
    var onClose: (() -> Void)? = nil

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
    @State private var lastCollectedResult: CollectResult?
    @State private var toasts: [BWToast] = []

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
        .onAppear {
            // 仅用于截图/演示：`BW_PREVIEW_TOAST=1` 自动点一次「收进图鉴」，验证 toast 层级
            guard ProcessInfo.processInfo.environment["BW_PREVIEW_TOAST"] == "1" else { return }
            bwAfter(1.6) {
                guard showCard, !hasCollected else { return }
                collectCard()
            }
        }
    }

    // MARK: - 第一段：开盒

    private var openingStage: some View {
        ZStack {
            revealStageBackground

            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            BWTheme.amber.opacity(lightOn ? 0.50 : 0.0),
                            BWTheme.amber.opacity(0.0)
                        ],
                        center: .center,
                        startRadius: 2,
                        endRadius: 210
                    )
                )
                .frame(width: 400, height: 400)
                .blur(radius: 10)

            VStack(spacing: 26) {
                ZStack {
                    particles

                    // 盒盖
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .fill(BWKraft.boxLid)
                        .overlay(
                            RoundedRectangle(cornerRadius: 5, style: .continuous)
                                .stroke(BWTheme.ink.opacity(0.9), lineWidth: 1.8)
                        )
                        .frame(width: 156, height: 35)
                        .rotationEffect(.degrees(lidUp ? -26 : 0))
                        .offset(x: lidUp ? 36 : 0, y: lidUp ? -148 : -38)

                    // 盒体
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(BWKraft.boxBody)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .stroke(BWTheme.ink.opacity(0.9), lineWidth: 1.8)
                        )
                        .overlay(
                            Text("?")
                                .font(.system(size: 50, weight: .bold))
                                .foregroundStyle(BWTheme.ink)
                        )
                        .frame(width: 140, height: 92)
                        .offset(y: 26)
                }
                .frame(height: 246)
                .rotationEffect(.degrees(boxShake ? 6 : -6))

                Text("这次，城市选了这个地方。")
                    .font(.system(size: 14))
                    .tracking(0.3)
                    .foregroundStyle(BWTheme.cream.opacity(lightOn ? 0.92 : 0.62))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
            }
            .padding(.bottom, 40)
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
        let diameter = 4.0 + Double(index % 3) * 2.0

        return RoundedRectangle(cornerRadius: 1.5, style: .continuous)
            .fill(index % 2 == 0 ? BWTheme.amber : BWTheme.ember)
            .frame(width: CGFloat(diameter), height: CGFloat(diameter * 1.4))
            .offset(
                x: CGFloat(cos(angle) * distance * factor),
                y: CGFloat(sin(angle) * distance * factor)
            )
            .rotationEffect(.degrees(particlesOut ? Double(index) * 30 : 0))
            .opacity(particlesFade ? 0.0 : (particlesOut ? 1.0 : 0.0))
    }

    // MARK: - 第二段：卡片

    private var cardStage: some View {
        ZStack {
            // web 里揭晓卡始终浮在深色舞台上（与开盒阶段同一个底）
            revealStageBackground

            if let place = place {
                VStack(spacing: 0) {
                    stageBar
                    GeometryReader { geo in
                        ScrollView(showsIndicators: false) {
                            VStack(spacing: 0) {
                                revealCard(place)
                                Text("这个地点，只为你亮一次。")
                                    .font(.system(size: 10))
                                    .tracking(0.6)
                                    .foregroundStyle(BWTheme.cream.opacity(0.42))
                                    .padding(.top, 14)
                            }
                            .padding(.horizontal, 26)
                            .padding(.vertical, 12)
                            .frame(maxWidth: .infinity)
                            .frame(minHeight: geo.size.height, alignment: .center)
                        }
                    }
                }
            } else {
                BWEmptyState(title: "今晚的盲盒还没准备好。", showsArt: false)
            }
        }
    }

    private var revealStageBackground: some View {
        RadialGradient(
            colors: [
                Color.bwMix(BWTheme.ink, BWTheme.amberDeep, 0.16),
                Color.bwMix(BWTheme.ink, BWTheme.amberDeep, 0.06),
                BWTheme.ink
            ],
            center: UnitPoint(x: 0.5, y: 0.26),
            startRadius: 12,
            endRadius: 460
        )
        .ignoresSafeArea()
    }

    /// 顶栏：左计时，右关闭（web .reveal-stage__bar）
    private var stageBar: some View {
        HStack {
            TimelineView(.periodic(from: Date(), by: 20)) { context in
                Text(BWFormat.clock(seconds: elapsed(context.date)))
                    .font(.system(size: 13, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(BWTheme.cream.opacity(0.92))
            }

            Spacer(minLength: 0)

            // 只有调用方提供了真正的「收起」时才显示关闭：
            // 否则按下去会跳到图鉴，反而是误导性的假按钮。
            if let onClose {
                Button {
                    guard !isCollecting else { return }
                    onClose()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(BWTheme.cream.opacity(0.72))
                        .frame(width: 30, height: 30)
                        .background(BWTheme.cream.opacity(0.08))
                        .clipShape(Circle())
                        .overlay(Circle().stroke(BWTheme.cream.opacity(0.14), lineWidth: 1))
                }
                .buttonStyle(BWPressEffectStyle())
                .accessibilityLabel("关闭揭晓")
            }
        }
        .padding(.horizontal, BWTheme.pagePadding)
        .frame(height: 46)
    }

    private func revealCard(_ place: Place) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center) {
                Text(serialText)
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(1)
                    .monospacedDigit()
                    .foregroundStyle(BWTheme.ink3)

                Spacer(minLength: 8)

                BWRarityBadge(rarity: place.rarity)
            }
            .padding(.bottom, 13)

            VStack(spacing: 7) {
                Text(place.emoji)
                    .font(.system(size: 46))
                Text(place.name)
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(BWTheme.ink)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                Text("\(BWFormat.areaName(place.area)) · \(place.category)")
                    .font(.system(size: 10.5))
                    .tracking(0.8)
                    .foregroundStyle(BWTheme.ink3)
            }
            .frame(maxWidth: .infinity)
            .padding(.bottom, 11)

            BWHairline()

            VStack(alignment: .leading, spacing: 6) {
                BWMicroLabel("为什么是这里：")
                Text(place.why)
                    .font(.system(size: 13))
                    .foregroundStyle(BWTheme.ink2)
                    .lineSpacing(5)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.vertical, 12)

            BWHairline()

            taskCard(place)
                .padding(.top, 12)

            buttons
                .padding(.top, 14)

            if hasCollected {
                Text("它现在是你的了。")
                    .font(.system(size: 10))
                    .tracking(0.5)
                    .foregroundStyle(BWTheme.ink3)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 9)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 17)
        .padding(.bottom, 18)
        .background(BWTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous))
        .shadow(color: BWTheme.ink.opacity(0.30), radius: 32, x: 0, y: 20)
        .rotationEffect(.degrees(-1.2))
        .scaleEffect(isCollecting ? 0.26 : 1)
        .opacity(isCollecting ? 0 : 1)
        .offset(y: isCollecting ? 250 : 0)
    }

    private func taskCard(_ place: Place) -> some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 3) {
                    Text("🎯").font(.system(size: 10))
                    BWMicroLabel("小任务：")
                }
                Text(place.task)
                    .font(.system(size: 12.5))
                    .foregroundStyle(BWTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)

            Button {
                guard !isCollecting else { return }
                taskDone.toggle()
                BWHaptics.light()
            } label: {
                Text(taskDone ? "已完成" : "完成后点一下")
                    .font(.system(size: 9.5))
                    .foregroundStyle(taskDone ? BWTheme.teal : BWTheme.ink3)
                    .padding(.top, 1)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BWTheme.paper2)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(BWTheme.line, lineWidth: 1)
        )
    }

    private var buttons: some View {
        HStack(spacing: 8) {
            Button(action: collectCard) {
                Text(hasCollected ? "去看看图鉴" : "收进图鉴")
                    .font(BWType.cta(14))
                    .foregroundStyle(BWTheme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                    .frame(maxWidth: .infinity)
                    .frame(height: 46)
                    .background(BWTheme.amber)
                    .clipShape(Capsule())
                    .shadow(color: BWTheme.amberDeep.opacity(0.28), radius: 12, x: 0, y: 6)
            }
            .buttonStyle(BWPressEffectStyle())
            .disabled(isCollecting)
            .layoutPriority(1.45)

            Button(action: shareToCircle) {
                Text(hasShared ? "已分享" : "分享")
                    .font(BWType.cta(14))
                    .foregroundStyle(BWTheme.ink2)
                    .lineLimit(1)
                    .frame(width: 96)
                    .frame(height: 46)
                    .overlay(Capsule().stroke(BWTheme.line, lineWidth: 1))
            }
            .buttonStyle(BWPressEffectStyle())
            .disabled(isCollecting || hasShared)
        }
    }

    // MARK: - Toast（贴底堆叠；成就 toast 用琥珀变体）

    private var toastLayer: some View {
        VStack(spacing: 8) {
            Spacer(minLength: 0)
            ForEach(toasts) { toast in
                BWToastView(toast: toast) {
                    withAnimation(BWAnimation.quick) {
                        toasts.removeAll { $0.id == toast.id }
                    }
                }
                .id(toast.id)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .padding(.horizontal, BWTheme.pagePadding)
        .padding(.bottom, 40)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .animation(BWAnimation.regular, value: toasts.map(\.id))
        .allowsHitTesting(false)
    }

    private func appendToast(_ toast: BWToast) {
        withAnimation(BWAnimation.regular) {
            toasts.append(toast)
        }
    }

    // MARK: - 动画时序

    private func elapsed(_ date: Date) -> TimeInterval {
        guard let startedAt = store.session?.startedAt else { return 0 }
        return date.timeIntervalSince(startedAt)
    }

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

        if hasCollected {
            dismissReveal()
            return
        }

        guard let result = store.collect() else {
            appendToast(BWToast(text: "这张卡已经在图鉴里了。", icon: "checkmark.seal"))
            return
        }

        hasCollected = true
        BWHaptics.success()

        // 卡片缩小飞向 Tab 图鉴，飞完再落回原位（web 同款：卡片留在原地并显示「它现在是你的了」）
        withAnimation(BWAnimation.openBox) {
            isCollecting = true
        }
        bwAfter(0.62) {
            withAnimation(BWAnimation.slow) {
                isCollecting = false
            }
        }

        appendToast(BWToast(text: "已收录 · 惊喜值 +\(result.xpGained)", icon: "sparkles"))

        // 成就 toast 延后 600ms（web 640ms）
        if let achievement = result.newAchievements.first {
            bwAfter(0.64) {
                appendToast(
                    BWToast(
                        text: "成就解锁 · \(achievement.name)",
                        icon: achievement.icon,
                        isAmber: true
                    )
                )
            }
        }

        // 不自动关：与 web 一致，收进图鉴后卡片停留并显示「它现在是你的了」，
        // toast 完整播完；用户点「去看看图鉴」或右上角关闭再返回。
        lastCollectedResult = result
    }

    private func dismissReveal() {
        guard !isCollecting else { return }
        if let lastCollectedResult {
            onCollected(lastCollectedResult)
            return
        }
        onCollected(
            CollectResult(
                card: store.card(for: place?.id ?? "") ?? PlaceCard(
                    placeID: place?.id ?? "",
                    serial: "",
                    collectedAt: Date(),
                    taskDone: taskDone
                ),
                xpGained: 0,
                newAchievements: []
            )
        )
    }

    // MARK: - 分享到圈子

    private func shareToCircle() {
        guard !isCollecting, !hasShared else { return }
        guard let place = place else { return }

        let caption = "今晚捡到一个地方：\(place.name)。"
        _ = store.share(caption: caption)
        hasShared = true
        BWHaptics.light()

        appendToast(BWToast(text: "已分享到圈子", icon: "paperplane.fill", tint: BWTheme.teal))
    }
}
