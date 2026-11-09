import SwiftUI
import UIKit

// MARK: - 圈子 Social（design-system §5.6，视觉基准：web 原型 #/social）

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
                VStack(alignment: .leading, spacing: 0) {
                    header
                    togetherCard.padding(.top, 12)
                    leaderboardSection.padding(.top, 20)
                    feedSection.padding(.top, 20)
                }
                .padding(.horizontal, BWTheme.pagePadding)
                .padding(.top, 6)
                .padding(.bottom, 26)
            }
        }
        .bwToast($toast)
        .toolbar(.hidden, for: .navigationBar)
        .bwTabBarChrome()
        .bwTypeBounds()
        .onAppear {
            // 仅用于截图/演示：`BW_PREVIEW_TOAST=1` 启动即弹一次 toast，验证层级与位置
            guard ProcessInfo.processInfo.environment["BW_PREVIEW_TOAST"] == "1" else { return }
            bwAfter(1.6) {
                withAnimation(BWAnimation.regular) {
                    toast = BWToast(text: "已复制同频码", icon: "doc.on.doc", tint: BWTheme.teal)
                }
            }
        }
    }

    // MARK: 顶栏

    private var header: some View {
        HStack(alignment: .center) {
            Text("圈子")
                .font(BWType.pageTitle())
                .foregroundStyle(BWTheme.ink)

            Spacer(minLength: 0)

            Button(action: refreshTogetherCode) {
                Text("同频")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(BWTheme.ink2)
                    .padding(.horizontal, 14)
                    .frame(height: 30)
                    .background(BWTheme.paper)
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(BWTheme.line, lineWidth: 1))
            }
            .buttonStyle(BWPressEffectStyle())
            .accessibilityLabel("刷新同频码")
        }
        .padding(.bottom, 4)
    }

    // MARK: 同频码卡（web .codecard：整张琥珀卡 + 两圈细环装饰）

    private var togetherCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("今晚一起走？")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(BWTheme.ink)

            Text("把这串码给朋友，各自开盒。")
                .font(BWType.caption(10.5))
                .foregroundStyle(BWTheme.ink.opacity(0.58))
                .padding(.top, 2)

            HStack(alignment: .center, spacing: 12) {
                Text(store.togetherCode)
                    .font(.system(size: 25, weight: .bold, design: .default))
                    .monospacedDigit()
                    .tracking(3.2)
                    .foregroundStyle(BWTheme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)

                Spacer(minLength: 0)

                Button(action: copyTogetherCode) {
                    Text("复制")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(BWTheme.ink)
                        .padding(.horizontal, 15)
                        .frame(height: 34)
                        .background(BWTheme.paper.opacity(0.9))
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(BWTheme.ink.opacity(0.12), lineWidth: 1))
                }
                .buttonStyle(BWPressEffectStyle())
                .accessibilityLabel("复制同频码 \(store.togetherCode)")
            }
            .padding(.top, 12)
            .padding(.bottom, 10)

            Text("好友输入同频码，各自开盒，结束后交换线索")
                .font(.system(size: 12.5))
                .foregroundStyle(BWTheme.ink.opacity(0.62))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 18)
        .padding(.top, 17)
        .padding(.bottom, 15)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            ZStack(alignment: .topTrailing) {
                LinearGradient(
                    colors: [BWTheme.amber, BWTheme.amberDeep],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )

                Circle()
                    .stroke(BWTheme.ink.opacity(0.13), lineWidth: 1)
                    .frame(width: 150, height: 150)
                    .offset(x: 34, y: -46)

                Circle()
                    .stroke(BWTheme.paper.opacity(0.28), lineWidth: 1)
                    .frame(width: 92, height: 92)
                    .offset(x: -6, y: -20)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous))
        .shadow(color: BWTheme.amberDeep.opacity(0.30), radius: 22, x: 0, y: 12)
    }

    // MARK: 本周榜

    private var leaderboardSection: some View {
        let entries = visibleLeaderboard

        return VStack(alignment: .leading, spacing: 8) {
            BWSectionHeader(title: "本周榜", trailingTitle: "惊喜指数")

            VStack(spacing: 0) {
                ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                    leaderboardRow(rank: rankOf(entry), entry: entry)
                }

                Button {
                    withAnimation(BWAnimation.regular) {
                        showAllLeaderboard.toggle()
                    }
                } label: {
                    Text(showAllLeaderboard ? "收起" : "展开 · 其余 \(max(0, allLeaderboard.count - entries.count)) 位")
                        .font(.system(size: 12.5))
                        .foregroundStyle(BWTheme.ink3)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 6)
                        .padding(.bottom, 4)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(BWTheme.paper)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(BWTheme.line, lineWidth: 1)
            )
            .shadow(color: BWTheme.ink.opacity(0.04), radius: 14, x: 0, y: 8)
        }
    }

    private func leaderboardRow(rank: Int, entry: LeaderboardEntry) -> some View {
        HStack(spacing: 10) {
            Text("\(rank)")
                .font(.system(size: 12, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(rankColor(rank))
                .frame(width: 16)

            Text(entry.emoji)
                .font(.system(size: 14))
                .frame(width: 28, height: 28)
                .background(BWTheme.paper2)
                .clipShape(Circle())

            HStack(spacing: 5) {
                Text(entry.name)
                    .font(.system(size: 13.5, weight: .semibold))
                    .foregroundStyle(BWTheme.ink)
                    .lineLimit(1)
                if entry.isMe {
                    Text("你")
                        .font(.system(size: 11))
                        .tracking(0.4)
                        .foregroundStyle(BWTheme.ink3)
                }
            }

            Spacer(minLength: 0)

            Text("\(entry.score)")
                .font(.system(size: 13.5, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(BWTheme.ink)
        }
        .padding(.horizontal, 8)
        .frame(height: 42)
        .background(entry.isMe ? BWTheme.amber.opacity(0.13) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func rankColor(_ rank: Int) -> Color {
        switch rank {
        case 1: return BWTheme.amberDeep
        case 2: return BWTheme.ink2
        case 3: return BWTheme.amberDeep.opacity(0.65)
        default: return BWTheme.ink3
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
            BWSectionHeader(title: "今晚的惊喜")

            if posts.isEmpty {
                BWEmptyState(
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
                    .font(.system(size: 15))
                    .frame(width: 32, height: 32)
                    .background(BWTheme.paper2)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(BWTheme.line, lineWidth: 1))

                VStack(alignment: .leading, spacing: 1) {
                    Text(post.authorName)
                        .font(.system(size: 13.5, weight: .semibold))
                        .foregroundStyle(BWTheme.ink)
                    Text(BWFormat.relative(post.createdAt))
                        .font(.system(size: 12))
                        .monospacedDigit()
                        .foregroundStyle(BWTheme.ink3)
                }

                Spacer(minLength: 0)

                Text("揭晓")
                    .font(.system(size: 11))
                    .tracking(0.5)
                    .foregroundStyle(BWTheme.ink3)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .overlay(Capsule().stroke(BWTheme.line, lineWidth: 1))
            }
            .padding(.bottom, 9)

            HStack(spacing: 8) {
                Text(post.categoryEmoji)
                    .font(.system(size: 16))
                Text(post.placeName)
                    .font(.system(size: 13.5, weight: .semibold))
                    .foregroundStyle(BWTheme.ink)
                    .lineLimit(1)
                Spacer(minLength: 6)
                BWRarityBadge(rarity: post.rarity)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(BWTheme.paper2)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(BWTheme.line, lineWidth: 1)
            )

            Text(post.caption)
                .font(.system(size: 14))
                .foregroundStyle(BWTheme.ink2)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 9)

            HStack(spacing: 6) {
                ForEach(0..<reactionOrder.count, id: \.self) { index in
                    reactionButton(for: post, key: reactionOrder[index])
                }
                Spacer(minLength: 0)
            }
            .padding(.top, 10)
        }
        .padding(.horizontal, 14)
        .padding(.top, 12)
        .padding(.bottom, 13)
        .background(BWTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(BWTheme.line, lineWidth: 1)
        )
        .shadow(color: BWTheme.ink.opacity(0.04), radius: 12, x: 0, y: 6)
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
                        .font(.system(size: 12))
                } else {
                    Text(emoji)
                        .font(.system(size: 13))
                }
                Text("\(count)")
                    .font(.system(size: 12, weight: .semibold))
                    .monospacedDigit()
            }
            .foregroundStyle(isTapped ? BWTheme.ink : BWTheme.ink2)
            .lineLimit(1)
            .padding(.horizontal, 10)
            .frame(height: 28)
            .background(isTapped ? BWTheme.amber.opacity(0.20) : BWTheme.paper2)
            .clipShape(Capsule())
            .overlay(
                Capsule().stroke(
                    isTapped ? BWTheme.amber.opacity(0.6) : BWTheme.line,
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
