import SwiftUI
import Foundation

// MARK: - 抽盒设置 Sheet（design-system §5.2，视觉基准：web 原型 #/setup）

struct BoxSetupSheet: View {

    let store: WalkaholicStore
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
    /// 定位失败的具体原因（权限被拒 / 超时 / 服务未开），写进失败面板
    @State private var locationIssue: String?
    @State private var isLocating = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    momentCard
                    scopeSection
                    // 「走多久 / 去哪一带」只影响步行半径；漫游的距离由环带决定，
                    // 摆着这两个选择只会让人以为它们有用，所以漫游时收起。
                    if store.selectedScope == .walk {
                        durationSection
                    }
                    moodSection
                    if store.selectedScope == .walk {
                        areaSection
                    }
                    actionSection

                    if failureReason != nil {
                        BoxFailureView(
                            reason: failureReason ?? "no-real-place",
                            reports: failureReports,
                            onExpand: { search(extraWide: true) },
                            onRelocate: { showLocationPicker = true },
                            diagnostic: locationIssue,
                            onRetryLocation: { locateThenSearch() },
                            onOpenSettings: openLocationSettings,
                            scope: store.selectedScope
                        )
                    }
                }
                .padding(.horizontal, WATheme.pagePadding)
                .padding(.top, 8)
                .padding(.bottom, 22)
            }
            .background(WATheme.cream)
            .navigationTitle("这次的盲盒")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消", action: onCancel)
                }
            }
        }
        .presentationDetents([.fraction(0.92)])
        .presentationDragIndicator(.visible)
        .presentationBackground(WATheme.cream)
        .waTypeBounds()
        .onAppear(perform: handleAppear)
        .sheet(isPresented: $showLocationPicker) {
            LocationInputSheet { point in
                store.lastKnownOrigin = point
                failureReason = nil
                search(extraWide: true)
            }
        }
    }

    // MARK: 现在（环境性盲盒：时段决定去哪一类地方）

    private var momentCard: some View {
        let moment = DayMoment.now
        return HStack(alignment: .top, spacing: 12) {
            Image(systemName: moment.symbol)
                .font(.title3)
                .foregroundStyle(WATheme.amber)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 3) {
                Text(moment.boxTitle)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(WATheme.ink)
                Text(moment.line)
                    .font(.footnote)
                    .foregroundStyle(WATheme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WATheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    // MARK: 怎么去（走路 / 远程漫游）

    private var scopeSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            WAMicroLabel("怎么去")

            VStack(spacing: 0) {
                ForEach(Array(ExploreScope.allCases.enumerated()), id: \.element) { index, scope in
                    scopeRow(scope)
                    if index < ExploreScope.allCases.count - 1 {
                        Divider().padding(.leading, 44)
                    }
                }
            }
            .background(WATheme.paper)
            .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))

            if store.selectedScope == .roam {
                VStack(alignment: .leading, spacing: 6) {
                    Label("超过 10 公里的兴趣点也能刷到：选中后会先带你开车到目的地 1 公里左右停车，剩下的路再步行探索。", systemImage: "car")
                        .fixedSize(horizontal: false, vertical: true)
                    Label("开车段不给线索、不画路线；进入停车圈（或点「已停车」）后才开始解锁线索。", systemImage: "lock")
                        .fixedSize(horizontal: false, vertical: true)
                }
                .font(.caption)
                .foregroundStyle(WATheme.ink2)
            }
        }
    }

    private func scopeRow(_ scope: ExploreScope) -> some View {
        let selected = store.selectedScope == scope
        return Button {
            guard store.selectedScope != scope else { return }
            store.selectedScope = scope
            failureReason = nil
            WAHaptics.light()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: scope.symbol)
                    .font(.body)
                    .foregroundStyle(selected ? WATheme.amber : WATheme.ink2)
                    .frame(width: 28)

                VStack(alignment: .leading, spacing: 2) {
                    Text(scope.title)
                        .font(.body)
                        .foregroundStyle(WATheme.ink)
                    Text(scope.subtitle)
                        .font(.footnote)
                        .foregroundStyle(WATheme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                }

                Spacer(minLength: 8)

                if selected {
                    Image(systemName: "checkmark")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(WATheme.amber)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(scope.title)：\(scope.subtitle)")
    }

    // MARK: 时长 3 选 1（web .segmented：纸色凹槽 + 白纸浮起块）

    private var durationSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            WAMicroLabel("走多久")

            Picker("走多久", selection: Binding(
                get: { store.selectedDuration },
                set: { selectDuration($0) }
            )) {
                ForEach(WalkDuration.allCases) { duration in
                    Text("\(duration.rawValue) 分钟").tag(duration)
                }
            }
            .pickerStyle(.segmented)

            Text(durationCaption(store.selectedDuration))
                .font(.footnote)
                .foregroundStyle(WATheme.ink2)
        }
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
            WAMicroLabel("心情")

            VStack(spacing: 0) {
                ForEach(Array(Mood.allCases.enumerated()), id: \.element) { index, mood in
                    moodRow(mood)
                    if index < Mood.allCases.count - 1 {
                        Divider().padding(.leading, 44)
                    }
                }
            }
            .background(WATheme.paper)
            .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
        }
    }

    private func moodRow(_ mood: Mood) -> some View {
        let selected = store.selectedMood == mood
        return Button {
            selectMood(mood)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: mood.symbol)
                    .font(.body)
                    .foregroundStyle(selected ? WATheme.amber : WATheme.ink2)
                    .frame(width: 28)

                VStack(alignment: .leading, spacing: 2) {
                    Text(mood.title)
                        .font(.body)
                        .foregroundStyle(WATheme.ink)
                    Text(mood.subtitle)
                        .font(.footnote)
                        .foregroundStyle(WATheme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                }

                Spacer(minLength: 8)

                if selected {
                    Image(systemName: "checkmark")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(WATheme.amber)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(mood.title)：\(mood.subtitle)")
    }

    // MARK: 区域 3 chips

    private var areaSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            WAMicroLabel("去哪一带")

            Picker("区域", selection: Binding(
                get: { store.selectedArea },
                set: { store.selectedArea = $0 }
            )) {
                Text("附近").tag(Area?.none)
                ForEach([Area.river, Area.oldtown], id: \.self) { area in
                    Text(area.label).tag(Area?.some(area))
                }
            }
            .pickerStyle(.segmented)
        }
    }

    private func areaChip(title: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        WAPill(title: title, selected: isSelected, action: action)
    }

    // MARK: 按钮

    private var actionSection: some View {
        VStack(spacing: 10) {
            WAPrimaryButton(
                title: "摇一个盲盒",
                action: shakeAndStart
            )
            .rotationEffect(.degrees(shakeAngle))
            .disabled(isShaking)
            .opacity(isShaking ? 0.7 : 1)

            Button("今天不想出门", action: onCancel)
                .buttonStyle(.plain)
                .font(.body)
                .foregroundStyle(WATheme.amber)

            if isLookingUp {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.small)
                    Text(searchHint ?? (store.selectedScope == .roam
                                        ? "正在 10–45 公里内找值得开过去的地方…"
                                        : "正在找附近真实存在的地点…"))
                        .font(.footnote)
                        .foregroundStyle(WATheme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity)
            }

            if startFailed {
                Text("这一次没抽到，再试一次。")
                    .font(.footnote)
                    .foregroundStyle(WATheme.ember)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: 交互

    private func selectDuration(_ duration: WalkDuration) {
        guard store.selectedDuration != duration else { return }
        store.selectedDuration = duration
        WAHaptics.light()
    }

    private func selectMood(_ mood: Mood) {
        guard store.selectedMood != mood else { return }
        store.selectedMood = mood
        WAHaptics.light()
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
        WAHaptics.light()

        withAnimation(.easeInOut(duration: 0.1).repeatCount(6, autoreverses: true)) {
            shakeAngle = 6
        }

        waAfter(0.7) {
            withAnimation(WAAnimation.quick) {
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
            // 没位置就现场再要一次，而不是直接判失败
            locateThenSearch()
            return
        }

        let env = ProcessInfo.processInfo.environment
        if env["WA_FORCE_SEARCH_FAIL"] == "1" {
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
        let scope = store.selectedScope
        let startMeters = store.selectedDuration.startMeters
        let seed = UInt64(Date().timeIntervalSince1970)
        let moment = DayMoment.now

        Task { @MainActor in
            // Key 由后台下发（bundle → Pages → 后台端点，缓存 12h）
            _ = await MapKeysService.shared.load()

            // ① 后台策展 POI 优先（人工审核过的点最可靠；调试可用 WA_SKIP_CURATED=1 强制走多数据源）
            let skipCurated = ProcessInfo.processInfo.environment["WA_SKIP_CURATED"] == "1"
            await AdminPOIService.shared.prepare()
            if !skipCurated, let curated = AdminPOIService.shared.pickCuratedPlace(
                origin: origin, mood: mood, startMeters: startMeters, seed: seed,
                excluding: store.profile.collectedPlaceIDs,
                scope: scope,
                moment: moment
            ) {
                debugLog("curated pick name=\(curated.name) id=\(curated.id) source=\(curated.source)")
                _ = finish(place: curated, origin: origin)
                return
            }
            debugLog("curated miss → providers ")

            // ② 三档放宽：每档都用真实数据，只是"挑哪个"逐步放宽
            var reports: [POISourceReport] = []
            var dullFallback: POICandidate?
            // 漫游每次要撒 4 个点 × 多个源，代价比附近搜索高，
            // 只跑两档（45 公里 → 55 公里），第三档收益很小、等待翻倍。
            let tierIndices: [Int] = scope == .roam
                ? (extraWide ? [1] : [0, 1])
                : Array((extraWide ? 2 : 0)..<POISelection.tiers.count)
            for (offset, tier) in tierIndices.enumerated() {
                guard isLookingUp else { return }
                let config = POISelection.tiers[tier]
                searchHint = offset > 0 ? Self.tierHint(tier, scope: scope) : nil
                // 漫游走「环带撒点」取点，普通模式走「附近搜索」
                let result = scope == .roam
                    ? await POIProviderService.shared.fetchRoamNearby(
                        origin: origin, relax: config.relax, mood: mood, deadline: 6
                    )
                    : await POIProviderService.shared.fetchNearby(
                        origin: origin, startMeters: startMeters, relax: config.relax,
                        mood: mood, scope: scope
                    )
                reports = result.reports
                if let picked = POISelection.pick(
                    from: result.candidates,
                    origin: origin,
                    mood: mood,
                    startMeters: startMeters,
                    relax: config.relax,
                    seed: seed &+ UInt64(tier),
                    excluding: store.profile.collectedPlaceIDs,
                    scope: scope,
                    moment: moment
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

    private static func tierHint(_ tier: Int, scope: ExploreScope = .walk) -> String {
        if scope == .roam {
            switch tier {
            case 1: return "10 公里外点少，把环带放宽到 55 公里再找…"
            default: return "再往外扩一圈，看看更远的地方…"
            }
        }
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
        // 这里的地点来自真实 POI 服务，不需要再从目录里抽一次。
        // 用 beginQuest 建空会话，随后 adopt 覆盖成真实目的地。
        guard store.beginQuest(origin: origin, startMeters: store.selectedDuration.startMeters) else {
            fail(reason: "no-real-place", reports: failureReports)
            return false
        }
        adopt(place: place, origin: origin)
        isLookingUp = false
        WAHaptics.medium()
        onStart()
        return true
    }


    private func fail(reason: String, reports: [POISourceReport]) {
        isLookingUp = false
        searchHint = nil
        failureReason = reason
        failureReports = reports
        WAHaptics.medium()
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
            // 用真实地点的 id：会话的 placeID 必须和 currentPlace 一致，
            // 否则手表摘要 / 历史记录会拿到一个对不上的 id
            placeID: place.id,
            startedAt: current.startedAt,
            totalMeters: total,
            remainingMeters: total,
            phase: .walking,
            unlockedHintCount: 1,
            target: coordinate,
            currentBearing: bearing,
            // 保留抽盒时选的范围：漫游旅程必须继续按「先开车再走」的规则走
            scope: current.scope
        )
        store.session = session
        store.currentPlace = place
        _ = store.updateLocation(distanceMeters: Double(total), bearingDegrees: bearing)
    }

    // MARK: 截图 / 自检辅助

    /// 截图自检：`WA_PREVIEW=setup` + `WA_AUTO_START=1` 时自动用模拟器坐标摇一次盲盒。
    private func handleAppear() {
        Task { await MapKeysService.shared.load() }
        Task { await AdminPOIService.shared.prepare() }

        let env = ProcessInfo.processInfo.environment
        // 真实模式下用户可能第一次打开 App：先拿一次定位，别让「没有起点」把抽盒卡死
        if env["WA_PREVIEW"] == nil, store.lastKnownOrigin == nil {
            locateThenSearch()
        }
        guard env["WA_AUTO_START"] == "1" else { return }
        if let raw = env["WA_PREVIEW_ORIGIN"], let parsed = Self.parseOrigin(raw) {
            store.lastKnownOrigin = parsed
        } else if store.lastKnownOrigin == nil {
            store.lastKnownOrigin = GeoPoint(latitude: 31.2304, longitude: 121.4737)
        }
        waAfter(0.9) { startQuest() }
    }

    /// 取一次定位；成功就继续抽盒，失败就把**具体原因**留在面板上。
    private func locateThenSearch() {
        guard !isLocating else { return }
        isLocating = true
        locationIssue = nil
        let service = OneShotLocationService()
        oneShotLocation = service
        Task { @MainActor in
            let statusBefore = service.authorizationStatus
            let point = await service.request(timeout: 10)
            isLocating = false
            if let point {
                store.lastKnownOrigin = point
                debugLog("one-shot origin acquired")
                if failureReason == "location" { failureReason = nil }
                search(extraWide: false)
                return
            }
            let statusAfter = service.authorizationStatus
            switch statusAfter {
            case .denied, .restricted:
                locationIssue = "定位权限被拒绝了。到「设置 → 隐私与安全性 → 定位服务 → 步迷」选「使用 App 期间」。"
            case .notDetermined:
                locationIssue = "定位授权还没完成（系统弹窗可能被关掉了）。点下面的按钮再试一次。"
            case .authorized:
                locationIssue = statusBefore == .authorized
                    ? "定位权限是开的，但 10 秒内没拿到坐标。可能是室内/地下，走到窗边或室外再试。"
                    : "刚授权完还没拿到坐标，再试一次通常就有了。"
            }
            fail(reason: "location", reports: [])
        }
    }

    private func openLocationSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    private static func parseOrigin(_ raw: String) -> GeoPoint? {
        let parts = raw.split(separator: ",").map { Double($0.trimmingCharacters(in: .whitespaces)) }
        guard parts.count == 2, let lat = parts[0], let lon = parts[1],
              abs(lat) <= 90, abs(lon) <= 180 else { return nil }
        return GeoPoint(latitude: lat, longitude: lon)
    }

    private func debugLog(_ message: String) {
        guard ProcessInfo.processInfo.environment["WA_DEBUG_POI"] == "1" else { return }
        print("[Walkaholic][poi] \(message)")
    }
}
