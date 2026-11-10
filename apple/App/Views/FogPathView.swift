import SwiftUI

// MARK: - 迷雾路径视图（docs/parity.md §3）
//
// 只画「当前位置前后各一段」的步行路径：两端 46m 渐隐，绝不画终点、街道名。
// heading-up：路径前进方向朝上，「你」固定在下方。
// 剩余 < 60m 整段隐藏，只显示「就在附近 · 抬头看看周围」。

struct FogPathView: View {

    let route: WalkingRoute?
    let here: GeoPoint?
    let remainingMeters: Int
    /// 设备朝向（罗盘）。有值时地图跟着你转身；没有则按路线方向朝上。
    var heading: Double? = nil

    private var frame: FogFrame? {
        guard let route, let here else { return nil }
        return FogFrame.make(route: route, here: here, upBearing: heading)
    }

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            ZStack(alignment: .bottomLeading) {
                RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous)
                    .fill(BWTheme.paper2)
                    .overlay(
                        RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous)
                            .stroke(BWTheme.line, lineWidth: 1)
                    )

                if let frame, !frame.isHidden {
                    Canvas { context, canvasSize in
                        draw(frame: frame, in: &context, size: canvasSize)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous))
                    .accessibilityHidden(true)

                    // 右下角指北针（heading-up：画布上方 = 行进方向，所以北 = -bearing）
                    CompassNeedle(bearing: frame.bearing)
                        .frame(width: 34, height: 34)
                        .padding(.trailing, 12)
                        .padding(.bottom, 32)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)

                    // 顶部保密标签
                    HStack(spacing: 5) {
                        Image(systemName: "cloud.fog")
                            .font(.system(size: 12, weight: .semibold))
                        Text("迷雾路径 · 只看见前后一段")
                            .font(.system(size: 12.5, weight: .medium))
                    }
                    .foregroundStyle(BWTheme.ink2)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(BWTheme.paper.opacity(0.92))
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(BWTheme.line, lineWidth: 1))
                    .padding(12)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .accessibilityHidden(true)
                } else if frame?.isHidden == true {
                    VStack(spacing: 8) {
                        Image(systemName: "figure.walk")
                            .font(.system(size: 24, weight: .light))
                            .foregroundStyle(BWTheme.ink3)
                        Text("就在附近 · 抬头看看周围")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(BWTheme.ink2)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityLabel("就在附近，抬头看看周围")
                } else {
                    VStack(spacing: 8) {
                        Image(systemName: "point.topleft.down.to.point.bottomright.curvepath")
                            .font(.system(size: 24, weight: .light))
                            .foregroundStyle(BWTheme.ink3)
                        Text("正在规划路径…")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(BWTheme.ink2)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityLabel("正在规划路径")
                }

                // 底部说明：偏离路径 / 剩余距离
                if let frame, !frame.isHidden {
                    Text(caption(for: frame))
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(BWTheme.ink2)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(BWTheme.paper.opacity(0.92))
                        .clipShape(Capsule())
                        .padding(12)
                        .accessibilityLabel(caption(for: frame))
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func caption(for frame: FogFrame) -> String {
        if abs(frame.userLateral) > FogFrame.deviationMeters {
            return "你离路径约 \(Int(abs(frame.userLateral).rounded())) 米 · 前方 \(Int(frame.routeRemaining.rounded())) 米"
        }
        return heading == nil ? "迷雾模式 · 只看见前后一段" : "跟随你的朝向 · 转身地图也会转"
    }

    // MARK: Canvas 绘制

    private func draw(frame: FogFrame, in context: inout GraphicsContext, size: CGSize) {
        let cx = size.width / 2
        let cy = size.height - 34
        let ahead = max(1, frame.ahead)
        let scaleY = min(148.0, size.height * 0.66) / ahead
        var maxLateral = 12.0
        for segment in frame.segments {
            maxLateral = max(maxLateral, abs(segment.lateral))
        }
        for chevron in frame.chevrons {
            maxLateral = max(maxLateral, abs(chevron.lateral))
        }
        let scaleX = min(scaleY, (size.width * 0.44) / (maxLateral + 8))
        let centerX = max(48, min(size.width - 48, cx))

        func point(along: Double, lateral: Double) -> CGPoint {
            CGPoint(x: centerX + lateral * scaleX, y: cy - along * scaleY)
        }

        // 1. 已走 / 前方路径（逐段透明度渐隐）
        let behindColor = Color(hex: 0xAEB8D6)
        let aheadColor = BWTheme.amber
        for index in 0..<max(0, frame.segments.count - 1) {
            let a = frame.segments[index]
            let b = frame.segments[index + 1]
            let gap = abs(b.along - a.along) > 20 || abs(b.lateral - a.lateral) > 30
            if gap { continue }
            var path = Path()
            path.move(to: point(along: a.along, lateral: a.lateral))
            path.addLine(to: point(along: b.along, lateral: b.lateral))
            let width: CGFloat = a.isBehind ? 7 : 9
            let opacity = min(a.opacity, b.opacity) * (a.isBehind ? 0.55 : 1.0)
            context.stroke(
                path,
                with: .color((a.isBehind ? behindColor : aheadColor).opacity(opacity)),
                style: StrokeStyle(lineWidth: width, lineCap: .butt)
            )
        }

        // 2. 每 55 米一个行进箭头
        for chevron in frame.chevrons {
            let center = point(along: chevron.along, lateral: chevron.lateral)
            var path = Path()
            path.move(to: CGPoint(x: center.x - 5, y: center.y + 3))
            path.addLine(to: CGPoint(x: center.x, y: center.y - 4))
            path.addLine(to: CGPoint(x: center.x + 5, y: center.y + 3))
            context.stroke(
                path,
                with: .color(BWTheme.ink.opacity(0.50 * chevron.opacity)),
                style: StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round)
            )
        }

        // 3. 你（白底琥珀圈 + 深色三角箭头），偏离路径时画红色虚线
        let userX = centerX + frame.userLateral * scaleX
        let userY = cy
        if abs(frame.userLateral) > FogFrame.deviationMeters {
            var deviation = Path()
            deviation.move(to: CGPoint(x: centerX, y: cy))
            deviation.addLine(to: CGPoint(x: userX, y: userY))
            context.stroke(
                deviation,
                with: .color(BWTheme.ember.opacity(0.7)),
                style: StrokeStyle(lineWidth: 2, dash: [4, 4])
            )
        }
        let halo = Path(ellipseIn: CGRect(x: userX - 17, y: userY - 17, width: 34, height: 34))
        context.fill(halo, with: .color(BWTheme.amber.opacity(0.22)))
        let ring = Path(ellipseIn: CGRect(x: userX - 12, y: userY - 12, width: 24, height: 24))
        context.fill(ring, with: .color(BWTheme.paper))
        context.stroke(ring, with: .color(BWTheme.amber), lineWidth: 2.5)

        var arrow = Path()
        arrow.move(to: CGPoint(x: userX, y: userY - 8))
        arrow.addLine(to: CGPoint(x: userX + 6, y: userY + 5))
        arrow.addLine(to: CGPoint(x: userX, y: userY + 2))
        arrow.addLine(to: CGPoint(x: userX - 6, y: userY + 5))
        arrow.closeSubpath()
        context.fill(arrow, with: .color(BWTheme.ink))
    }
}

// MARK: - 指北针

private struct CompassNeedle: View {
    let bearing: Double

    var body: some View {
        ZStack {
            Circle()
                .fill(BWTheme.paper.opacity(0.94))
                .overlay(Circle().stroke(BWTheme.line, lineWidth: 1))
            VStack(spacing: 1) {
                Text("北")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(BWTheme.ink3)
                ZStack {
                    Triangle()
                        .fill(BWTheme.ember)
                        .frame(width: 8, height: 12)
                        .offset(y: -5)
                    Triangle()
                        .fill(BWTheme.ink3.opacity(0.6))
                        .rotationEffect(.degrees(180))
                        .frame(width: 7, height: 10)
                        .offset(y: 5)
                }
            }
            .rotationEffect(.degrees(-bearing))
        }
        .accessibilityHidden(true)
    }
}

private struct Triangle: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}
