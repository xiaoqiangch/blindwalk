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
        ZStack {
            WAPaperBackground()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    togetherCard.padding(.top, 12)
                    leaderboardSection.padding(.top, 20)
                    feedSection.padding(.top, 20)
                }
                .padding(.horizontal, WATheme.pagePadding)
                .padding(.top, 6)
                .padding(.bottom, 26)
            }
        }
        .waToast($toast)
        .toolbar(.hidden, for: .navigationBar)
        .waTabBarChrome()
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

    // MARK: 顶栏

    private var header: some View {
        HStack(alignment: .center) {
            Text("圈子")
                .font(WAType.pageTitle())
                .foregroundStyle(WATheme.ink)

            Spacer(minLength: 0)

            Button(action: refreshTogetherCode) {
                HStack(spacing: 4) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.system(size: 11, weight: .medium))
                    Text("换一个")
                        .font(.system(size: 12.5))
                }
                .foregroundStyle(WATheme.ink2)
                .padding(.horizontal, 11)
                .frame(height: 30)
                .background(WATheme.paper)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(WATheme.line, lineWidth: 1))
            }
            .buttonStyle(WAPressEffectStyle())
            .accessibilityLabel("刷新同频码")
        }
        .padding(.bottom, 14)
    }

    // MARK: 同频码卡（web .codecard：整张琥珀卡 + 两圈细环装饰）

    private var togetherCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("今晚一起走")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.66))
                Spacer(minLength: 0)
                Text("同频码")
                    .font(.system(size: 11.5))
                    .foregroundStyle(Color.white.opacity(0.40))
            }

            Text(store.togetherCode)
                .font(.system(size: 30, weight: .semibold, design: .monospaced))
                .tracking(3)
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .padding(.top, 12)

            Text("朋友输这串码，各自开盒，回来交换线索")
                .font(.system(size: 12.5))
                .foregroundStyle(Color.white.opacity(0.58))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)

            Button(action: copyTogetherCode) {
                HStack(spacing: 5) {
                    Image(systemName: "doc.on.doc")
                        .font(.system(size: 11, weight: .medium))
                    Text("复制")
                        .font(.system(size: 13, weight: .medium))
                }
                .foregroundStyle(WATheme.ink)
                .padding(.horizontal, 14)
                .frame(height: 32)
                .background(Color.white)
                .clipShape(Capsule())
            }
            .buttonStyle(WAPressEffectStyle())
            .padding(.top, 16)
            .accessibilityLabel("复制同频码 \(store.togetherCode)")
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WATheme.ink)
        .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
    }

    // MARK: 本周榜

    private var leaderboardSection: some View {
        let entries = visibleLeaderboard

        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("本周榜")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(WATheme.ink)
                Spacer(minLength: 0)
                Text("惊喜指数")
                    .font(.system(size: 12))
                    .foregroundStyle(WATheme.ink3)
            }

            VStack(spacing: 0) {
                ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                    leaderboardRow(rank: rankOf(entry), entry: entry)
                }

                Button {
                    withAnimation(WAAnimation.regular) {
                        showAllLeaderboard.toggle()
                    }
                } label: {
                    Text(showAllLeaderboard ? "收起" : "其余 \(max(0, allLeaderboard.count - entries.count)) 位")
                        .font(.system(size: 12.5))
                        .foregroundStyle(WATheme.ink3)
                        .frame(maxWidth: .infinity)
                        .frame(height: 40)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 10)
            .background(WATheme.paper)
            .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous)
                    .stroke(WATheme.line, lineWidth: 1)
            )
        }
    }

    private func leaderboardRow(rank: Int, entry: LeaderboardEntry) -> some View {
        HStack(spacing: 10) {
            Text("\(rank)")
                .font(.system(size: 12, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(rankColor(rank))
                .frame(width: 16, alignment: .leading)

            Text(entry.emoji)
                .font(.system(size: 13))
                .frame(width: 26, height: 26)
                .background(WATheme.paper2)
                .clipShape(Circle())

            HStack(spacing: 5) {
                Text(entry.name)
                    .font(.system(size: 14, weight: entry.isMe ? .medium : .regular))
                    .foregroundStyle(WATheme.ink)
                    .lineLimit(1)
                if entry.isMe {
                    Text("你")
                        .font(.system(size: 11))
                        .foregroundStyle(WATheme.ink3)
                }
            }

            Spacer(minLength: 0)

            Text("\(entry.score)")
                .font(.system(size: 14, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(WATheme.ink)
        }
        .padding(.horizontal, 8)
        .frame(height: 44)
        .background(entry.isMe ? WATheme.amberSoft : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
    }

    private func rankColor(_ rank: Int) -> Color {
        switch rank {
        case 1: return WATheme.amberDeep
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

    // MARK: 动态流

    private var feedSection: some View {
        let posts = sortedPosts

        return VStack(alignment: .leading, spacing: 10) {
            Text("今晚的惊喜")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(WATheme.ink)

            if posts.isEmpty {
                WAEmptyState(
                    title: "还没有人分享今晚的惊喜。",
                    subtitle: "去开一个盲盒，把第一个留在这里。"
                )
            } else {
                ForEach(posts) { post in
                    postCard(post)
                }
            }
        }
    }

    private func postCard(_ post: FeedPost) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 9) {
                Text(post.authorEmoji)
                    .font(.system(size: 14))
                    .frame(width: 30, height: 30)
                    .background(WATheme.paper2)
                    .clipShape(Circle())

                VStack(alignment: .leading, spacing: 1) {
                    Text(post.authorName)
                        .font(.system(size: 13.5, weight: .medium))
                        .foregroundStyle(WATheme.ink)
                    Text(WAFormat.relative(post.createdAt))
                        .font(.system(size: 12))
                        .monospacedDigit()
                        .foregroundStyle(WATheme.ink3)
                }

                Spacer(minLength: 0)

                if post.isMine {
                    Text("你埋的")
                        .font(.system(size: 11))
                        .foregroundStyle(WATheme.ink3)
                }
            }
            .padding(.bottom, 10)

            HStack(spacing: 8) {
                Text(post.categoryEmoji)
                    .font(.system(size: 15))
                Text(post.placeName)
                    .font(.system(size: 13.5, weight: .medium))
                    .foregroundStyle(WATheme.ink)
                    .lineLimit(1)
                Spacer(minLength: 6)
                WARarityBadge(rarity: post.rarity)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(WATheme.paper2)
            .clipShape(RoundedRectangle(cornerRadius: WATheme.controlRadius, style: .continuous))

            Text(post.caption)
                .font(.system(size: 14))
                .foregroundStyle(WATheme.ink2)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 10)

            HStack(spacing: 6) {
                ForEach(0..<reactionOrder.count, id: \.self) { index in
                    reactionButton(for: post, key: reactionOrder[index])
                }
                Spacer(minLength: 0)
            }
            .padding(.top, 12)
        }
        .padding(14)
        .background(WATheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous)
                .stroke(WATheme.line, lineWidth: 1)
        )
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
                if emoji.isEmpty {
                    Text(key)
                        .font(.system(size: 12))
                } else {
                    Text(emoji)
                        .font(.system(size: 12))
                }
                Text("\(count)")
                    .font(.system(size: 12))
                    .monospacedDigit()
            }
            .foregroundStyle(isTapped ? WATheme.amberDeep : WATheme.ink2)
            .lineLimit(1)
            .padding(.horizontal, 10)
            .frame(height: 28)
            .background(isTapped ? WATheme.amberSoft : WATheme.paper2)
            .clipShape(Capsule())
            .overlay(
                Capsule().stroke(isTapped ? WATheme.amber.opacity(0.30) : Color.clear, lineWidth: 1)
            )
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
