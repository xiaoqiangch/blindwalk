import SwiftUI
import Foundation
import UIKit

// MARK: - 旅程 Journey（design-system §5.3，全屏）
//
// 结构：顶栏（盲盒进行中 + 计时 + 暂停）→ 定位状态 → 抽象地图 → 距离 → 三阶线索 → 底部操作。
// 到达（≤30m）后播放「到了」闪屏，再全屏推入揭晓。
//
// 定位策略（真实 GPS 优先，演示兜底）：
// 1. 进入即启动 `LiveLocationService`，首次进入会弹定位授权；
// 2. 每次定位回调 → 算「到目的地的距离 + 方位角」→ 写进 `BlindWalkStore.updateLocation`，
//    由 Shared 层推进线索解锁 / 到达判定（≤30m 自动开盒）；
// 3. 如果当前会话没有真实目的地（演示数据 / 抽盒时没拿到定位），拿到第一个定位点后
//    用「当前位置 + 剩余距离 + 固定方向」补一个真实目的地，保证真实 GPS 也能走；
// 4. 权限被拒 / 长时间拿不到定位 / 用户主动选择 → 切演示模式（+50m），绝不黑屏假死。
// 5. 箭头：在真实定位 + 拿到 heading 时按「相对手机朝向」旋转（bearing - heading），
//    这样「↑」永远表示往前直走，符合盲走用户的实际使用方式。

struct JourneyView: View {

    let store: BlindWalkStore
    var onClose: () -> Void
    var onCollected: (CollectResult) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase

    /// 演示兜底服务（保留 +50m 能力）
    @State private var demoService = SimulatedLocationService()
    /// 真实定位服务，首次 onAppear 才创建（避免 View 反复初始化时重复建 CLLocationManager）
    @State private var liveService: LiveLocationService?

    /// 当前定位模式
    @State private var locationMode: JourneyLocationMode = .waiting
    /// 定位权限（来自 LiveLocationService）
    @State private var authorization: LocationAuthorization = .notDetermined
    /// 最近一次有效定位读数
    @State private var lastReading: LocationReading?
    /// 已走轨迹（真实地图上画出来；只画走过的，不画终点）
    @State private var walkedTrail: [GeoPoint] = []
    /// 手机朝向（真机才有）
    @State private var headingDegrees: Double?
    /// 用户主动选择「用演示模式继续」
    @State private var choseDemo = false
    /// 等太久没定位 → 先允许演示
    @State private var fixTimedOut = false
    /// 会话没有真实目的地时，是否可以在首个定位点补一个
    @State private var canAdoptTarget = false
    /// 上次写入 store 的剩余距离（避免朝向变化时重复推进业务状态）
    @State private var lastSentRemaining: Double?
    /// 是否已经做过「首个定位点合理性检查」（目的地是否离当前位置离谱地远）
    @State private var didValidateFirstFix = false
    /// 定位状态的细节文案（信号弱 / 定位失败等）
    @State private var locatingIssue: String?

    @State private var showReveal = false
    @State private var isPaused = false
    @State private var pauseStartedAt: Date?
    @State private var pausedDuration: TimeInterval = 0
    @State private var arrivalFlash = false
    @State private var hasTriggeredArrival = false
    /// 「这是编辑精选的地点」提示（抽到后台策展点后短暂出现）
    @State private var curatedNoticeVisible = false

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

            if curatedNoticeVisible {
                curatedNotice
            }
        }
        .fullScreenCover(isPresented: $showReveal) {
            RevealView(
                store: store,
                onCollected: handleCollected,
                onClose: { showReveal = false }
            )
        }
        .onAppear(perform: handleAppear)
        .onDisappear(perform: handleDisappear)
        .onChange(of: scenePhase) { _, phase in
            // 从「设置」改完权限回来：重新尝试真实定位（暂停中不打扰）
            guard phase == .active, !isPaused, let service = liveService, !choseDemo else { return }
            service.start()
            authorization = service.authorizationStatus
            refreshMode()
        }
    }

    /// 地图高度：按「剩余空间预算」而不是固定比例。
    /// 目标是：一屏内一定能看到「剩余距离 + 线索标题 + 第一条线索」，
    /// 否则用户会以为线索区被按钮盖住了（真机 874pt 高、45% 比例时就是这个问题）。
    /// 预算：屏高 − 顶栏(60) − 定位状态行(34) − 距离区(150) − 线索标题+首条(104)
    ///       − 底部按钮区(118) − 安全区(60)
    private func mapHeight(for available: CGFloat) -> CGFloat {
        let budget = available - 60 - 34 - 150 - 104 - 118 - 60
        // 地图本身保留一点呼吸感，夹在 170…360 之间
        return min(360, max(170, budget))
    }

    /// 底部按钮区占用的高度（滚动内容底部留白用）
    private var actionBarReserve: CGFloat { 118 }

    // MARK: 主内容

    private func content(session: QuestSession, place: Place) -> some View {
        GeometryReader { geo in
            VStack(spacing: 0) {
                topBar(session: session)
                    .padding(.horizontal, BWTheme.pagePadding)
                    .padding(.top, 6)
                    .padding(.bottom, 8)

                locationStatusRow
                    .padding(.horizontal, BWTheme.pagePadding)
                    .padding(.bottom, 10)

                // 整页可滚动：地图 + 距离 + 线索一起滚，按钮固定在底部。
                // 宽屏（折叠屏展开态）改为左右分栏：左地图 / 右「距离 + 线索」。
                ScrollView(showsIndicators: false) {
                    if BWTheme.isWide(geo.size.width) {
                        HStack(alignment: .top, spacing: 22) {
                            mapSection(session: session)
                                .frame(height: max(260, mapHeight(for: geo.size.height)))

                            VStack(alignment: .leading, spacing: 16) {
                                if authorization.isBlocked && !choseDemo {
                                    permissionBanner
                                }
                                distanceSection(session: session)
                                clueSection(session: session, place: place)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(.horizontal, BWTheme.pagePadding)
                        .padding(.top, 6)
                        .padding(.bottom, 16)
                        .frame(maxWidth: BWTheme.contentMaxWidth, alignment: .leading)
                        .frame(maxWidth: .infinity)
                    } else {
                        VStack(alignment: .leading, spacing: 0) {
                            // 抽象地图区：占屏高约 45%（design-system §5.3），小屏收到 38%
                            mapSection(session: session)
                                .frame(height: mapHeight(for: geo.size.height))

                            VStack(alignment: .leading, spacing: 16) {
                                if authorization.isBlocked && !choseDemo {
                                    permissionBanner
                                }

                                distanceSection(session: session)

                                clueSection(session: session, place: place)
                            }
                            .padding(.horizontal, BWTheme.pagePadding)
                            .padding(.top, 12)
                            .padding(.bottom, 16)
                        }
                    }
                }

                actionBar
                    .frame(maxWidth: BWTheme.contentMaxWidth)
                    .padding(.horizontal, BWTheme.pagePadding)
                    .padding(.top, 8)
                    .padding(.bottom, 10)
                    .background(
                        // 顶部 18pt 渐隐：滚动内容被按钮区遮住时自然淡出，而不是硬切一刀
                        VStack(spacing: 0) {
                            LinearGradient(
                                colors: [BWTheme.cream.opacity(0), BWTheme.cream],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                            .frame(height: 18)
                            Rectangle().fill(BWTheme.cream)
                        }
                        .ignoresSafeArea(edges: .bottom)
                    )
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

    // MARK: 定位状态（真实定位在跑时给明确反馈，避免用户误以为是演示）

    private var locationStatusRow: some View {
        HStack(spacing: 8) {
            HStack(spacing: 5) {
                Circle()
                    .fill(locationStatusColor)
                    .frame(width: 6, height: 6)
                Text(locationStatusText)
                    .font(BWTheme.caption(11))
                    .foregroundStyle(BWTheme.ink2)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(BWTheme.paper)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(BWTheme.line, lineWidth: 1))

            // 来源标签：真实地标 / 编辑精选 / 演示（只标来源，不泄露地点信息）
            HStack(spacing: 4) {
                Image(systemName: questSourceIcon)
                    .font(.system(size: 9, weight: .semibold))
                Text(questSourceLabel)
                    .font(.system(size: 9.5, weight: .semibold))
                    .lineLimit(1)
            }
            .foregroundStyle(questSourceTint)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(questSourceTint.opacity(0.10))
            .clipShape(Capsule())
            .overlay(Capsule().stroke(questSourceTint.opacity(0.30), lineWidth: 1))

            Spacer(minLength: 0)

            if authorization.isBlocked && locationMode == .demo {
                Button("去设置", action: openSettings)
                    .font(BWTheme.caption(11))
                    .foregroundStyle(BWTheme.amberDeep)
            } else if locationMode == .demo, liveService != nil, choseDemo || fixTimedOut {
                Button(fixTimedOut ? "重试定位" : "用实时定位继续", action: retryLocating)
                    .font(BWTheme.caption(11))
                    .foregroundStyle(BWTheme.amberDeep)
            } else if locationMode == .tracking {
                Text("GPS")
                    .font(.system(size: 9, weight: .bold))
                    .tracking(0.8)
                    .foregroundStyle(BWTheme.teal)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(BWTheme.teal.opacity(0.10))
                    .clipShape(Capsule())
            }
        }
    }

    private var locationStatusColor: Color {
        switch locationMode {
        case .tracking: return BWTheme.teal
        case .waiting: return BWTheme.amber
        case .demo: return authorization.isBlocked ? BWTheme.ember : BWTheme.ink3
        }
    }

    private var locationStatusText: String {
        switch locationMode {
        case .tracking:
            if let accuracy = lastReading?.horizontalAccuracy, accuracy > 35 {
                return "实时定位 · 信号弱（±\(Int(accuracy.rounded())) 米）"
            }
            return "实时定位 · 已连接"
        case .waiting:
            return locatingIssue.map { "正在获取定位 · \($0)" } ?? "正在获取定位…"
        case .demo:
            if authorization.isBlocked { return "未开定位权限 · 演示模式" }
            if choseDemo { return "演示模式 · 模拟步行" }
            if fixTimedOut { return "没拿到定位 · 已切演示模式" }
            return "演示模式 · 该盲盒没有真实目的地"
        }
    }

    // MARK: 来源标签（真实地标 / 编辑精选 / 演示）

    private var questSourceLabel: String {
        switch store.currentPlace?.source ?? "catalog" {
        case "curated": return "编辑精选"
        case "catalog": return "演示"
        default: return "真实地标"
        }
    }

    private var questSourceIcon: String {
        switch store.currentPlace?.source ?? "catalog" {
        case "curated": return "sparkles"
        case "catalog": return "theatermasks"
        default: return "mappin.and.ellipse"
        }
    }

    private var questSourceTint: Color {
        switch store.currentPlace?.source ?? "catalog" {
        case "curated": return BWTheme.amberDeep
        case "catalog": return BWTheme.ink3
        default: return BWTheme.teal
        }
    }

    /// 抽到「编辑精选」时的短提示（2.6s 淡出；不包含任何地点名）
    private var curatedNotice: some View {
        VStack(spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "sparkles")
                    .font(.system(size: 11, weight: .semibold))
                Text("这是编辑精选的地点")
                    .font(.system(size: 12, weight: .semibold))
            }
            Text("终点仍然保密。到了才知道是哪里。")
                .font(.system(size: 10))
                .foregroundStyle(BWTheme.cream.opacity(0.68))
        }
        .foregroundStyle(BWTheme.cream)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(BWTheme.ink.opacity(0.90))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(BWTheme.amber.opacity(0.38), lineWidth: 1)
        )
        .shadow(color: BWTheme.ink.opacity(0.22), radius: 18, x: 0, y: 10)
        .frame(maxHeight: .infinity, alignment: .top)
        .padding(.top, 96)
        .transition(.opacity)
        .accessibilityLabel("这是编辑精选的地点，终点仍然保密")
    }

    // MARK: 抽象地图

    private func mapSection(session: QuestSession) -> some View {
        ZStack(alignment: .topLeading) {
            // 真实地点 + 有真实坐标 → 真实地图；否则退回抽象手绘地图
            if session.target != nil, store.currentPlace?.source != "catalog" {
                // 真实地图内部已经画了「目的地保密中」胶囊，外层不再重复
                RealMapView(
                    userLocation: store.lastKnownOrigin,
                    trail: walkedTrail,
                    remainingMeters: session.remainingMeters,
                    height: nil
                )
            } else {
                JourneyMapView(
                    progress: session.progress,
                    remainingMeters: session.remainingMeters
                )
                mapCaption(session: session)
            }
        }
    }

    /// 抽象地图上的「目的地保密中」胶囊（真实地图自带，不重复画）
    private func mapCaption(session: QuestSession) -> some View {
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
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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

                // 真实定位 + 拿到手机朝向：箭头相对手机旋转（↑ = 你正前方）
                // 否则退回按绝对方位 / 剩余距离分段的箭头
                directionArrowView(session: session)
            }

            Text(session.compassCopy)
                .font(BWTheme.body(14))
                .foregroundStyle(BWTheme.ink2)

            if locationMode == .tracking {
                Text("箭头按你手机朝向校准，跟着它走")
                    .font(BWTheme.caption(10))
                    .foregroundStyle(BWTheme.ink3)
            }

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

    /// 真实定位 + 有手机朝向 → 相对方向（bearing - heading）；否则退回绝对/演示箭头
    private func directionArrow(session: QuestSession) -> String {
        if locationMode == .tracking,
           let bearing = session.currentBearing,
           let heading = headingDegrees {
            return GeoMath.arrow(bearing - heading)
        }
        return session.arrowSymbol
    }

    @ViewBuilder
    private func directionArrowView(session: QuestSession) -> some View {
        Text(directionArrow(session: session))
            .font(.system(size: 34, weight: .semibold))
            .foregroundStyle(BWTheme.amberDeep)
            .animation(reduceMotion ? nil : BWAnimation.quick, value: directionArrow(session: session))
            .accessibilityLabel(directionAccessibilityLabel(session: session))
    }

    /// VoiceOver：把箭头翻译成可以听懂的方位
    private func directionAccessibilityLabel(session: QuestSession) -> String {
        if locationMode == .tracking,
           let bearing = session.currentBearing,
           let heading = headingDegrees {
            let relative = (bearing - heading + 360).truncatingRemainder(dividingBy: 360)
            let relativeCopy: String
            switch relative {
            case 337.5..., 0..<22.5: relativeCopy = "正前方"
            case 22.5..<67.5: relativeCopy = "右前方"
            case 67.5..<112.5: relativeCopy = "右边"
            case 112.5..<157.5: relativeCopy = "右后方"
            case 157.5..<202.5: relativeCopy = "后方"
            case 202.5..<247.5: relativeCopy = "左后方"
            case 247.5..<292.5: relativeCopy = "左边"
            default: relativeCopy = "左前方"
            }
            return "目的地在\(relativeCopy)，\(GeoMath.compassLabel(bearing))方向"
        }
        return "方向指示 \(session.arrowSymbol)"
    }

    // MARK: 权限降级卡

    private var permissionBanner: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "location.slash")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(BWTheme.ember)
                Text("开启定位权限才能真实盲走")
                    .font(BWTheme.title(14))
                    .foregroundStyle(BWTheme.ink)
            }

            Text("系统设置 → 盲走 → 位置 → 选「使用 App 期间」。开启后回来，这里会自动切回真实定位。")
                .font(BWTheme.caption(12))
                .foregroundStyle(BWTheme.ink2)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 10) {
                Button(action: openSettings) {
                    Text("去设置")
                        .font(BWTheme.caption(12))
                        .foregroundStyle(BWTheme.paper)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(BWTheme.amberDeep)
                        .clipShape(Capsule())
                }
                .buttonStyle(BWPressEffectStyle())

                Button(action: switchToDemo) {
                    Text("用演示模式继续")
                        .font(BWTheme.caption(12))
                        .foregroundStyle(BWTheme.ink2)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(BWTheme.paper2)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(BWTheme.line, lineWidth: 1))
                }
                .buttonStyle(BWPressEffectStyle())

                Spacer(minLength: 0)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BWTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(BWTheme.ember.opacity(0.3), lineWidth: 1)
        )
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
        return "再走 \(gap) 米，解锁第\(BWFormat.chineseIndex(index))条线索"
    }

    // MARK: 底部操作

    private var actionBar: some View {
        VStack(spacing: 8) {
            switch locationMode {
            case .tracking:
                // 真实定位在跑：主按钮只剩「我到了」，避免「模拟步行」误导
                BWPrimaryButton(
                    title: "我到了",
                    icon: "flag.checkered",
                    action: arriveNow
                )
                .disabled(isPaused)
                .opacity(isPaused ? 0.55 : 1)

                Button(action: switchToDemo) {
                    Text("位置没动？改用演示模式")
                        .font(BWTheme.caption(12))
                        .foregroundStyle(BWTheme.ink3)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.plain)

            case .waiting:
                // 还在等第一个定位点：先别让用户按「模拟步行」，给出明确等待态
                BWPrimaryButton(
                    title: "正在获取定位…",
                    icon: "location",
                    action: retryLocating
                )
                .disabled(true)
                .opacity(0.55)

                Button(action: switchToDemo) {
                    Text("先用演示模式继续")
                        .font(BWTheme.caption(12))
                        .foregroundStyle(BWTheme.ink2)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(BWTheme.paper2)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(BWTheme.line, lineWidth: 1))
                }
                .buttonStyle(BWPressEffectStyle())

            case .demo:
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
            // 暂停结束恢复真实定位
            if locationMode == .waiting || locationMode == .tracking {
                liveService?.start()
            }
        } else {
            pauseStartedAt = Date()
            isPaused = true
            // 暂停时停止真实定位，避免「暂停了但距离还在变」
            liveService?.stop()
        }
        BWHaptics.light()
    }

    // MARK: 演示步行

    private func simulateWalk() {
        guard !isPaused else { return }

        let events = store.advance(byMeters: 50)
        demoService.simulateAdvance(meters: 50)
        demoService.sync(remaining: store.session?.remainingMeters)
        BWHaptics.light()
        handle(events: events)
    }

    private func arriveNow() {
        let events = store.arriveNow()
        handle(events: events)
    }

    private func switchToDemo() {
        choseDemo = true
        fixTimedOut = false
        liveService?.stop()
        demoService.sync(remaining: store.session?.remainingMeters)
        refreshMode()
        BWHaptics.light()
    }

    // MARK: 真实定位

    private func handleAppear() {
        demoService.sync(remaining: store.session?.remainingMeters)

        if store.session?.phase == .arrived || store.reveal != nil {
            triggerArrival()
        }

        // 抽到后台策展点 → 明确提示「编辑精选」（不剧透地点）
        if store.currentPlace?.source == "curated" {
            withAnimation(BWAnimation.regular) {
                curatedNoticeVisible = true
            }
            bwAfter(2.6) {
                withAnimation(BWAnimation.regular) {
                    curatedNoticeVisible = false
                }
            }
        }

        startLiveLocationIfPossible()
        applyAutoArrivePreviewIfNeeded()
    }

    /// 截图自检：`BW_AUTO_ARRIVE=<毫秒>` 时进入旅程后自动触发到达（便于 headless 截揭晓页）。
    private func applyAutoArrivePreviewIfNeeded() {
        let env = ProcessInfo.processInfo.environment
        guard let raw = env["BW_AUTO_ARRIVE"], let milliseconds = Double(raw), milliseconds >= 0 else {
            return
        }
        bwAfter(milliseconds / 1000.0) {
            guard store.session?.phase == .walking else { return }
            let events = store.arriveNow()
            handle(events: events)
        }
    }

    private func handleDisappear() {
        liveService?.stop()
    }

    /// 启动真实定位：只要有在走的会话就请求权限（首次进入弹系统授权），
    /// 同时把定位点缓存进 store，下一次抽盒 `startQuest()` 就能直接生成真实目的地。
    /// - 有真实目的地 / 还没有目的地的会话（抽盒时没拿到定位）→ 真实模式
    /// - 截图/演示走查默认留在演示模式，避免系统权限弹窗打断截图；
    ///   `BW_PREVIEW=live` 或 `BW_LIVE_GPS=1` 时走真实定位（模拟器自检用）。
    private func startLiveLocationIfPossible() {
        guard let session = store.session, session.phase == .walking else {
            refreshMode()
            return
        }

        let env = ProcessInfo.processInfo.environment
        let preview = env["BW_PREVIEW"] ?? ""
        let forceLive = env["BW_LIVE_GPS"] == "1" || preview == "live"
        guard preview.isEmpty || forceLive else {
            // 截图/走查：不弹系统定位授权，直接用演示步行（来源标签仍然准确）
            choseDemo = true
            refreshMode()
            return
        }

        canAdoptTarget = session.target == nil

        let service = liveService ?? makeLiveService()
        liveService = service
        attachCallbacks(to: service)
        service.target = store.session?.target
        authorization = service.authorizationStatus
        service.start()
        authorization = service.authorizationStatus
        refreshMode()

        // 8 秒还没拿到第一个定位点 → 给出可用的演示兜底（不自动切，先提示）
        bwAfter(8) {
            guard lastReading == nil,
                  !choseDemo,
                  !authorization.isBlocked,
                  store.session?.phase == .walking else { return }
            fixTimedOut = true
            refreshMode()
        }
    }

    private func makeLiveService() -> LiveLocationService {
        let service = LiveLocationService()
        attachCallbacks(to: service)
        return service
    }

    /// 在回调里把读数写回 SwiftUI 状态（onAppear 每次都会重新挂，避免多次进入后重复绑定）
    private func attachCallbacks(to service: LiveLocationService) {
        service.onUpdate = { [weak service] reading in
            guard let service else { return }
            apply(reading: reading, service: service)
        }

        service.onAuthorizationChange = { status in
            authorization = status
            if status.isBlocked {
                locatingIssue = "无权限"
            }
            refreshMode()
        }
    }

    /// 每次定位 / 朝向回调：补目的地、推进业务状态、刷新 UI
    private func apply(reading: LocationReading, service: LiveLocationService) {
        lastReading = reading
        headingDegrees = reading.headingDegrees
        if let accuracy = reading.horizontalAccuracy {
            locatingIssue = accuracy > 60 ? "信号弱" : nil
        }

        // 记下最近定位点，下一次抽盒时 startQuest 可以直接用它当起点
        if let origin = reading.origin {
            store.lastKnownOrigin = origin
            // 轨迹：只在移动超过 8 米时记录，避免 GPS 抖动画出毛线团
            if let last = walkedTrail.last {
                if GeoMath.distance(from: last, to: origin) >= 8 {
                    walkedTrail.append(origin)
                }
            } else {
                walkedTrail.append(origin)
            }
        }

        // 会话已经有真实目的地（真实 POI / 真实坐标）→ 把这个坐标交给定位服务，
        // 否则 service 不知道 target，距离永远停在初始值。
        if service.target == nil, let existing = store.session?.target {
            service.target = existing
        }

        // 会话还没有真实目的地 → 用当前位置 + 剩余距离 + 固定方向补一个
        // （放在「剩余距离」处，进度条/线索阈值都不变，距离立刻变成真值）
        if service.target == nil, canAdoptTarget, let origin = reading.origin,
           let session = store.session {
            let meters = Double(max(session.remainingMeters, QuestSession.arriveThreshold + 10))
            let bearing = adoptionBearing(for: session)
            let target = GeoMath.offset(from: origin, meters: meters, bearingDegrees: bearing)
            service.target = target
            store.session?.target = target
            didValidateFirstFix = true
            lastSentRemaining = meters
            let events = store.updateLocation(
                distanceMeters: meters,
                bearingDegrees: bearing
            )
            handle(events: events)
            refreshMode()
            return
        }

        guard let remaining = reading.remainingMeters else {
            refreshMode()
            return
        }

        // 首个定位点合理性检查（只在旅程刚开始的 3 分钟内做）：
        // 抽盒时用的起点可能是上一次缓存的、已经过期的位置（在家抽的盒、人已经走到别处），
        // 只在这个时间窗内、且算出来跟「总路程」差得离谱时，才按当前位置重建目的地。
        // 中途恢复的旧旅程不动它——那时 remaining 本来就该小于 total。
        // 真实 POI / 真实坐标的旅程：目的地是真实存在的，不能按「漂移」重建
        let isRealPlaceQuest = store.currentPlace.map { $0.source != "catalog" } ?? false
        if !isRealPlaceQuest, !didValidateFirstFix {
            didValidateFirstFix = true
            if let session = store.session,
               Date().timeIntervalSince(session.startedAt) < 180 {
                let total = Double(session.totalMeters)
                let drift = abs(remaining - total)
                if drift > max(80, total * 0.3), let origin = reading.origin {
                    let meters = Double(max(session.remainingMeters, QuestSession.arriveThreshold + 10))
                    let bearing = session.currentBearing ?? adoptionBearing(for: session)
                    let target = GeoMath.offset(from: origin, meters: meters, bearingDegrees: bearing)
                    service.target = target
                    store.session?.target = target
                    lastSentRemaining = meters
                    _ = store.updateLocation(distanceMeters: meters, bearingDegrees: bearing)
                    refreshMode()
                    return
                }
            }
        }

        // 朝向变化不重复推进 store，只在距离变化时推进（减少无意义刷新）
        if lastSentRemaining == nil || abs(remaining - (lastSentRemaining ?? -1)) >= 1 {
            lastSentRemaining = remaining
            let events = store.updateLocation(
                distanceMeters: remaining,
                bearingDegrees: reading.bearingDegrees
            )
            handle(events: events)
        }

        refreshMode()
    }

    /// 补目的地时用确定性方向（同一会话每次一致），避免每次都正北
    private func adoptionBearing(for session: QuestSession) -> Double {
        let seed = UInt64(bitPattern: Int64(session.id.hashValue))
        var generator = SeededGenerator(seed: seed)
        return Double(Int.random(in: 0..<360, using: &generator))
    }

    /// 根据权限 / 读数 / 用户选择决定当前模式
    private func refreshMode() {
        if choseDemo || authorization.isBlocked {
            locationMode = .demo
            return
        }
        // 已经有真实目的地（真实 POI / 真实坐标）：即使还没收到定位读数，也属于 tracking
        let hasRealTarget = store.session?.target != nil && store.currentPlace?.source != "catalog"
        guard liveService != nil || hasRealTarget, canAdoptTarget || hasRealTarget else {
            locationMode = .demo
            return
        }
        if let reading = lastReading, reading.remainingMeters != nil || liveService?.target != nil {
            locationMode = .tracking
        } else if fixTimedOut {
            locationMode = .demo
        } else {
            locationMode = .waiting
        }
    }

    private func retryLocating() {
        guard let service = liveService else { return }
        choseDemo = false
        fixTimedOut = false
        locatingIssue = nil
        authorization = service.authorizationStatus
        service.start()
        refreshMode()
        BWHaptics.light()
    }

    private func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        openURL(url)
        BWHaptics.light()
    }

    // MARK: 事件

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

        // 已到达：停掉真实定位省电（揭晓页不需要）
        liveService?.stop()

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

    private func handleCollected(_ result: CollectResult) {
        showReveal = false
        bwAfter(0.5) {
            onCollected(result)
        }
    }
}

// MARK: - 定位模式

/// 旅程页定位状态机
enum JourneyLocationMode: Equatable {
    /// 已启动真实定位，等第一个定位点
    case waiting
    /// 真实定位在跑，距离/箭头都是真值
    case tracking
    /// 演示兜底（用户选择 / 无权限 / 无真实目的地 / 长时间无定位）
    case demo
}
