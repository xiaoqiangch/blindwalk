import SwiftUI
import PhotosUI
import UIKit

// MARK: - 埋下一个惊喜（BuriedSurprise 的作者端）
//
// 流程（docs/surprise-exchange.md §7.1）：
// 拍/选一张照片 → 写一句话（为什么埋在这里）→ 可选一句提示 → 看到「埋在这里」的位置
// → 埋下 → 动画 + toast「已埋下 · 神秘值 +30」+（若触发成就）成就 toast
//
// 两个约定：
// - 照片只存沙盒（Documents/Surprises/），记录里留文件名（ADR-010：不上传）。
// - 位置优先真实定位；拿不到就降级到演示坐标，并**一直**显示「演示位置」标签。

struct BurySurpriseView: View {

    let store: BlindWalkStore
    var onClose: () -> Void = {}
    var onOpenSeek: (() -> Void)? = nil
    var onOpenMine: (() -> Void)? = nil

    // MARK: 状态

    private enum Stage { case compose, burying, done }

    @State private var stage: Stage = .compose
    @State private var probe = SurpriseLocationProbe()

    @State private var pickerItem: PhotosPickerItem?
    @State private var photo: UIImage?
    @State private var photoSource: PhotoSource = .none

    @State private var message = ""
    @State private var hint = ""
    @State private var isCameraPresented = false

    @State private var toasts: [BWToast] = []
    @State private var buryError: String?
    @State private var buried: BuriedSurprise?
    @State private var newAchievements: [Achievement] = []

    // 埋下动画
    @State private var photoSinks = false
    @State private var glowOut = false
    @State private var doneGlow = false

    private let messageLimit = 60
    private let hintLimit = 40

    private enum PhotoSource {
        case none, album, camera
    }

    // MARK: 位置

    private var resolvedPoint: GeoPoint {
        probe.origin ?? store.lastKnownOrigin ?? SurpriseLocation.demoPoint
    }

    private var isDemoLocation: Bool {
        probe.origin == nil && store.lastKnownOrigin == nil
    }

    private var areaLabel: String {
        SurpriseLocation.areaLabel(probeLabel: probe.areaLabel, isDemo: isDemoLocation)
    }

    /// 定位状态一句话（克制，只交代事实）
    private var locationStatusCopy: String? {
        if isDemoLocation {
            return "还没拿到定位。用演示位置也能先走通。"
        }
        if probe.isSearching {
            return "正在定位。"
        }
        return nil
    }

    private var canBury: Bool {
        photo != nil && !message.surpriseTrimmed.isEmpty && stage == .compose
    }

    private var messageCount: String { "\(message.count)/\(messageLimit)" }
    private var hintCount: String { "\(hint.count)/\(hintLimit)" }

    // MARK: Body

    var body: some View {
        ZStack {
            BWPaperBackground()

            switch stage {
            case .compose:
                // 用 VStack 而不是「ScrollView + safeAreaInset」：
                // 底栏必须是滚动区之外的实体，否则内容会滑到 CTA 底下互相盖住。
                VStack(spacing: 0) {
                    composeScroll
                    bottomBar
                }
            case .burying, .done:
                doneStage
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
                    adopt(image: image, source: .camera)
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
        .onChange(of: pickerItem) { _, item in
            guard let item else { return }
            Task { @MainActor in
                if let image = await PhotoLibraryService.loadImage(from: item) {
                    adopt(image: image, source: .album)
                } else {
                    appendToast(BWToast(text: "这张照片读不出来，换一张试试。", icon: "photo.badge.exclamationmark"))
                }
                pickerItem = nil
            }
        }
    }

    // MARK: 编写阶段

    private var composeScroll: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                SurpriseScreenHeader(
                    eyebrow: "埋惊喜",
                    title: "埋下一张照片",
                    onClose: onClose,
                    trailingLabel: buried == nil ? nil : "我的",
                    onTrailing: onOpenMine
                )
                .padding(.horizontal, BWTheme.pagePadding)

                Text("它留在这里，等一个人来找到。")
                    .font(BWType.body(13))
                    .foregroundStyle(BWTheme.ink2)
                    .padding(.horizontal, BWTheme.pagePadding)
                    .padding(.top, 6)

                photoSection
                    .padding(.horizontal, BWTheme.pagePadding)
                    .padding(.top, 18)

                messageSection
                    .padding(.horizontal, BWTheme.pagePadding)
                    .padding(.top, 22)

                hintSection
                    .padding(.horizontal, BWTheme.pagePadding)
                    .padding(.top, 18)

                locationSection
                    .padding(.horizontal, BWTheme.pagePadding)
                    .padding(.top, 22)

                Text("照片只留在你自己的手机里，不上传。")
                    .font(BWType.caption(10.5))
                    .foregroundStyle(BWTheme.ink3)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 18)
                    .padding(.bottom, 16)
            }
            .padding(.top, 6)
        }
    }

    // MARK: 照片区

    @ViewBuilder
    private var photoSection: some View {
        if let photo {
            chosenPhotoCard(photo)
        } else {
            emptyPhotoCard
        }
    }

    private var emptyPhotoCard: some View {
        VStack(spacing: 10) {
            BWEmptyArt()
                .padding(.bottom, 2)

            Text("先拍一张。你觉得好的那一张。")
                .font(BWType.body(13))
                .foregroundStyle(BWTheme.ink2)
                .multilineTextAlignment(.center)

            SurprisePhotoPickRow(
                pickerItem: $pickerItem,
                cameraAvailable: CameraPhotoPicker.isCameraAvailable,
                onPickCamera: { isCameraPresented = true },
                primaryTitle: "拍一张",
                albumTitle: "从相册选"
            )
            .padding(.top, 2)

            if !CameraPhotoPicker.isCameraAvailable {
                Text("这台设备没有相机，用相册也能埋。")
                    .font(BWType.caption(10.5))
                    .foregroundStyle(BWTheme.ink3)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 22)
        .padding(.horizontal, 16)
        .background(BWTheme.paper.opacity(0.55))
        .clipShape(RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous)
                .strokeBorder(BWTheme.line, style: StrokeStyle(lineWidth: 1.2, dash: [6, 5]))
        )
    }

    private func chosenPhotoCard(_ image: UIImage) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(maxWidth: .infinity)
                .frame(height: 232)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(BWTheme.ink.opacity(0.08), lineWidth: 1)
                )

            HStack(spacing: 8) {
                SurprisePill(
                    text: photoSource == .camera ? "刚拍的" : "相册里的",
                    icon: photoSource == .camera ? "camera.fill" : "photo.on.rectangle",
                    tint: BWTheme.ink2,
                    background: BWTheme.paper2
                )

                Spacer(minLength: 0)

                SurprisePhotoPickRow(
                    pickerItem: $pickerItem,
                    cameraAvailable: CameraPhotoPicker.isCameraAvailable,
                    onPickCamera: { isCameraPresented = true },
                    primaryTitle: "重拍",
                    albumTitle: "换一张",
                    height: 32
                )
            }
        }
        .padding(12)
        .background(BWTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous)
                .stroke(BWTheme.line, lineWidth: 1)
        )
        .shadow(color: BWTheme.ink.opacity(0.06), radius: 12, x: 0, y: 7)
    }

    // MARK: 一句话

    private var messageSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                BWMicroLabel("写一句话：为什么埋在这里")
                Spacer(minLength: 0)
                Text(messageCount)
                    .font(BWType.caption(10))
                    .monospacedDigit()
                    .foregroundStyle(message.count >= messageLimit ? BWTheme.ember : BWTheme.ink3)
            }

            TextField(
                "比如：这张是我在等一杯咖啡时拍的。",
                text: $message,
                axis: .vertical
            )
            .lineLimit(3...5)
            .font(BWType.body(13.5))
            .foregroundStyle(BWTheme.ink)
            .tint(BWTheme.amberDeep)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(BWTheme.paper2)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(BWTheme.line, lineWidth: 1)
            )
            .onChange(of: message) { _, newValue in
                if newValue.count > messageLimit {
                    message = String(newValue.prefix(messageLimit))
                }
            }

            Text("别写地方名。让 TA 自己找。")
                .font(BWType.caption(10.5))
                .foregroundStyle(BWTheme.ink3)
        }
    }

    // MARK: 提示

    private var hintSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                BWMicroLabel("（可选）给找它的人一句提示")
                Spacer(minLength: 0)
                Text(hintCount)
                    .font(BWType.caption(10))
                    .monospacedDigit()
                    .foregroundStyle(hint.count >= hintLimit ? BWTheme.ember : BWTheme.ink3)
            }

            TextField(
                "不能直接说答案哦。",
                text: $hint,
                axis: .vertical
            )
            .lineLimit(2...3)
            .font(BWType.body(13.5))
            .foregroundStyle(BWTheme.ink)
            .tint(BWTheme.amberDeep)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(BWTheme.paper2)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(BWTheme.line, lineWidth: 1)
            )
            .onChange(of: hint) { _, newValue in
                if newValue.count > hintLimit {
                    hint = String(newValue.prefix(hintLimit))
                }
            }
        }
    }

    // MARK: 位置

    private var locationSection: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .center, spacing: 6) {
                Text("埋在这里")
                    .font(BWType.micro())
                    .tracking(1.1)
                    .foregroundStyle(BWTheme.ink3)

                Spacer(minLength: 0)

                if isDemoLocation {
                    SurpriseDemoTag()
                } else if probe.origin == nil {
                    SurprisePill(text: "上次位置", icon: "clock.arrow.circlepath", tint: BWTheme.ink2)
                } else {
                    SurprisePill(text: "实时定位", icon: "location.fill", tint: BWTheme.teal)
                }
            }

            HStack(alignment: .center, spacing: 10) {
                Image(systemName: "mappin.and.ellipse")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(isDemoLocation ? BWTheme.ember : BWTheme.amberDeep)

                VStack(alignment: .leading, spacing: 2) {
                    Text(areaLabel)
                        .font(BWType.rowTitle(14))
                        .foregroundStyle(BWTheme.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Text(SurpriseLocation.coordinateText(resolvedPoint))
                        .font(.system(size: 10.5, weight: .regular))
                        .monospacedDigit()
                        .foregroundStyle(BWTheme.ink3)
                }

                Spacer(minLength: 0)

                if isDemoLocation {
                    Button {
                        retryLocating()
                    } label: {
                        Text("重试定位")
                            .font(BWType.caption(10.5))
                            .foregroundStyle(BWTheme.ink2)
                            .padding(.horizontal, 10)
                            .frame(height: 26)
                            .background(BWTheme.paper2)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(BWTheme.line, lineWidth: 1))
                    }
                    .buttonStyle(BWPressEffectStyle())
                }
            }

            if let locationStatusCopy {
                Text(locationStatusCopy)
                    .font(BWType.caption(10.5))
                    .foregroundStyle(isDemoLocation ? BWTheme.ember.opacity(0.9) : BWTheme.ink3)
            }

            if let buryError {
                Text(buryError)
                    .font(BWType.caption(11))
                    .foregroundStyle(BWTheme.ember)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BWTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(isDemoLocation ? BWTheme.ember.opacity(0.24) : BWTheme.line, lineWidth: 1)
        )
    }

    // MARK: 底部 CTA

    private var bottomBar: some View {
        VStack(spacing: 6) {
            BWPrimaryButton(
                title: canBury ? "埋在这里" : "还差一张照片",
                icon: canBury ? "arrow.down.to.line" : "camera",
                caption: canBury ? "+30" : nil,
                action: { bury() }
            )
            .disabled(!canBury)
            .opacity(canBury ? 1 : 0.5)

            Text("埋下后，它会一直留在这个位置，等一个人来。")
                .font(BWType.caption(10))
                .foregroundStyle(BWTheme.ink3)
        }
        .padding(.horizontal, BWTheme.pagePadding)
        .padding(.top, 12)
        .padding(.bottom, 16)
        // 底栏必须是实底：半透明渐变会让滚动内容从 CTA 下面透出来，看着像两层叠在一起。
        .background(alignment: .top) {
            ZStack(alignment: .top) {
                BWTheme.cream
                BWHairline()
            }
            .ignoresSafeArea(edges: .bottom)
        }
    }

    // MARK: 埋下阶段 / 成功页

    private var doneStage: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer(minLength: 0)
                BWIconButton(systemName: "xmark", size: 32, action: onClose)
                    .accessibilityLabel("关闭")
            }
            .padding(.horizontal, BWTheme.pagePadding)
            .padding(.top, 6)

            Spacer(minLength: 0)

            ZStack {
                // 埋在土里的一小圈暖光
                Circle()
                    .fill(BWTheme.amber.opacity(doneGlow ? 0.18 : 0.0))
                    .frame(width: 250, height: 250)
                    .blur(radius: 30)
                    .scaleEffect(doneGlow ? 1 : 0.7)

                if let photo {
                    Image(uiImage: photo)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 168, height: 206)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .stroke(BWTheme.cream.opacity(0.5), lineWidth: 1)
                        )
                        .rotationEffect(.degrees(photoSinks ? -3 : 0))
                        .scaleEffect(photoSinks ? 0.42 : 1)
                        .opacity(photoSinks ? 0 : 1)
                        .offset(y: photoSinks ? 74 : 0)
                }

                // 照片沉下去之后，留在原地的是一张「封住的纸」：
                // 它同时说明了「别人先看到的是这个」，比纯空白更有信息量。
                if photoSinks {
                    VStack(spacing: 6) {
                        ZStack {
                            BWKraft.thumbGradient
                            Text("?")
                                .font(.system(size: 30, weight: .bold))
                                .foregroundStyle(BWTheme.ink3.opacity(0.9))
                        }
                        .frame(width: 96, height: 118)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .strokeBorder(BWTheme.ink3.opacity(0.5), style: StrokeStyle(lineWidth: 1.4, dash: [5, 4]))
                        )

                        Text("别人先看到这个")
                            .font(BWType.caption(10))
                            .foregroundStyle(BWTheme.ink3)
                    }
                    .transition(.scale(scale: 0.8).combined(with: .opacity))
                }

                // 埋点：琥珀环
                Circle()
                    .stroke(BWTheme.amber, lineWidth: 2)
                    .frame(width: glowOut ? 190 : 26, height: glowOut ? 190 : 26)
                    .opacity(glowOut ? 0 : 0.9)
                    .offset(y: photoSinks ? 44 : 0)
            }
            .frame(height: 280)

            VStack(spacing: 8) {
                Text(stage == .done ? "已埋下。" : "正在埋下")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(BWTheme.ink)

                if let buried {
                    Text("\(buried.areaLabel) · 等一个人来找到。")
                        .font(BWType.body(13))
                        .foregroundStyle(BWTheme.ink2)
                        .multilineTextAlignment(.center)

                    Text(buried.message)
                        .font(BWType.body(12.5))
                        .foregroundStyle(BWTheme.ink3)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 40)
                        .padding(.top, 2)
                }
            }
            .opacity(stage == .done ? 1 : 0.45)

            Spacer(minLength: 0)

            VStack(spacing: 8) {
                if let onOpenSeek {
                    BWPrimaryButton(title: "去寻宝看看", icon: "sparkle.magnifyingglass", action: onOpenSeek)
                }
                HStack(spacing: 8) {
                    if let onOpenMine {
                        BWSecondaryButton(title: "我的惊喜", icon: "tray.full") { onOpenMine() }
                    }
                    BWSecondaryButton(title: "再埋一个", icon: "plus.viewfinder") { resetForAnother() }
                }
            }
            .padding(.horizontal, BWTheme.pagePadding)
            // 让出底部 toast 的高度（两条叠加约 130pt），别让「成就解锁」压住按钮
            .padding(.bottom, 150)
        }
    }

    // MARK: 行为

    private func bootstrap() {
        // 埋点必须准：别用「上次旅程的定位」（可能是几十分钟前、甚至另一个城市），
        // 一定现取一次。取不到才退回 store 里那个点，再取不到就走演示位置。
        probe.startIfNeeded(storeOrigin: nil)
        applyPreviewRoute()
    }

    private func retryLocating() {
        probe.stop()
        let fresh = SurpriseLocationProbe()
        probe = fresh
        fresh.startIfNeeded(storeOrigin: nil)
        BWHaptics.light()
    }

    private func adopt(image: UIImage, source: PhotoSource) {
        photo = image
        photoSource = source
        buryError = nil
        BWHaptics.light()
    }

    private func bury() {
        guard let photo, let name = try? PhotoLibraryService.save(photo) else {
            buryError = "照片没能存下来。再试一次。"
            return
        }

        // 记录埋之前已解锁的成就，用差值判断本次新解锁（不动 Shared 层）
        let before = Set(store.profile.achievements.filter { $0.unlockedAt != nil }.map(\.id))

        let buriedSurprise = store.burySurprise(
            message: message.surpriseTrimmed,
            photoName: name,
            location: resolvedPoint,
            areaLabel: areaLabel,
            hint: hint.surpriseOptional
        )
        buried = buriedSurprise
        newAchievements = store.profile.achievements.filter {
            $0.unlockedAt != nil && !before.contains($0.id)
        }

        BWHaptics.success()
        buryError = nil

        withAnimation(BWAnimation.openBox) {
            stage = .burying
            photoSinks = true
            glowOut = true
        }

        bwAfter(0.55) {
            withAnimation(BWAnimation.slow) {
                stage = .done
                doneGlow = true
            }
            appendToast(BWToast(text: "已埋下 · 神秘值 +30", icon: "sparkles"))
            if let achievement = newAchievements.first {
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
    }

    private func resetForAnother() {
        photo = nil
        photoSource = .none
        message = ""
        hint = ""
        buried = nil
        newAchievements = []
        photoSinks = false
        glowOut = false
        doneGlow = false
        stage = .compose
    }

    private func appendToast(_ toast: BWToast) {
        withAnimation(BWAnimation.regular) {
            toasts.append(toast)
        }
    }

    /// 截图 / 走查专用：`SIMCTL_CHILD_BW_PREVIEW=bury|bury-filled`
    private func applyPreviewRoute() {
        #if DEBUG
        switch ProcessInfo.processInfo.environment["BW_PREVIEW"] {
        case "bury-filled":
            photo = PhotoLibraryService.debugPlaceholderImage()
            photoSource = .camera
            message = "这张是我在等一杯咖啡时拍的。柜台后面那盏灯，晚上会有很软的一圈光。"
            hint = "往灯最暖的那扇窗走。"
        case "bury-done":
            photo = PhotoLibraryService.debugPlaceholderImage()
            photoSource = .camera
            message = "这张是我在等一杯咖啡时拍的。柜台后面那盏灯，晚上会有很软的一圈光。"
            hint = "往灯最暖的那扇窗走。"
            bwAfter(0.5) { bury() }
        default:
            break
        }
        #endif
    }
}
