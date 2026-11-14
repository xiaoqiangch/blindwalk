import SwiftUI

/// 步迷 · watchOS 10 独立 App
///
/// 抬腕就能看旅程进度、线索与揭晓。表盘 198×242 逻辑像素（45mm），黑底 + 系统 SF 字体，
/// 版式与文案依据 docs/design-system.md §5.9 / §8。
///
/// 数据来源（两选一，运行时自动回退）：
/// 1. iPhone 通过 WatchConnectivity 的 `applicationContext` 推送 `WatchSessionSummary`
///    （见 WatchBridge.swift；到达前不下发地点名，避免提前泄露目的地）；
/// 2. 无连接（未配对 / 手机没开）时显示**空状态**：不编造地点，也不假装有进度。
///
/// 4 个页面（`TabView` 竖滑翻页）：进度 → 线索 → 揭晓 → 我的。
@main
@MainActor
struct WalkaholicWatchApp: App {

    /// `WalkaholicStore` 是 Shared/Core 里的 `@Observable @MainActor` 类，
    /// 而 SwiftUI 总在主线程创建 App；整个 App 标 `@MainActor` 让这层隔离保持一致，
    /// 不依赖各版本 watchOS SDK 对 `App.init` 是否标注主 actor。
    /// 手表自己不再构造演示档案：没有 iPhone 数据时显示空状态（见 WatchSessionSummary.disconnected）
    @State private var store: WalkaholicStore = WalkaholicStore()

    /// WCSession 摘要；未连接时回退空状态（见 WatchSessionSummary.disconnected）。
    @State private var bridge = WatchBridge()

    var body: some Scene {
        WindowGroup {
            WatchRootView(store: store, bridge: bridge)
        }
    }
}

/// 四个表盘的编号（TabView selection 用）
enum WatchPage: Int, Hashable, CaseIterable {
    case progress, hints, reveal, mine

    /// 截图/演示用：SIMCTL_CHILD_WA_WATCH_PAGE=progress|hints|reveal|mine
    static func preview(_ name: String) -> WatchPage? {
        switch name {
        case "progress": return .progress
        case "hints": return .hints
        case "reveal": return .reveal
        case "mine": return .mine
        default: return nil
        }
    }
}

/// 根容器：黑底、竖滑翻页。
///
/// - 到达（phase 变为 `arrived`）时自动翻到揭晓页并播一次「到达」触感；
/// - iPhone 已连接时，把 WCSession 摘要同步进共享 Store，界面仍然只读 Store。
struct WatchRootView: View {

    let store: WalkaholicStore
    let bridge: WatchBridge

    @State private var page: WatchPage = .progress

    var body: some View {
        TabView(selection: $page) {
            WatchProgressView(store: store) {
                page = .hints
            }
            .tag(WatchPage.progress)

            WatchHintsView(store: store)
                .tag(WatchPage.hints)

            WatchRevealView(store: store, bridge: bridge)
                .tag(WatchPage.reveal)

            WatchMineView(store: store, bridge: bridge)
                .tag(WatchPage.mine)
        }
        .tabViewStyle(.verticalPage)
        .background(Color.black.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .onAppear {
            bridge.activateIfNeeded()
            syncFromPhoneIfNeeded()
            if let name = ProcessInfo.processInfo.environment["WA_WATCH_PAGE"],
               let preview = WatchPage.preview(name) {
                page = preview
            }
        }
        .onChange(of: bridge.summary.generatedAt) { _, _ in
            syncFromPhoneIfNeeded()
        }
        .onChange(of: store.session?.phase.rawValue ?? "") { _, phase in
            // 到达 → 自动翻到揭晓页 + 一次「到达」触感（§5.9 / §8）
            guard phase == QuestPhase.arrived.rawValue else { return }
            page = .reveal
            Haptics.arrival()
        }
        .onChange(of: store.session?.unlockedHintCount ?? 0) { oldCount, newCount in
            // 新线索解锁 → 「咔哒」一下（§3 触感：解锁线索）
            if newCount > oldCount {
                Haptics.hintUnlocked()
            }
        }
    }

    /// 有 iPhone 连接时，用摘要里的会话覆盖本地演示会话（无连接时保持 DemoData）。
    /// `WalkaholicStore` 是 `@MainActor`，这里显式标注（调用点都在 body / onChange 里）。
    @MainActor
    private func syncFromPhoneIfNeeded() {
        guard bridge.source == .phone else { return }
        let summary = bridge.summary
        guard let place = PlaceDirectory.shared.place(id: summary.placeID) else { return }

        let phase = QuestPhase(rawValue: summary.phase) ?? .walking
        store.currentPlace = place
        store.session = QuestSession(
            id: store.session?.id ?? summary.placeID,
            placeID: summary.placeID,
            startedAt: summary.startedAt,
            totalMeters: summary.totalMeters,
            remainingMeters: summary.remainingMeters,
            phase: phase,
            unlockedHintCount: summary.unlockedHintCount
        )
        store.reveal = summary.isArrived
            ? Reveal(place: place, xpGained: 40 + place.rarity.xpBonus)
            : nil
    }
}
