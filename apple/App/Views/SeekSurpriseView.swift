import SwiftUI
import PhotosUI
import UIKit

// MARK: - 寻惊喜（SeekSurpriseView）
//
// 全流程（docs/surprise-exchange.md §7.2–7.3）：
// 列表 → 详情（三阶线索按距离解锁）→ 进入半径 → **只给「这样拍一张」**
// → 拍完才揭晓作者原图 + 并排对比 + 相似度 + 评价 → 达标结算 / 不达标重拍。
//
// ADR-007「先拍后看」是这个功能的灵魂：在 `phase == .shoot` 之前的任何界面，
// 都不显示作者照片。代码里唯一的作者图入口是 `compareStage`，它只在
// `finderResult != nil`（已经拍过）时才会被渲染。

struct SeekSurpriseView: View {

    let store: BlindWalkStore
    var onClose: () -> Void = {}
    var onOpenBury: (() -> Void)? = nil
    var onOpenMine: (() -> Void)? = nil

    // MARK: 状态

    private enum Phase {
        /// 还没进半径：只显示线索与距离
        case approach
        /// 已进半径：只有「这样拍一张」
        case shoot
        /// 已经拍了：并排揭晓 + 判定
        case compare
    }

    @State private var probe = SurpriseLocationProbe()
    @State private var selected: BuriedSurprise?
    @State private var phase: Phase = .approach

    @State private var pickerItem: PhotosPickerItem?
    @State private var finderImage: UIImage?
    @State private var finderPhotoName: String?
    @State private var outcome: PhotoMatchOutcome?
    @State private var findResult: SurpriseFindResult?
    @State private var isCameraPresented = false
    @State private var isSubmitting = false

    @State private var toasts: [BWToast] = []
    @State private var passedGlow = false

    /// 演示模式：用固定演示坐标算距离（真实定位离演示种子太远时）
    @State private var usesDemoDistance = false
    /// 已经领过「辛苦分」的惊喜：同一条只给一次 +10，避免反复重拍刷分
    @State private var settledFailures: Set<String> = []
    /// 这一次不达标是否真的给了辛苦分（文案要说实话）
    @State private var comfortPointAwarded = false
    /// 点过「演示：当作到了」→ 线索视为全解锁
    @State private var simulatedInRange = false

    // MARK: 位置与列表

    private var origin: GeoPoint { probe.origin ?? store.lastKnownOrigin ?? SurpriseLocation.demoPoint }

    private var hasRealOrigin: Bool { probe.origin != nil || store.lastKnownOrigin != nil }

    /// 列表：真实定位能圈到就用真实的；圈不到（人在另一个城市 / 模拟器没定位）
    /// 就退回全部待寻惊喜 + 「演示距离」，保证明天在真机上也能走通。
    private var nearbyList: [BuriedSurprise] {
        if hasRealOrigin {
            let real = store.explorableSurprises(near: origin, within: 5_000)
            if !real.isEmpty { return real }
        }
        return store.explorableSurprises(near: nil)
    }

    private var isDemoDistance: Bool {
        if !hasRealOrigin { return true }
        return store.explorableSurprises(near: origin, within: 5_000).isEmpty
    }

    // MARK: Body

    var body: some View {
        ZStack {
            BWPaperBackground()

            if let selected {
                VStack(spacing: 0) {
                    detailScreen(selected)
                    if phase == .approach {
                        detailBottomBar
                    }
                }
            } else {
                listScreen
            }

            SurpriseToastLayer(toasts: toasts) { toast in
                withAnimation(BWAnimation.quick) {
                    toasts.removeAll { $0.id == toast.id }
                }
            }
        }
        .bwTypeBounds()
        .fullScreenCover(isPresented: $isCameraPresented) {
            CameraPhotoPicker(
                onPicked: { image in
                    isCameraPresented = false
                    receive(finderImage: image)
                },
                onCancel: { isCameraPresented = false }
            )
            .ignoresSafeArea()
        }
        .onAppear(perform: bootstrap)
        .onChange(of: probe.origin) { _, newOrigin in
            guard let newOrigin else { return }
            store.lastKnownOrigin = newOrigin
        }
        .task { await watchArrival() }
        .onChange(of: pickerItem) { _, item in
            guard let item else { return }
            Task { @MainActor in
                if let image = await PhotoLibraryService.loadImage(from: item) {
                    receive(finderImage: image)
                } else {
                    appendToast(BWToast(text: "这张照片读不出来，换一张试试。", icon: "photo.badge.exclamationmark"))
                }
                pickerItem = nil
            }
        }
    }

    // MARK: - 列表

    private var listScreen: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                SurpriseScreenHeader(
                    eyebrow: "寻惊喜",
                    title: "附近的惊喜",
                    onClose: onClose,
                    trailingLabel: onOpenMine == nil ? nil : "我的",
                    onTrailing: onOpenMine
                )
                .padding(.horizontal, BWTheme.pagePadding)

                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(nearbyList.isEmpty
                         ? "这附近还没有人埋下惊喜。"
                         : "\(nearbyList.count) 张照片在某个角落等你。")
                        .font(BWType.body(13))
                        .foregroundStyle(BWTheme.ink2)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, BWTheme.pagePadding)
                .padding(.top, 6)

                locationBanner
                    .padding(.horizontal, BWTheme.pagePadding)
                    .padding(.top, 14)

                if nearbyList.isEmpty {
                    emptyListCard
                        .padding(.horizontal, BWTheme.pagePadding)
                        .padding(.top, 22)
                } else {
                    VStack(spacing: 10) {
                        ForEach(nearbyList) { surprise in
                            seekRow(surprise)
                        }
                    }
                    .padding(.horizontal, BWTheme.pagePadding)
                    .padding(.top, 18)
                }

                Text("照片在你拍完之后才会出现。")
                    .font(BWType.caption(10.5))
                    .foregroundStyle(BWTheme.ink3)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 20)
                    .padding(.bottom, 26)
            }
            .padding(.top, 6)
        }
    }

    private var locationBanner: some View {
        HStack(alignment: .center, spacing: 8) {
            Image(systemName: isDemoDistance ? "location.slash" : "location.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(isDemoDistance ? BWTheme.ember : BWTheme.teal)

            Text(isDemoDistance ? "没有定位，距离按演示位置算。" : "距离按你此刻的位置算。")
                .font(BWType.caption(10.5))
                .foregroundStyle(BWTheme.ink3)

            Spacer(minLength: 0)

            if isDemoDistance {
                SurpriseDemoTag()
            } else if probe.isSearching {
                Text("定位中…")
                    .font(BWType.caption(10))
                    .foregroundStyle(BWTheme.ink3)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(BWTheme.paper.opacity(0.65))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(BWTheme.line, lineWidth: 1)
        )
    }

    private var emptyListCard: some View {
        BWCard(padding: 0) {
            BWEmptyState(
                title: "这附近还没有人埋下惊喜。",
                subtitle: "要不要先埋一个？"
            )
            if let onOpenBury {
                BWSecondaryButton(title: "埋下一个", icon: "plus.viewfinder") { onOpenBury() }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 16)
            }
        }
    }

    private func seekRow(_ surprise: BuriedSurprise) -> some View {
        Button {
            openDetail(surprise)
        } label: {
            BWCard(padding: 14) {
                HStack(alignment: .center, spacing: 12) {
                    // 模糊态：一张「还没有内容」的纸片，绝不预览作者照片（ADR-007）
                    ZStack {
                        BWKraft.thumbGradient
                        Text("?")
                            .font(.system(size: 19, weight: .bold))
                            .foregroundStyle(BWTheme.ink3.opacity(0.9))
                    }
                    .frame(width: 54, height: 68)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(BWTheme.ink.opacity(0.08), lineWidth: 1)
                    )
                    .blur(radius: 0.4)

                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(surprise.authorEmoji)
                                .font(.system(size: 14))
                            Text("\(surprise.authorName) 埋下的")
                                .font(BWType.rowTitle(13))
                                .foregroundStyle(BWTheme.ink)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                        }

                        Text("一张照片，在某处等你。")
                            .font(BWType.body(12.5))
                            .foregroundStyle(BWTheme.ink2)

                        HStack(spacing: 6) {
                            SurprisePill(
                                text: distanceText(surprise),
                                icon: "figure.walk",
                                tint: isDemoDistance ? BWTheme.ember : BWTheme.ink2,
                                background: isDemoDistance ? BWTheme.ember.opacity(0.09) : BWTheme.paper2
                            )
                            Text(surprise.areaLabel)
                                .font(BWType.caption(10.5))
                                .foregroundStyle(BWTheme.ink3)
                                .lineLimit(1)
                        }
                    }

                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(BWTheme.ink3)
                }
            }
        }
        .buttonStyle(BWPressEffectStyle())
        .accessibilityLabel("\(surprise.authorName) 埋在\(surprise.areaLabel)的惊喜，\(distanceText(surprise))")
    }

    // MARK: - 详情

    private func detailScreen(_ surprise: BuriedSurprise) -> some View {
        ScrollViewReader { proxy in
            ScrollView(showsIndicators: false) {
                detailContent(surprise)
            }
            // 拍完自动滚到对比卡：不用用户自己找，也不会让结算区藏在屏幕外。
            // 延迟一帧：onChange 时新内容还没完成布局，立刻 scrollTo 会滚到一个旧高度。
            .onChange(of: phase) { _, newPhase in
                guard newPhase == .compare else { return }
                bwAfter(0.2) {
                    withAnimation(BWAnimation.slow) {
                        proxy.scrollTo("compare", anchor: .top)
                    }
                }
            }
        }
    }

    private func detailContent(_ surprise: BuriedSurprise) -> some View {
        VStack(alignment: .leading, spacing: 0) {
                SurpriseScreenHeader(
                    eyebrow: "寻惊喜",
                    title: "一个惊喜",
                    onBack: closeDetail,
                    trailingLabel: nil,
                    onTrailing: nil
                )
                .padding(.horizontal, BWTheme.pagePadding)

                authorCard(surprise)
                    .padding(.horizontal, BWTheme.pagePadding)
                    .padding(.top, 10)

                clueTimeline(surprise)
                    .padding(.horizontal, BWTheme.pagePadding)
                    .padding(.top, 22)

                phaseContent(surprise)
                    .id("compare")
                    .padding(.horizontal, BWTheme.pagePadding)
                    .padding(.top, 22)
                    // 对比阶段底部会叠两条 toast，多留一点空间，避免压住结算按钮
                    .padding(.bottom, phase == .compare ? 110 : 34)
        }
        .padding(.top, 6)
    }

    private func authorCard(_ surprise: BuriedSurprise) -> some View {
        BWCard(padding: 14) {
            HStack(alignment: .center, spacing: 11) {
                Text(surprise.authorEmoji)
                    .font(.system(size: 20))
                    .frame(width: 44, height: 44)
                    .background(BWTheme.paper2)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(BWTheme.line, lineWidth: 1))

                VStack(alignment: .leading, spacing: 3) {
                    Text("\(surprise.authorName) 埋在 · \(surprise.areaLabel)")
                        .font(BWType.rowTitle(13))
                        .foregroundStyle(BWTheme.ink)
                        .lineLimit(1)
                    Text(BWFormat.relative(surprise.createdAt))
                        .font(BWType.caption(10.5))
                        .foregroundStyle(BWTheme.ink3)
                }

                Spacer(minLength: 0)

                VStack(alignment: .trailing, spacing: 3) {
                    Text(distanceText(surprise))
                        .font(.system(size: 15, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(phase == .approach ? BWTheme.amberDeep : BWTheme.teal)
                    if isDemoDistance {
                        Text("演示距离")
                            .font(.system(size: 9))
                            .foregroundStyle(BWTheme.ember)
                    }
                }
            }
        }
    }

    // MARK: 三阶线索

    private func clueTimeline(_ surprise: BuriedSurprise) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("线索")
                    .font(BWTheme.title(17))
                    .foregroundStyle(BWTheme.ink)
                Text("\(unlockedClueCount(for: surprise))/3")
                    .font(BWTheme.caption(12))
                    .foregroundStyle(BWTheme.ink3)
                Spacer(minLength: 0)
            }

            ZStack(alignment: .leading) {
                Rectangle()
                    .fill(BWTheme.line)
                    .frame(width: 1)
                    .padding(.leading, 12)
                    .padding(.vertical, 20)

                VStack(spacing: 12) {
                    ForEach(0..<3, id: \.self) { index in
                        clueRow(surprise, index: index)
                    }
                }
            }
        }
    }

    private func clueRow(_ surprise: BuriedSurprise, index: Int) -> some View {
        let unlocked = index < unlockedClueCount(for: surprise)
        let clue = index < surprise.clues.count ? surprise.clues[index] : ""

        return HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle()
                    .fill(unlocked ? BWTheme.teal.opacity(0.16) : BWTheme.paper2)
                Circle()
                    .stroke(unlocked ? BWTheme.teal.opacity(0.4) : BWTheme.line, lineWidth: 1)
                if unlocked {
                    Image(systemName: "checkmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(BWTheme.teal)
                } else {
                    Text("\(index + 1)")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(BWTheme.ink3)
                }
            }
            .frame(width: 26, height: 26)

            if unlocked {
                HStack(alignment: .top, spacing: 8) {
                    Text("✅").font(.system(size: 13))
                    Text(clue)
                        .font(BWTheme.body(14))
                        .foregroundStyle(BWTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(BWTheme.paper)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(BWTheme.line, lineWidth: 1)
                )
                .shadow(color: BWTheme.ink.opacity(0.06), radius: 10, x: 0, y: 6)
            } else {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "lock.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(BWTheme.ink3)
                    Text(lockedClueCopy(surprise, index: index))
                        .font(BWTheme.caption(13))
                        .foregroundStyle(BWTheme.ink3)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(BWTheme.paper2.opacity(0.55))
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(BWTheme.line, style: StrokeStyle(lineWidth: 1.2, dash: [5, 5]))
                )
            }
        }
    }

    // MARK: 阶段内容

    @ViewBuilder
    private func phaseContent(_ surprise: BuriedSurprise) -> some View {
        switch phase {
        case .approach:
            approachCard(surprise)
        case .shoot:
            shootCard(surprise)
        case .compare:
            compareStage(surprise)
        }
    }

    /// 还没进半径：只讲距离，没有任何照片
    private func approachCard(_ surprise: BuriedSurprise) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            BWMicroLabel("还差一点")
            Text("走近一点。到了，才给你拍的角度。")
                .font(BWTheme.body(13))
                .foregroundStyle(BWTheme.ink2)
                .fixedSize(horizontal: false, vertical: true)

            if let hint = approachHint(surprise) {
                Text(hint)
                    .font(BWType.caption(11))
                    .foregroundStyle(BWTheme.ink3)
            }

            // 演示兜底：明天真机用户不在演示坐标附近时，也要能走通
            if isDemoDistance {
                HStack(spacing: 8) {
                    SurpriseDemoTag()
                    Button {
                        simulateArrival()
                    } label: {
                        Text("演示：当作到了")
                            .font(.system(size: 10.5, weight: .semibold))
                            .foregroundStyle(BWTheme.ink2)
                            .padding(.horizontal, 10)
                            .frame(height: 26)
                            .background(BWTheme.paper)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(BWTheme.line, lineWidth: 1))
                    }
                    .buttonStyle(BWPressEffectStyle())
                    Spacer(minLength: 0)
                }
                .padding(.top, 4)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BWTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(BWTheme.line, lineWidth: 1)
        )
    }

    /// 进半径：只有拍照入口。这里**没有**作者照片 —— ADR-007。
    private func shootCard(_ surprise: BuriedSurprise) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                Image(systemName: "camera.viewfinder")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(BWTheme.amberDeep)
                Text("你已经在范围里了")
                    .font(BWType.rowTitle(13))
                    .foregroundStyle(BWTheme.ink)
                Spacer(minLength: 0)
                SurprisePill(text: "≤ \(Int(surprise.radiusMeters)) m", icon: "scope", tint: BWTheme.teal)
            }

            Text("抬手机，拍一张你眼前的画面。")
                .font(BWTheme.body(13))
                .foregroundStyle(BWTheme.ink2)
                .fixedSize(horizontal: false, vertical: true)

            Text("先别急着看，找到你的角度。")
                .font(BWType.caption(11))
                .foregroundStyle(BWTheme.ink3)

            SurprisePhotoPickRow(
                pickerItem: $pickerItem,
                cameraAvailable: CameraPhotoPicker.isCameraAvailable,
                onPickCamera: { isCameraPresented = true },
                primaryTitle: "这样拍一张",
                albumTitle: "从相册选",
                height: 44
            )
            .padding(.top, 2)
        }
        .padding(15)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BWTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(BWTheme.amber.opacity(0.35), lineWidth: 1)
        )
        .shadow(color: BWTheme.amberDeep.opacity(0.12), radius: 14, x: 0, y: 8)
    }

    /// 拍完之后：才并排给出作者原图 + 我的照片 + 相似度 + 评价
    private func compareStage(_ surprise: BuriedSurprise) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 8) {
                BWMicroLabel("对照")
                Spacer(minLength: 0)
                if let outcome {
                    Text(outcome.isDemo ? "演示匹配 · \(outcome.percentText) 像" : "\(outcome.percentText) 像")
                        .font(.system(size: 12, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(outcome.passed ? BWTheme.teal : BWTheme.amberDeep)
                        .padding(.horizontal, 10)
                        .frame(height: 26)
                        .background((outcome.passed ? BWTheme.teal : BWTheme.amberDeep).opacity(0.12))
                        .clipShape(Capsule())
                }
            }

            HStack(spacing: 8) {
                photoTile(
                    title: "TA 的",
                    image: authorImage(for: surprise) ?? demoStandInImage(for: surprise),
                    isDemo: authorImage(for: surprise) == nil
                )
                photoTile(
                    title: "你的",
                    image: finderImage,
                    isDemo: false
                )
            }

            if let outcome {
                Text(outcome.verdict)
                    .font(BWTheme.body(13))
                    .foregroundStyle(BWTheme.ink2)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)

                if outcome.isDemo {
                    Text("作者的原图不在这台手机上，这次的相似度是演示值。")
                        .font(BWType.caption(10.5))
                        .foregroundStyle(BWTheme.ember.opacity(0.9))
                }
            }

            BWHairline()

            if let result = findResult, let outcome, outcome.passed {
                settlementBlock(result)
            } else {
                retryBlock
            }
        }
        .padding(15)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BWTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous)
                .stroke(outcome?.passed == true ? BWTheme.teal.opacity(0.4) : BWTheme.amber.opacity(0.32), lineWidth: 1)
        )
        .shadow(color: BWTheme.ink.opacity(0.07), radius: 14, x: 0, y: 9)
    }

    private func photoTile(title: String, image: UIImage?, isDemo: Bool) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Group {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                } else {
                    ZStack {
                        BWKraft.thumbGradient
                        Text("?")
                            .font(.system(size: 20, weight: .bold))
                            .foregroundStyle(BWTheme.ink3)
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 172)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(BWTheme.ink.opacity(0.08), lineWidth: 1)
            )

            HStack(spacing: 4) {
                Text(title)
                    .font(BWType.caption(10))
                    .foregroundStyle(BWTheme.ink3)
                if isDemo {
                    Text("演示照片")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(BWTheme.ember)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    /// 达标结算
    private func settlementBlock(_ result: SurpriseFindResult) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("找到")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(BWTheme.ink)
                Text("探索值 +\(result.seekerPoints)")
                    .font(.system(size: 15, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(BWTheme.teal)
                Spacer(minLength: 0)
                Text("作者 +\(result.authorPoints)")
                    .font(BWType.caption(10.5))
                    .foregroundStyle(BWTheme.ink3)
            }

            Text("你把 TA 的那一眼，重新看了一遍。")
                .font(BWTheme.body(12.5))
                .foregroundStyle(BWTheme.ink2)

            if let achievement = result.newAchievements.first {
                HStack(spacing: 6) {
                    Text(achievement.icon).font(.system(size: 13))
                    Text("成就解锁 · \(achievement.name)")
                        .font(BWType.caption(11))
                        .foregroundStyle(BWTheme.ink2)
                }
                .padding(.horizontal, 10)
                .frame(height: 28)
                .background(BWTheme.amber.opacity(0.16))
                .clipShape(Capsule())
            }

            HStack(spacing: 8) {
                if let onOpenMine {
                    BWSecondaryButton(title: "我的惊喜", icon: "tray.full") { onOpenMine() }
                }
                BWPrimaryButton(title: "再找一个", icon: "sparkle.magnifyingglass") {
                    closeDetail()
                }
            }
            .padding(.top, 2)
        }
        .padding(14)
        .background(BWTheme.teal.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(BWTheme.teal.opacity(0.22), lineWidth: 1)
        )
        .overlay(alignment: .topTrailing) {
            Circle()
                .fill(BWTheme.teal.opacity(passedGlow ? 0.16 : 0.0))
                .frame(width: 120, height: 120)
                .blur(radius: 24)
                .offset(x: 26, y: -34)
                .allowsHitTesting(false)
        }
    }

    private var retryBlock: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("再往那边挪两步。")
                .font(BWType.rowTitle(14))
                .foregroundStyle(BWTheme.ink)
            Text(comfortPointAwarded
                 ? "不着急，重拍一张就好。这次的 10 点是辛苦分。"
                 : "不着急，重拍一张就好。")
                .font(BWType.body(12))
                .foregroundStyle(BWTheme.ink2)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 8) {
                SurprisePhotoPickRow(
                    pickerItem: $pickerItem,
                    cameraAvailable: CameraPhotoPicker.isCameraAvailable,
                    onPickCamera: { isCameraPresented = true },
                    primaryTitle: "重拍一张",
                    albumTitle: "从相册选",
                    height: 42
                )
                Spacer(minLength: 0)
            }
        }
    }

    // MARK: 底部操作条

    @ViewBuilder
    private var detailBottomBar: some View {
        if let surprise = selected, phase == .approach {
            VStack(spacing: 6) {
                BWPrimaryButton(
                    title: "再走近 \(remainingMetersText(surprise))",
                    icon: "figure.walk",
                    action: {}
                )
                .disabled(true)
                .opacity(0.5)

                Text("到了，就给你拍的角度。")
                    .font(BWType.caption(10))
                    .foregroundStyle(BWTheme.ink3)
            }
            .padding(.horizontal, BWTheme.pagePadding)
            .padding(.top, 12)
            .padding(.bottom, 16)
            .background(alignment: .top) {
                ZStack(alignment: .top) {
                    BWTheme.cream
                    BWHairline()
                }
                .ignoresSafeArea(edges: .bottom)
            }
        }
    }

    // MARK: - 行为

    private func bootstrap() {
        // 寻惊喜优先用上次旅程的定位（通常就是几分钟前，够算距离），
        // 没有再主动取一次，避免每次进页面都等 GPS。
        probe.startIfNeeded(storeOrigin: store.lastKnownOrigin)
        usesDemoDistance = isDemoDistance
        applyPreviewRoute()
    }

    /// 真实定位迟到时，进了范围就自动切到拍摄阶段。
    /// 用 `.task` 挂载（视图消失自动取消），不要用裸 Task —— 否则全屏页关掉后循环还活着。
    private func watchArrival() async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            guard !Task.isCancelled else { return }
            guard let surprise = selected, phase == .approach else { continue }
            if GeoMath.distance(from: origin, to: surprise.location) <= surprise.radiusMeters {
                withAnimation(BWAnimation.regular) {
                    phase = .shoot
                }
                BWHaptics.medium()
            }
            let demo = isDemoDistance
            if demo != usesDemoDistance {
                usesDemoDistance = demo
            }
        }
    }

    private func openDetail(_ surprise: BuriedSurprise) {
        selected = surprise
        phase = .approach
        simulatedInRange = false
        comfortPointAwarded = false
        finderImage = nil
        finderPhotoName = nil
        outcome = nil
        findResult = nil
        isSubmitting = false
        passedGlow = false

        if distance(for: surprise) <= surprise.radiusMeters {
            phase = .shoot
            // 走进范围内给一次中等触感（design-system §3：解锁 = medium）
            BWHaptics.medium()
        }
        BWHaptics.light()
    }

    private func closeDetail() {
        withAnimation(BWAnimation.regular) {
            selected = nil
        }
        phase = .approach
    }

    /// 「演示：当作到了」= 只在 UI 上放行进入半径，**不改坐标**。
    /// 一旦放行，三条线索都视为已解锁（等于你人已经站在那个位置了）。
    private func simulateArrival() {
        simulatedInRange = true
        withAnimation(BWAnimation.regular) {
            phase = .shoot
        }
        BWHaptics.medium()
    }

    /// 收到寻者照片：算相似度 → 揭晓对比 → 达标则提交结算
    private func receive(finderImage image: UIImage, forceScore: Double? = nil) {
        guard let surprise = selected, !isSubmitting else { return }
        isSubmitting = true

        var result = PhotoLibraryService.match(finderImage: image, authorPhotoName: surprise.photoName)
        if let forceScore {
            result = PhotoMatchOutcome(score: forceScore, isDemo: result.isDemo, verdict: PhotoMatcher.verdict(for: forceScore))
        }
        self.finderImage = image
        self.outcome = result

        if result.passed {
            // 只有达标才落盘：不达标不留孤儿文件
            if let name = try? PhotoLibraryService.save(image) {
                finderPhotoName = name
                SurprisePhotoCache.insert(image, named: name)
            }
            let find = store.completeSurpriseFind(
                surpriseID: surprise.id,
                finderPhotoName: finderPhotoName ?? "",
                matchScore: result.score
            )
            findResult = find
            if let find {
                toasts.append(BWToast(
                    text: "找到 · 探索值 +\(find.seekerPoints)",
                    icon: "sparkles"
                ))
                if let achievement = find.newAchievements.first {
                    bwAfter(0.6) {
                        appendToast(
                            BWToast(
                                text: "成就解锁 · \(achievement.name)",
                                icon: achievement.icon,
                                isAmber: true
                            )
                        )
                    }
                }
            }
            BWHaptics.success()
            passedGlow = true
        } else {
            // 不达标：同一条惊喜只在第一次给 +10 辛苦分（反复重拍不该刷分），
            // 惊喜继续等别人 —— 所以这里不落盘 finderPhotoName。
            if !settledFailures.contains(surprise.id) {
                _ = store.completeSurpriseFind(
                    surpriseID: surprise.id,
                    finderPhotoName: "",
                    matchScore: result.score
                )
                settledFailures.insert(surprise.id)
                comfortPointAwarded = true
            } else {
                comfortPointAwarded = false
            }
            findResult = nil
            BWHaptics.light()
        }

        withAnimation(BWAnimation.slow) {
            phase = .compare
        }
        isSubmitting = false

        // 达标后刷新 detail 里那份 surprise 副本（状态已变 found）
        refreshSelected()
    }

    private func refreshSelected() {
        guard let current = selected else { return }
        if let updated = store.surprises.first(where: { $0.id == current.id }) {
            selected = updated
        }
    }

    // MARK: 距离 / 线索

    private func distance(for surprise: BuriedSurprise) -> Double {
        let from = isDemoDistance ? SurpriseLocation.demoPoint : origin
        return GeoMath.distance(from: from, to: surprise.location)
    }

    private func distanceText(_ surprise: BuriedSurprise) -> String {
        let meters = Int(distance(for: surprise).rounded())
        // 设计稿口径是「480 m」，1 公里内不换算成 km，免得 320m 显示成 0.3km 丢精度
        if meters < 1000 {
            return "\(meters) m"
        }
        return BWFormat.distanceKilometers(meters)
    }

    private func remainingMetersText(_ surprise: BuriedSurprise) -> String {
        let meters = Int((distance(for: surprise) - surprise.radiusMeters).rounded())
        return "\(max(0, meters)) m"
    }

    private func remainingMeters(_ surprise: BuriedSurprise) -> Double {
        max(0, distance(for: surprise) - surprise.radiusMeters)
    }

    /// 三阶阈值：按 radiusMeters 自适应（半径 60m 时正好 ≈ 400 / 200 / 60）
    private func clueThresholds(for surprise: BuriedSurprise) -> [Double] {
        let radius = max(20, surprise.radiusMeters)
        return [radius * 6.5, radius * 3.3, radius]
    }

    private func unlockedClueCount(for surprise: BuriedSurprise) -> Int {
        // 进了拍摄阶段（真实走入范围，或点了明确标注的「当作到了」）→ 三条全开
        if phase != .approach { return 3 }
        let meters = distance(for: surprise)
        let thresholds = clueThresholds(for: surprise)
        return thresholds.filter { meters <= $0 }.count
    }

    private func lockedClueCopy(_ surprise: BuriedSurprise, index: Int) -> String {
        let thresholds = clueThresholds(for: surprise)
        guard index < thresholds.count else { return "到了你就知道" }
        let gap = Int(max(0, distance(for: surprise) - thresholds[index]).rounded())
        if gap <= 0 { return "到了你就知道" }
        return "再走近 \(gap) m，解锁第\(BWFormat.chineseIndex(index))条线索"
    }

    private func approachHint(_ surprise: BuriedSurprise) -> String? {
        let gap = remainingMeters(surprise)
        guard gap > 0 else { return nil }
        return "还有 \(Int(gap.rounded())) 米到可以拍的位置。"
    }

    // MARK: 作者照片（只在 compare 阶段被调用）

    private func authorImage(for surprise: BuriedSurprise) -> UIImage? {
        SurprisePhotoCache.image(named: surprise.photoName)
    }

    /// 演示种子没有像素文件 → 生成一张明确标注「演示照片」的替身，
    /// 让「并排对比」在演示时也能成立，但绝不冒充作者真图。
    private func demoStandInImage(for surprise: BuriedSurprise) -> UIImage {
        PhotoLibraryService.demoStandInImage(seed: surprise.id)
    }

    // MARK: 杂项

    private func appendToast(_ toast: BWToast) {
        withAnimation(BWAnimation.regular) {
            toasts.append(toast)
        }
    }

    #if DEBUG
    /// 给演示种子惊喜补一份「作者原图」，让真实 dHash 分支可以被走查/截图。
    /// 只在 DEBUG + 显式 preview 入口时执行，不影响产品路径。
    private func seedAuthorPhoto(for surprise: BuriedSurprise, image: UIImage? = nil) {
        guard !PhotoLibraryService.exists(surprise.photoName) else { return }
        let image = image ?? PhotoLibraryService.demoStandInImage(seed: surprise.id + "-author")
        guard let saved = try? PhotoLibraryService.save(image) else { return }
        // save() 会生成新 UUID 文件名，这里改名成种子记录里的那个名字
        let target = PhotoLibraryService.url(for: surprise.photoName)
        try? FileManager.default.removeItem(at: target)
        try? FileManager.default.moveItem(at: PhotoLibraryService.url(for: saved), to: target)
        SurprisePhotoCache.insert(image, named: surprise.photoName)
    }
    #endif

    /// 截图 / 走查专用：`SIMCTL_CHILD_BW_PREVIEW=seek|seek-detail|seek-compare`
    private func applyPreviewRoute() {
        #if DEBUG
        let mode = ProcessInfo.processInfo.environment["BW_PREVIEW"] ?? ""
        guard ["seek-detail", "seek-shoot", "seek-compare", "seek-miss", "seek-compare-real", "seek-compare-same"].contains(mode) else { return }
        guard let first = nearbyList.first else { return }

        // 「真实 dHash」分支：真有作者原图时才会走的那条路。
        // 单机演示里预置种子没有像素文件，所以这里给它补一份，验证 isDemo == false 的完整链路。
        if mode == "seek-compare-real" {
            seedAuthorPhoto(for: first)
        } else if mode == "seek-compare-same" {
            // 同一构图（只是尺寸不同）→ 真实 dHash 应给出高分，用来确认算法不是恒 0
            seedAuthorPhoto(for: first, image: PhotoLibraryService.debugPlaceholderImage(size: CGSize(width: 600, height: 800)))
        }

        bwAfter(0.35) {
            openDetail(first)
            guard mode != "seek-detail" else { return }
            bwAfter(0.6) {
                simulateArrival()
                guard mode != "seek-shoot" else { return }
                bwAfter(0.5) {
                    switch mode {
                    case "seek-miss":
                        // 用一张「完全不同的画面」强制走不达标分支，用于设计走查
                        receive(finderImage: PhotoLibraryService.debugContrastImage(), forceScore: 0.28)
                    case "seek-compare-real":
                        // 真实的 dHash 对比：作者原图与寻者照片是两张不同的图，
                        // 分数完全由 PhotoMatcher 算出来（不注入）。
                        receive(finderImage: PhotoLibraryService.debugPlaceholderImage(size: CGSize(width: 700, height: 930)))
                    case "seek-compare-same":
                        // 同构图（换尺寸）：真实链路下应当高分通过，用来验证 dHash 不是恒 0
                        receive(finderImage: PhotoLibraryService.debugPlaceholderImage(size: CGSize(width: 500, height: 660)))
                    default:
                        receive(finderImage: PhotoLibraryService.debugPlaceholderImage())
                    }
                }
            }
        }
        #endif
    }
}
