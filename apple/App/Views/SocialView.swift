import SwiftUI
import UIKit

// MARK: - 圈子 Social（design-system §5.6）

struct SocialView: View {

    let store: BlindWalkStore

    @State private var toast: BWToast?
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
            BWPaperBackground()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    togetherCard
                    leaderboardSection()
                    feedSection()
                }
                .padding(.horizontal, BWTheme.pagePadding)
                .padding(.top, 8)
                .padding(.bottom, 28)
            }
        }
        .bwToast($toast)
        .toolbar(.hidden, for: .navigationBar)
    }

    // MARK: 顶栏

    private var header: some View {
        HStack(alignment: .center) {
            Text("圈子")
                .font(BWTheme.title(26))
                .foregroundStyle(BWTheme.ink)

            Spacer(minLength: 0)

            Button(action: refreshTogetherCode) {
                HStack(spacing: 4) {
                    Image(systemName: "waveform")
                        .font(.system(size: 11, weight: .semibold))
                    Text("同频")
                        .font(BWTheme.caption(12))
                }
                .foregroundStyle(BWTheme.ink2)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(BWTheme.paper)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(BWTheme.line, lineWidth: 1))
            }
            .buttonStyle(BWPressEffectStyle())
        }
    }

    // MARK: 同频码卡

    private var togetherCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text("今晚一起走？")
                    .font(BWTheme.title(20))
                    .foregroundStyle(BWTheme.ink)
                Spacer(minLength: 0)
                Image(systemName: "antenna.radiowaves.left.and.right")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(BWTheme.amberDeep)
            }

            HStack(spacing: 12) {
                Text(store.togetherCode)
                    .font(.system(size: 26, weight: .bold, design: .monospaced))
                    .tracking(6)
                    .foregroundStyle(BWTheme.ink)

                Spacer(minLength: 0)

                Button(action: copyTogetherCode) {
                    HStack(spacing: 4) {
                        Image(systemName: "doc.on.doc")
                            .font(.system(size: 11, weight: .semibold))
                        Text("复制")
                            .font(BWTheme.caption(11))
                    }
                    .foregroundStyle(BWTheme.ink)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(BWTheme.paper.opacity(0.75))
                    .clipShape(Capsule())
                }
                .buttonStyle(BWPressEffectStyle())
            }

            Text("好友输入同频码，各自开盒，结束后交换线索")
                .font(BWTheme.caption(11))
                .foregroundStyle(BWTheme.ink2)
        }
        .padding(18)
        .background(
            LinearGradient(
                colors: [
                    BWTheme.amber.opacity(0.42),
                    BWTheme.amberDeep.opacity(0.20),
                    BWTheme.paper2
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous)
                .stroke(BWTheme.amber.opacity(0.32), lineWidth: 1)
        )
        .shadow(color: BWTheme.ink.opacity(0.10), radius: 18, x: 0, y: 12)
    }

    // MARK: 本周榜

    private func leaderboardSection() -> some View {
        let entries = visibleLeaderboard

        return VStack(alignment: .leading, spacing: 10) {
            BWSectionHeader(title: "本周榜")

            VStack(spacing: 0) {
                ForEach(entries.indices, id: \.self) { index in
                    leaderboardRow(rank: index + 1, entry: entries[index])
                    if index != entries.count - 1 {
                        Rectangle()
                            .fill(BWTheme.line)
                            .frame(height: 1)
                            .padding(.leading, 46)
                    }
                }
            }
            .background(BWTheme.paper.opacity(0.7))
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(BWTheme.line, lineWidth: 1)
            )

            Button {
                withAnimation(BWAnimation.regular) {
                    showAllLeaderboard.toggle()
                }
            } label: {
                HStack(spacing: 4) {
                    Text(showAllLeaderboard ? "收起" : "展开全部")
                        .font(BWTheme.caption(11))
                    Image(systemName: showAllLeaderboard ? "chevron.up" : "chevron.down")
                        .font(.system(size: 9, weight: .semibold))
                }
                .foregroundStyle(BWTheme.amberDeep)
            }
            .buttonStyle(.plain)
        }
    }

    private func leaderboardRow(rank: Int, entry: LeaderboardEntry) -> some View {
        HStack(spacing: 12) {
            Text("\(rank)")
                .font(BWTheme.title(15))
                .monospacedDigit()
                .foregroundStyle(rank <= 3 ? BWTheme.amberDeep : BWTheme.ink3)
                .frame(width: 22)

            Text(entry.emoji)
                .font(.system(size: 18))
                .frame(width: 32, height: 32)
                .background(BWTheme.paper2)
                .clipShape(Circle())

            Text(entry.name)
                .font(BWTheme.body(14))
                .foregroundStyle(BWTheme.ink)

            if entry.isMe {
                Text("我")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(BWTheme.amberDeep)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(BWTheme.amber.opacity(0.18))
                    .clipShape(Capsule())
            }

            Spacer(minLength: 0)

            Text("\(entry.score)")
                .font(BWTheme.caption(13))
                .monospacedDigit()
                .foregroundStyle(BWTheme.ink2)
        }
        .padding(.vertical, 9)
        .padding(.horizontal, 12)
        .background(entry.isMe ? BWTheme.amber.opacity(0.08) : Color.clear)
    }

    private var visibleLeaderboard: [LeaderboardEntry] {
        let all = SocialFeed.leaderboard(profile: store.profile)
        return showAllLeaderboard ? all : Array(all.prefix(3))
    }

    // MARK: 动态流

    private func feedSection() -> some View {
        let posts = sortedPosts

        return VStack(alignment: .leading, spacing: 12) {
            BWSectionHeader(title: "大家的今晚")

            if posts.isEmpty {
                VStack(spacing: 8) {
                    Text("还没有人分享今晚的惊喜。")
                        .font(BWTheme.body(14))
                        .foregroundStyle(BWTheme.ink2)
                    Text("你可以是第一个。")
                        .font(BWTheme.caption(11))
                        .foregroundStyle(BWTheme.ink3)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 28)
                .background(BWTheme.paper.opacity(0.6))
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            } else {
                ForEach(posts) { post in
                    postCard(post)
                }
            }
        }
    }

    private func postCard(_ post: FeedPost) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Text(post.authorEmoji)
                    .font(.system(size: 18))
                    .frame(width: 32, height: 32)
                    .background(BWTheme.paper2)
                    .clipShape(Circle())

                VStack(alignment: .leading, spacing: 2) {
                    Text(post.authorName)
                        .font(BWTheme.caption(13))
                        .foregroundStyle(BWTheme.ink)
                    Text(BWFormat.relative(post.createdAt))
                        .font(.system(size: 9))
                        .foregroundStyle(BWTheme.ink3)
                }

                Spacer(minLength: 0)

                Text("揭晓")
                    .font(.system(size: 9, weight: .semibold))
                    .tracking(1)
                    .foregroundStyle(BWTheme.amberDeep)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(BWTheme.amber.opacity(0.14))
                    .clipShape(Capsule())
            }

            HStack(spacing: 10) {
                Text(post.categoryEmoji)
                    .font(.system(size: 20))
                VStack(alignment: .leading, spacing: 2) {
                    Text(post.placeName)
                        .font(BWTheme.caption(13))
                        .foregroundStyle(BWTheme.ink)
                    Text(post.rarity.label)
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(BWTheme.rarityColor(post.rarity))
                }
                Spacer(minLength: 0)
            }
            .padding(10)
            .background(BWTheme.paper2)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

            Text(post.caption)
                .font(BWTheme.body(13))
                .foregroundStyle(BWTheme.ink)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 8) {
                ForEach(0..<reactionOrder.count, id: \.self) { index in
                    reactionButton(for: post, key: reactionOrder[index])
                }
                Spacer(minLength: 0)
            }
        }
        .padding(16)
        .background(BWTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous)
                .stroke(BWTheme.line, lineWidth: 1)
        )
        .shadow(color: BWTheme.ink.opacity(0.06), radius: 12, x: 0, y: 8)
    }

    private func reactionButton(for post: FeedPost, key: String) -> some View {
        let count = post.reactions[key] ?? 0
        let identifier = "\(post.id)|\(key)"
        let isTapped = tappedReactions.contains(identifier)
        let emoji = reactionEmoji[key] ?? ""

        return Button {
            store.react(to: post.id, reaction: key)
            tappedReactions.insert(identifier)
            BWHaptics.light()
        } label: {
            HStack(spacing: 4) {
                if emoji.isEmpty {
                    Text(key)
                        .font(.system(size: 11))
                } else {
                    Text(emoji)
                        .font(.system(size: 12))
                }
                Text("\(count)")
                    .font(.system(size: 11, weight: .semibold))
                    .monospacedDigit()
            }
            .foregroundStyle(isTapped ? BWTheme.amberDeep : BWTheme.ink3)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(isTapped ? BWTheme.amber.opacity(0.16) : BWTheme.paper2)
            .clipShape(Capsule())
            .overlay(
                Capsule().stroke(
                    isTapped ? BWTheme.amber.opacity(0.4) : BWTheme.line,
                    lineWidth: 1
                )
            )
        }
        .buttonStyle(BWPressEffectStyle())
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
        BWHaptics.light()
        withAnimation(BWAnimation.regular) {
            toast = BWToast(text: "已复制同频码", icon: "doc.on.doc", tint: BWTheme.teal)
        }
    }

    private func refreshTogetherCode() {
        store.togetherCode = SocialFeed.makeTogetherCode()
        BWHaptics.light()
        withAnimation(BWAnimation.regular) {
            toast = BWToast(text: "同频码已更新", icon: "waveform")
        }
    }
}
