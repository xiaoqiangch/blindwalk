import SwiftUI

// MARK: - App 入口

@main
struct BlindWalkApp: App {

    /// MVP 演示开关：
    /// - true：用 `BlindWalkStore.demo()` 预置「已经用了 12 天 / 18 张卡 / 正在走第 3 个盲盒」的状态，
    ///   方便录屏与走查（design-system §7 的演示数据）。
    /// - false：走真实路径，从 UserDefaults 读回上次的 Profile（正式版默认）。
    private static let usesDemoData = true

    @State private var store: BlindWalkStore = BlindWalkApp.makeStore()

    var body: some Scene {
        WindowGroup {
            RootView(store: store)
                .preferredColorScheme(.light) // MVP 仅浅色（design-system §8）
        }
    }

    /// 真实的 init 路径保留在这里：不依赖任何演示数据。
    private static func makeStore() -> BlindWalkStore {
        if usesDemoData {
            let store = BlindWalkStore.demo()
            // 仅用于截图/演示：`SIMCTL_CHILD_BW_PREVIEW=reveal` 启动即到达并开盒
            let preview = ProcessInfo.processInfo.environment["BW_PREVIEW"] ?? ""
            if preview == "reveal" {
                _ = store.arriveNow()
                store.beginReveal()
            }
            // 真实定位链路自检：以当前（模拟器）定位为起点抽一个真实坐标的盲盒
            if preview == "live" {
                store.lastKnownOrigin = GeoPoint(latitude: 31.2304, longitude: 121.4737)
                _ = store.startQuest()
            }
            return store
        }
        let persistence = UserDefaultsProfileStore()
        let profile = persistence.loadProfile() ?? Profile()
        return BlindWalkStore(profile: profile, persistence: persistence)
    }
}

// MARK: - 底部 Tab

enum AppTab: Hashable {
    case home
    case cards
    case social
    case profile
}

// MARK: - 根视图
// 4 个 Tab：今日 / 图鉴 / 圈子 / 我的（design-system §4）。
// 旅程与揭晓用 fullScreenCover 全屏承载，盖住 Tab。

struct RootView: View {
    let store: BlindWalkStore

    @State private var selectedTab: AppTab = .home
    @State private var isSetupPresented = false
    @State private var isJourneyPresented = false

    /// iPhone → Apple Watch 同步（Shared/Core/WatchSessionSummary 共用 Schema）。
    /// 与 RootView 同层持有，全 App 只有这一个实例。
    @State private var watchSync = WatchSyncService()
    @Environment(\.scenePhase) private var scenePhase

    /// 仅用于截图/演示：SIMCTL_CHILD_BW_PREVIEW=journey|reveal|cards|social|profile
    private let previewScreen: String

    init(store: BlindWalkStore) {
        self.store = store
        let preview = ProcessInfo.processInfo.environment["BW_PREVIEW"] ?? ""
        self.previewScreen = preview
        let tab: AppTab
        switch preview {
        case "cards": tab = .cards
        case "social": tab = .social
        case "profile": tab = .profile
        default: tab = .home
        }
        _selectedTab = State(initialValue: tab)
        _isJourneyPresented = State(initialValue: ["journey", "reveal", "live"].contains(preview))
    }

    var body: some View {
        coreTabs
            .tint(BWTheme.amberDeep)
            .toolbarBackground(BWTheme.paper, for: .tabBar)
            .toolbarBackground(.visible, for: .tabBar)
            .sheet(isPresented: $isSetupPresented) { setupSheet }
            .fullScreenCover(isPresented: $isJourneyPresented) { journeyCover }
            .onAppear(perform: activateWatchSync)
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active else { return }
                watchSync.forceSync(store: store)
            }
            .onChange(of: store.session?.placeID ?? "") { _, _ in pushWatch() }
            .onChange(of: store.session?.remainingMeters ?? -1) { _, _ in pushWatch() }
            .onChange(of: store.session?.phase.rawValue ?? "") { _, _ in pushWatch() }
            .onChange(of: store.session?.unlockedHintCount ?? 0) { _, _ in pushWatch() }
            .onChange(of: store.profile.boxesOpened) { _, _ in pushWatch() }
            .onChange(of: store.profile.streakDays) { _, _ in pushWatch() }
    }

    // 拆成独立属性，避免 body 表达式过大导致 type-check 超时
    private var coreTabs: some View {
        TabView(selection: $selectedTab) {
            NavigationStack {
                HomeView(
                    store: store,
                    onOpenSetup: { isSetupPresented = true },
                    onOpenJourney: { isJourneyPresented = true },
                    onOpenCards: { selectedTab = .cards }
                )
            }
            .tabItem { Label("今日", systemImage: "shippingbox") }
            .tag(AppTab.home)

            NavigationStack { CardsView(store: store) }
                .tabItem { Label("图鉴", systemImage: "rectangle.stack") }
                .tag(AppTab.cards)

            NavigationStack { SocialView(store: store) }
                .tabItem { Label("圈子", systemImage: "person.2") }
                .tag(AppTab.social)

            NavigationStack { ProfileView(store: store) }
                .tabItem { Label("我的", systemImage: "person.crop.circle") }
                .tag(AppTab.profile)
        }
    }

    private var setupSheet: some View {
        BoxSetupSheet(
            store: store,
            onStart: {
                // 先关 sheet，稍等 dismiss 动画结束再全屏推入旅程
                isSetupPresented = false
                bwAfter(0.45) { isJourneyPresented = true }
            },
            onCancel: { isSetupPresented = false }
        )
    }

    private var journeyCover: some View {
        JourneyView(
            store: store,
            onClose: { isJourneyPresented = false },
            onCollected: { _ in
                // 收录完成：关闭旅程，切到图鉴页看新卡
                isJourneyPresented = false
                selectedTab = .cards
            }
        )
    }

    // MARK: 手表同步

    /// start(store:) = activateIfNeeded() + 立即推首帧。
    /// 只用 activateIfNeeded() 时，冷启动已有进行中旅程不会触发任何 onChange，
    /// 手表会永远停在它自己的本地演示数据上（sync-dev 实测：推送 0 次）。
    private func activateWatchSync() {
        watchSync.start(store: store)
        watchSync.onCheckIn = { date in
            // 手表上「轻点打卡」= 用户确认到达
            _ = store.arriveNow(now: date)
        }
    }

    private func pushWatch() {
        watchSync.sync(store: store)
    }
}
