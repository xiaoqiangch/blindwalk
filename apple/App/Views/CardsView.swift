import SwiftUI

// MARK: - 图鉴 Cards（design-system §5.5，视觉基准：web 原型 #/cards）

struct CardsView: View {

    let store: WalkaholicStore

    @State private var filter: CardFilter = .all
    @State private var selectedPlace: Place?
    /// 从「附近惊喜」点进来的惊喜 id（打开探寻页时聚焦它）
    @State private var seekFocusID: String?
    @State private var showSeek = false

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
        ZStack {
            WAPaperBackground()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    collectStats.padding(.top, 2).padding(.bottom, 10)
                    nearbyHintsSection.padding(.bottom, 12)
                    filterRow.padding(.bottom, 15)
                    grid
                }
                .padding(.horizontal, WATheme.pagePadding)
                .padding(.top, 6)
                .padding(.bottom, 24)
            }

            if let selectedPlace {
                detailOverlay(selectedPlace)
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
        .toolbar(.hidden, for: .navigationBar)
        .waTabBarChrome()
        .waTypeBounds()
        .animation(WAAnimation.regular, value: selectedPlace?.id)
        .onAppear {
            // 仅用于截图/演示：`WA_PREVIEW_DETAIL=1` 打开第一张已收集卡的详情
            guard ProcessInfo.processInfo.environment["WA_PREVIEW_DETAIL"] == "1", selectedPlace == nil else { return }
            waAfter(0.5) {
                selectedPlace = allPlaces.first { collectedIDs.contains($0.id) }
            }
        }
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
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text("附近的惊喜")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(WATheme.ink)
                Spacer(minLength: 0)
                Text(list.isEmpty ? "这一带暂时没有" : "\(list.count) 个还没被找到")
                    .font(.system(size: 12))
                    .foregroundStyle(WATheme.ink3)
            }
            .padding(.bottom, 10)

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
                    .overlay(
                        RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous)
                            .stroke(WATheme.line, style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                    )
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
                                    .font(.system(size: 15))
                                    .frame(width: 32, height: 32)
                                    .background(WATheme.paper2)
                                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(distanceBucket(store.lastKnownOrigin.map { GeoMath.distance(from: $0, to: surprise.location) }))
                                        .font(.system(size: 14, weight: .medium))
                                        .foregroundStyle(WATheme.ink)
                                    Text(atmosphere(for: surprise))
                                        .font(.system(size: 12.5))
                                        .foregroundStyle(WATheme.ink3)
                                        .lineLimit(2)
                                        .multilineTextAlignment(.leading)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(WATheme.ink3)
                            }
                            .padding(.vertical, 11)
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
                .overlay(
                    RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous)
                        .stroke(WATheme.line, lineWidth: 1)
                )
            }
        }
    }

    // MARK: 顶栏

    private var header: some View {
        HStack(alignment: .center) {
            Text("回忆册")
                .font(WAType.pageTitle())
                .foregroundStyle(WATheme.ink)

            Spacer(minLength: 0)

            Menu {
                ForEach(CardFilter.allCases) { item in
                    Button {
                        filter = item
                    } label: {
                        Label(item.rawValue, systemImage: item.symbol)
                    }
                }
            } label: {
                Image(systemName: "line.3.horizontal.decrease")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(WATheme.ink2)
                    .frame(width: 34, height: 34)
                    .background(WATheme.paper)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(WATheme.line, lineWidth: 1))
            }
            .accessibilityLabel("筛选")
        }
        .padding(.bottom, 12)
    }

    // MARK: 统计条：已收集 18/24 · 稀有 7 · 隐藏 1

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
        HStack(spacing: 8) {
            ForEach(CardFilter.allCases) { item in
                WAPill(title: item.rawValue, selected: filter == item) {
                    withAnimation(WAAnimation.quick) {
                        filter = item
                    }
                }
            }
            Spacer(minLength: 0)
        }
    }

    // MARK: 3 列卡片网格

    private var grid: some View {
        LazyVGrid(columns: columns, spacing: 12) {
            ForEach(visiblePlaces) { place in
                Button {
                    if collectedIDs.contains(place.id) {
                        selectedPlace = place
                    }
                } label: {
                    cardCell(place)
                }
                .buttonStyle(WAPressEffectStyle())
                .disabled(!collectedIDs.contains(place.id))
            }
        }
    }

    @ViewBuilder
    private func cardCell(_ place: Place) -> some View {
        let collected = collectedIDs.contains(place.id)
        let card = store.card(for: place.id)

        if collected {
            VStack(alignment: .leading, spacing: 0) {
                Text(place.emoji)
                    .font(.system(size: 20))
                    .padding(.bottom, 10)

                Text(place.name)
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(WATheme.ink)
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Spacer(minLength: 6)

                HStack(alignment: .center, spacing: 0) {
                    if let card {
                        Text(WAFormat.compactDate(card.collectedAt))
                            .font(.system(size: 11))
                            .monospacedDigit()
                            .foregroundStyle(WATheme.ink3)
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
            .overlay(
                RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous)
                    .stroke(WATheme.line, lineWidth: 1)
            )
        } else {
            VStack(spacing: 6) {
                Image(systemName: "lock")
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(WATheme.ink3)
                Text("未解锁")
                    .font(.system(size: 11.5))
                    .foregroundStyle(WATheme.ink3)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .aspectRatio(0.8, contentMode: .fit)
            .overlay(
                RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous)
                    .strokeBorder(WATheme.line, style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
            )
        }
    }

    // MARK: 居中放大查看

    private func detailOverlay(_ place: Place) -> some View {
        ZStack {
            WATheme.ink.opacity(0.38)
                .ignoresSafeArea()
                .onTapGesture {
                    selectedPlace = nil
                }

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .top) {
                        WAMicroLabel("图鉴 · \(WAFormat.areaName(place.area))")
                        Spacer(minLength: 8)
                        WARarityBadge(rarity: place.rarity)
                    }
                    .padding(.bottom, 16)

                    VStack(spacing: 8) {
                        Text(place.emoji)
                            .font(.system(size: 38))
                        Text(place.name)
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(WATheme.ink)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                        if let card = store.card(for: place.id) {
                            Text("\(card.serialDisplay) · \(WAFormat.shortDate(card.collectedAt))")
                                .font(WAType.caption(12))
                                .monospacedDigit()
                                .foregroundStyle(WATheme.ink3)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.bottom, 16)

                    WAHairline()

                    VStack(alignment: .leading, spacing: 6) {
                        WAMicroLabel("为什么是这里")
                        Text(place.why)
                            .font(.system(size: 14))
                            .foregroundStyle(WATheme.ink2)
                            .lineSpacing(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.vertical, 14)

                    WAHairline()

                    taskView(place)
                        .padding(.top, 14)

                    HStack(spacing: 8) {
                        Button {
                            selectedPlace = nil
                        } label: {
                            Text("关闭")
                                .font(WAType.cta(14.5))
                                .foregroundStyle(WATheme.ink)
                                .frame(maxWidth: .infinity)
                                .frame(height: 46)
                                .background(WATheme.paper2)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .buttonStyle(WAPressEffectStyle())
                    }
                    .padding(.top, 16)
                }
                .padding(.horizontal, 20)
                .padding(.top, 18)
                .padding(.bottom, 20)
                .background(WATheme.paper)
                .clipShape(RoundedRectangle(cornerRadius: WATheme.panelRadius, style: .continuous))
                .frame(maxWidth: 322)
                .padding(.horizontal, 26)
                .padding(.vertical, 40)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .transition(.opacity)
    }

    private func taskView(_ place: Place) -> some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 4) {
                    Image(systemName: "checklist")
                        .font(.system(size: 11, weight: .regular))
                        .foregroundStyle(WATheme.ink3)
                    WAMicroLabel("小任务")
                }
                Text(place.task)
                    .font(.system(size: 13.5))
                    .foregroundStyle(WATheme.ink)
                    .fixedSize(horizontal: false, vertical: true)

                if let card = store.card(for: place.id) {
                    Text(card.taskDone ? "已完成" : "还没打卡 · 下次再去补上")
                        .font(.system(size: 12))
                        .foregroundStyle(card.taskDone ? WATheme.teal : WATheme.ink3)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WATheme.paper2)
        .clipShape(RoundedRectangle(cornerRadius: WATheme.controlRadius, style: .continuous))
    }

    // MARK: 数据

    private var collectedIDs: Set<String> {
        store.profile.collectedPlaceIDs
    }

    private var localArea: Area {
        store.currentPlace?.area ?? .near
    }

    /// 内置图鉴 + 本机已收录的策展点（后台「编辑精选」）。
    /// 只合并「已经收进 profile.cards」的策展点，未抽到的不提前剧透。
    private var allPlaces: [Place] {
        let curated = store.profile.cards.compactMap { card in
            AdminPOIService.shared.place(for: card.placeID)
        }
        return PlaceCatalog.all + curated
    }

    private var visiblePlaces: [Place] {
        let base = allPlaces
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
