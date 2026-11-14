import SwiftUI

// MARK: - 图鉴 Cards（design-system §5.5，视觉基准：web 原型 #/cards）

struct CardsView: View {

    let store: WalkaholicStore

    @State private var filter: CardFilter = .all
    @State private var selectedPlace: Place?
    /// 从「附近惊喜」点进来的惊喜 id（打开探寻页时聚焦它）
    @State private var seekFocusID: String?
    @State private var showSeek = false
    /// 点未解锁卡片、但还没有定位 → 弹出「先拿到位置」的说明
    @State private var exploreWithoutLocation: Place?
    /// 出发失败 / 没定位的提示
    @State private var exploreError: String?
    /// 探秘时全屏进入旅程
    @State private var showJourney = false
    /// 附近真实兴趣点（高德/百度/OSM/维基），未探索的显示成问号卡
    @State private var nearbyCandidates: [Place] = []
    @State private var isLoadingNearby = false
    @State private var nearbyError: String?
    @State private var oneShot = OneShotLocationService()

    private enum CardFilter: String, CaseIterable, Identifiable {
        case all = "全部"
        case rare = "稀有"
        case hidden = "隐藏"
        case nearby = "本区"

        var id: String { rawValue }

        var symbol: String {
            switch self {
            case .all:
                return "square.grid.2x2"
            case .rare:
                return "diamond"
            case .hidden:
                return "key"
            case .nearby:
                return "location"
            }
        }
    }

    /// 自适应列数：常规 iPhone 3 列；折叠屏展开态自动变 5 列（见 docs/foldable.md）
    private let columns = [
        GridItem(.adaptive(minimum: 96, maximum: 132), spacing: 10)
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if allPlaces.isEmpty {
                    emptyDirectory
                        .padding(.bottom, 20)
                }
                collectStats
                    .padding(.bottom, 12)
                almostThereCard
                    .padding(.bottom, 20)
                nearbyHintsSection
                    .padding(.bottom, 16)
                filterRow
                    .padding(.bottom, 14)
                nearbyStatusRow
                    .padding(.bottom, 10)
                grid
                if !unresolvedCards.isEmpty {
                    unresolvedNotice
                        .padding(.top, 16)
                }
            }
            .padding(.horizontal, WATheme.pagePadding)
            .padding(.bottom, 24)
        }
        .background(WATheme.cream)
        .refreshable {
            await AdminPOIService.shared.prepare()
            await loadNearbyCandidates()
        }
        .navigationTitle("图鉴")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    ForEach(CardFilter.allCases) { item in
                        Button {
                            filter = item
                        } label: {
                            Label(item.rawValue, systemImage: item.symbol)
                        }
                    }
                } label: {
                    Image(systemName: "line.3.horizontal.decrease.circle")
                }
                .accessibilityLabel("筛选")
            }
        }
        .fullScreenCover(isPresented: $showSeek) {
            SeekSurpriseView(
                store: store,
                onClose: {
                    showSeek = false
                    seekFocusID = nil
                },
                focusID: seekFocusID
            )
        }
        .sheet(item: $selectedPlace) { place in
            NavigationStack {
                PlaceDetailSheet(store: store, place: place)
                    .navigationTitle(place.name)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("完成") { selectedPlace = nil }
                        }
                    }
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .fullScreenCover(isPresented: $showJourney) {
            JourneyView(
                store: store,
                onClose: { showJourney = false },
                onCollected: { _ in showJourney = false }
            )
        }
        .alert("先拿到你的位置", isPresented: Binding(
            get: { exploreWithoutLocation != nil },
            set: { if !$0 { exploreWithoutLocation = nil } }
        )) {
            Button("获取位置") {
                if let place = exploreWithoutLocation {
                    exploreWithoutLocation = nil
                    Task { await requestLocationThenExplore(place) }
                }
            }
            Button("取消", role: .cancel) { exploreWithoutLocation = nil }
        } message: {
            Text("探秘要从你脚下的位置出发，所以需要一次定位。不会上传你的坐标。")
        }
        .alert("出发失败", isPresented: Binding(
            get: { exploreError != nil },
            set: { if !$0 { exploreError = nil } }
        )) {
            Button("知道了") { exploreError = nil }
        } message: {
            Text(exploreError ?? "")
        }
        .waTypeBounds()
        .onAppear {
            // 仅用于截图/演示：`WA_PREVIEW_DETAIL=1` 打开第一张已收集卡的详情
            guard ProcessInfo.processInfo.environment["WA_PREVIEW_DETAIL"] == "1", selectedPlace == nil else { return }
            waAfter(0.5) {
                selectedPlace = allPlaces.first { collectedIDs.contains($0.id) }
            }
        }
        .task {
            // 先把真实目录填上（策展 POI + 历史已收录点），再拉附近的惊喜和附近兴趣点
            await AdminPOIService.shared.prepare()
            await refreshRemoteSurprises()
            await loadNearbyCandidates()
        }
    }

    /// 「正在找附近兴趣点 / 没找到 / 找失败」的一行说明
    @ViewBuilder
    private var nearbyStatusRow: some View {
        if isLoadingNearby && nearbyCandidates.isEmpty {
            HStack(spacing: 6) {
                ProgressView().controlSize(.mini)
                Text("正在找附近的真实地点…")
                    .font(.caption)
                    .foregroundStyle(WATheme.ink2)
            }
        } else if let nearbyError {
            HStack(spacing: 6) {
                Image(systemName: "info.circle")
                    .font(.caption)
                Text(nearbyError)
                    .font(.caption)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                Button("重试") {
                    Task { await loadNearbyCandidates() }
                }
                .font(.caption.weight(.medium))
                .foregroundStyle(WATheme.amber)
            }
            .foregroundStyle(WATheme.ink2)
        }
    }

    /// 缺详情的已收录卡：如实说明，并提供不了地点就不假装有
    private var unresolvedNotice: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("有 \(unresolvedCards.count) 张卡的地点详情已丢失", systemImage: "questionmark.folder")
                .font(.footnote.weight(.medium))
                .foregroundStyle(WATheme.ink2)
            Text("这些是你早期收录的真实地点，但当时没有把地点信息存到本机。之后的收录会正常保存。")
                .font(.caption)
                .foregroundStyle(WATheme.ink3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color(.tertiarySystemFill))
        .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
    }

    /// 目录为空时的说明：不编造地点，直接告诉用户为什么是空的
    private var emptyDirectory: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("这一带还没有收录到真实地点", systemImage: "mappin.slash")
                .font(.headline)
            Text("步迷只收真实存在的地方。开一个盲盒，让位置带着你找。")
                .font(.subheadline)
                .foregroundStyle(WATheme.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(WATheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
    }

    // MARK: 附近真实兴趣点（问号卡的来源）

    /// 用当前定位现场搜一遍附近的真实地点（高德 / 百度 / OSM / 维基）。
    /// 只保留「走得到 + 还没收藏」的，作为图鉴里未探索的问号卡。
    private func loadNearbyCandidates() async {
        guard let origin = store.lastKnownOrigin else {
            nearbyError = "还没有定位，拿不到附近的兴趣点。"
            return
        }
        guard !isLoadingNearby else { return }
        isLoadingNearby = true
        nearbyError = nil
        defer { isLoadingNearby = false }

        _ = await MapKeysService.shared.load()
        // 只要「周围」：15 分钟档 + 不放宽，半径约 1.6 公里；
        // 这里的目的是图鉴里能点一下就走去探索，不是搜全城。
        let result = await POIProviderService.shared.fetchNearby(
            origin: origin,
            startMeters: WalkDuration.m15.startMeters,
            relax: 0,
            mood: store.selectedMood,
            deadline: 6
        )

        let hour = Calendar.current.component(.hour, from: Date())
        let collected = collectedIDs
        var seen: [(GeoPoint, String)] = allPlaces.compactMap { place in
            place.coordinate.map { ($0, place.name) }
        }

        var picked: [Place] = []
        for candidate in result.candidates {
            guard GeoMath.distance(from: origin, to: candidate.coordinate) <= Self.exploreRadiusMeters else { continue }
            // 已经收藏的、或和已有地点近到 40 米内的，都不再重复出现
            if collected.contains("real-\(candidate.id)") { continue }
            let tooClose = seen.contains { GeoMath.distance(from: $0.0, to: candidate.coordinate) < 40 }
            if tooClose { continue }
            // 只留「值得走过去」的：像「后勤服务集团运输中心」「XX 专卖店」这种不要
            let worth = POISelection.scoreWalkworthy(name: candidate.name)
            if !worth.ok || worth.penalty < 0.5 { continue }

            let place = RealPlaceFactory.scrub(RealPlaceFactory.makePlace(
                from: candidate,
                origin: origin,
                mood: store.selectedMood,
                hour: hour,
                startMeters: store.selectedDuration.startMeters
            ))
            picked.append(place)
            seen.append((candidate.coordinate, candidate.name))
        }

        nearbyCandidates = Array(picked.prefix(24))
        if nearbyCandidates.isEmpty {
            let okSources = result.reports.filter(\.ok).map(\.label)
            nearbyError = okSources.isEmpty
                ? "这次没能连上地图服务（\(result.reports.map { $0.label }.joined(separator: "、")))"
                : "附近没有适合走过去的真实地点"
        }
    }

    // MARK: 附近的惊喜：先拿本机的，再补账号服务上别人埋的

    private func refreshRemoteSurprises() async {
        guard let origin = store.lastKnownOrigin else { return }
        let remote = await SurpriseService.shared.fetchNearby(origin: origin)
        guard !remote.isEmpty else { return }
        store.mergeRemoteSurprises(remote, near: origin)
    }

    // MARK: 附近的惊喜（隐晦提示）

    /// 待寻的惊喜，按距离排序
    private var nearbyHintList: [BuriedSurprise] {
        let origin = store.lastKnownOrigin
        // 有定位按 5km 圈；没有定位就全部待寻的，并显示「位置未知」
        let all = store.explorableSurprises(near: origin)
        return Array(all.prefix(3))
    }

    private func distanceBucket(_ meters: Double?) -> String {
        guard let meters, meters.isFinite else { return "位置未知" }
        if meters <= 120 { return "就在附近几步" }
        if meters <= 350 { return "大概一两百米" }
        if meters <= 800 { return "走过去几分钟" }
        if meters <= 2000 { return "要走一段路" }
        if meters <= 8000 { return "在比较远的地方" }
        return "不在附近，需要专程去"
    }

    /// 隐晦氛围提示：不含地名、不含作者以外的识别信息
    private func atmosphere(for surprise: BuriedSurprise) -> String {
        let pool = [
            "那儿光线不错，适合停下来喘口气。",
            "有人在那儿等到过一次意外的好天气。",
            "那个角落平时没什么人经过。",
            "声音会变小，风会变大一点。",
            "走到那儿大概会想掏出手机拍点什么。",
            "那里有一小块能坐下来的地方。",
            "路过的人都很赶，只有你可能会停。"
        ]
        var seed = 0
        for ch in surprise.id.unicodeScalars { seed = (seed &* 31 &+ Int(ch.value)) % 9973 }
        return pool[seed % pool.count]
    }

    @ViewBuilder
    private var nearbyHintsSection: some View {
        let list = nearbyHintList
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("附近的惊喜")
                    .font(.headline)
                Spacer(minLength: 0)
                Text(list.isEmpty ? "这一带暂时没有" : "\(list.count) 个还没被找到")
                    .font(.footnote)
                    .foregroundStyle(WATheme.ink2)
            }

            if list.isEmpty {
                Button {
                    showSeek = true
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "plus")
                            .font(.system(size: 12, weight: .medium))
                        Text("这一带还没人埋过，你来第一个")
                            .font(.system(size: 13, weight: .medium))
                    }
                    .foregroundStyle(WATheme.ink2)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .background(WATheme.paper)
                    .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
                }
                .buttonStyle(WAPressEffectStyle())
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(list.enumerated()), id: \.element.id) { index, surprise in
                        Button {
                            seekFocusID = surprise.id
                            showSeek = true
                        } label: {
                            HStack(alignment: .center, spacing: 12) {
                                Text(surprise.authorEmoji)
                                    .font(.body)
                                    .frame(width: 34, height: 34)
                                    .background(Color(.secondarySystemFill))
                                    .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(distanceBucket(store.lastKnownOrigin.map { GeoMath.distance(from: $0, to: surprise.location) }))
                                        .font(.body)
                                        .foregroundStyle(WATheme.ink)
                                    Text(atmosphere(for: surprise))
                                        .font(.footnote)
                                        .foregroundStyle(WATheme.ink2)
                                        .lineLimit(2)
                                        .multilineTextAlignment(.leading)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right")
                                    .font(.footnote.weight(.semibold))
                                    .foregroundStyle(WATheme.ink3)
                            }
                            .padding(.vertical, 10)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(WAPressEffectStyle())

                        if index < list.count - 1 {
                            WAHairline()
                        }
                    }
                }
                .padding(.horizontal, 14)
                .background(WATheme.paper)
                .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
            }
        }
    }

    // MARK: 统计条

    private var collectStats: some View {
        HStack(spacing: 6) {
            statPiece("已收集", "\(collectedIDs.count)/\(allPlaces.count)")
            dot
            statPiece("稀有", "\(store.profile.rareCount)")
            dot
            statPiece("隐藏", "\(store.profile.hiddenCount)")
            Spacer(minLength: 0)
        }
    }

    // MARK: 差一张（收集驱动）

    /// 还没收下的地点
    private var remainingPlaces: [Place] {
        allPlaces.filter { !collectedIDs.contains($0.id) }
    }

    /// 最近的一张未解锁（只算有真实坐标的）
    private var nearestRemaining: (place: Place, meters: Double)? {
        guard let origin = store.lastKnownOrigin else { return nil }
        return remainingPlaces
            .compactMap { place -> (Place, Double)? in
                guard let coordinate = place.coordinate else { return nil }
                return (place, GeoMath.distance(from: origin, to: coordinate))
            }
            .min { $0.1 < $1.1 }
    }

    /// 「只差一张」卡：把收集进度写成一句人话，并给最近的未解锁地点一个一键出发
    @ViewBuilder
    private var almostThereCard: some View {
        let total = allPlaces.count
        let remaining = remainingPlaces.count
        if total > 0 {
            let collected = total - remaining
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(headlineForRemaining(remaining))
                        .font(.headline)
                        .foregroundStyle(WATheme.ink)
                    Spacer(minLength: 0)
                    Text("\(collected)/\(total)")
                        .font(.footnote)
                        .monospacedDigit()
                        .foregroundStyle(WATheme.ink2)
                }

                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(WATheme.line)
                        Capsule()
                            .fill(WATheme.amber)
                            .frame(width: max(3, geo.size.width * CGFloat(Double(collected) / Double(total))))
                    }
                }
                .frame(height: 4)

                if remaining == 0 {
                    Text("这一带的真实地点都被你走过了。换个城市，或者去远处漫游一次。")
                        .font(.caption)
                        .foregroundStyle(WATheme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                } else if let nearest = nearestRemaining {
                    Button {
                        startExplore(nearest.place)
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "figure.walk")
                                .font(.caption)
                            Text("最近的一张：\(distanceCopy(nearest.place)) · 现在就走")
                                .font(.footnote.weight(.medium))
                            Spacer(minLength: 0)
                            Image(systemName: "arrow.right")
                                .font(.caption2.weight(.semibold))
                        }
                        .foregroundStyle(WATheme.amber)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("出发去最近的一个没解锁的地点")
                } else {
                    Text("开一个盲盒，路上遇到的都会收进来。")
                        .font(.caption)
                        .foregroundStyle(WATheme.ink2)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(WATheme.amberSoft)
            .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
        }
    }

    private func headlineForRemaining(_ remaining: Int) -> String {
        switch remaining {
        case 0: return "这一带集齐了"
        case 1: return "只差一张"
        case 2...3: return "还差 \(remaining) 张就集齐"
        default: return "这一带还有 \(remaining) 个没去过"
        }
    }

    private func statPiece(_ label: String, _ value: String) -> some View {
        HStack(spacing: 3) {
            Text(label)
                .font(WAType.body(12.5))
                .foregroundStyle(WATheme.ink3)
            Text(value)
                .font(.system(size: 12.5, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(WATheme.ink2)
        }
    }

    private var dot: some View {
        Text("·")
            .font(WAType.body(12.5))
            .foregroundStyle(WATheme.ink3)
    }

    // MARK: 筛选 chips

    private var filterRow: some View {
        Picker("筛选", selection: $filter) {
            ForEach(CardFilter.allCases) { item in
                Text(item.rawValue).tag(item)
            }
        }
        .pickerStyle(.segmented)
    }

    // MARK: 卡片网格

    /// 已解锁的排前面，未解锁的按距离由近到远排在后面。
    private var orderedPlaces: [Place] {
        visiblePlaces.sorted { lhs, rhs in
            let lc = collectedIDs.contains(lhs.id)
            let rc = collectedIDs.contains(rhs.id)
            if lc != rc { return lc }
            return distanceTo(lhs) < distanceTo(rhs)
        }
    }

    private func distanceTo(_ place: Place) -> Double {
        guard let origin = store.lastKnownOrigin, let coordinate = place.coordinate else {
            return .greatestFiniteMagnitude
        }
        return GeoMath.distance(from: origin, to: coordinate)
    }

    private var grid: some View {
        LazyVGrid(columns: columns, spacing: 12) {
            ForEach(orderedPlaces) { place in
                Button {
                    if collectedIDs.contains(place.id) {
                        selectedPlace = place
                    } else {
                        startExplore(place)
                    }
                } label: {
                    cardCell(place)
                }
                .buttonStyle(WAPressEffectStyle())
            }
        }
    }

    /// 点未解锁卡片 = 直接出发去这里（不再进详情）。
    /// 没有定位时先要一次定位，拿不到就提示用户开定位——真实模式下绝不虚构起点。
    private func startExplore(_ place: Place) {
        if let origin = store.lastKnownOrigin {
            beginQuest(to: place, origin: origin)
            return
        }
        WAHaptics.light()
        exploreWithoutLocation = place
    }

    private func beginQuest(to place: Place, origin: GeoPoint) {
        guard place.coordinate != nil else {
            exploreError = "这个地点没有真实坐标，没法走过去。换一个。"
            return
        }
        guard store.startQuest(to: place, origin: origin) else {
            exploreError = "这一趟没开成，再点一次。"
            return
        }
        store.rememberPlace(place)
        showJourney = true
    }

    /// 没有定位时：要一次定位再出发（5 秒拿不到就明确说失败，不虚构起点）
    private func requestLocationThenExplore(_ place: Place) async {
        let point = await oneShot.request()
        guard let point else {
            exploreError = "没拿到你的位置。到「设置 → 隐私与安全性 → 定位服务」里允许「步迷」使用定位后再试。"
            return
        }
        store.lastKnownOrigin = point
        beginQuest(to: place, origin: point)
    }

    @ViewBuilder
    private func cardCell(_ place: Place) -> some View {
        let collected = collectedIDs.contains(place.id)
        let card = store.card(for: place.id)

        if collected {
            VStack(alignment: .leading, spacing: 0) {
                Text(place.emoji)
                    .font(.title2)
                    .padding(.bottom, 8)

                Text(place.name)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(WATheme.ink)
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Spacer(minLength: 6)

                HStack(alignment: .center, spacing: 0) {
                    if let card {
                        Text(WAFormat.compactDate(card.collectedAt))
                            .font(.caption2)
                            .monospacedDigit()
                            .foregroundStyle(WATheme.ink2)
                    }
                    Spacer(minLength: 0)
                    WARarityDot(rarity: place.rarity)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .aspectRatio(0.8, contentMode: .fit)
            .background(WATheme.paper)
            .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
        } else {
            // 未探索：问号卡。名字是答案，不能显示；
            // 给「距离 + 一句概括」，点一下直接出发。
            VStack(alignment: .leading, spacing: 0) {
                // 盲盒：虚线盒子里一个问号
                ZStack {
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .strokeBorder(WATheme.amber.opacity(0.55),
                                      style: StrokeStyle(lineWidth: 1.4, dash: [4, 3]))
                        .frame(width: 40, height: 40)
                    Text("?")
                        .font(.system(size: 22, weight: .bold, design: .rounded))
                        .foregroundStyle(WATheme.amber)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 8)

                Text(distanceCopy(place))
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(WATheme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)

                Text(unexploredSummary(place))
                    .font(.caption2)
                    .foregroundStyle(WATheme.ink2)
                    .lineLimit(3)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 3)

                Spacer(minLength: 6)

                HStack(spacing: 3) {
                    Image(systemName: "figure.walk")
                        .font(.caption2)
                    Text("走过去")
                        .font(.caption2.weight(.medium))
                }
                .foregroundStyle(WATheme.amber)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .aspectRatio(0.8, contentMode: .fit)
            .background(WATheme.amberSoft)
            .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous)
                    .strokeBorder(WATheme.amber.opacity(0.25), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
            )
        }
    }

    /// 未探索卡片的一句概括：类别 + 氛围（绝不出现地点名）
    private func unexploredSummary(_ place: Place) -> String {
        // 先用地点自己的线索（已做过去地名清洗），没有就退回类别
        if place.hints.count > 1, !place.hints[1].isEmpty {
            return place.hints[1]
        }
        if !place.category.isEmpty {
            return "是个「\(place.category)」。走过去才知道是哪。"
        }
        return "走过去才知道是哪"
    }

    /// 未解锁卡片的距离文案：远一点就说模糊区间，近了才给具体米数。
    /// 内置虚构地点没有真实坐标 → 不说距离（编一个距离等于骗人），直接说「还没去过」。
    private func distanceCopy(_ place: Place) -> String {
        guard place.coordinate != nil else { return "还没去过" }
        let meters = distanceTo(place)
        guard meters.isFinite else { return "位置未知" }
        switch meters {
        case ..<100: return "就在旁边"
        case ..<300: return "约 \(Int((meters / 50).rounded()) * 50) 米"
        case ..<1000: return "约 \(Int((meters / 100).rounded()))00 米"
        case ..<3000: return "约 \(String(format: "%.1f", meters / 1000)) 公里"
        default: return "要专程去一趟"
        }
    }

    // MARK: 数据

    private var collectedIDs: Set<String> {
        store.profile.collectedPlaceIDs
    }

    /// 已收录、但当前查不到地点详情的卡。
    /// 早期版本收录运行时抓到的 POI 时没有落盘地点信息，重启后详情就丢了。
    /// 这类卡不能静默丢弃（那是用户真实走过的），但也不能编一个地点出来，
    /// 所以单独说一句「有 N 张缺详情」。
    private var unresolvedCards: [PlaceCard] {
        let resolvable = Set(allPlaces.map(\.id))
        return store.profile.cards.filter { !resolvable.contains($0.placeID) }
    }

    private var localArea: Area {
        store.currentPlace?.area ?? .near
    }

    /// 「走到那儿」的上限。超过就**不显示**，而不是列出来写一句「在比较远的地方」。
    ///
    /// 30 公里太大：在南京会把 271 公里外的上海策展点也列成问号卡（用户实际踩到）。
    /// 3 公里才是「周围」——步行 40 分钟内能到。
    private static let exploreRadiusMeters: Double = 3_000

    /// 图鉴的全部候选：只包含**真实坐标 + 能走到**的地点。
    ///
    /// 两条规则：
    ///   1. 已收录的卡无条件保留（历史卡不能因为后台下架或搬城市就消失）；
    ///   2. 未收录的候选，只取当前位置 30 公里内的真实地点 —— 远的直接不列，
    ///      而不是列出来写一句「在比较远的地方」。
    private var allPlaces: [Place] {
        var seen = Set<String>()
        var result: [Place] = []
        let origin = store.lastKnownOrigin

        func append(_ place: Place?, allowFar: Bool) {
            guard let place, place.coordinate != nil, !seen.contains(place.id) else { return }
            if !allowFar {
                // 没有定位时无法判断远近：未收录的候选一律不列（不能靠猜）
                guard let origin, let coordinate = place.coordinate else { return }
                guard GeoMath.distance(from: origin, to: coordinate) <= Self.exploreRadiusMeters else { return }
            }
            seen.insert(place.id)
            result.append(place)
        }

        // 1) 已收录的（无条件保留）
        for card in store.profile.cards.sorted(by: { $0.collectedAt > $1.collectedAt }) {
            append(PlaceDirectory.shared.place(id: card.placeID), allowFar: true)
            append(AdminPOIService.shared.place(for: card.placeID), allowFar: true)
        }
        // 2) 后台策展的：只有在「周围 3 公里」内才列（其它城市的点绝不出现）
        for poi in AdminPOIService.shared.allPlaces { append(poi, allowFar: false) }
        // 3) 运行时抓到过的真实点（同样只看走得到的）
        for place in PlaceDirectory.shared.all { append(place, allowFar: false) }
        // 4) 现场搜到的附近真实兴趣点（未探索 → 问号卡）
        for place in nearbyCandidates { append(place, allowFar: false) }

        return result
    }

    private var visiblePlaces: [Place] {
        let base = allPlaces.filter { $0.coordinate != nil }
        switch filter {
        case .all:
            return base
        case .rare:
            return base.filter { $0.rarity == .rare || $0.rarity == .epic }
        case .hidden:
            return base.filter { $0.rarity == .hidden }
        case .nearby:
            return base.filter { $0.area == localArea }
        }
    }
}
