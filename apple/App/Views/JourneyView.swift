import SwiftUI
import Foundation

// MARK: - 旅程 Journey（design-system §5.3，全屏）
//
// 结构：顶栏（盲盒进行中 + 计时 + 暂停）→ 抽象地图 → 距离 → 三阶线索 → 底部操作。
// 到达（≤30m）后播放「到了」闪屏，再全屏推入揭晓。

struct JourneyView: View {

    let store: BlindWalkStore
    var onClose: () -> Void
    var onCollected: (CollectResult) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// 演示默认使用模拟定位；真实版把这里换成 LiveLocationService。
    @State private var locationService = SimulatedLocationService()

    @State private var showReveal = false
    @State private var isPaused = false
    @State private var pauseStartedAt: Date?
    @State private var pausedDuration: TimeInterval = 0
    @State private var arrivalFlash = false
    @State private var hasTriggeredArrival = false

    var body: some View {
        ZStack {
            BWPaperBackground()

            if let session = store.session, let place = store.currentPlace {
                content(session: session, place: place)
            } else {
                emptyState
            }

            if arrivalFlash {
                arrivalOverlay
            }
        }
        .fullScreenCover(isPresented: $showReveal) {
            RevealView(store: store, onCollected: handleCollected)
        }
        .onAppear(perform: handleAppear)
    }

    // MARK: 主内容

    private func content(session: QuestSession, place: Place) -> some View {
        GeometryReader { geo in
            VStack(spacing: 0) {
                topBar(session: session)
                    .padding(.horizontal, BWTheme.pagePadding)
                    .padding(.top, 6)
                    .padding(.bottom, 10)

                // 抽象地图区：占屏高约 45%（design-system §5.3）
                mapSection(session: session)
                    .frame(height: max(220, geo.size.height * 0.45))
                    .padding(.horizontal, BWTheme.pagePadding)

                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 22) {
                        distanceSection(session: session)
                        clueSection(session: session, place: place)
                    }
                    .padding(.horizontal, BWTheme.pagePadding)
                    .padding(.top, 18)
                    .padding(.bottom, 16)
                }

                actionBar
                    .padding(.horizontal, BWTheme.pagePadding)
                    .padding(.top, 8)
                    .padding(.bottom, 10)
                    .background(BWTheme.cream)
            }
        }
    }

    // MARK: 顶栏

    private func topBar(session: QuestSession) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("盲盒进行中")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(BWTheme.amberDeep)

                TimelineView(.periodic(from: Date(), by: 1)) { context in
                    Text(BWFormat.clock(seconds: elapsedSeconds(at: context.date, session: session)))
                        .font(BWTheme.body(15))
                        .monospacedDigit()
                        .foregroundStyle(BWTheme.ink)
                }
            }

            Spacer(minLength: 0)

            Button(action: togglePause) {
                HStack(spacing: 4) {
                    Image(systemName: isPaused ? "play.fill" : "pause.fill")
                        .font(.system(size: 10, weight: .semibold))
                    Text(isPaused ? "继续" : "暂停")
                        .font(BWTheme.caption(11))
                }
                .foregroundStyle(BWTheme.ink2)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(BWTheme.paper2)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(BWTheme.line, lineWidth: 1))
            }
            .buttonStyle(BWPressEffectStyle())

            BWIconButton(systemName: "xmark", action: onClose)
        }
    }

    // MARK: 抽象地图

    private func mapSection(session: QuestSession) -> some View {
        ZStack(alignment: .topLeading) {
            JourneyMapView(
                progress: session.progress,
                remainingMeters: session.remainingMeters
            )

            HStack(spacing: 5) {
                Image(systemName: "eye.slash")
                    .font(.system(size: 9, weight: .semibold))
                Text("目的地保密中 · 还有 \(session.remainingMeters) 米")
                    .font(.system(size: 11, weight: .medium))
                    .italic()
            }
            .foregroundStyle(BWTheme.ink2)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(BWTheme.cream.opacity(0.88))
            .clipShape(Capsule())
            .overlay(Capsule().stroke(BWTheme.line, lineWidth: 1))
            .padding(12)
        }
    }

    // MARK: 距离

    private func distanceSection(session: QuestSession) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(session.remainingMeters)")
                    .font(BWTheme.display(54))
                    .monospacedDigit()
                    .foregroundStyle(BWTheme.ink)

                Text("米")
                    .font(BWTheme.title(18))
                    .foregroundStyle(BWTheme.ink2)

                Spacer(minLength: 8)

                Text(session.bearing)
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(BWTheme.amberDeep)
            }

            Text("沿河往北走，别急")
                .font(BWTheme.body(14))
                .foregroundStyle(BWTheme.ink2)

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(BWTheme.line)
                    Capsule()
                        .fill(BWTheme.amber)
                        .frame(width: max(0, geo.size.width * CGFloat(session.progress)))
                }
            }
            .frame(height: 5)
            .padding(.top, 4)

            Text("已走 \(session.totalMeters - session.remainingMeters) 米 · 共 \(session.totalMeters) 米")
                .font(BWTheme.caption(10))
                .foregroundStyle(BWTheme.ink3)
        }
    }

    // MARK: 三阶线索时间线

    private func clueSection(session: QuestSession, place: Place) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("线索")
                    .font(BWTheme.title(17))
                    .foregroundStyle(BWTheme.ink)
                Text("\(min(session.unlockedHintCount, 3))/3")
                    .font(BWTheme.caption(12))
                    .foregroundStyle(BWTheme.ink3)
                Spacer(minLength: 0)
            }

            ZStack(alignment: .leading) {
                Rectangle()
                    .fill(BWTheme.line)
                    .frame(width: 1)
                    .padding(.leading, 12)
                    .padding(.vertical, 20)

                VStack(spacing: 12) {
                    ForEach(0..<3, id: \.self) { index in
                        clueRow(index: index, session: session, place: place)
                    }
                }
            }
        }
    }

    private func clueRow(index: Int, session: QuestSession, place: Place) -> some View {
        let unlocked = index < session.unlockedHintCount
        let hint = index < place.hints.count ? place.hints[index] : ""

        return HStack(alignment: .top, spacing: 12) {
            clueIndicator(index: index, unlocked: unlocked)

            if unlocked {
                HStack(alignment: .top, spacing: 8) {
                    Text("✅").font(.system(size: 13))
                    Text(hint)
                        .font(BWTheme.body(14))
                        .foregroundStyle(BWTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(BWTheme.paper)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(BWTheme.line, lineWidth: 1)
                )
                .shadow(color: BWTheme.ink.opacity(0.06), radius: 10, x: 0, y: 6)
            } else {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "lock.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(BWTheme.ink3)
                    Text(lockedCopy(index: index, session: session))
                        .font(BWTheme.caption(13))
                        .foregroundStyle(BWTheme.ink3)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(BWTheme.paper2.opacity(0.55))
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(
                            BWTheme.line,
                            style: StrokeStyle(lineWidth: 1.2, dash: [5, 5])
                        )
                )
            }
        }
    }

    private func clueIndicator(index: Int, unlocked: Bool) -> some View {
        ZStack {
            Circle()
                .fill(unlocked ? BWTheme.teal.opacity(0.16) : BWTheme.paper2)
            Circle()
                .stroke(unlocked ? BWTheme.teal.opacity(0.4) : BWTheme.line, lineWidth: 1)
            if unlocked {
                Image(systemName: "checkmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(BWTheme.teal)
            } else {
                Text("\(index + 1)")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(BWTheme.ink3)
            }
        }
        .frame(width: 26, height: 26)
    }

    /// 待解锁文案：第一条未解锁的线索显示动态距离，更后面的显示「到了你就知道」
    private func lockedCopy(index: Int, session: QuestSession) -> String {
        guard index == session.unlockedHintCount,
              index < QuestSession.hintThresholds.count else {
            return "到了你就知道"
        }
        let threshold = QuestSession.hintThresholds[index]
        let gap = max(0, session.remainingMeters - threshold)
        return "再走 \(gap) 米，解锁第\(BWFormat.chineseIndex(index + 1))条线索"
    }

    // MARK: 底部操作

    private var actionBar: some View {
        VStack(spacing: 8) {
            BWPrimaryButton(
                title: "模拟步行 +50m",
                icon: "figure.walk",
                caption: "演示",
                action: simulateWalk
            )
            .disabled(isPaused)
            .opacity(isPaused ? 0.55 : 1)

            Button(action: arriveNow) {
                Text("我到了")
                    .font(BWTheme.title(14))
                    .foregroundStyle(BWTheme.ink2)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 11)
                    .background(BWTheme.paper2)
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(BWTheme.line, lineWidth: 1))
            }
            .buttonStyle(BWPressEffectStyle())
        }
    }

    // MARK: 到达闪屏

    private var arrivalOverlay: some View {
        ZStack {
            BWTheme.ink.opacity(0.94).ignoresSafeArea()

            VStack(spacing: 14) {
                Text("到了")
                    .font(BWTheme.display(46))
                    .foregroundStyle(BWTheme.paper)
                Text("这个地点，只为你亮一次。")
                    .font(BWTheme.body(14))
                    .foregroundStyle(BWTheme.paper.opacity(0.7))
            }
            .transition(.opacity)
        }
    }

    // MARK: 空状态

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "shippingbox")
                .font(.system(size: 40, weight: .light))
                .foregroundStyle(BWTheme.ink3)

            Text("现在没有正在走的盲盒。")
                .font(BWTheme.body(15))
                .foregroundStyle(BWTheme.ink2)

            Text("回到今日，开一个吧。")
                .font(BWTheme.caption(12))
                .foregroundStyle(BWTheme.ink3)

            BWSecondaryButton(title: "关闭", action: onClose)
                .frame(maxWidth: 160)
        }
        .padding(28)
    }

    // MARK: 计时

    private func elapsedSeconds(at date: Date, session: QuestSession) -> TimeInterval {
        let pausedNow = pauseStartedAt.map { date.timeIntervalSince($0) } ?? 0
        let total = date.timeIntervalSince(session.startedAt) - pausedDuration - pausedNow
        return max(0, total)
    }

    private func togglePause() {
        if isPaused {
            if let started = pauseStartedAt {
                pausedDuration += Date().timeIntervalSince(started)
            }
            pauseStartedAt = nil
            isPaused = false
        } else {
            pauseStartedAt = Date()
            isPaused = true
        }
        BWHaptics.light()
    }

    // MARK: 演示步行

    private func simulateWalk() {
        guard !isPaused else { return }

        let events = store.advance(byMeters: 50)
        locationService.simulateAdvance(meters: 50)
        locationService.sync(remaining: store.session?.remainingMeters)
        BWHaptics.light()
        handle(events: events)
    }

    private func arriveNow() {
        let events = store.arriveNow()
        handle(events: events)
    }

    private func handle(events: [QuestEvent]) {
        for event in events {
            switch event {
            case .hintUnlocked(let index):
                _ = index
                BWHaptics.medium()
            case .revealed:
                break
            case .arrived:
                triggerArrival()
            }
        }

        if store.session?.phase == .arrived {
            triggerArrival()
        }
    }

    private func triggerArrival() {
        guard !hasTriggeredArrival else { return }
        hasTriggeredArrival = true
        BWHaptics.success()

        if reduceMotion {
            showReveal = true
            return
        }

        withAnimation(BWAnimation.regular) {
            arrivalFlash = true
        }

        bwAfter(0.9) {
            withAnimation(BWAnimation.quick) {
                arrivalFlash = false
            }
            bwAfter(0.15) {
                showReveal = true
            }
        }
    }

    private func handleAppear() {
        locationService.sync(remaining: store.session?.remainingMeters)

        if store.session?.phase == .arrived || store.reveal != nil {
            triggerArrival()
        }
    }

    private func handleCollected(_ result: CollectResult) {
        showReveal = false
        bwAfter(0.5) {
            onCollected(result)
        }
    }
}
