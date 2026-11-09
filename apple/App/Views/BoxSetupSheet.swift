import SwiftUI
import Foundation

// MARK: - 抽盒设置 Sheet（design-system §5.2，视觉基准：web 原型 #/setup）

struct BoxSetupSheet: View {

    let store: BlindWalkStore
    var onStart: () -> Void
    var onCancel: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shakeAngle: Double = 0
    @State private var isShaking = false
    @State private var startFailed = false
    @State private var isLookingUp = false
    @State private var searchHint: String?
    @State private var failureReason: String?
    @State private var failureReports: [POISourceReport] = []
    @State private var showLocationPicker = false
    @State private var oneShotLocation: OneShotLocationService?

    var body: some View {
        ZStack {
            BWTheme.paper.ignoresSafeArea()

            ScrollViewReader { proxy in
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 0) {
                    Text("这次的盲盒，你想要什么？")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(BWTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)

                    Text("选完就出发，目的地保密。")
                        .font(.system(size: 13.5))
                        .foregroundStyle(BWTheme.ink3)
                        .padding(.top, 4)
                        .padding(.bottom, 18)

                    durationSection
                    moodSection.padding(.top, 15)
                    areaSection.padding(.top, 15)
                    actionSection.padding(.top, 17)

                    if failureReason != nil {
                        BoxFailureView(
                            reason: failureReason ?? "no-real-place",
                            reports: failureReports,
                            onExpand: { search(extraWide: true) },
                            onRelocate: { showLocationPicker = true },
                            onDemo: { startDemo() }
                        )
                        .padding(.top, 14)
                        .id("failurePanel")
                    }
                    }
                    .padding(.horizontal, BWTheme.pagePadding)
                    .padding(.top, 10)
                    .padding(.bottom, 22)
                }
                .onChange(of: failureReason) { _, reason in
                    guard reason != nil else { return }
                    withAnimation(BWAnimation.regular) {
                        proxy.scrollTo("failurePanel", anchor: .bottom)
                    }
                }
            }
        }
        .presentationDetents([.fraction(0.92)])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(BWTheme.panelRadius)
        .presentationBackground(BWTheme.paper)
        .bwTypeBounds()
        .onAppear(perform: handleAppear)
        .sheet(isPresented: $showLocationPicker) {
            LocationInputSheet { point in
                store.lastKnownOrigin = point
                failureReason = nil
                search(extraWide: true)
            }
        }
    }

    // MARK: 时长 3 选 1（web .segmented：纸色凹槽 + 白纸浮起块）

    private var durationSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            BWMicroLabel("时长")

            HStack(spacing: 4) {
                ForEach(WalkDuration.allCases) { duration in
                    durationButton(duration)
                }
            }
            .padding(4)
            .background(BWTheme.paper2)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(BWTheme.line, lineWidth: 1)
            )
        }
    }

    private func durationButton(_ duration: WalkDuration) -> some View {
        let selected = store.selectedDuration == duration
        return Button {
            selectDuration(duration)
        } label: {
            VStack(spacing: 1) {
                Text("\(duration.rawValue) 分钟")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(selected ? BWTheme.ink : BWTheme.ink2)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text(durationCaption(duration))
                    .font(.system(size: 11.5))
                    .foregroundStyle(selected ? BWTheme.amberDeep : BWTheme.ink3)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background {
                if selected {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(BWTheme.paper)
                        .shadow(color: BWTheme.ink.opacity(0.10), radius: 3, x: 0, y: 2)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(BWTheme.amber.opacity(0.55), lineWidth: 1)
                        )
                }
            }
        }
        .buttonStyle(BWPressEffectStyle())
        .accessibilityLabel(duration.title)
    }

    private func durationCaption(_ duration: WalkDuration) -> String {
        switch duration {
        case .m15: return "一小圈"
        case .m30: return "刚好"
        case .m60: return "走远点"
        }
    }

    // MARK: 心情 3 卡

    private var moodSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            BWMicroLabel("心情")

            VStack(spacing: 7) {
                ForEach(Mood.allCases) { mood in
                    moodRow(mood)
                }
            }
        }
    }

    private func moodRow(_ mood: Mood) -> some View {
        let selected = store.selectedMood == mood
        return Button {
            selectMood(mood)
        } label: {
            HStack(spacing: 12) {
                Text(mood.emoji)
                    .font(.system(size: 17))
                    .frame(width: 34, height: 34)
                    .background(selected ? BWTheme.amber.opacity(0.16) : BWTheme.paper2)
                    .clipShape(Circle())

                VStack(alignment: .leading, spacing: 1) {
                    Text(mood.title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(BWTheme.ink)
                    Text(mood.subtitle)
                        .font(.system(size: 12.5))
                        .foregroundStyle(BWTheme.ink3)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                }

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? BWTheme.amber.opacity(0.07) : BWTheme.paper)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(selected ? BWTheme.amber.opacity(0.70) : BWTheme.line, lineWidth: 1)
            )
        }
        .buttonStyle(BWPressEffectStyle())
        .accessibilityLabel("\(mood.title)：\(mood.subtitle)")
    }

    // MARK: 区域 3 chips

    private var areaSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            BWMicroLabel("区域")

            HStack(spacing: 8) {
                areaChip(title: "附近", isSelected: store.selectedArea == nil) {
                    store.selectedArea = nil
                }
                ForEach([Area.river, Area.oldtown], id: \.self) { area in
                    areaChip(title: area.label, isSelected: store.selectedArea == area) {
                        store.selectedArea = (store.selectedArea == area ? nil : area)
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }

    private func areaChip(title: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        BWPill(title: title, selected: isSelected, action: action)
    }

    // MARK: 按钮

    private var actionSection: some View {
        VStack(spacing: 4) {
            BWPrimaryButton(
                title: "摇一个盲盒",
                action: shakeAndStart
            )
            .rotationEffect(.degrees(shakeAngle))
            .disabled(isShaking)
            .opacity(isShaking ? 0.7 : 1)

            Button(action: onCancel) {
                Text("今天不想出门")
                    .font(.system(size: 14.5, weight: .medium))
                    .foregroundStyle(BWTheme.ink2)
                    .frame(maxWidth: .infinity)
                    .frame(height: 42)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isLookingUp {
                HStack(spacing: 6) {
                    ProgressView()
                        .controlSize(.mini)
                    Text(searchHint ?? "正在找附近真实存在的地点…")
                        .font(.system(size: 12.5))
                        .foregroundStyle(BWTheme.ink3)
                }
                .frame(maxWidth: .infinity)
            }

            if startFailed {
                Text("这一次没抽到，再试一次。")
                    .font(.system(size: 13))
                    .foregroundStyle(BWTheme.ember)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: 交互

    private func selectDuration(_ duration: WalkDuration) {
        guard store.selectedDuration != duration else { return }
        store.selectedDuration = duration
        BWHaptics.light()
    }

    private func selectMood(_ mood: Mood) {
        guard store.selectedMood != mood else { return }
        store.selectedMood = mood
        BWHaptics.light()
    }

    /// 摇盒 600ms（±6° 三次）→ 抽盒 → 关闭 sheet 进入旅程
    private func shakeAndStart() {
        guard !isShaking else { return }
        startFailed = false

        if reduceMotion {
            startQuest()
            return
        }

        isShaking = true
        BWHaptics.light()

        withAnimation(.easeInOut(duration: 0.1).repeatCount(6, autoreverses: true)) {
            shakeAngle = 6
        }

        bwAfter(0.7) {
            withAnimation(BWAnimation.quick) {
                shakeAngle = 0
            }
            isShaking = false
            startQuest()
        }
    }

    /// 抽盒：策展 POI → 多数据源（高德/百度/OSM/维基）三档放宽 → 明确失败面板。
    /// 真实模式下绝不使用虚构地点；只有用户点「改成演示模式」才进入内置地点。
    private func startQuest() {
        search(extraWide: false)
    }

    private func search(extraWide: Bool) {
        failureReason = nil
        failureReports = []
        startFailed = false
        searchHint = nil

        guard let origin = store.lastKnownOrigin else {
            fail(reason: "location", reports: [])
            return
        }

        let env = ProcessInfo.processInfo.environment
        if env["BW_FORCE_SEARCH_FAIL"] == "1" {
            fail(reason: "network", reports: [
                POISourceReport(id: "amap", label: "高德地图", ok: false, count: 0, error: "网络超时"),
                POISourceReport(id: "baidu", label: "百度地图", ok: false, count: 0, error: "未配置 Key"),
                POISourceReport(id: "osm", label: "OpenStreetMap", ok: false, count: 0, error: "网络超时"),
                POISourceReport(id: "wiki", label: "中文维基百科", ok: false, count: 0, error: "网络超时")
            ])
            return
        }

        isLookingUp = true
        let mood = store.selectedMood
        let startMeters = store.selectedDuration.startMeters
        let seed = UInt64(Date().timeIntervalSince1970)

        Task { @MainActor in
            // Key 由后台下发（bundle → Pages → 后台端点，缓存 12h）
            _ = await MapKeysService.shared.load()

            // ① 后台策展 POI 优先（人工审核过的点最可靠；调试可用 BW_SKIP_CURATED=1 强制走多数据源）
            let skipCurated = ProcessInfo.processInfo.environment["BW_SKIP_CURATED"] == "1"
            await AdminPOIService.shared.prepare()
            if !skipCurated, let curated = AdminPOIService.shared.pickCuratedPlace(
                origin: origin, mood: mood, startMeters: startMeters, seed: seed
            ) {
                debugLog("curated pick name=\(curated.name) id=\(curated.id) source=\(curated.source)")
                _ = finish(place: curated, origin: origin)
                return
            }
            debugLog("curated miss → providers ")

            // ② 三档放宽：每档都用真实数据，只是"挑哪个"逐步放宽
            var reports: [POISourceReport] = []
            var dullFallback: POICandidate?
            let tierStart = extraWide ? 2 : 0
            for tier in tierStart..<POISelection.tiers.count {
                guard isLookingUp else { return }
                let config = POISelection.tiers[tier]
                searchHint = tier > 0 ? Self.tierHint(tier) : nil
                let result = await POIProviderService.shared.fetchNearby(
                    origin: origin,
                    startMeters: startMeters,
                    relax: config.relax,
                    mood: mood
                )
                reports = result.reports
                if let picked = POISelection.pick(
                    from: result.candidates,
                    origin: origin,
                    mood: mood,
                    startMeters: startMeters,
                    relax: config.relax,
                    seed: seed &+ UInt64(tier)
                ) {
                    if POISelection.isDull(picked) {
                        if dullFallback == nil { dullFallback = picked }
                        continue
                    }
                    debugLog("provider pick name=\(picked.name) source=\(picked.source) relax=\(config.relax) pool=\(result.candidates.count)")
                    _ = finish(picked, origin: origin)
                    return
                }
            }

            // 三档都没有更好的：有"够真实但不够格"的就用它，否则明确失败
            if let fallback = dullFallback {
                debugLog("provider dull fallback name=\(fallback.name) source=\(fallback.source)")
                _ = finish(fallback, origin: origin)
                return
            }

            let reason = reports.contains(where: { $0.ok }) ? "no-real-place" : "network"
            fail(reason: reason, reports: reports)
        }
    }

    private static func tierHint(_ tier: Int) -> String {
        switch tier {
        case 1: return "附近点少，扩大范围再找…"
        default: return "再放宽一次，把附近能走到的真实地点都算上…"
        }
    }

    /// 用真实 POI 进入旅程（绝不接受 catalog/虚构来源）
    @discardableResult
    private func finish(_ candidate: POICandidate, origin: GeoPoint) -> Bool {
        guard PlaceSource.isReal(candidate.source) else {
            fail(reason: "no-real-place", reports: failureReports)
            return false
        }
        let hour = Calendar.current.component(.hour, from: Date())
        let realPlace = RealPlaceFactory.scrub(RealPlaceFactory.makePlace(
            from: candidate,
            origin: origin,
            mood: store.selectedMood,
            hour: hour,
            startMeters: store.selectedDuration.startMeters
        ))
        return finish(place: realPlace, origin: origin)
    }

    /// 策展 / 多数据源最终都走这里：校验真实来源 → 开旅程 → 覆盖真实目的地
    @discardableResult
    private func finish(place: Place, origin: GeoPoint) -> Bool {
        guard place.coordinate != nil, PlaceSource.isReal(place.source) else {
            fail(reason: "no-real-place", reports: failureReports)
            return false
        }
        guard store.startQuest(origin: origin) != nil else {
            fail(reason: "no-real-place", reports: failureReports)
            return false
        }
        adopt(place: place, origin: origin)
        isLookingUp = false
        BWHaptics.medium()
        onStart()
        return true
    }

    /// 用户显式选择演示模式（虚构地点）——只有这个按钮会走内置目录
    private func startDemo() {
        guard store.startQuest() != nil else {
            startFailed = true
            return
        }
        debugLog("demo mode chosen by user")
        isLookingUp = false
        BWHaptics.medium()
        onStart()
    }

    private func fail(reason: String, reports: [POISourceReport]) {
        isLookingUp = false
        searchHint = nil
        failureReason = reason
        failureReports = reports
        BWHaptics.medium()
    }

    /// 把真实地点覆盖进 store：
    /// - 目的地坐标 = POI 真实坐标；展示地点 = 真实 Place
    /// - 总路程改成「起点 → 目的地的真实距离」，避免假进度；线索按真实距离解锁
    private func adopt(place: Place, origin: GeoPoint) {
        guard let coordinate = place.coordinate, let current = store.session else {
            store.currentPlace = place
            return
        }
        let distance = max(Double(QuestSession.arriveThreshold + 1), GeoMath.distance(from: origin, to: coordinate))
        let total = max(Int(distance.rounded()), QuestSession.arriveThreshold + 1)
        let bearing = GeoMath.bearing(from: origin, to: coordinate)

        let session = QuestSession(
            id: current.id,
            placeID: current.placeID,
            startedAt: current.startedAt,
            totalMeters: total,
            remainingMeters: total,
            phase: .walking,
            unlockedHintCount: 1,
            target: coordinate,
            currentBearing: bearing
        )
        store.session = session
        store.currentPlace = place
        _ = store.updateLocation(distanceMeters: Double(total), bearingDegrees: bearing)
    }

    // MARK: 截图 / 自检辅助

    /// 截图自检：`BW_PREVIEW=setup` + `BW_AUTO_START=1` 时自动用模拟器坐标摇一次盲盒。
    private func handleAppear() {
        Task { await MapKeysService.shared.load() }
        Task { await AdminPOIService.shared.prepare() }

        let env = ProcessInfo.processInfo.environment
        // 真实模式下用户可能第一次打开 App：先拿一次定位，别让「没有起点」把抽盒卡死
        if env["BW_PREVIEW"] == nil, store.lastKnownOrigin == nil {
            let service = OneShotLocationService()
            oneShotLocation = service
            Task { @MainActor in
                if let point = await service.request() {
                    store.lastKnownOrigin = point
                    debugLog("one-shot origin acquired")
                }
            }
        }
        guard env["BW_AUTO_START"] == "1" else { return }
        if let raw = env["BW_PREVIEW_ORIGIN"], let parsed = Self.parseOrigin(raw) {
            store.lastKnownOrigin = parsed
        } else if store.lastKnownOrigin == nil {
            store.lastKnownOrigin = GeoPoint(latitude: 31.2304, longitude: 121.4737)
        }
        bwAfter(0.9) { startQuest() }
    }

    private static func parseOrigin(_ raw: String) -> GeoPoint? {
        let parts = raw.split(separator: ",").map { Double($0.trimmingCharacters(in: .whitespaces)) }
        guard parts.count == 2, let lat = parts[0], let lon = parts[1],
              abs(lat) <= 90, abs(lon) <= 180 else { return nil }
        return GeoPoint(latitude: lat, longitude: lon)
    }

    private func debugLog(_ message: String) {
        guard ProcessInfo.processInfo.environment["BW_DEBUG_POI"] == "1" else { return }
        print("[BlindWalk][poi] \(message)")
    }
}
