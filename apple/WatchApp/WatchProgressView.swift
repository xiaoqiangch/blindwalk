import Foundation
import SwiftUI

/// §5.9 表盘 1「进度」
///
/// 顶部小字「盲盒进行中」+ 计时（00:12:34）；进度环 62%；
/// 环内大数字「480 m」；底部「线索 1/3 · 点按查看」→ 翻到线索页。
@MainActor
struct WatchProgressView: View {

    let store: WalkaholicStore
    var onOpenHints: () -> Void = {}

    private var session: QuestSession? { store.session }
    private var progress: Double { session?.progress ?? 0 }
    private var remaining: Int { session?.remainingMeters ?? 0 }
    private var walked: Int { max(0, (session?.totalMeters ?? 0) - remaining) }
    private var unlockedHints: Int { session?.unlockedHintCount ?? 0 }
    private var totalHints: Int { store.currentPlace?.hints.count ?? 3 }

    var body: some View {
        VStack(spacing: 5) {
            header
            ring
            Spacer(minLength: 0)
            Button(action: onOpenHints) {
                Text("线索 \(unlockedHints)/\(totalHints) · 点按查看")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(WATheme.amber)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("查看线索，已解锁 \(unlockedHints) 条，共 \(totalHints) 条")
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .watchScreen()
    }

    // MARK: 顶部

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text("盲盒进行中")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.white.opacity(0.9))
                .lineLimit(1)

            Spacer(minLength: 2)

            TimelineView(.periodic(from: .now, by: 1)) { context in
                Text(Self.elapsed(from: session?.startedAt ?? context.date, to: context.date))
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.55))
            }
        }
    }

    private static func elapsed(from start: Date, to now: Date) -> String {
        WatchFormat.clock(from: start, to: now)
    }

    // MARK: 进度环 + 大数字

    private var ring: some View {
        ZStack {
            Circle()
                .stroke(Color.white.opacity(0.12), lineWidth: 10)

            Circle()
                .trim(from: 0, to: max(0.004, min(1, progress)))
                .stroke(
                    AngularGradient(
                        colors: [WATheme.amber, WATheme.ember],
                        center: .center
                    ),
                    style: StrokeStyle(lineWidth: 10, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .animation(.easeOut(duration: 0.32), value: progress)

            VStack(spacing: 1) {
                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text("\(remaining)")
                        .font(.system(size: 42, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    Text("m")
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.7))
                }

                Text("已走 \(walked) m · \(WatchFormat.percent(progress))")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(.white.opacity(0.45))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .frame(maxWidth: 100)
        }
        .frame(width: 122, height: 122)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("还剩 \(remaining) 米，进度 \(WatchFormat.percent(progress))")
    }
}
