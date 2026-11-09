import SwiftUI
import MapKit

/// 真实地图（design-system：目的地保密）
///
/// **产品核心约束**：地图上只画「你」和已经走过的轨迹，
/// **绝不画目的地图标、不画路线终点、不显示目的地方向的固定标记**。
/// 用户只能靠方向箭头 + 距离 + 线索走，到了才揭晓。
struct RealMapView: View {

    /// 用户当前位置（跟随定位更新）
    let userLocation: GeoPoint?
    /// 已走轨迹（按时间顺序）
    let trail: [GeoPoint]
    /// 剩余距离，用于呼吸光点的强弱（不给方向）
    let remainingMeters: Int
    /// nil = 填满父容器
    let height: CGFloat?

    @State private var camera: MapCameraPosition = .automatic

    private var coordinate: CLLocationCoordinate2D? {
        guard let userLocation else { return nil }
        return CLLocationCoordinate2D(latitude: userLocation.latitude, longitude: userLocation.longitude)
    }

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Map(position: $camera, interactionModes: [.pan, .zoom]) {
                // 只画轨迹与你，不画目的地
                if trail.count >= 2 {
                    MapPolyline(coordinates: trail.map {
                        CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
                    })
                    .stroke(BWTheme.amber.opacity(0.85), style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
                }
                if let coordinate {
                    Annotation("你", coordinate: coordinate) {
                        userDot
                    }
                }
            }
            .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
            .mapControls { }
            .frame(height: height)
            .frame(maxHeight: height == nil ? .infinity : nil)
            .clipShape(RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous)
                    .stroke(BWTheme.line, lineWidth: 1)
            )

            // 左上角说明：目的地保密
            HStack(spacing: 5) {
                Image(systemName: "eye.slash")
                    .font(.system(size: 10, weight: .semibold))
                Text("目的地保密中 · 还有 \(remainingMeters) 米")
                    .font(BWTheme.caption(11))
            }
            .foregroundStyle(BWTheme.ink2)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(BWTheme.paper.opacity(0.92))
            .clipShape(Capsule())
            .overlay(Capsule().stroke(BWTheme.line, lineWidth: 1))
            .padding(12)

            // 右下角「真实地图」标记
            HStack(spacing: 4) {
                Image(systemName: "map")
                    .font(.system(size: 9, weight: .semibold))
                Text("真实地图")
                    .font(.system(size: 9.5, weight: .semibold))
            }
            .foregroundStyle(BWTheme.teal)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(BWTheme.paper.opacity(0.92))
            .clipShape(Capsule())
            .padding(12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
        }
        .onAppear { recenter() }
        .onChange(of: userLocation) { _, _ in recenter() }
    }

    private var userDot: some View {
        ZStack {
            Circle()
                .fill(BWTheme.amber.opacity(0.28))
                .frame(width: 34, height: 34)
            Circle()
                .fill(BWTheme.amber)
                .frame(width: 14, height: 14)
                .overlay(Circle().stroke(BWTheme.paper, lineWidth: 2.5))
                .shadow(color: BWTheme.ink.opacity(0.2), radius: 4, y: 2)
        }
        .accessibilityLabel("你的位置")
    }

    private func recenter() {
        guard let coordinate else { return }
        withAnimation(.easeInOut(duration: 0.4)) {
            camera = .region(
                MKCoordinateRegion(
                    center: coordinate,
                    latitudinalMeters: 520,
                    longitudinalMeters: 520
                )
            )
        }
    }
}
