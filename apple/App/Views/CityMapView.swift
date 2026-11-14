import SwiftUI
import MapKit

// MARK: - 个人城市地图（我的足迹）
//
// 为什么要有这一页：卡片是「产品给的」，走过的路是「我自己留下的」。
// 它把两件事画在同一张图上：
//   1. 真实走过的轨迹（`WalkTrackStore`，只在步行段记录，开车段不画）；
//   2. 已经收下的地点（图鉴里的卡，有真实坐标的）。
//
// 边界：
// - 只在本地画，不上传任何坐标（与「隐私与安全」的承诺一致）。
// - 轨迹按天分线，最近一天最亮，越久越淡 —— 一眼能看出「哪片是我最熟的」。
// - 没有轨迹、也没有收过卡时给空状态，不画假数据。

struct CityMapView: View {

    let store: WalkaholicStore

    @State private var camera: MapCameraPosition = .automatic
    @State private var window: MapWindow = .all
    @State private var didFit = false

    private let track = WalkTrackStore.shared

    enum MapWindow: String, CaseIterable, Identifiable {
        case all = "全部"
        case recent = "最近 7 天"

        var id: String { rawValue }
    }

    // MARK: 数据

    /// 按天切好的轨迹（新的在前），取样到「够画一条线」的密度
    private var dayTracks: [(day: Date, points: [GeoPoint])] {
        let all = track.days()
        let cutoff = Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? .distantPast
        let source = window == .recent ? all.filter { $0.day >= cutoff } : all
        return source.prefix(90).map { entry in
            (entry.day, Self.simplify(entry.points.map(\.coordinate), limit: 400))
        }
    }

    /// 已收录且带真实坐标的地点
    private var visited: [(place: Place, at: Date)] {
        store.profile.cards.compactMap { card in
            guard let place = PlaceDirectory.shared.place(id: card.placeID),
                  place.coordinate != nil else { return nil }
            return (place, card.collectedAt)
        }
    }

    private var allCoordinates: [GeoPoint] {
        dayTracks.flatMap { $0.points } + visited.compactMap { $0.place.coordinate }
    }

    private var isEmpty: Bool {
        dayTracks.allSatisfy { $0.points.isEmpty } && visited.isEmpty
    }

    // MARK: 视图

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 16) {
                statsCard
                    .padding(.horizontal, WATheme.pagePadding)

                if isEmpty {
                    emptyCard
                        .padding(.horizontal, WATheme.pagePadding)
                } else {
                    mapCard
                        .padding(.horizontal, WATheme.pagePadding)
                    legend
                        .padding(.horizontal, WATheme.pagePadding)
                }

                Text("轨迹只存在这台手机上，不会上传。开车段不记，只留走路的那部分。")
                    .font(WAType.caption(10.5))
                    .foregroundStyle(WATheme.ink3)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.horizontal, WATheme.pagePadding)
                    .padding(.top, 2)
                    .padding(.bottom, 26)
            }
            .padding(.top, 12)
        }
        .background(WATheme.cream)
        .navigationTitle("我的城市")
        .navigationBarTitleDisplayMode(.inline)
        .waTypeBounds()
        .onAppear(perform: fitCamera)
        .onChange(of: window) { _, _ in fitCamera() }
    }

    // MARK: 统计

    private var statsCard: some View {
        let cells = track.exploredCellCount
        let area = Double(cells) * (WalkTrackStore.cellMeters * WalkTrackStore.cellMeters) / 1_000_000
        return WACard(padding: 16, background: WATheme.paper) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(store.profile.displayName)
                        .font(.headline)
                        .foregroundStyle(WATheme.ink)
                    Spacer(minLength: 0)
                    Text("\(track.walkedDayCount) 天在路上")
                        .font(.footnote)
                        .foregroundStyle(WATheme.ink2)
                        .monospacedDigit()
                }

                WAStatsRow(items: [
                    (WAFormat.decimal1(track.totalMeters / 1000), "走过公里"),
                    ("\(cells)", "探索街区"),
                    (String(format: "%.1f", area), "平方公里")
                ])

                HStack(spacing: 6) {
                    Image(systemName: "mappin.and.ellipse")
                        .font(.caption)
                    Text("收下的地点 \(visited.count) 处")
                        .font(WAType.caption(11.5))
                }
                .foregroundStyle(WATheme.ink2)
            }
        }
    }

    // MARK: 地图

    private var mapCard: some View {
        ZStack(alignment: .topTrailing) {
            Map(position: $camera, interactionModes: [.pan, .zoom]) {
                ForEach(Array(dayTracks.enumerated()), id: \.offset) { index, entry in
                    if entry.points.count >= 2 {
                        MapPolyline(coordinates: entry.points.map(Self.coordinate))
                            .stroke(
                                WATheme.amber.opacity(Self.opacity(rank: index)),
                                style: StrokeStyle(lineWidth: 3.4, lineCap: .round, lineJoin: .round)
                            )
                    }
                }

                ForEach(visited, id: \.place.id) { item in
                    if let coordinate = item.place.coordinate {
                        Annotation(item.place.name, coordinate: Self.coordinate(coordinate)) {
                            Text(item.place.emoji)
                                .font(.system(size: 15))
                                .frame(width: 28, height: 28)
                                .background(WATheme.paper)
                                .clipShape(Circle())
                                .overlay(Circle().stroke(WATheme.amber.opacity(0.45), lineWidth: 1))
                                .shadow(color: WATheme.ink.opacity(0.14), radius: 3, y: 1)
                        }
                    }
                }
            }
            .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
            .mapControls { }
            .frame(height: 420)
            .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous)
                    .stroke(WATheme.line, lineWidth: 1)
            )

            Picker("范围", selection: $window) {
                ForEach(MapWindow.allCases) { item in
                    Text(item.rawValue).tag(item)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 176)
            .padding(10)
        }
    }

    private var legend: some View {
        HStack(spacing: 14) {
            legendDot(color: WATheme.amber, text: "最近走过")
            legendDot(color: WATheme.amber.opacity(0.35), text: "更早的")
            legendDot(color: WATheme.ink3.opacity(0.6), text: "收下的地点")
            Spacer(minLength: 0)
        }
    }

    private func legendDot(color: Color, text: String) -> some View {
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(text)
                .font(WAType.caption(10.5))
                .foregroundStyle(WATheme.ink2)
        }
    }

    private var emptyCard: some View {
        WACard(padding: 0) {
            WAEmptyState(
                title: "城市地图还是空的。",
                subtitle: "打开一个盲盒走完，走过的路会自己长在这张图上。"
            )
        }
    }

    // MARK: 相机

    private func fitCamera() {
        let points = allCoordinates
        guard let first = points.first else { return }
        var minLat = first.latitude, maxLat = first.latitude
        var minLon = first.longitude, maxLon = first.longitude
        for point in points {
            minLat = min(minLat, point.latitude)
            maxLat = max(maxLat, point.latitude)
            minLon = min(minLon, point.longitude)
            maxLon = max(maxLon, point.longitude)
        }
        // 留出边距；最小视野约 1.2 公里，避免单点被放大到街道级
        let latSpan = max((maxLat - minLat) * 1.35, 0.012)
        let lonSpan = max((maxLon - minLon) * 1.35, 0.012)
        let region = MKCoordinateRegion(
            center: CLLocationCoordinate2D(
                latitude: (minLat + maxLat) / 2,
                longitude: (minLon + maxLon) / 2
            ),
            span: MKCoordinateSpan(latitudeDelta: latSpan, longitudeDelta: lonSpan)
        )
        withAnimation(.easeInOut(duration: didFit ? 0.3 : 0)) {
            camera = .region(region)
        }
        didFit = true
    }

    // MARK: 工具

    /// 越新的轨迹越亮；最多衰减到 0.22，保证旧轨迹还看得见
    private static func opacity(rank: Int) -> Double {
        max(0.22, 0.9 - Double(rank) * 0.06)
    }

    private static func coordinate(_ point: GeoPoint) -> CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: point.latitude, longitude: point.longitude)
    }

    /// 抽稀：MapKit 画几千个点会卡，等距采样到 limit 个即可
    private static func simplify(_ points: [GeoPoint], limit: Int) -> [GeoPoint] {
        guard points.count > limit else { return points }
        let step = Double(points.count) / Double(limit)
        var out: [GeoPoint] = []
        out.reserveCapacity(limit)
        for index in 0..<limit {
            out.append(points[min(points.count - 1, Int(Double(index) * step))])
        }
        if let last = points.last, out.last != last { out.append(last) }
        return out
    }
}
