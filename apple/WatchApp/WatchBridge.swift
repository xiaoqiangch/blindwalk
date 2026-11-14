import Foundation
import Observation
import WatchConnectivity

/// WatchConnectivity 骨架（接收端）。
///
/// - 摘要类型 `WatchSessionSummary` 在 `Shared/Core/WatchSessionSummary.swift`，
///   iOS 发送端（v0.2，见 docs/roadmap.md）会复用同一 Schema；
/// - 激活成功后读取 `session.applicationContext` 里的摘要；
/// - 收到新 context 时在主线程更新（SwiftUI 用 Observation 直接跟踪变化）；
/// - 未激活 / 没有数据（模拟器、未配对、纯演示）时回退 `WatchSessionSummary.demo()`。
@Observable
final class WatchBridge: NSObject {

    /// 当前数据来源（「我的」页脚展示，也方便调试）
    enum Source: String {
        case connecting = "连接中"
        case phone = "iPhone"
        case demo = "本地演示"
    }

    private(set) var summary: WatchSessionSummary
    private(set) var source: Source = .connecting
    private(set) var lastSyncedAt: Date?
    private(set) var lastCheckInAt: Date?

    private let wcSession: WCSession?

    override init() {
        self.wcSession = WCSession.isSupported() ? WCSession.default : nil
        self.summary = WatchSessionSummary.disconnected()
        super.init()
    }

    /// 根视图 onAppear 时调用（同一 WCSession 只激活一次）
    func activateIfNeeded() {
        guard let wcSession, wcSession.delegate == nil else { return }
        wcSession.delegate = self
        wcSession.activate()
    }

    /// 打卡回传：可达时 sendMessage，否则 transferUserInfo（离线也会补送）
    func sendCheckIn(at date: Date = Date()) {
        lastCheckInAt = date
        guard let wcSession, wcSession.activationState == .activated else { return }

        let payload: [String: Any] = [
            "walkaholic.checkIn": true,
            "at": date.timeIntervalSince1970
        ]
        if wcSession.isReachable {
            wcSession.sendMessage(payload, replyHandler: nil, errorHandler: nil)
        } else {
            wcSession.transferUserInfo(payload)
        }
    }

    // MARK: 内部

    private func apply(applicationContext: [String: Any]) {
        guard let received = WatchSessionSummary(applicationContext: applicationContext) else {
            // 手机还没推送过摘要：保持在本地演示态
            if source != .phone { source = .demo }
            return
        }
        summary = received
        source = .phone
        lastSyncedAt = Date()
    }
}

// MARK: - WCSessionDelegate

extension WatchBridge: WCSessionDelegate {

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        let context = session.applicationContext
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard activationState == .activated else {
                // 模拟器 / 未配对 / 激活失败 → 本地演示数据
                if self.source != .phone { self.source = .demo }
                return
            }
            self.apply(applicationContext: context)
        }
    }

    func session(
        _ session: WCSession,
        didReceiveApplicationContext applicationContext: [String: Any]
    ) {
        DispatchQueue.main.async { [weak self] in
            self?.apply(applicationContext: applicationContext)
        }
    }
}
