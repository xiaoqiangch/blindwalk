import SwiftUI

// MARK: - 抽象街区地图（design-system §5.3）
//
// 不接 MapKit 瓦片：用 Canvas / Path 在奶油纸上手绘「黄昏的旧地图」，
// 一条虚线路线从底部「你」出发向前弯曲，终点只有一个呼吸光点和「?」。

struct JourneyMapView: View {

    /// 0…1，旅程进度（决定「你」在路线上的位置）
    var progress: Double
    /// 剩余米数（保留给以后做地图上的动态标注）
    var remainingMeters: Int

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breathing = false

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            let here = currentPoint(size: size)
            let target = endPoint(size: size)

            ZStack {
                Canvas { context, canvasSize in
                    drawBackground(context: &context, size: canvasSize)
                }

                youMarker
                    .position(x: here.x, y: here.y)

                targetMarker
                    .position(x: target.x, y: target.y)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous)
                .stroke(BWTheme.line, lineWidth: 1)
        )
        .shadow(color: BWTheme.ink.opacity(0.08), radius: 14, x: 0, y: 10)
        .accessibilityLabel("抽象街区地图，目的地保密")
        .onAppear {
            guard !reduceMotion else {
                breathing = true
                return
            }
            withAnimation(BWAnimation.breathing) {
                breathing = true
            }
        }
    }

    // MARK: 标记

    private var youMarker: some View {
        VStack(spacing: 2) {
            ZStack {
                Circle()
                    .fill(BWTheme.paper)
                    .frame(width: 26, height: 26)
                Circle()
                    .stroke(BWTheme.amberDeep, lineWidth: 1.6)
                    .frame(width: 26, height: 26)
                Text("你")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(BWTheme.amberDeep)
            }
            Capsule()
                .fill(BWTheme.ink.opacity(0.12))
                .frame(width: 18, height: 4)
        }
    }

    private var targetMarker: some View {
        ZStack {
            Circle()
                .fill(BWTheme.amber.opacity(breathing ? 0.40 : 0.18))
                .frame(width: 54, height: 54)
                .blur(radius: 10)
                .scaleEffect(breathing ? 1.12 : 0.90)

            ZStack {
                Circle()
                    .fill(BWTheme.paper)
                    .frame(width: 30, height: 30)
                Circle()
                    .stroke(BWTheme.amberDeep, lineWidth: 1.5)
                    .frame(width: 30, height: 30)
                Text("?")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(BWTheme.amberDeep)
            }
            .scaleEffect(breathing ? 1.06 : 0.96)
        }
    }

    // MARK: 绘制

    private func drawBackground(context: inout GraphicsContext, size: CGSize) {
        // 纸底
        context.fill(
            Path(CGRect(origin: .zero, size: size)),
            with: .color(BWTheme.cream)
        )

        // 河
        context.stroke(
            riverPath(size: size),
            with: .color(BWTheme.teal.opacity(0.10)),
            style: StrokeStyle(lineWidth: 26, lineCap: .round)
        )
        context.stroke(
            riverPath(size: size),
            with: .color(BWTheme.teal.opacity(0.20)),
            style: StrokeStyle(lineWidth: 1, lineCap: .round, dash: [3, 6])
        )

        // 小方块建筑
        for block in blockPaths(size: size) {
            context.fill(block, with: .color(BWTheme.ink3.opacity(0.16)))
            context.stroke(block, with: .color(BWTheme.line), style: StrokeStyle(lineWidth: 0.8))
        }

        // 街道：先铺一条纸色宽路，再画一条虚线中线
        let streets = streetsPath(size: size)
        context.stroke(
            streets,
            with: .color(BWTheme.paper),
            style: StrokeStyle(lineWidth: 12, lineCap: .round)
        )
        context.stroke(
            streets,
            with: .color(BWTheme.ink3.opacity(0.30)),
            style: StrokeStyle(lineWidth: 1, lineCap: .round, dash: [4, 6])
        )

        // 路线：已走的一段实线琥珀，剩下的一段虚线
        let route = routePath(size: size)
        let t = routeProgress
        context.stroke(
            route.trimmedPath(from: 0, to: t),
            with: .color(BWTheme.amber),
            style: StrokeStyle(lineWidth: 3.4, lineCap: .round)
        )
        context.stroke(
            route.trimmedPath(from: t, to: 1),
            with: .color(BWTheme.ink3.opacity(0.75)),
            style: StrokeStyle(lineWidth: 2.4, lineCap: .round, dash: [6, 7])
        )
    }

    // MARK: 几何

    private var routeProgress: CGFloat {
        let clamped = min(0.90, max(0.06, progress))
        return CGFloat(clamped)
    }

    private func startPoint(size: CGSize) -> CGPoint {
        CGPoint(x: size.width * 0.54, y: size.height * 0.92)
    }

    private func controlPoint(size: CGSize) -> CGPoint {
        CGPoint(x: size.width * 0.14, y: size.height * 0.58)
    }

    private func endPoint(size: CGSize) -> CGPoint {
        CGPoint(x: size.width * 0.30, y: size.height * 0.20)
    }

    private func currentPoint(size: CGSize) -> CGPoint {
        point(
            start: startPoint(size: size),
            control: controlPoint(size: size),
            end: endPoint(size: size),
            t: routeProgress
        )
    }

    private func point(start: CGPoint, control: CGPoint, end: CGPoint, t: CGFloat) -> CGPoint {
        let u = 1 - t
        let x = u * u * start.x + 2 * u * t * control.x + t * t * end.x
        let y = u * u * start.y + 2 * u * t * control.y + t * t * end.y
        return CGPoint(x: x, y: y)
    }

    // MARK: 路径

    private func routePath(size: CGSize) -> Path {
        var path = Path()
        path.move(to: startPoint(size: size))
        path.addQuadCurve(to: endPoint(size: size), control: controlPoint(size: size))
        return path
    }

    private func riverPath(size: CGSize) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: size.width * 0.04, y: size.height * 1.06))
        path.addQuadCurve(
            to: CGPoint(x: size.width * 0.34, y: size.height * 0.56),
            control: CGPoint(x: size.width * 0.04, y: size.height * 0.70)
        )
        path.addQuadCurve(
            to: CGPoint(x: size.width * 0.16, y: -size.height * 0.06),
            control: CGPoint(x: size.width * 0.54, y: size.height * 0.30)
        )
        return path
    }

    private func streetsPath(size: CGSize) -> Path {
        var path = Path()

        for index in 0..<3 {
            let y = size.height * (0.24 + CGFloat(index) * 0.24)
            path.move(to: CGPoint(x: -12, y: y + size.height * 0.02))
            path.addQuadCurve(
                to: CGPoint(x: size.width + 12, y: y - size.height * 0.02),
                control: CGPoint(x: size.width * 0.55, y: y + size.height * 0.07)
            )
        }

        for index in 0..<2 {
            let x = size.width * (0.26 + CGFloat(index) * 0.42)
            path.move(to: CGPoint(x: x, y: -12))
            path.addQuadCurve(
                to: CGPoint(x: x + size.width * 0.05, y: size.height + 12),
                control: CGPoint(x: x - size.width * 0.06, y: size.height * 0.5)
            )
        }

        return path
    }

    private func blockPaths(size: CGSize) -> [Path] {
        // 归一化的小方块（x, y, w, h），固定写死保证每次绘制一致
        let specs: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [
            (0.06, 0.10, 0.13, 0.07),
            (0.24, 0.08, 0.10, 0.06),
            (0.40, 0.12, 0.16, 0.06),
            (0.62, 0.08, 0.12, 0.07),
            (0.80, 0.14, 0.14, 0.06),
            (0.10, 0.34, 0.10, 0.06),
            (0.46, 0.36, 0.12, 0.07),
            (0.66, 0.32, 0.16, 0.06),
            (0.86, 0.38, 0.10, 0.07),
            (0.18, 0.60, 0.12, 0.06),
            (0.38, 0.62, 0.10, 0.07),
            (0.58, 0.58, 0.14, 0.06),
            (0.78, 0.64, 0.12, 0.06),
            (0.06, 0.78, 0.10, 0.06),
            (0.30, 0.80, 0.14, 0.05),
            (0.68, 0.80, 0.12, 0.06)
        ]

        return specs.map { spec in
            let rect = CGRect(
                x: size.width * spec.0,
                y: size.height * spec.1,
                width: size.width * spec.2,
                height: size.height * spec.3
            )
            return Path(roundedRect: rect, cornerRadius: 3)
        }
    }
}
