import Foundation
import SwiftUI

/// 「我的」表盘（第 4 页，配合 §5.9 的手表信息密度）
///
/// 一眼可读：今日卡（类别 emoji + 卡名）、连续天数、总盒数、数据来源。
/// iPhone 已连接时显示 WCSession 摘要里的数据，否则用 `BlindWalkStore.demo()`。
@MainActor
struct WatchMineView: View {

    let store: BlindWalkStore
    let bridge: WatchBridge

    private var isPhoneDriven: Bool { bridge.source == .phone }
    private var streakDays: Int { isPhoneDriven ? bridge.summary.streakDays : store.profile.streakDays }
    private var boxesOpened: Int { isPhoneDriven ? bridge.summary.boxesOpened : store.profile.boxesOpened }

    private var todayEmoji: String {
        isPhoneDriven ? bridge.summary.todayEmoji : (localTodayPlace?.emoji ?? "📦")
    }

    private var todayName: String {
        isPhoneDriven ? bridge.summary.todayCardName : (localTodayPlace?.name ?? "还没收录卡片")
    }

    /// 演示数据里最近收录的一张卡
    private var localTodayPlace: Place? {
        guard let card = store.profile.cards.max(by: { $0.collectedAt < $1.collectedAt }) else {
            return nil
        }
        return PlaceCatalog.place(id: card.placeID)
    }

    private var syncNote: String {
        switch bridge.source {
        case .connecting:
            return "正在连接 iPhone…"
        case .phone:
            if let syncedAt = bridge.lastSyncedAt {
                return "已同步 iPhone · \(WatchFormat.time(syncedAt))"
            }
            return "已同步 iPhone"
        case .demo:
            return "本地演示数据"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("我的")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(BWTheme.amber)
                .accessibilityAddTraits(.isHeader)

            todayCard

            HStack(spacing: 6) {
                stat(emoji: "🔥", value: "\(streakDays)", unit: "天", label: "连续")
                stat(emoji: "📦", value: "\(boxesOpened)", unit: "盒", label: "总盒数")
            }

            Spacer(minLength: 0)

            Text(syncNote)
                .font(.system(size: 9))
                .foregroundStyle(.white.opacity(0.35))
                .lineLimit(1)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .watchScreen(.topLeading)
    }

    // MARK: 今日卡

    private var todayCard: some View {
        HStack(spacing: 8) {
            Text(todayEmoji)
                .font(.system(size: 24))

            VStack(alignment: .leading, spacing: 1) {
                Text("今日卡")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(.white.opacity(0.45))
                Text(todayName)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .minimumScaleFactor(0.75)
            }

            Spacer(minLength: 0)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(BWTheme.amber.opacity(0.14))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(BWTheme.amber.opacity(0.25), lineWidth: 1)
        )
    }

    // MARK: 统计小卡

    private func stat(emoji: String, value: String, unit: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label)
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(.white.opacity(0.45))
                .lineLimit(1)

            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(emoji)
                    .font(.system(size: 13))
                Text(value)
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(unit)
                    .font(.system(size: 10))
                    .foregroundStyle(.white.opacity(0.6))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(7)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.white.opacity(0.08))
        )
    }
}
