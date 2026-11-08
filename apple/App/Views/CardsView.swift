import SwiftUI

// MARK: - 图鉴 Cards（design-system §5.5）

struct CardsView: View {

    let store: BlindWalkStore

    @State private var filter: CardFilter = .all
    @State private var selectedPlace: Place?

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

    private let columns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12)
    ]

    var body: some View {
        ZStack {
            BWPaperBackground()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    statBar
                    filterRow
                    grid
                }
                .padding(.horizontal, BWTheme.pagePadding)
                .padding(.top, 8)
                .padding(.bottom, 24)
            }

            if let selectedPlace {
                detailOverlay(selectedPlace)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .animation(BWAnimation.regular, value: selectedPlace?.id)
    }

    // MARK: 顶栏

    private var header: some View {
        HStack(alignment: .center) {
            Text("回忆册")
                .font(BWTheme.title(26))
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
                Image(systemName: "line.3.horizontal.decrease.circle")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(BWTheme.ink2)
                    .frame(width: 36, height: 36)
                    .background(BWTheme.paper)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(BWTheme.line, lineWidth: 1))
            }
        }
    }

    // MARK: 统计条：已收集 18/24 · 稀有 7 · 隐藏 1

    private var statBar: some View {
        HStack(spacing: 0) {
            statCell(title: "已收集", value: "\(collectedIDs.count)/\(PlaceCatalog.all.count)")
            statDivider
            statCell(title: "稀有", value: "\(store.profile.rareCount)")
            statDivider
            statCell(title: "隐藏", value: "\(store.profile.hiddenCount)")
        }
        .padding(.vertical, 12)
        .background(BWTheme.paper.opacity(0.7))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(BWTheme.line, lineWidth: 1)
        )
    }

    private func statCell(title: String, value: String) -> some View {
        HStack(spacing: 5) {
            Text(title)
                .font(BWTheme.caption(10))
                .foregroundStyle(BWTheme.ink3)
            Text(value)
                .font(BWTheme.caption(13))
                .monospacedDigit()
                .foregroundStyle(BWTheme.ink)
        }
        .frame(maxWidth: .infinity)
    }

    private var statDivider: some View {
        Rectangle()
            .fill(BWTheme.line)
            .frame(width: 1, height: 18)
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
        LazyVGrid(columns: columns, spacing: 12) {
            ForEach(visiblePlaces) { place in
                Button {
                    if collectedIDs.contains(place.id) {
                        selectedPlace = place
                    }
                } label: {
                    cardCell(place)
                }
                .buttonStyle(BWPressEffectStyle())
            }
        }
    }

    private func cardCell(_ place: Place) -> some View {
        let collected = collectedIDs.contains(place.id)
        let card = store.card(for: place.id)

        return Group {
            if collected {
                VStack(alignment: .leading, spacing: 6) {
                    Text(place.emoji)
                        .font(.system(size: 26))

                    Text(place.name)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(BWTheme.ink)
                        .lineLimit(2)
                        .minimumScaleFactor(0.85)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Spacer(minLength: 0)

                    HStack(spacing: 4) {
                        if let card {
                            Text(BWFormat.shortDate(card.collectedAt))
                                .font(.system(size: 9))
                                .foregroundStyle(BWTheme.ink3)
                        }
                        Spacer(minLength: 0)
                        Circle()
                            .fill(BWTheme.rarityColor(place.rarity))
                            .frame(width: 5, height: 5)
                    }
                }
                .padding(10)
                .frame(maxWidth: .infinity)
                .frame(height: 128)
                .background(BWTheme.paper)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(BWTheme.line, lineWidth: 1)
                )
                .shadow(color: BWTheme.ink.opacity(0.06), radius: 8, x: 0, y: 4)
            } else {
                ZStack {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(BWTheme.paper2.opacity(0.5))
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(BWTheme.line, style: StrokeStyle(lineWidth: 1.2, dash: [5, 4]))

                    VStack(spacing: 6) {
                        Text("?")
                            .font(.system(size: 26, weight: .bold, design: .rounded))
                            .foregroundStyle(BWTheme.ink3.opacity(0.7))
                        Text("未解锁")
                            .font(.system(size: 9))
                            .foregroundStyle(BWTheme.ink3)
                    }
                }
                .frame(height: 128)
            }
        }
    }

    // MARK: 居中放大查看

    private func detailOverlay(_ place: Place) -> some View {
        ZStack {
            BWTheme.ink.opacity(0.35)
                .ignoresSafeArea()
                .onTapGesture {
                    selectedPlace = nil
                }

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(alignment: .top) {
                        BWMicroLabel("图鉴 · \(BWFormat.areaName(place.area))")
                        Spacer(minLength: 8)
                        BWRarityBadge(rarity: place.rarity)
                    }

                    VStack(spacing: 6) {
                        Text(place.emoji)
                            .font(.system(size: 40))
                        Text(place.name)
                            .font(BWTheme.title(22))
                            .foregroundStyle(BWTheme.ink)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                        if let card = store.card(for: place.id) {
                            Text("\(card.serialDisplay) · \(BWFormat.shortDate(card.collectedAt))")
                                .font(BWTheme.caption(11))
                                .monospacedDigit()
                                .foregroundStyle(BWTheme.ink3)
                        }
                    }
                    .frame(maxWidth: .infinity)

                    Rectangle()
                        .fill(BWTheme.line)
                        .frame(height: 1)

                    Text(place.why)
                        .font(BWTheme.body(14))
                        .foregroundStyle(BWTheme.ink)
                        .lineSpacing(4)
                        .fixedSize(horizontal: false, vertical: true)

                    taskView(place)

                    Button {
                        selectedPlace = nil
                    } label: {
                        Text("关闭")
                            .font(BWTheme.title(14))
                            .foregroundStyle(BWTheme.ink2)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(BWTheme.paper2)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(BWTheme.line, lineWidth: 1))
                    }
                    .buttonStyle(BWPressEffectStyle())
                }
                .padding(20)
                .background(BWTheme.paper)
                .clipShape(RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous)
                        .stroke(BWTheme.line, lineWidth: 1)
                )
                .shadow(color: BWTheme.ink.opacity(0.18), radius: 24, x: 0, y: 16)
                .padding(.horizontal, 32)
                .padding(.vertical, 60)
            }
        }
        .transition(.opacity)
    }

    private func taskView(_ place: Place) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("🎯 小任务")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(BWTheme.ink2)
            Text(place.task)
                .font(BWTheme.body(14))
                .foregroundStyle(BWTheme.ink)
                .fixedSize(horizontal: false, vertical: true)

            if let card = store.card(for: place.id) {
                Text(card.taskDone ? "已完成" : "还没打卡 · 下次再去补上")
                    .font(BWTheme.caption(10))
                    .foregroundStyle(card.taskDone ? BWTheme.teal : BWTheme.ink3)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BWTheme.paper2)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    // MARK: 数据

    private var collectedIDs: Set<String> {
        store.profile.collectedPlaceIDs
    }

    private var localArea: Area {
        store.currentPlace?.area ?? .near
    }

    private var visiblePlaces: [Place] {
        switch filter {
        case .all:
            return PlaceCatalog.all
        case .rare:
            return PlaceCatalog.all.filter { $0.rarity == .rare || $0.rarity == .epic }
        case .hidden:
            return PlaceCatalog.all.filter { $0.rarity == .hidden }
        case .nearby:
            return PlaceCatalog.all.filter { $0.area == localArea }
        }
    }
}
