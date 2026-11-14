import SwiftUI

// MARK: - 抽象街区地图（design-system §5.3，视觉基准：web 原型 mapSVG）
//
// 不接 MapKit 瓦片：用 Canvas / Path 在奶油纸上手绘「黄昏的旧地图」。
// 图层顺序：纸底 → 河 → 路 → 车行道虚线 → 绿地 → 建筑 → 树 → 路线 → 光点 → 标记。

struct JourneyMapView: View {

    /// 0…1，旅程进度（决定终点光点与「你」在路线上的位置）
    var progress: Double
    /// 剩余米数（保留给以后做地图上的动态标注）
    var remainingMeters: Int

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breathing = false

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            let target = endPoint(size: size)

            ZStack {
                Canvas { context, canvasSize in
                    drawBackground(context: &context, size: canvasSize)
                }

                // 目标呼吸光点（保密）
                targetMarker
                    .position(x: target.x, y: target.y)

                // 「你」的位置
                youMarker
                    .position(x: startPoint(size: size).x, y: startPoint(size: size).y)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous)
                .stroke(WATheme.line, lineWidth: 1)
        )
        .accessibilityLabel("抽象街区地图，目的地保密")
        .onAppear {
            guard !reduceMotion else {
                breathing = true
                return
            }
            withAnimation(WAAnimation.breathing) {
                breathing = true
            }
        }
    }

    // MARK: 标记

    /// start 标记：琥珀 halo + 墨色小圆点 + 旁边一枚「你」
    private var youMarker: some View {
        ZStack {
            Circle()
                .fill(WATheme.amber.opacity(0.22))
                .frame(width: 26, height: 26)

            Circle()
                .fill(WATheme.ink)
                .frame(width: 9, height: 9)
        }
        .overlay(alignment: .leading) {
            Text("你")
                .font(.system(size: 10.5, weight: .semibold))
                .foregroundStyle(WATheme.ink2)
                .fixedSize()
                .offset(x: 18)
        }
    }

    /// 目标：外圈 halo + 细环 + 琥珀芯 + 下方「?」
    private var targetMarker: some View {
        ZStack {
            Circle()
                .fill(WATheme.amber.opacity(0.20))
                .frame(width: 38, height: 38)
                .scaleEffect(breathing ? 1.06 : 0.94)

            Circle()
                .stroke(WATheme.amber.opacity(0.50), lineWidth: 1)
                .frame(width: 20, height: 20)

            Circle()
                .fill(WATheme.amber)
                .frame(width: 8, height: 8)

            Text("?")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(WATheme.ink)
                .offset(y: 22)
        }
    }

    // MARK: 绘制

    private func drawBackground(context: inout GraphicsContext, size: CGSize) {
        // 纸底
        context.fill(
            Path(CGRect(origin: .zero, size: size)),
            with: .color(WATheme.cream)
        )

        // 河：宽带 + 细虚线
        let river = riverPath(size: size)
        context.stroke(
            river,
            with: .color(WATheme.teal.opacity(0.10)),
            style: StrokeStyle(lineWidth: 46, lineCap: .round)
        )
        context.stroke(
            river,
            with: .color(WATheme.teal.opacity(0.18)),
            style: StrokeStyle(lineWidth: 1, lineCap: .round, dash: [5, 9])
        )

        // 路：先铺纸色宽路，再画车行道虚线
        let mainRoads = mainRoadPaths(size: size)
        for road in mainRoads {
            context.stroke(road, with: .color(WATheme.line.opacity(0.75)), style: StrokeStyle(lineWidth: 13, lineCap: .round))
            context.stroke(road, with: .color(WATheme.ink.opacity(0.10)), style: StrokeStyle(lineWidth: 1, lineCap: .round, dash: [3, 6]))
        }

        // 支路
        for road in minorRoadPaths(size: size) {
            context.stroke(road, with: .color(WATheme.line.opacity(0.45)), style: StrokeStyle(lineWidth: 6, lineCap: .round))
        }

        // 绿地
        for park in parkRects(size: size) {
            context.fill(park, with: .color(WATheme.teal.opacity(0.06)))
        }

        // 建筑
        for block in blockPaths(size: size) {
            context.fill(block, with: .color(WATheme.ink.opacity(0.10)))
            context.stroke(block, with: .color(WATheme.ink.opacity(0.12)), style: StrokeStyle(lineWidth: 0.8))
        }

        // 树
        for tree in treeCircles(size: size) {
            context.fill(tree, with: .color(WATheme.teal.opacity(0.14)))
            context.stroke(tree, with: .color(WATheme.ink.opacity(0.10)), style: StrokeStyle(lineWidth: 1))
        }

        // 路线：整条虚线（design-system §5.3「一条虚线路线从底部「你」出发向前弯曲」，
        // 与 web .map-route 一致；不额外加实线，避免地图自己讲太多）
        context.stroke(
            routePath(size: size),
            with: .color(WATheme.ink2.opacity(0.55)),
            style: StrokeStyle(lineWidth: 1.6, lineCap: .round, dash: [4, 8])
        )
    }

    // MARK: 几何

    private func startPoint(size: CGSize) -> CGPoint {
        CGPoint(x: size.width * 0.50, y: size.height * 0.96)
    }

    private func endPoint(size: CGSize) -> CGPoint {
        CGPoint(x: size.width * 0.50, y: size.height * 0.26)
    }

    private func routePath(size: CGSize) -> Path {
        var path = Path()
        let start = startPoint(size: size)
        let end = endPoint(size: size)
        path.move(to: start)
        path.addCurve(
            to: end,
            control1: CGPoint(x: size.width * 0.50, y: size.height * 0.74),
            control2: CGPoint(x: size.width * 0.44, y: size.height * 0.46)
        )
        return path
    }

    private func riverPath(size: CGSize) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: -size.width * 0.10, y: size.height * 0.18))
        path.addCurve(
            to: CGPoint(x: size.width * 0.60, y: size.height * 0.30),
            control1: CGPoint(x: size.width * 0.16, y: size.height * 0.34),
            control2: CGPoint(x: size.width * 0.38, y: size.height * 0.14)
        )
        path.addCurve(
            to: CGPoint(x: size.width * 1.14, y: size.height * 0.30),
            control1: CGPoint(x: size.width * 0.78, y: size.height * 0.44),
            control2: CGPoint(x: size.width * 0.94, y: size.height * 0.24)
        )
        return path
    }

    private func mainRoadPaths(size: CGSize) -> [Path] {
        var horizontal = Path()
        horizontal.move(to: CGPoint(x: -10, y: size.height * 0.62))
        horizontal.addCurve(
            to: CGPoint(x: size.width + 10, y: size.height * 0.60),
            control1: CGPoint(x: size.width * 0.28, y: size.height * 0.58),
            control2: CGPoint(x: size.width * 0.62, y: size.height * 0.65)
        )

        var vertical = Path()
        vertical.move(to: CGPoint(x: size.width * 0.30, y: -10))
        vertical.addCurve(
            to: CGPoint(x: size.width * 0.36, y: size.height + 10),
            control1: CGPoint(x: size.width * 0.26, y: size.height * 0.36),
            control2: CGPoint(x: size.width * 0.42, y: size.height * 0.70)
        )

        return [horizontal, vertical]
    }

    private func minorRoadPaths(size: CGSize) -> [Path] {
        var diagonal = Path()
        diagonal.move(to: CGPoint(x: size.width * 0.02, y: size.height * 1.04))
        diagonal.addCurve(
            to: CGPoint(x: size.width * 1.06, y: size.height * 0.52),
            control1: CGPoint(x: size.width * 0.30, y: size.height * 0.86),
            control2: CGPoint(x: size.width * 0.66, y: size.height * 0.70)
        )

        var rightTop = Path()
        rightTop.move(to: CGPoint(x: size.width * 0.78, y: -10))
        rightTop.addCurve(
            to: CGPoint(x: size.width * 0.88, y: size.height * 0.62),
            control1: CGPoint(x: size.width * 0.74, y: size.height * 0.28),
            control2: CGPoint(x: size.width * 0.92, y: size.height * 0.44)
        )

        var leftTop = Path()
        leftTop.move(to: CGPoint(x: -10, y: size.height * 0.36))
        leftTop.addCurve(
            to: CGPoint(x: size.width * 0.40, y: size.height * 0.26),
            control1: CGPoint(x: size.width * 0.16, y: size.height * 0.34),
            control2: CGPoint(x: size.width * 0.26, y: size.height * 0.28)
        )

        return [diagonal, rightTop, leftTop]
    }

    private func parkRects(size: CGSize) -> [Path] {
        [
            CGRect(x: size.width * 0.14, y: size.height * 0.76, width: size.width * 0.19, height: size.height * 0.15),
            CGRect(x: size.width * 0.76, y: size.height * 0.18, width: size.width * 0.14, height: size.height * 0.11)
        ].map { Path(roundedRect: $0, cornerRadius: 9) }
    }

    private func treeCircles(size: CGSize) -> [Path] {
        let specs: [(CGFloat, CGFloat, CGFloat)] = [
            (0.18, 0.32, 8), (0.28, 0.31, 6), (0.39, 0.35, 7), (0.55, 0.28, 6),
            (0.73, 0.30, 7), (0.90, 0.38, 6), (0.12, 0.60, 7), (0.82, 0.64, 6),
            (0.33, 0.83, 7), (0.69, 0.86, 6)
        ]
        return specs.map { spec in
            let rect = CGRect(
                x: size.width * spec.0 - spec.2,
                y: size.height * spec.1 - spec.2,
                width: spec.2 * 2,
                height: spec.2 * 2
            )
            return Path(ellipseIn: rect)
        }
    }

    private func blockPaths(size: CGSize) -> [Path] {
        // 归一化小方块（x, y, w, h, rotation）
        let specs: [(CGFloat, CGFloat, CGFloat, CGFloat, Double)] = [
            (0.08, 0.50, 0.09, 0.08, -2), (0.19, 0.56, 0.07, 0.07, 3), (0.31, 0.47, 0.10, 0.09, -1),
            (0.43, 0.55, 0.07, 0.07, 2), (0.54, 0.65, 0.09, 0.08, -2), (0.65, 0.50, 0.08, 0.07, 1),
            (0.75, 0.59, 0.10, 0.09, -1), (0.87, 0.49, 0.07, 0.07, 2), (0.14, 0.71, 0.07, 0.07, -1),
            (0.26, 0.77, 0.09, 0.07, 2), (0.38, 0.71, 0.07, 0.06, -2), (0.61, 0.79, 0.08, 0.07, 1),
            (0.77, 0.75, 0.07, 0.07, -2), (0.88, 0.82, 0.09, 0.08, 1), (0.05, 0.84, 0.07, 0.06, 2),
            (0.94, 0.70, 0.06, 0.06, -1), (0.22, 0.39, 0.08, 0.06, 1), (0.48, 0.39, 0.06, 0.06, -2),
            (0.68, 0.36, 0.09, 0.07, 2), (0.84, 0.24, 0.07, 0.06, -1)
        ]

        return specs.map { spec in
            let rect = CGRect(
                x: size.width * spec.0,
                y: size.height * spec.1,
                width: size.width * spec.2,
                height: size.height * spec.3
            )
            let base = Path(roundedRect: rect, cornerRadius: 2.5)
            let transform = CGAffineTransform(
                translationX: rect.midX,
                y: rect.midY
            ).rotated(by: spec.4 * .pi / 180).translatedBy(x: -rect.midX, y: -rect.midY)
            return base.applying(transform)
        }
    }
}
