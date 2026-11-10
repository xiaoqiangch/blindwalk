import SwiftUI

// MARK: - 图鉴 Cards（design-system §5.5，视觉基准：web 原型 #/cards）

struct CardsView: View {

    let store: BlindWalkStore

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
            BWPaperBackground()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    collectStats.padding(.top, 2).padding(.bottom, 10)
                    nearbyHintsSection.padding(.bottom, 12)
                    filterRow.padding(.bottom, 15)
                    grid
                }
                .padding(.horizontal, BWTheme.pagePadding)
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
        .bwTabBarChrome()
        .bwTypeBounds()
        .animation(BWAnimation.regular, value: selectedPlace?.id)
        .onAppear {
            // 仅用于截图/演示：`BW_PREVIEW_DETAIL=1` 打开第一张已收集卡的详情
            guard ProcessInfo.processInfo.environment["BW_PREVIEW_DETAIL"] == "1", selectedPlace == nil else { return }
            bwAfter(0.5) {
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
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("附近的惊喜")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(BWTheme.ink)
                Text(list.isEmpty ? "这一带暂时没有" : "\(list.count) 个还没被找到")
                    .font(.system(size: 11.5))
                    .foregroundStyle(BWTheme.ink3)
            }

            if list.isEmpty {
                Button {
                    showSeek = true
                } label: {
                    Text("有人在这儿留下第一张？埋一个 →")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(BWTheme.amberDeep)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(BWTheme.amber.opacity(0.05))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(BWTheme.amber.opacity(0.35), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                        )
                }
                .buttonStyle(.plain)
            } else {
                ForEach(list) { surprise in
                    Button {
                        seekFocusID = surprise.id
                        showSeek = true
                    } label: {
                        HStack(alignment: .top, spacing: 10) {
                            Text(surprise.authorEmoji)
                                .font(.system(size: 17))
                                .frame(width: 32, height: 32)
                                .background(BWTheme.amber.opacity(0.1))
                                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(distanceBucket(store.lastKnownOrigin.map { GeoMath.distance(from: $0, to: surprise.location) })) · 有人留下一张照片")
                                    .font(.system(size: 13.5, weight: .semibold))
                                    .foregroundStyle(BWTheme.ink)
                                    .multilineTextAlignment(.leading)
                                Text(atmosphere(for: surprise))
                                    .font(.system(size: 12.5))
                                    .foregroundStyle(BWTheme.ink2)
                                    .multilineTextAlignment(.leading)
                                Text("线索要靠走近才会解锁 · 点这里开始找")
                                    .font(.system(size: 10.5))
                                    .foregroundStyle(BWTheme.ink3)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(BWTheme.ink3)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 11)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(BWTheme.amber.opacity(0.18), lineWidth: 1)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous)
                .fill(LinearGradient(colors: [Color(hex: 0xF4F6FF), .white], startPoint: .topLeading, endPoint: .bottomTrailing))
        )
        .overlay(
            RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous)
                .stroke(BWTheme.line, lineWidth: 1)
        )
    }

    // MARK: 顶栏

    private var header: some View {
        HStack(alignment: .center) {
            Text("回忆册")
                .font(BWType.pageTitle())
                .foregroundStyle(BWTheme.ink)

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
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(BWTheme.ink2)
                    .frame(width: 34, height: 34)
                    .background(BWTheme.paper)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(BWTheme.line, lineWidth: 1))
            }
            .accessibilityLabel("筛选")
        }
        .padding(.bottom, 10)
    }

    // MARK: 统计条：已收集 18/24 · 稀有 7 · 隐藏 1（web 是一行文字，不是卡片）

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
                .font(BWType.body(12))
                .foregroundStyle(BWTheme.ink2)
            Text(value)
                .font(.system(size: 13, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(BWTheme.ink)
        }
    }

    private var dot: some View {
        Text("·")
            .font(BWType.body(12))
            .foregroundStyle(BWTheme.ink3)
    }

    // MARK: 筛选 chips

    private var filterRow: some View {
        HStack(spacing: 8) {
            ForEach(CardFilter.allCases) { item in
                BWPill(title: item.rawValue, selected: filter == item) {
                    withAnimation(BWAnimation.quick) {
                        filter = item
                    }
                }
            }
            Spacer(minLength: 0)
        }
    }

    // MARK: 3 列卡片网格

    private var grid: some View {
        LazyVGrid(columns: columns, spacing: 10) {
            ForEach(visiblePlaces) { place in
                Button {
                    if collectedIDs.contains(place.id) {
                        selectedPlace = place
                    }
                } label: {
                    cardCell(place)
                }
                .buttonStyle(BWPressEffectStyle())
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
                    .font(.system(size: 21))
                    .padding(.bottom, 6)

                Text(place.name)
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(BWTheme.ink)
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Spacer(minLength: 4)

                HStack(alignment: .center, spacing: 0) {
                    if let card {
                        Text(BWFormat.compactDate(card.collectedAt))
                            .font(.system(size: 10.5))
                            .monospacedDigit()
                            .foregroundStyle(BWTheme.ink3)
                    }
                    Spacer(minLength: 0)
                    BWRarityDot(rarity: place.rarity)
                }
            }
            .padding(.horizontal, 9)
            .padding(.top, 9)
            .padding(.bottom, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .aspectRatio(0.8, contentMode: .fit)
            .background(BWTheme.paper)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(BWTheme.line, lineWidth: 1)
            )
        } else {
            VStack(spacing: 5) {
                Text("?")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(BWTheme.ink3)
                Text("未解锁")
                    .font(.system(size: 11))
                    .tracking(0.5)
                    .foregroundStyle(BWTheme.ink3)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .aspectRatio(0.8, contentMode: .fit)
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(BWTheme.line, style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
            )
        }
    }

    // MARK: 居中放大查看

    private func detailOverlay(_ place: Place) -> some View {
        ZStack {
            BWTheme.ink.opacity(0.46)
                .ignoresSafeArea()
                .onTapGesture {
                    selectedPlace = nil
                }

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .top) {
                        BWMicroLabel("图鉴 · \(BWFormat.areaName(place.area))")
                        Spacer(minLength: 8)
                        BWRarityBadge(rarity: place.rarity)
                    }
                    .padding(.bottom, 13)

                    VStack(spacing: 6) {
                        Text(place.emoji)
                            .font(.system(size: 40))
                        Text(place.name)
                            .font(.system(size: 22, weight: .bold))
                            .foregroundStyle(BWTheme.ink)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                        if let card = store.card(for: place.id) {
                            Text("\(card.serialDisplay) · \(BWFormat.shortDate(card.collectedAt))")
                                .font(BWType.caption(10.5))
                                .monospacedDigit()
                                .foregroundStyle(BWTheme.ink3)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.bottom, 14)

                    BWHairline()

                    VStack(alignment: .leading, spacing: 6) {
                        BWMicroLabel("为什么是这里")
                        Text(place.why)
                            .font(.system(size: 14))
                            .foregroundStyle(BWTheme.ink2)
                            .lineSpacing(4)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.vertical, 12)

                    BWHairline()

                    taskView(place)
                        .padding(.top, 12)

                    HStack(spacing: 8) {
                        Button {
                            selectedPlace = nil
                        } label: {
                            Text("关闭")
                                .font(BWType.cta(14))
                                .foregroundStyle(BWTheme.ink2)
                                .frame(maxWidth: .infinity)
                                .frame(height: 44)
                                .overlay(Capsule().stroke(BWTheme.line, lineWidth: 1))
                        }
                        .buttonStyle(BWPressEffectStyle())
                    }
                    .padding(.top, 14)
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 18)
                .background(BWTheme.paper)
                .clipShape(RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous))
                .frame(maxWidth: 322)
                .shadow(color: BWTheme.ink.opacity(0.28), radius: 30, x: 0, y: 18)
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
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 3) {
                    Text("🎯").font(.system(size: 12))
                    BWMicroLabel("小任务")
                }
                Text(place.task)
                    .font(.system(size: 13.5))
                    .foregroundStyle(BWTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)

                if let card = store.card(for: place.id) {
                    Text(card.taskDone ? "已完成" : "还没打卡 · 下次再去补上")
                        .font(.system(size: 11.5))
                        .foregroundStyle(card.taskDone ? BWTheme.teal : BWTheme.ink3)
                }
            }
            Spacer(minLength: 0)
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
