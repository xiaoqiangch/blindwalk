import SwiftUI
import UIKit

// MARK: - 我的埋惊喜 + 首页入口卡
//
// 这个文件同时提供三件东西：
// 1. `SurpriseHubCard` —— 首页「惊喜社区」入口卡（Lead 已插入 HomeView）；
// 2. `SurprisesView`   —— 我的：我埋的 / 我找到的；
// 3. 三个页面共用的纸感小构件（页头、照片帧、徽章、toast 层、照片缓存）。
//
// 首页接入代码（Lead 已加，留档）：
//
//     SurpriseHubCard(store: store)
//         .padding(.top, 20)
//
// 卡片自带 fullScreenCover，出埋 / 寻 / 我的三个页面，调用方不需要管导航。

// MARK: - 首页入口卡

struct SurpriseHubCard: View {

    let store: BlindWalkStore

    @State private var destination: SurpriseDestination?

    private var waitingCount: Int {
        store.explorableSurprises(near: store.lastKnownOrigin).count
    }

    private var buriedCount: Int { store.mySurprises.count }
    private var foundCount: Int { store.profile.surprisesSeeked }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                BWMicroLabel("惊喜社区")
                Spacer(minLength: 8)
                Text("我埋了 \(buriedCount) · 找到 \(foundCount)")
                    .font(BWType.caption(10.5))
                    .foregroundStyle(BWTheme.ink3)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }

            Text("留一张照片给陌生人，或者去找到别人的。")
                .font(BWType.body(13))
                .foregroundStyle(BWTheme.ink2)
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 7)

            HStack(spacing: 8) {
                hubButton(
                    title: "埋下一个",
                    systemName: "plus.viewfinder",
                    emphasized: true,
                    action: { destination = .bury }
                )
                hubButton(
                    title: waitingCount > 0 ? "去寻宝 · \(waitingCount) 个在等你" : "去寻宝",
                    systemName: "sparkle.magnifyingglass",
                    emphasized: false,
                    action: { destination = .seek }
                )
            }
            .padding(.top, 13)

            Button {
                destination = .mine
            } label: {
                HStack(spacing: 3) {
                    Text("我的惊喜")
                        .font(BWType.caption(10.5))
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10.5, weight: .semibold))
                }
                .foregroundStyle(BWTheme.ink3)
            }
            .buttonStyle(BWPressEffectStyle())
            .padding(.top, 10)
            .accessibilityLabel("查看我埋的和我找到的惊喜")
        }
        .padding(.horizontal, 18)
        .padding(.top, 16)
        .padding(.bottom, 15)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BWTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous)
                .stroke(BWTheme.line, lineWidth: 1)
        )
        .overlay(alignment: .topLeading) {
            // 右上角一小片琥珀光，让这张卡和「今日盲盒」区分开，又不抢戏
            Circle()
                .fill(BWTheme.amber.opacity(0.10))
                .frame(width: 74, height: 74)
                .blur(radius: 18)
                .offset(x: 40, y: -30)
                .allowsHitTesting(false)
        }
        .shadow(color: BWTheme.ink.opacity(0.07), radius: 14, x: 0, y: 9)
        .fullScreenCover(item: $destination) { destination in
            switch destination {
            case .bury:
                BurySurpriseView(
                    store: store,
                    onClose: { self.destination = nil },
                    onOpenSeek: { self.destination = .seek },
                    onOpenMine: { self.destination = .mine }
                )
            case .seek:
                SeekSurpriseView(
                    store: store,
                    onClose: { self.destination = nil },
                    onOpenBury: { self.destination = .bury },
                    onOpenMine: { self.destination = .mine }
                )
            case .mine:
                SurprisesView(
                    store: store,
                    onClose: { self.destination = nil },
                    onOpenBury: { self.destination = .bury },
                    onOpenSeek: { self.destination = .seek }
                )
            }
        }
        .onAppear(perform: applyPreviewRoute)
    }

    private func hubButton(title: String, systemName: String, emphasized: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: systemName)
                    .font(.system(size: 13, weight: .semibold))
                Text(title)
                    .font(.system(size: 13.5, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
            }
            .foregroundStyle(emphasized ? BWTheme.ink : BWTheme.ink2)
            .frame(maxWidth: .infinity)
            .frame(height: 40)
            .background(emphasized ? BWTheme.amber : BWTheme.paper2)
            .clipShape(Capsule())
            .overlay(
                Capsule().stroke(emphasized ? Color.clear : BWTheme.line, lineWidth: 1)
            )
            .shadow(color: emphasized ? BWTheme.amberDeep.opacity(0.22) : .clear, radius: 10, x: 0, y: 5)
        }
        .buttonStyle(BWPressEffectStyle())
        .accessibilityLabel(title)
    }

    /// 截图 / 走查专用：`SIMCTL_CHILD_BW_PREVIEW=bury|seek|surprises`
    private func applyPreviewRoute() {
        let preview = ProcessInfo.processInfo.environment["BW_PREVIEW"] ?? ""
        #if DEBUG
        // 照片算法自检（日志里看 [dhash-selfcheck]）
        if preview == "dhash-check" {
            PhotoLibraryService.runSelfCheck()
            return
        }
        #endif
        switch preview {
        case "bury", "bury-filled", "bury-done": destination = .bury
        case "seek", "seek-detail", "seek-shoot", "seek-compare", "seek-compare-real", "seek-compare-same", "seek-miss": destination = .seek
        case "surprises", "surprises-filled": destination = .mine
        default: break
        }
    }
}

/// 三个惊喜页面的路由（HubCard 内部使用）
enum SurpriseDestination: String, Identifiable {
    case bury, seek, mine

    var id: String { rawValue }
}

// MARK: - 我的惊喜 SurprisesView

struct SurprisesView: View {

    let store: BlindWalkStore
    var onClose: () -> Void = {}
    var onOpenBury: (() -> Void)? = nil
    var onOpenSeek: (() -> Void)? = nil

    private var buried: [BuriedSurprise] { store.mySurprises }
    private var waiting: [BuriedSurprise] { buried.filter(\.isWaiting) }
    private var caught: [BuriedSurprise] { buried.filter { $0.status == .found } }
    private var foundByMe: [BuriedSurprise] {
        store.surprises.filter { $0.status == .found && $0.finderName == store.profile.displayName }
    }

    var body: some View {
        ZStack {
            BWPaperBackground()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    SurpriseScreenHeader(
                        eyebrow: "我的",
                        title: "惊喜",
                        onClose: onClose
                    )
                    .padding(.horizontal, BWTheme.pagePadding)

                    statsCard
                        .padding(.horizontal, BWTheme.pagePadding)
                        .padding(.top, 16)

                    buriedSection
                        .padding(.horizontal, BWTheme.pagePadding)
                        .padding(.top, 26)

                    foundSection
                        .padding(.horizontal, BWTheme.pagePadding)
                        .padding(.top, 26)

                    Text("照片只留在你自己的手机里。")
                        .font(BWType.caption(10.5))
                        .foregroundStyle(BWTheme.ink3)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 22)
                        .padding(.bottom, 30)
                }
                .padding(.top, 6)
            }
        }
        .bwTypeBounds()
        .onAppear(perform: seedPreviewDataIfNeeded)
    }

    /// 截图 / 走查专用：`SIMCTL_CHILD_BW_PREVIEW=surprises-filled`
    /// 往 store 里塞两条真实形状的记录（照片用代码生成的占位图），验证列表排版。
    private func seedPreviewDataIfNeeded() {
        #if DEBUG
        guard ProcessInfo.processInfo.environment["BW_PREVIEW"] == "surprises-filled" else { return }
        guard store.mySurprises.isEmpty else { return }

        let here = store.lastKnownOrigin ?? SurpriseLocation.demoPoint

        // ① 我埋的（等待中）
        if let name = try? PhotoLibraryService.save(PhotoLibraryService.demoStandInImage(seed: "preview-buried-1")) {
            store.burySurprise(
                message: "这张是我在等一杯咖啡时拍的。柜台后面那盏灯，晚上会有很软的一圈光。",
                photoName: name,
                location: here,
                areaLabel: "静安 · 街角",
                hint: "往灯最暖的那扇窗走。"
            )
        }

        // ② 我埋的（已被找到）+ 寻者复刻图
        if let finderName = try? PhotoLibraryService.save(PhotoLibraryService.demoStandInImage(seed: "preview-found-2")),
           let index = store.surprises.firstIndex(where: { $0.isMine }) {
            store.surprises[index].status = .found
            store.surprises[index].finderName = "小满"
            store.surprises[index].foundAt = Date().addingTimeInterval(-3_600)
            store.surprises[index].finderPhotoName = finderName
            store.surprises[index].matchScore = 0.78
        }

        // ③ 我找到的（别人埋的 + 我的复刻）
        if let myName = try? PhotoLibraryService.save(PhotoLibraryService.demoStandInImage(seed: "preview-mine-3")),
           let index = store.surprises.firstIndex(where: { $0.isWaiting && !$0.isMine }) {
            store.surprises[index].status = .found
            store.surprises[index].finderName = store.profile.displayName
            store.surprises[index].foundAt = Date().addingTimeInterval(-7_200)
            store.surprises[index].finderPhotoName = myName
            store.surprises[index].matchScore = 0.86
        }
        #endif
    }

    // MARK: 统计

    private var statsCard: some View {
        BWCard(padding: 16, background: BWTheme.paper) {
            BWStatsRow(items: [
                ("\(buried.count)", "我埋的"),
                ("\(caught.count)", "被找到"),
                ("\(foundByMe.count)", "我找到的")
            ])
        }
    }

    // MARK: 我埋的

    private var buriedSection: some View {
        VStack(alignment: .leading, spacing: 11) {
            BWSectionHeader(title: "我埋的", trailingTitle: buried.isEmpty ? nil : "等待中 \(waiting.count) · 被找到 \(caught.count)")

            if buried.isEmpty {
                emptyBuryCard
            } else {
                ForEach(buried) { surprise in
                    buriedRow(surprise)
                }
            }
        }
    }

    private var emptyBuryCard: some View {
        BWCard(padding: 0) {
            BWEmptyState(
                title: "你还没埋下过惊喜。",
                subtitle: "找一个你觉得好的地方，放一张照片在那儿。"
            )

            if let onOpenBury {
                BWSecondaryButton(title: "埋下一个", icon: "plus.viewfinder") {
                    onOpenBury()
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
            }
        }
    }

    private func buriedRow(_ surprise: BuriedSurprise) -> some View {
        BWCard(padding: 14) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .center, spacing: 11) {
                    SurpriseThumb(name: surprise.photoName, layout: .fixed(CGSize(width: 54, height: 68)))
                        .overlay(alignment: .bottomTrailing) {
                            Text(surprise.authorEmoji)
                                .font(.system(size: 14))
                                .offset(x: 4, y: 4)
                        }

                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Text(surprise.areaLabel)
                                .font(BWType.rowTitle(13))
                                .foregroundStyle(BWTheme.ink)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                            SurpriseStatusBadge(status: surprise.status)
                        }

                        Text(surprise.message)
                            .font(BWType.body(12.5))
                            .foregroundStyle(BWTheme.ink2)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)

                        Text("埋于 \(BWFormat.relative(surprise.createdAt))")
                            .font(BWType.caption(10.5))
                            .foregroundStyle(BWTheme.ink3)
                    }
                }

                if surprise.status == .found {
                    BWHairline()
                    foundNote(surprise)
                }
            }
        }
    }

    private func foundNote(_ surprise: BuriedSurprise) -> some View {
        HStack(spacing: 10) {
            SurpriseThumb(name: surprise.photoName, layout: .fixed(CGSize(width: 40, height: 50)))
            Image(systemName: "arrow.left.arrow.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(BWTheme.ink3)
            SurpriseThumb(name: surprise.finderPhotoName ?? "", layout: .fixed(CGSize(width: 40, height: 50)))

            VStack(alignment: .leading, spacing: 2) {
                Text("被 \(surprise.finderName ?? "有人") 找到了")
                    .font(BWType.rowTitle(12.5))
                    .foregroundStyle(BWTheme.ink)
                if let score = surprise.matchScore {
                    Text("\(Int((score * 100).rounded()))% 像 · \(BWFormat.relative(surprise.foundAt ?? surprise.createdAt))")
                        .font(BWType.caption(10.5))
                        .foregroundStyle(BWTheme.teal)
                }
            }

            Spacer(minLength: 0)
        }
    }

    // MARK: 我找到的

    private var foundSection: some View {
        VStack(alignment: .leading, spacing: 11) {
            BWSectionHeader(title: "我找到的", trailingTitle: foundByMe.isEmpty ? nil : "\(foundByMe.count) 张")

            if foundByMe.isEmpty {
                BWCard(padding: 0) {
                    BWEmptyState(
                        title: "还没找到别人的照片。",
                        subtitle: "附近有几个惊喜在等你。"
                    )
                    if let onOpenSeek {
                        BWSecondaryButton(title: "去寻宝", icon: "sparkle.magnifyingglass") {
                            onOpenSeek()
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 16)
                    }
                }
            } else {
                ForEach(foundByMe) { surprise in
                    foundByMeRow(surprise)
                }
            }
        }
    }

    private func foundByMeRow(_ surprise: BuriedSurprise) -> some View {
        BWCard(padding: 14) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .center, spacing: 9) {
                    Text(surprise.authorEmoji)
                        .font(.system(size: 16))
                        .frame(width: 30, height: 30)
                        .background(BWTheme.paper2)
                        .clipShape(Circle())
                        .overlay(Circle().stroke(BWTheme.line, lineWidth: 1))

                    Text("\(surprise.authorName) 埋在 · \(surprise.areaLabel)")
                        .font(BWType.rowTitle(12.5))
                        .foregroundStyle(BWTheme.ink)
                        .lineLimit(1)

                    Spacer(minLength: 0)

                    if let score = surprise.matchScore {
                        Text("\(Int((score * 100).rounded()))% 像")
                            .font(.system(size: 12.5, weight: .bold))
                            .foregroundStyle(BWTheme.teal)
                            .padding(.horizontal, 8)
                            .frame(height: 22)
                            .background(BWTheme.teal.opacity(0.12))
                            .clipShape(Capsule())
                    }
                }

                HStack(spacing: 8) {
                    pairTile(title: "TA 的", name: surprise.photoName)
                    pairTile(title: "你的", name: surprise.finderPhotoName ?? "")
                }

                Text(surprise.message)
                    .font(BWType.body(12))
                    .foregroundStyle(BWTheme.ink2)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func pairTile(title: String, name: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            SurpriseThumb(name: name, layout: .fill(aspect: 0.8))
                .frame(maxWidth: .infinity)
            Text(title)
                .font(BWType.caption(10))
                .foregroundStyle(BWTheme.ink3)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - 共用叶子组件（三个页面都用）
//
// 这些是「纸卡里的零件」，不是新视觉：圆角、描边、字号全部取既有 token。

/// 页面头：左关闭 / 返回，中间微标 + 标题，右侧可选一个文字动作。
struct SurpriseScreenHeader: View {
    var eyebrow: String? = nil
    var title: String
    var onClose: (() -> Void)? = nil
    var onBack: (() -> Void)? = nil
    var trailingLabel: String? = nil
    var onTrailing: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            if let onBack {
                circleButton(systemName: "chevron.left", label: "返回", action: onBack)
            } else if let onClose {
                circleButton(systemName: "xmark", label: "关闭", action: onClose)
            } else {
                Color.clear.frame(width: 32, height: 32)
            }

            VStack(alignment: .leading, spacing: 2) {
                if let eyebrow {
                    Text(eyebrow)
                        .font(BWType.micro())
                        .tracking(1.1)
                        .foregroundStyle(BWTheme.ink3)
                }
                Text(title)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(BWTheme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }

            Spacer(minLength: 0)

            if let trailingLabel, let onTrailing {
                Button(action: onTrailing) {
                    Text(trailingLabel)
                        .font(BWType.caption(11))
                        .foregroundStyle(BWTheme.ink2)
                        .padding(.horizontal, 11)
                        .frame(height: 28)
                        .background(BWTheme.paper)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(BWTheme.line, lineWidth: 1))
                }
                .buttonStyle(BWPressEffectStyle())
            }
        }
        .frame(height: 46)
    }

    private func circleButton(systemName: String, label: String, action: @escaping () -> Void) -> some View {
        BWIconButton(systemName: systemName, size: 32, action: action)
            .accessibilityLabel(label)
    }
}

/// 照片帧：16pt 圆角 + 发丝描边；文件不在本机时给一张诚实的占位纸。
///
/// 尺寸用两种显式布局，而不是「先 Group 再 frame」：
/// `.fixed` 给缩略图撑确切尺寸；`.fill` 用 aspectRatio 让并排对比自适应卡片宽度。
/// 关键是**先定框、再 overlay 画图、最后裁圆角** —— 直接对 `scaledToFill` 的 Image
/// 套 frame 会按图片固有尺寸撑开，把卡片顶破。
struct SurpriseThumb: View {

    enum Layout {
        case fixed(CGSize)
        /// 宽度跟随容器，高度 = 宽度 / aspect
        case fill(aspect: CGFloat)
    }

    let name: String
    var layout: Layout = .fixed(CGSize(width: 54, height: 68))

    private var image: UIImage? { SurprisePhotoCache.image(named: name) }

    var body: some View {
        frameView
            .overlay {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                } else {
                    placeholder
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(BWTheme.ink.opacity(0.08), lineWidth: 1)
            )
            .accessibilityLabel(image == nil ? "照片不在这台手机上" : "一张埋下的照片")
    }

    @ViewBuilder
    private var frameView: some View {
        switch layout {
        case .fixed(let size):
            Color.clear.frame(width: size.width, height: size.height)
        case .fill(let aspect):
            Color.clear.aspectRatio(aspect, contentMode: .fit)
        }
    }

    private var placeholder: some View {
        ZStack {
            BWKraft.thumbGradient
            VStack(spacing: 3) {
                Text("?")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(BWTheme.ink3)
                Text("照片不在本机")
                    .font(.system(size: 10.5))
                    .foregroundStyle(BWTheme.ink3)
                    .multilineTextAlignment(.center)
            }
            .padding(2)
        }
    }
}

/// 状态徽章：等待中 / 已被找到 / 演示
struct SurpriseStatusBadge: View {
    let status: BuriedSurprise.Status

    var body: some View {
        let style = styleInfo
        Text(style.0)
            .font(.system(size: 12, weight: .bold))
            .tracking(0.2)
            .foregroundStyle(style.1)
            .padding(.horizontal, 8)
            .frame(height: 20)
            .background(style.1.opacity(0.12))
            .clipShape(Capsule())
            .overlay(Capsule().stroke(style.1.opacity(0.3), lineWidth: 1))
    }

    private var styleInfo: (String, Color) {
        switch status {
        case .waiting: return ("等待中", BWTheme.amberDeep)
        case .found: return ("已找到", BWTheme.teal)
        case .retired: return ("已收回", BWTheme.ink3)
        }
    }
}

/// 小徽章（距离 / 「演示位置」这类）
struct SurprisePill: View {
    let text: String
    var icon: String? = nil
    var tint: Color = BWTheme.ink2
    var background: Color = BWTheme.paper2

    var body: some View {
        HStack(spacing: 3) {
            if let icon {
                Image(systemName: icon)
                    .font(.system(size: 11.5, weight: .semibold))
            }
            Text(text)
                .font(.system(size: 12.5, weight: .semibold))
                .monospacedDigit()
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 9)
        .frame(height: 22)
        .background(background)
        .clipShape(Capsule())
        .overlay(Capsule().stroke(tint.opacity(0.22), lineWidth: 1))
    }
}

/// 「演示」标注：全程可见，不让用户误以为自己真的在那个坐标上
struct SurpriseDemoTag: View {
    var body: some View {
        SurprisePill(
            text: "演示位置",
            icon: "info.circle",
            tint: BWTheme.ember,
            background: BWTheme.ember.opacity(0.10)
        )
    }
}

/// 底部 toast 堆叠层（与揭晓页一致的贴底样式）
struct SurpriseToastLayer: View {
    let toasts: [BWToast]
    let onDismiss: (BWToast) -> Void

    var body: some View {
        VStack(spacing: 8) {
            Spacer(minLength: 0)
            ForEach(toasts) { toast in
                BWToastView(toast: toast) { onDismiss(toast) }
                    .id(toast.id)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .padding(.horizontal, BWTheme.pagePadding)
        .padding(.bottom, 30)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .animation(BWAnimation.regular, value: toasts.map(\.id))
        .allowsHitTesting(false)
    }
}

// MARK: - 照片缓存
//
// 同一张照片可能在列表里出现多次（作者图 / 寻者图 / 对比图），
// 同步读盘 + 解码不贵，但每帧都做会掉帧；这里给一层极小缓存。

enum SurprisePhotoCache {
    private static let cache = NSCache<NSString, UIImage>()

    static func image(named name: String) -> UIImage? {
        guard !name.isEmpty else { return nil }
        if let cached = cache.object(forKey: name as NSString) { return cached }
        guard let image = PhotoLibraryService.load(named: name) else { return nil }
        cache.setObject(image, forKey: name as NSString)
        return image
    }

    static func insert(_ image: UIImage, named name: String) {
        cache.setObject(image, forKey: name as NSString)
    }
}

// MARK: - 文案小工具

extension String {
    var surpriseTrimmed: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// 空串 → nil（提示是可选的）
    var surpriseOptional: String? {
        let trimmed = surpriseTrimmed
        return trimmed.isEmpty ? nil : trimmed
    }
}
