import SwiftUI

// MARK: - 迷雾路径视图（docs/parity.md §3）
//
// 只画「当前位置前后各一段」的步行路径：两端 46m 渐隐，绝不画终点、街道名。
// 剩余 < 60m 整段隐藏，只显示「就在附近 · 抬头看看周围」。
//
// 关于「圆点里的箭头指哪」，这里遵循 Apple Maps / Google Maps 的同一套语义（查过两家文档）：
//   · 圆点 + 箭头 = **你现在面朝哪**（device heading），不是「该往哪走」；
//   · 路面 + 箭头虚线 = **路线怎么走**（walk direction）。
// 两者职责分开，用户才不会看到「箭头和路一起转」这种双份旋转。
//
// 于是：
//   - 跟随转身（heading-up）：画布随手机转，圆点箭头恒朝上（= 你面朝屏幕上方），
//     路线按真实夹角倾斜 —— 这是 Apple Maps 步行导航的默认行为；
//   - 北朝上（north-up）：画布不转，圆点箭头随你转身而转，路线固定朝它的真实方位；
//   - 没有罗盘：画布退回「路线朝上」，圆点箭头不画（不知道你面朝哪，就不假装知道）。
// 另外在偏离路线方向 > 35° 时，额外给一个独立的「该往这边走」提示，
// 而不是把这个信息塞进圆点箭头里。

struct FogPathView: View {

    let route: WalkingRoute?
    let here: GeoPoint?
    let remainingMeters: Int
    /// 设备朝向（罗盘）。用于让「你」的箭头正确指向你面朝的方向。
    var heading: Double? = nil
    /// true = 固定北朝上（忽略 heading 旋转地图）
    var northUp: Bool = false
    /// 已走米数（画布空白处补一行进度，避免整块雾面空着）
    var walkedMeters: Int = 0
    /// 距离下一条线索还差多少米（nil = 线索已全解锁）
    var clueGap: Int? = nil
    /// 下一条线索是第几条（1 起）
    var clueIndex: Int = 1

    private var frame: FogFrame? {
        guard let route, let here else { return nil }
        let up = northUp ? 0 : heading
        return FogFrame.make(route: route, here: here, upBearing: up)
    }

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            ZStack(alignment: .bottomLeading) {
                RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous)
                    .fill(WATheme.paper2)
                    .overlay(
                        RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous)
                            .stroke(WATheme.line, lineWidth: 1)
                    )

                if let frame, !frame.isHidden {
                    // 底纹（雾面 + 点阵）画在最底层，文字信息压在它上面，路线再压最上
                    Canvas { context, canvasSize in
                        drawFogBackdrop(in: &context, size: canvasSize)
                    }
                    .accessibilityHidden(true)

                    // 空白处补信息：迷雾地图不能上半屏只剩一张纸。
                    // 大号虚字给「还有多远」，下面补「再走多远解锁线索」；画在路线下层，不挡路。
                    fogInfoOverlay(frame: frame)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                        .padding(.top, 54)
                        .accessibilityHidden(true)

                    Canvas { context, canvasSize in
                        draw(frame: frame, in: &context, size: canvasSize)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
                    .accessibilityHidden(true)

                    // 右下角指北针（heading-up：画布上方 = 行进方向，所以北 = -bearing）
                    CompassNeedle(bearing: frame.bearing)
                        .frame(width: 34, height: 34)
                        .padding(.trailing, 12)
                        .padding(.bottom, 32)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)

                    // 偏离方向 > 35° 时，单独给一个「该往这边走」的指示。
                    // 这是**独立**信息，不塞进圆点箭头 —— 圆点箭头只表示你面朝哪。
                    if let turnHint = turnHintText(for: frame) {
                        HStack(spacing: 5) {
                            Image(systemName: "arrow.turn.up.right")
                                .font(.system(size: 11, weight: .semibold))
                            Text(turnHint)
                                .font(.system(size: 12, weight: .medium))
                        }
                        .foregroundStyle(WATheme.amberDeep)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(WATheme.amberSoft)
                        .clipShape(Capsule())
                        .padding(.top, 12)
                        .padding(.trailing, 12)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                        .accessibilityHidden(true)
                    }

                    // 顶部保密标签
                    HStack(spacing: 5) {
                        Image(systemName: "cloud.fog")
                            .font(.system(size: 12, weight: .semibold))
                        Text("迷雾路径 · 只看见前后一段")
                            .font(.system(size: 12.5, weight: .medium))
                    }
                    .foregroundStyle(WATheme.ink2)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(WATheme.paper.opacity(0.92))
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(WATheme.line, lineWidth: 1))
                    .padding(12)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .accessibilityHidden(true)
                } else if frame?.isHidden == true {
                    VStack(spacing: 8) {
                        Image(systemName: "figure.walk")
                            .font(.system(size: 24, weight: .light))
                            .foregroundStyle(WATheme.ink3)
                        Text("就在附近 · 抬头看看周围")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(WATheme.ink2)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityLabel("就在附近，抬头看看周围")
                } else {
                    VStack(spacing: 8) {
                        Image(systemName: "point.topleft.down.to.point.bottomright.curvepath")
                            .font(.system(size: 24, weight: .light))
                            .foregroundStyle(WATheme.ink3)
                        Text("正在规划路径…")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(WATheme.ink2)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityLabel("正在规划路径")
                }

                // 底部说明：偏离路径 / 剩余距离
                if let frame, !frame.isHidden {
                    Text(caption(for: frame))
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(WATheme.ink2)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(WATheme.paper.opacity(0.92))
                        .clipShape(Capsule())
                        .padding(12)
                        .accessibilityLabel(caption(for: frame))
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// 「该往这边走」的方向提示。只在方向差够大时出现，避免一直有个箭头在闪。
    /// 返回 nil 表示不用提示（方向基本一致，或者没有罗盘）。
    private func turnHintText(for frame: FogFrame) -> String? {
        guard let heading else { return nil }
        var delta = (frame.walkBearing - heading).truncatingRemainder(dividingBy: 360)
        if delta > 180 { delta -= 360 }
        if delta < -180 { delta += 360 }
        guard abs(delta) > 35 else { return nil }
        if abs(delta) > 135 { return "方向反了，往回走" }
        return delta > 0 ? "往右前方调整" : "往左前方调整"
    }

    private func caption(for frame: FogFrame) -> String {
        if abs(frame.userLateral) > FogFrame.deviationMeters {
            return "你离路径约 \(Int(abs(frame.userLateral).rounded())) 米 · 前方 \(Int(frame.routeRemaining.rounded())) 米"
        }
        if heading == nil { return "迷雾模式 · 只看见前后一段（未拿到罗盘，按路线朝上）" }
        return northUp ? "北朝上 · 圆点箭头指向你面朝的方向" : "跟着你转 · 屏幕上方是你的正前方"
    }

    // MARK: Canvas 绘制

    private func draw(frame: FogFrame, in context: inout GraphicsContext, size: CGSize) {
        let cx = size.width / 2
        // 「你」放在下方 80% 处，路线从脚下一路向上铺满整块画布（旧版钉在底部 34pt，
        // 纵向只画 148pt，屏幕上半截永远是空的）
        let cy = size.height * 0.80
        let topInset: CGFloat = 52
        let ahead = max(1, frame.ahead)
        let scaleY = max(0.2, (cy - topInset) / CGFloat(ahead))
        var maxLateral = 12.0
        for segment in frame.segments {
            maxLateral = max(maxLateral, abs(segment.lateral))
        }
        for chevron in frame.chevrons {
            maxLateral = max(maxLateral, abs(chevron.lateral))
        }
        // 横向必须留得下最偏的那一段；两个方向取小值，保证几何不变形（等比例）
        let scaleXFit = (size.width / 2 - 26) / CGFloat(maxLateral)
        let scale = min(scaleY, scaleXFit)
        let centerX = cx

        func point(along: Double, lateral: Double) -> CGPoint {
            CGPoint(x: centerX + lateral * scale, y: cy - along * scale)
        }

        // 1. 已走 / 前方路径（逐段透明度渐隐）
        let behindColor = Color(hex: 0xAEB8D6)
        let aheadColor = WATheme.amber
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
            path.move(to: CGPoint(x: -5, y: 3))
            path.addLine(to: CGPoint(x: 0, y: -4))
            path.addLine(to: CGPoint(x: 5, y: 3))
            var transform = CGAffineTransform(translationX: center.x, y: center.y)
            transform = transform.rotated(by: chevron.angle * .pi / 180)
            context.stroke(
                path.applying(transform),
                with: .color(WATheme.ink.opacity(0.50 * chevron.opacity)),
                style: StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round)
            )
        }

        // 3. 你（白底琥珀圈 + 深色三角箭头），偏离路径时画红色虚线
        let userX = centerX + frame.userLateral * scale
        let userY = cy
        if abs(frame.userLateral) > FogFrame.deviationMeters {
            var deviation = Path()
            deviation.move(to: CGPoint(x: centerX, y: cy))
            deviation.addLine(to: CGPoint(x: userX, y: userY))
            context.stroke(
                deviation,
                with: .color(WATheme.ember.opacity(0.7)),
                style: StrokeStyle(lineWidth: 2, dash: [4, 4])
            )
        }
        let halo = Path(ellipseIn: CGRect(x: userX - 17, y: userY - 17, width: 34, height: 34))
        context.fill(halo, with: .color(WATheme.amber.opacity(0.22)))
        let ring = Path(ellipseIn: CGRect(x: userX - 12, y: userY - 12, width: 24, height: 24))
        context.fill(ring, with: .color(WATheme.paper))
        context.stroke(ring, with: .color(WATheme.amber), lineWidth: 2.5)

        // 圆点里的箭头 = **你现在面朝哪**（Apple Maps 同款语义），
        // 屏幕角度 = 设备朝向 − 画布朝上方向：
        //   · 跟随转身：heading − heading = 0 → 恒朝上（屏幕上方就是你的正前方）
        //   · 北朝上：heading − 0 = heading → 随你转身而转
        //   · 没有罗盘：不画箭头（不知道就别猜）
        if let heading {
            let arrowRotation = heading - frame.bearing
            var arrow = Path()
            arrow.move(to: CGPoint(x: 0, y: -8))
            arrow.addLine(to: CGPoint(x: 6, y: 5))
            arrow.addLine(to: CGPoint(x: 0, y: 2))
            arrow.addLine(to: CGPoint(x: -6, y: 5))
            arrow.closeSubpath()
            var arrowTransform = CGAffineTransform(translationX: userX, y: userY)
            arrowTransform = arrowTransform.rotated(by: arrowRotation * .pi / 180)
            context.fill(arrow.applying(arrowTransform), with: .color(WATheme.ink))
        } else {
            // 没有罗盘：只画一个中性圆点，避免假装知道朝向
            let dot = Path(ellipseIn: CGRect(x: userX - 5, y: userY - 5, width: 10, height: 10))
            context.fill(dot, with: .color(WATheme.ink))
        }
    }

// MARK: - 空白处信息 / 底纹

    /// 迷雾面上的一层信息：大号剩余距离 + 线索进度 + 已走
    private func fogInfoOverlay(frame: FogFrame) -> some View {
        VStack(spacing: 4) {
            Text(distanceLabel(frame.routeRemaining))
                .font(.system(size: 40, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(WATheme.ink.opacity(0.12))

            Text(clueCopy)
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(WATheme.ink3.opacity(0.85))

            if walkedMeters > 0 {
                Text("已走 \(walkedMeters) 米")
                    .font(.system(size: 10.5))
                    .monospacedDigit()
                    .foregroundStyle(WATheme.ink3.opacity(0.65))
            }
        }
    }

    private var clueCopy: String {
        guard let clueGap else { return "线索都解锁了 · 跟着路走" }
        if clueGap <= 0 { return "下一条线索就在前面" }
        return "再走 \(clueGap) 米 · 解锁第 \(clueIndex) 条线索"
    }

    private func distanceLabel(_ meters: Double) -> String {
        if meters >= 1000 {
            return String(format: "%.1f 公里", meters / 1000)
        }
        return "\(Int(meters.rounded())) 米"
    }

    /// 雾面底纹：顶部渐浓 + 极淡点阵（只是为了别让整块画布是死的纯色）
    private func drawFogBackdrop(in context: inout GraphicsContext, size: CGSize) {
        context.fill(
            Path(CGRect(origin: .zero, size: size)),
            with: .linearGradient(
                Gradient(colors: [WATheme.paper.opacity(0.9), WATheme.paper.opacity(0.0)]),
                startPoint: CGPoint(x: size.width / 2, y: 0),
                endPoint: CGPoint(x: size.width / 2, y: size.height * 0.55)
            )
        )

        let step: CGFloat = 30
        var dots = Path()
        var y = step
        while y < size.height {
            var x = step
            while x < size.width {
                dots.addEllipse(in: CGRect(x: x - 1, y: y - 1, width: 2, height: 2))
                x += step
            }
            y += step
        }
        context.fill(dots, with: .color(WATheme.ink.opacity(0.05)))
    }
}

// MARK: - 指北针

private struct CompassNeedle: View {
    let bearing: Double

    var body: some View {
        ZStack {
            Circle()
                .fill(WATheme.paper.opacity(0.94))
                .overlay(Circle().stroke(WATheme.line, lineWidth: 1))
            VStack(spacing: 1) {
                Text("北")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(WATheme.ink3)
                ZStack {
                    Triangle()
                        .fill(WATheme.ember)
                        .frame(width: 8, height: 12)
                        .offset(y: -5)
                    Triangle()
                        .fill(WATheme.ink3.opacity(0.6))
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
