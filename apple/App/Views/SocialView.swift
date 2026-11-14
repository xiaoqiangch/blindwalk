import SwiftUI
import UIKit

// MARK: - 圈子 Social（design-system §5.6，视觉基准：web 原型 #/social）

struct SocialView: View {

    let store: WalkaholicStore

    @State private var toast: WAToast?
    @State private var tappedReactions: Set<String> = []
    @State private var showAllLeaderboard = false

    private let reactionOrder = ["羡慕", "一起", "下次带我"]
    private let reactionEmoji: [String: String] = [
        "羡慕": "👀",
        "一起": "🫶",
        "下次带我": ""
    ]

    var body: some View {
        List {
            Section {
                togetherCard
                    .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16))
                    .listRowBackground(Color.clear)
            }

            Section {
                ForEach(Array(visibleLeaderboard.enumerated()), id: \.element.id) { index, entry in
                    leaderboardRow(rank: rankOf(entry), entry: entry)
                }
                Button {
                    withAnimation { showAllLeaderboard.toggle() }
                } label: {
                    Text(showAllLeaderboard ? "收起" : "其余 \(max(0, allLeaderboard.count - visibleLeaderboard.count)) 位")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)
                .foregroundStyle(WATheme.amber)
            } header: {
                HStack {
                    Text("本周榜")
                    Spacer()
                    Text("惊喜指数").textCase(nil)
                        .font(.footnote)
                        .foregroundStyle(WATheme.ink2)
                }
            }

            Section("今晚的惊喜") {
                if sortedPosts.isEmpty {
                    Text("还没有人分享今晚的惊喜。")
                        .foregroundStyle(WATheme.ink2)
                } else {
                    ForEach(sortedPosts) { post in
                        postRow(post)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .background(WATheme.cream)
        .navigationTitle("圈子")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(action: refreshTogetherCode) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                }
                .accessibilityLabel("刷新同频码")
            }
        }
        .waToast($toast)
        .waTypeBounds()
        .onAppear {
            // 仅用于截图/演示：`WA_PREVIEW_TOAST=1` 启动即弹一次 toast，验证层级与位置
            guard ProcessInfo.processInfo.environment["WA_PREVIEW_TOAST"] == "1" else { return }
            waAfter(1.6) {
                withAnimation(WAAnimation.regular) {
                    toast = WAToast(text: "已复制同频码", icon: "doc.on.doc", tint: WATheme.teal)
                }
            }
        }
    }

    // MARK: 同频码卡（系统大号颜色卡：tint 底 + 白字）

    private var togetherCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("今晚一起走")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white.opacity(0.8))
                Spacer(minLength: 0)
                Text("同频码")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.6))
            }

            Text(store.togetherCode)
                .font(.system(.title, design: .monospaced).weight(.bold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .textSelection(.enabled)

            Text("朋友输这串码，各自开盒，回来交换线索")
                .font(.footnote)
                .foregroundStyle(.white.opacity(0.75))
                .fixedSize(horizontal: false, vertical: true)

            Button(action: copyTogetherCode) {
                Label("复制", systemImage: "doc.on.doc")
                    .font(.subheadline.weight(.medium))
            }
            .buttonStyle(.borderedProminent)
            .tint(.white)
            .foregroundStyle(WATheme.amber)
            .padding(.top, 4)
            .accessibilityLabel("复制同频码 \(store.togetherCode)")
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WATheme.amber)
        .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
    }

    // MARK: 本周榜

    private func leaderboardRow(rank: Int, entry: LeaderboardEntry) -> some View {
        HStack(spacing: 10) {
            Text("\(rank)")
                .font(.footnote.weight(.medium))
                .monospacedDigit()
                .foregroundStyle(rankColor(rank))
                .frame(width: 18, alignment: .leading)

            Text(entry.emoji)
                .font(.footnote)
                .frame(width: 28, height: 28)
                .background(Color(.secondarySystemFill))
                .clipShape(Circle())

            HStack(spacing: 6) {
                Text(entry.name)
                    .font(.body)
                    .lineLimit(1)
                if entry.isMe {
                    Text("你")
                        .font(.caption)
                        .foregroundStyle(WATheme.ink2)
                }
            }

            Spacer(minLength: 0)

            Text("\(entry.score)")
                .font(.body.weight(.medium))
                .monospacedDigit()
                .foregroundStyle(WATheme.ink2)
        }
        .padding(.vertical, 2)
    }

    private func rankColor(_ rank: Int) -> Color {
        switch rank {
        case 1: return WATheme.amber
        case 2, 3: return WATheme.ink2
        default: return WATheme.ink3
        }
    }

    private var allLeaderboard: [LeaderboardEntry] {
        SocialFeed.leaderboard(profile: store.profile)
    }

    /// 收起时展示前三名 + 自己（web 同款）
    private var visibleLeaderboard: [LeaderboardEntry] {
        let all = allLeaderboard
        guard !showAllLeaderboard else { return all }
        var collapsed = Array(all.prefix(3))
        if let me = all.first(where: { $0.isMe }), !collapsed.contains(where: { $0.isMe }) {
            collapsed.append(me)
        }
        return collapsed
    }

    private func rankOf(_ entry: LeaderboardEntry) -> Int {
        (allLeaderboard.firstIndex(of: entry) ?? 0) + 1
    }

    private func postRow(_ post: FeedPost) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Text(post.authorEmoji)
                    .font(.footnote)
                    .frame(width: 32, height: 32)
                    .background(Color(.secondarySystemFill))
                    .clipShape(Circle())

                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 6) {
                        Text(post.authorName)
                            .font(.subheadline.weight(.semibold))
                        if post.isMine {
                            Text("你埋的")
                                .font(.caption2)
                                .foregroundStyle(WATheme.ink2)
                        }
                    }
                    Text(WAFormat.relative(post.createdAt))
                        .font(.caption)
                        .monospacedDigit()
                        .foregroundStyle(WATheme.ink2)
                }

                Spacer(minLength: 0)

                WARarityBadge(rarity: post.rarity)
            }

            HStack(spacing: 6) {
                Text(post.categoryEmoji)
                    .font(.subheadline)
                Text(post.placeName)
                    .font(.subheadline)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }

            Text(post.caption)
                .font(.subheadline)
                .foregroundStyle(WATheme.ink2)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 8) {
                ForEach(0..<reactionOrder.count, id: \.self) { index in
                    reactionButton(for: post, key: reactionOrder[index])
                }
                Spacer(minLength: 0)
            }
            .padding(.top, 2)
        }
        .padding(.vertical, 4)
    }

    private func reactionButton(for post: FeedPost, key: String) -> some View {
        let count = post.reactions[key] ?? 0
        let identifier = "\(post.id)|\(key)"
        let isTapped = tappedReactions.contains(identifier)
        let emoji = reactionEmoji[key] ?? ""

        return Button {
            store.react(to: post.id, reaction: key)
            tappedReactions.insert(identifier)
            WAHaptics.light()
        } label: {
            HStack(spacing: 4) {
                if !emoji.isEmpty {
                    Text(emoji)
                        .font(.footnote)
                }
                Text(key)
                    .font(.footnote)
                Text("\(count)")
                    .font(.footnote)
                    .monospacedDigit()
            }
            .foregroundStyle(isTapped ? Color.white : WATheme.ink)
            .lineLimit(1)
            .padding(.horizontal, 10)
            .frame(height: 28)
            .background(isTapped ? WATheme.amber : Color(.secondarySystemFill))
            .clipShape(Capsule())
        }
        .buttonStyle(WAPressEffectStyle())
        .accessibilityLabel("\(key) \(count)")
    }

    /// 本人发布的动态置顶，其余按时间倒序
    private var sortedPosts: [FeedPost] {
        store.feed.sorted { lhs, rhs in
            if lhs.isMine != rhs.isMine {
                return lhs.isMine
            }
            return lhs.createdAt > rhs.createdAt
        }
    }

    // MARK: 操作

    private func copyTogetherCode() {
        UIPasteboard.general.string = store.togetherCode
        WAHaptics.light()
        withAnimation(WAAnimation.regular) {
            toast = WAToast(text: "已复制同频码", icon: "doc.on.doc", tint: WATheme.teal)
        }
    }

    private func refreshTogetherCode() {
        store.togetherCode = SocialFeed.makeTogetherCode()
        WAHaptics.light()
        withAnimation(WAAnimation.regular) {
            toast = WAToast(text: "同频码已更新", icon: "waveform")
        }
    }
}
