//
//  WatchSyncService.swift
//  BlindWalk（iOS 端）
//
//  iPhone → Apple Watch 的同步发送端（WatchConnectivity），与手表接收端
//  `WatchApp/WatchBridge.swift` 严格共用 `Shared/Core/WatchSessionSummary.swift` 的 Schema：
//    · 摘要一律由 `WatchSessionSummary.make(session:place:profile:todayCard:now:)` 生成
//      —— 它保证 `phase == walking` 时 placeName / rarity / areaLabel 全为 nil（目的地保密，§5.3）；
//    · 推送走 `updateApplicationContext`（只有一份最新快照，手表 `didReceiveApplicationContext` 收）；
//    · 手表打卡 `["blindwalk.checkIn": true, "at": 时间戳]` 由 `didReceiveMessage` / `didReceiveUserInfo` 收下，
//      通过 `onCheckIn` 回调给 App。
//
//  ── Lead 在 `BlindWalkApp.swift` 里的接入示例（约 6 行，其余都是自动同步）────────────
//  1) 属性：   @State private var watchSync = WatchSyncService()
//  2) onAppear：watchSync.start(store: store)          // ← 激活 + 立刻推首帧（冷启动 store 已有旅程时必须要）
//  3) 回调：   watchSync.onCheckIn = { date in _ = store.arriveNow(now: date) }   // 手表打卡 → 手机推进到到达
//  4) 同步：   .onChange(of: store.session?.remainingMeters ?? -1) { _, _ in watchSync.sync(store: store) }
//              .onChange(of: store.session?.phase.rawValue ?? "") { _, _ in watchSync.sync(store: store) }
//              .onChange(of: store.profile.boxesOpened) { _, _ in watchSync.sync(store: store) }
//  5) 角标：   WatchStatusChip(service: watchSync)        // 可放 HomeView 顶栏 / ProfileView
//  （若把 `WatchSyncService` 交给 `@State`，务必与 RootView 同层持有，不要在每个页面各建一个。）
//
//  注意：新文件需要出现在 Xcode target 里。本工程由 XcodeGen 生成 ——
//  `cd apple && xcodegen generate`（`sources: App` 会自动收录本文件）；
//  若手改 pbxproj，则需给 `App/Services/WatchSyncService.swift` 补 PBXBuildFile / PBXFileReference / Sources。
//
//  模拟器 / 未配对 / 不支持 WatchConnectivity 时安全降级：`isSupported == false` 或激活失败都只更新状态，
//  不抛异常、不阻塞主线程；此时 `push` 返回 false，摘要暂存在 `pendingSummary`，激活完成后自动补发。
//

import Foundation
import Observation
import WatchConnectivity

/// iOS 侧 WatchConnectivity 封装（发送端）。
///
/// 线程模型：整个类在 `@MainActor` 上；WCSessionDelegate 的回调来自后台队列，
/// 统一 `Task { @MainActor in ... }` 跳回主线程再改状态，UI 可直接用 Observation 跟踪。
@MainActor
@Observable
final class WatchSyncService: NSObject {

    // MARK: - 连接状态（暴露给 UI）

    /// 当前响应对应的聚合状态（`WatchStatusChip` 用它决定文案/颜色）
    enum ConnectionStatus: Equatable {
        /// 设备不支持 WatchConnectivity（如不支持的模拟器）
        case unsupported
        /// 配对里没有 Apple Watch
        case notPaired
        /// 配对了但手表上没装步谜
        case appNotInstalled
        /// 已配对已安装，但 WCSession 还没激活完成
        case activating
        /// 已激活，手表 App 此刻在前台可即时通讯
        case reachable
        /// 已激活，手表 App 不在前台（仍会通过 applicationContext 在后台送达）
        case unreachable
    }

    /// WatchConnectivity 是否可用（模拟器/老旧设备上可能 false）
    private(set) var isSupported: Bool = WCSession.isSupported()

    /// WCSession 激活状态（未激活 / 激活中 / 已激活）
    private(set) var activationState: WCSessionActivationState = .notActivated

    /// 是否已与 Apple Watch 配对
    private(set) var isPaired = false

    /// 手表 App 是否已安装
    private(set) var isWatchAppInstalled = false

    /// 手表 App 当前是否可达（可达时才走 sendMessage 即时通道）
    private(set) var isReachable = false

    /// 最近一次成功推送摘要的时间（= 摘要的 `generatedAt`）
    private(set) var lastSyncedAt: Date?

    /// 最近一次收到手表打卡的时间
    private(set) var lastCheckInAt: Date?

    /// 最近一次失败原因（调试/角标提示用；成功后自动清空）
    private(set) var lastErrorMessage: String?

    /// 最近一次推送出去的摘要（调试用，也可让 UI 显示「手表上现在是第几米」）
    private(set) var lastSentSummary: WatchSessionSummary?

    // MARK: - 回调 / 配置

    /// 手表打卡回调（主线程）。`date` 是手表点按的时间。
    @ObservationIgnored
    var onCheckIn: ((Date) -> Void)?

    /// 剩余距离去抖粒度：每变化满 N 米才推一次，避免每帧都写 applicationContext。
    /// 到达 / 换地点 / 线索解锁 / 阶段变化 / 档案计数变化会**无视**此粒度立即推送。
    @ObservationIgnored
    var meterBucket: Int = 10

    // MARK: - 内部

    private let wcSession: WCSession?

    /// 激活完成前要推的摘要；激活后自动补发（冷启动时 store 可能比 WCSession 先就绪）
    private var pendingSummary: WatchSessionSummary?

    /// 是否已经 `activate()` 过一次（WCSession 只允许激活一次，切换手表时由 delegate 复位）
    private var didRequestActivation = false

    // MARK: - 生命周期

    override init() {
        self.wcSession = WCSession.isSupported() ? WCSession.default : nil
        super.init()
        // 未激活时这些值可能是默认值（false），等 didActivate 回调再刷新
        refreshFlags()
    }

    /// 激活 WCSession（幂等；App 启动 / 根视图 onAppear 调一次即可）。
    func activateIfNeeded() {
        guard let wcSession else {
            lastErrorMessage = "此设备不支持 WatchConnectivity"
            refreshFlags()
            return
        }
        guard !didRequestActivation else { return }
        didRequestActivation = true
        wcSession.delegate = self
        wcSession.activate()
        refreshFlags()
    }

    // MARK: - 推送

    /// 推送一份已经构造好的摘要。
    ///
    /// - 未激活：记到 `pendingSummary`，激活完成后自动补发；
    /// - 已激活：`try updateApplicationContext(...)`，成功后更新 `lastSyncedAt`；失败只记录 `lastErrorMessage`。
    /// - Returns: 是否真的写入了 applicationContext。
    @discardableResult
    func push(summary: WatchSessionSummary) -> Bool {
        activateIfNeeded()
        guard let wcSession else {
            lastErrorMessage = "此设备不支持 WatchConnectivity"
            return false
        }
        guard wcSession.activationState == .activated else {
            // 冷启动竞态：先存着，激活完成后补发
            pendingSummary = summary
            return false
        }
        do {
            try wcSession.updateApplicationContext(summary.applicationContext())
            pendingSummary = nil
            lastSentSummary = summary
            lastSyncedAt = summary.generatedAt
            lastErrorMessage = nil
            refreshFlags()
            return true
        } catch {
            pendingSummary = summary
            lastErrorMessage = "推送失败：\(error.localizedDescription)"
            refreshFlags()
            return false
        }
    }

    /// 便捷同步：内部用 `WatchSessionSummary.make(...)` 生成摘要（walking 阶段自动隐藏地名），
    /// 再按去抖规则决定是否真正推送。
    ///
    /// - Parameters:
    ///   - session: 当前旅程；`nil`（没有进行中的旅程）时不下发，手表保持本地演示 / 上一帧
    ///   - place: 当前地点（目的地）；可为 nil（此时 emoji 用 📦 兜底）
    ///   - profile: 用户档案（连续天数 / 开盒数 / 今日卡）
    ///   - todayCard: 今日卡片；nil 时 `make` 会从 `profile.cards` 里取最近收录的一张
    /// - Returns: 生成的摘要（即使因为去抖没推，也返回给调用方做本地展示）
    @discardableResult
    func sync(
        session: QuestSession?,
        place: Place?,
        profile: Profile,
        todayCard: PlaceCard? = nil,
        now: Date = Date()
    ) -> WatchSessionSummary? {
        guard let session else {
            // 没有进行中的旅程：不推送（避免手表显示一个假的「0 米」旅程）。
            // 手表端 WatchBridge 在没有 applicationContext 时回退本地演示数据。
            return nil
        }
        let summary = WatchSessionSummary.make(
            session: session,
            place: place,
            profile: profile,
            todayCard: todayCard,
            now: now
        )
        if let last = lastSentSummary, !needsPush(from: last, to: summary) {
            return summary
        }
        push(summary: summary)
        return summary
    }

    /// 便捷同步（直接吃 store，接入时一行搞定）。
    @discardableResult
    func sync(store: BlindWalkStore, todayCard: PlaceCard? = nil) -> WatchSessionSummary? {
        sync(
            session: store.session,
            place: store.currentPlace,
            profile: store.profile,
            todayCard: todayCard
        )
    }

    /// 一步接入：**激活 + 立刻推一次当前状态**（根视图 `onAppear` 调这一个就够）。
    ///
    /// 冷启动时 `store` 往往已经有进行中的旅程（UserDefaults 恢复）而不会触发 onChange，
    /// 手表会一直停在它自己的本地演示 / 上一帧数据上。这个方法是唯一需要的「首帧推送」入口：
    /// 若 WCSession 还没激活，摘要会进 `pendingSummary`，激活回调里自动补发。
    func start(store: BlindWalkStore, todayCard: PlaceCard? = nil) {
        activateIfNeeded()
        forceSync(store: store, todayCard: todayCard)
    }

    /// 无视去抖，强制推送当前状态（例如回到前台、刚解锁线索、刚打卡后）。
    @discardableResult
    func forceSync(store: BlindWalkStore, todayCard: PlaceCard? = nil) -> WatchSessionSummary? {
        guard let session = store.session else { return nil }
        let summary = WatchSessionSummary.make(
            session: session,
            place: store.currentPlace,
            profile: store.profile,
            todayCard: todayCard
        )
        push(summary: summary)
        return summary
    }

    // MARK: - 状态

    /// 聚合连接状态
    var status: ConnectionStatus {
        guard isSupported else { return .unsupported }
        guard activationState == .activated else {
            return isPaired ? .activating : .notPaired
        }
        guard isPaired else { return .notPaired }
        guard isWatchAppInstalled else { return .appNotInstalled }
        return isReachable ? .reachable : .unreachable
    }

    /// 一行文案（UI 兜底用；`WatchStatusChip` 也用这个）
    var statusText: String {
        switch status {
        case .unsupported: return "此设备不支持手表同步"
        case .notPaired: return "未配对 Apple Watch"
        case .appNotInstalled: return "手表上还没装步谜"
        case .activating: return "正在连接手表…"
        case .reachable: return "手表已连接"
        case .unreachable: return "手表同步中"
        }
    }

    /// 是否处于「已经能同步」的状态（激活 + 配对 + 装了手表 App）
    var isWatchReady: Bool {
        activationState == .activated && isPaired && isWatchAppInstalled
    }

    // MARK: - 内部：去抖

    /// 摘要是否值得再推一次。
    /// `generatedAt` 每次都不同，因此不参与比较；剩余距离按 `meterBucket` 分桶。
    private func needsPush(from old: WatchSessionSummary, to new: WatchSessionSummary) -> Bool {
        // 保密相关 / 结构字段：任一变化立即推
        if old.phase != new.phase { return true }
        if old.placeID != new.placeID { return true }
        if old.placeName != new.placeName { return true }
        if old.rarity != new.rarity { return true }
        if old.areaLabel != new.areaLabel { return true }
        if old.totalMeters != new.totalMeters { return true }
        if old.startedAt != new.startedAt { return true }
        if old.unlockedHintCount != new.unlockedHintCount { return true }
        if old.hints != new.hints { return true }
        // 「我的」：连续天数 / 开盒数 / 今日卡
        if old.streakDays != new.streakDays { return true }
        if old.boxesOpened != new.boxesOpened { return true }
        if old.todayCardName != new.todayCardName { return true }
        if old.todayEmoji != new.todayEmoji { return true }
        // 走路进度：按米分桶，避免每帧写 applicationContext
        return bucket(old.remainingMeters) != bucket(new.remainingMeters)
    }

    private func bucket(_ meters: Int) -> Int {
        max(0, meters) / max(1, meterBucket)
    }

    // MARK: - 内部：激活 / 刷新

    private func refreshFlags() {
        guard let wcSession else {
            activationState = .notActivated
            isPaired = false
            isWatchAppInstalled = false
            isReachable = false
            return
        }
        activationState = wcSession.activationState
        isPaired = wcSession.isPaired
        isWatchAppInstalled = wcSession.isWatchAppInstalled
        isReachable = wcSession.isReachable
    }

    private func applyActivation(state: WCSessionActivationState, errorMessage: String?) {
        refreshFlags()
        if let errorMessage {
            lastErrorMessage = "激活失败：\(errorMessage)"
        }
        guard state == .activated else { return }
        // 激活前攒下的摘要，这时补发（冷启动常见）
        if let pendingSummary {
            push(summary: pendingSummary)
        }
    }

    // MARK: - 内部：打卡

    /// 解析手表消息里的打卡时间；兼容 Double / NSNumber / Date / Int。
    nonisolated static func checkInDate(from value: Any?) -> Date? {
        switch value {
        case let date as Date:
            return date
        case let number as NSNumber:
            return Date(timeIntervalSince1970: number.doubleValue)
        case let double as Double:
            return Date(timeIntervalSince1970: double)
        case let int as Int:
            return Date(timeIntervalSince1970: TimeInterval(int))
        default:
            return nil
        }
    }

    /// 识别并处理一条手表消息（`blindwalk.checkIn`）。
    /// - Returns: 若是打卡消息，返回打卡时间，否则 nil。
    @discardableResult
    nonisolated static func parseCheckIn(from message: [String: Any]) -> Date? {
        // 值可能是 Bool / NSNumber(true)，两种都接受
        let flag = (message["blindwalk.checkIn"] as? Bool)
            ?? (message["blindwalk.checkIn"] as? NSNumber)?.boolValue
        guard flag == true else { return nil }
        return checkInDate(from: message["at"]) ?? Date()
    }

    private func handleCheckIn(at date: Date) {
        lastCheckInAt = date
        lastErrorMessage = nil
        onCheckIn?(date)
    }
}

// MARK: - WCSessionDelegate
//
// 回调来自 WatchConnectivity 的后台队列：所有状态更新都跳回 MainActor。
// 模拟器未配对时 `activate()` 可能永远停留在 .notActivated 或回调 error，
// 这里只记录状态，不 fatalError、不阻塞。

extension WatchSyncService: WCSessionDelegate {

    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        let message = error?.localizedDescription
        Task { @MainActor [weak self] in
            self?.applyActivation(state: activationState, errorMessage: message)
        }
    }

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {
        Task { @MainActor [weak self] in
            self?.refreshFlags()
        }
    }

    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        // 用户换了另一只表：需要重新激活
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.didRequestActivation = false
            self.refreshFlags()
            self.activateIfNeeded()
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        let reachable = session.isReachable
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.isReachable = reachable
            self.refreshFlags()
        }
    }

    nonisolated func sessionWatchStateDidChange(_ session: WCSession) {
        Task { @MainActor [weak self] in
            self?.refreshFlags()
        }
    }

    /// 手表可达时的即时消息（`WatchBridge.sendCheckIn` 走这条）
    nonisolated func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any]
    ) {
        guard let date = Self.parseCheckIn(from: message) else { return }
        Task { @MainActor [weak self] in
            self?.handleCheckIn(at: date)
        }
    }

    nonisolated func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        guard let date = Self.parseCheckIn(from: message) else {
            replyHandler(["blindwalk.rejected": true])
            return
        }
        replyHandler([
            "blindwalk.checkIn.received": true,
            "at": Date().timeIntervalSince1970
        ])
        Task { @MainActor [weak self] in
            self?.handleCheckIn(at: date)
        }
    }

    /// 手表不可达时的兜底通道（`WatchBridge` 用 `transferUserInfo` 补送，可能延迟到达）
    nonisolated func session(
        _ session: WCSession,
        didReceiveUserInfo userInfo: [String: Any]
    ) {
        guard let date = Self.parseCheckIn(from: userInfo) else { return }
        Task { @MainActor [weak self] in
            self?.handleCheckIn(at: date)
        }
    }
}
