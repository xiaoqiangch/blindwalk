//
//  WatchStatusChip.swift
//  BlindWalk（iOS 端）
//
//  「手表连接」小角标：显示 手表已连接 / 同步中 / 未配对 / 不支持。
//  纯展示组件，状态全部来自 `WatchSyncService`（Observation 自动跟踪变化），
//  不持有 service、不发任何 WCSession 调用，可安全放在任何页面顶栏。
//
//  用法（Lead 在 BlindWalkApp.swift / HomeView 里接）：
//      WatchStatusChip(service: watchSync)                       // 默认紧凑样式
//      WatchStatusChip(service: watchSync, showsLastSync: true)  // 带「刚刚 / 3 分钟前」
//
//  默认不占位（未配对时也会显示灰点提示），若只想在有手表时显示，用
//  `if watchSync.isSupported { WatchStatusChip(...) }` 或 `WatchStatusChip(service:hidesWhenUnavailable: true)`。
//

import SwiftUI

/// 手表连接角标（胶囊）。颜色语义与 design-system §3 一致：
/// 能用 → teal（活着），连接中 → amber（暖），不可用 → ink3（灰）。
struct WatchStatusChip: View {

    let service: WatchSyncService

    /// 是否在文案后追加「最近同步」相对时间
    var showsLastSync: Bool = false

    /// 不支持 / 未配对时是否隐藏（默认显示灰态，便于发现「手表没连上」）
    var hidesWhenUnavailable: Bool = false

    var body: some View {
        Group {
            if hidesWhenUnavailable && !service.isWatchReady {
                EmptyView()
            } else {
                chip
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    // MARK: - 主体

    private var chip: some View {
        HStack(spacing: 5) {
            Image(systemName: iconName)
                .font(.system(size: 10.5, weight: .semibold))
                .foregroundStyle(tint)
                .symbolEffect(.pulse, isActive: isConnecting)

            Circle()
                .fill(tint)
                .frame(width: 5, height: 5)
                .opacity(isActive ? 1 : 0.45)

            Text(text)
                .font(BWTheme.caption(11))
                .foregroundStyle(isActive ? BWTheme.ink2 : BWTheme.ink3)
                .lineLimit(1)

            if showsLastSync, let synced = service.lastSyncedAt, isActive {
                Text("· \(BWFormat.relative(synced))")
                    .font(BWTheme.caption(11))
                    .foregroundStyle(BWTheme.ink3)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(background)
        .clipShape(Capsule())
        .overlay(
            Capsule().stroke(tint.opacity(isActive ? 0.35 : 0.22), lineWidth: 1)
        )
        .fixedSize()
    }

    // MARK: - 状态映射

    private var status: WatchSyncService.ConnectionStatus { service.status }

    private var isActive: Bool {
        status == .reachable || status == .unreachable || status == .activating
    }

    private var isConnecting: Bool {
        status == .activating || status == .unreachable
    }

    private var tint: Color {
        switch status {
        case .reachable:
            return BWTheme.teal
        case .activating, .unreachable:
            return BWTheme.amberDeep
        case .notPaired, .appNotInstalled, .unsupported:
            return BWTheme.ink3
        }
    }

    private var background: Color {
        switch status {
        case .reachable:
            return BWTheme.teal.opacity(0.10)
        case .activating, .unreachable:
            return BWTheme.amber.opacity(0.12)
        case .notPaired, .appNotInstalled, .unsupported:
            return BWTheme.paper2
        }
    }

    private var iconName: String {
        switch status {
        case .reachable:
            return "applewatch.radiowaves.left.and.right"
        case .activating, .unreachable:
            return "applewatch"
        case .notPaired:
            return "applewatch.slash"
        case .appNotInstalled:
            return "arrow.down.app"
        case .unsupported:
            return "applewatch.slash"
        }
    }

    /// 文案：正常态尽量短（角标只占一行）；异常态给一句可读的解释。
    private var text: String {
        switch status {
        case .reachable:
            return "手表已连接"
        case .unreachable:
            return "手表同步中"
        case .activating:
            return "连接手表…"
        case .notPaired:
            return "未配对手表"
        case .appNotInstalled:
            return "手表未安装"
        case .unsupported:
            return "不支持手表"
        }
    }

    private var accessibilityText: String {
        var parts = [service.statusText]
        if let error = service.lastErrorMessage {
            parts.append(error)
        }
        if let synced = service.lastSyncedAt {
            parts.append("最近同步 \(BWFormat.relative(synced))")
        }
        return parts.joined(separator: "，")
    }
}

// MARK: - 预览

#Preview("手表角标") {
    let service = WatchSyncService()
    return VStack(alignment: .leading, spacing: 12) {
        WatchStatusChip(service: service)
        WatchStatusChip(service: service, showsLastSync: true)
    }
    .padding()
    .background(BWTheme.paper)
}
