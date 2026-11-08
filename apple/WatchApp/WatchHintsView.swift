import SwiftUI

/// §5.9 表盘 2「线索」
///
/// 三条线索：已解锁的实心卡可读，未解锁的虚线卡只显示「…」。
/// 顶部「线索 · n/3」按会话解锁数显示（§5.3：起点第 1 条，≤200m 第 2 条，≤60m 第 3 条；
/// 演示会话剩余 480m，所以是「线索 · 1/3」）。
@MainActor
struct WatchHintsView: View {

    let store: BlindWalkStore

    private var session: QuestSession? { store.session }
    private var place: Place? { store.reveal?.place ?? store.currentPlace }
    private var hints: [String] { place?.hints ?? [] }
    private var unlocked: Int { min(session?.unlockedHintCount ?? 0, totalHints) }
    private var totalHints: Int { max(hints.count, 3) }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("线索 · \(unlocked)/\(totalHints)")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(BWTheme.amber)
                .accessibilityAddTraits(.isHeader)

            ScrollView {
                VStack(spacing: 5) {
                    ForEach(Array(0..<totalHints), id: \.self) { index in
                        hintRow(index: index)
                    }
                }
            }
            .scrollIndicators(.hidden)

            if let session, session.phase == .walking, unlocked < totalHints {
                Text(session.nextHintCopy)
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(.white.opacity(0.4))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .watchScreen(.topLeading)
    }

    // MARK: 单条线索

    @ViewBuilder
    private func hintRow(index: Int) -> some View {
        let isUnlocked = index < unlocked
        let text = isUnlocked ? hintText(at: index) : "…"

        HStack(alignment: .top, spacing: 6) {
            Image(systemName: isUnlocked ? "checkmark.circle.fill" : "lock.fill")
                .font(.system(size: isUnlocked ? 10 : 9, weight: .semibold))
                .foregroundStyle(isUnlocked ? BWTheme.teal : Color.white.opacity(0.35))
                .padding(.top, 1)

            Text(text)
                .font(.system(size: 11, weight: isUnlocked ? .medium : .regular))
                .foregroundStyle(isUnlocked ? Color.white : Color.white.opacity(0.35))
                .lineLimit(2)
                .minimumScaleFactor(0.8)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(isUnlocked ? Color.white.opacity(0.10) : Color.white.opacity(0.03))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(
                    isUnlocked ? Color.clear : Color.white.opacity(0.22),
                    style: StrokeStyle(lineWidth: 1, dash: isUnlocked ? [] : [3, 3])
                )
        )
    }

    private func hintText(at index: Int) -> String {
        guard hints.indices.contains(index) else { return "…" }
        return hints[index]
    }
}
