import SwiftUI

// MARK: - 今日 Home（design-system §5.1，视觉基准：web 原型 #/home）

struct HomeView: View {

    let store: BlindWalkStore
    var onOpenSetup: () -> Void

    /// 折叠屏展开态 / iPad 走宽屏双列；常规 iPhone 是 .compact
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    var onOpenJourney: () -> Void
    var onOpenCards: () -> Void

    private struct Friend: Identifiable {
        let id: String
        let name: String
        let emoji: String
        let isOnline: Bool
    }

    private let friends: [Friend] = [
        Friend(id: "f1", name: "小满", emoji: "🐱", isOnline: false),
        Friend(id: "f2", name: "阿岛", emoji: "🎧", isOnline: false),
        Friend(id: "f3", name: "77", emoji: "🌙", isOnline: true),
        Friend(id: "f4", name: "老陈", emoji: "🍜", isOnline: false)
    ]

    var body: some View {
        ZStack {
            BWPaperBackground()

            ScrollView(showsIndicators: false) {
                    Group {
                        if isWideLayout {
                            // 展开态：左「盲盒主卡」右「统计 + 好友 + 上一次 + 惊喜社区」
                            VStack(alignment: .leading, spacing: 0) {
                                topBar
                                hero
                                HStack(alignment: .top, spacing: 22) {
                                    VStack(alignment: .leading, spacing: 0) {
                                        blindBoxCard
                                        lastSurpriseSection.padding(.top, 18)
                                    }
                                    VStack(alignment: .leading, spacing: 0) {
                                        statsRow
                                        friendsRow.padding(.top, 22)
                                        SurpriseHubCard(store: store).padding(.top, 22)
                                    }
                                }
                            }
                        } else {
                            VStack(alignment: .leading, spacing: 0) {
                                topBar
                                hero
                                blindBoxCard
                                statsRow.padding(.top, 20)
                                friendsRow.padding(.top, 22)
                                lastSurpriseSection.padding(.top, 20)
                                // 惊喜社区入口（埋惊喜 / 寻惊喜）。详情见 docs/surprise-exchange.md
                                SurpriseHubCard(store: store).padding(.top, 20)
                            }
                        }
                    }
                    .padding(.horizontal, BWTheme.pagePadding)
                    .padding(.top, 6)
                    .padding(.bottom, 26)
                    .frame(maxWidth: isWideLayout ? BWTheme.contentMaxWidth : .infinity, alignment: .leading)
                    .frame(maxWidth: .infinity)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .bwTabBarChrome()
        .bwTypeBounds()
        .onAppear {
            // 仅用于截图/演示：`SIMCTL_CHILD_BW_PREVIEW=setup` 直达抽盒 sheet
            if ProcessInfo.processInfo.environment["BW_PREVIEW"] == "setup" {
                bwAfter(0.4) { onOpenSetup() }
            }
        }
    }

    /// 宽屏（折叠屏展开态 / iPad）：双列 + 内容居中限宽
    private var isWideLayout: Bool { horizontalSizeClass == .regular }

    // MARK: 顶栏：问候 + 连续天数

    private var topBar: some View {
        HStack(alignment: .center, spacing: 12) {
            Text(BWFormat.greeting(name: store.profile.displayName))
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(BWTheme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.85)

            Spacer(minLength: 0)

            HStack(spacing: 4) {
                Text("🔥").font(.system(size: 12))
                Text("\(store.profile.streakDays) 天")
                    .font(.system(size: 12.5, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(BWTheme.ink)
            }
            .padding(.horizontal, 11)
            .frame(height: 28)
            .background(BWTheme.paper)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(BWTheme.line, lineWidth: 1))
        }
    }

    // MARK: 大头文案

    private var hero: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("今天，想去哪儿？")
                .font(BWType.hero())
                .foregroundStyle(BWTheme.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text("不用选。让城市替你选。")
                .font(.system(size: 14.5))
                .foregroundStyle(BWTheme.ink2)
        }
        .padding(.top, 17)
        .padding(.bottom, 16)
    }

    // MARK: 今晚的盲盒主卡

    private var blindBoxCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center) {
                BWMicroLabel("今日盲盒")
                Spacer(minLength: 8)
                if store.hasActiveQuest {
                    resumeChip
                }
            }
            .frame(minHeight: 24)

            HStack {
                Spacer(minLength: 0)
                BWBoxIllustration(width: 118)
                Spacer(minLength: 0)
            }
            .padding(.top, 2)
            .padding(.bottom, 8)

            BWPrimaryButton(title: "开一个盲盒", action: onOpenSetup)

            Text("预计 \(store.selectedDuration.rawValue) 分钟 · \(BWFormat.distanceKilometers(store.selectedDuration.radiusMeters)) 内")
                .font(BWType.caption(10.5))
                .foregroundStyle(BWTheme.ink.opacity(0.52))
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding(.top, 8)
        }
        .padding(.horizontal, 18)
        .padding(.top, 15)
        .padding(.bottom, 14)
        .background {
            ZStack {
                BWKraft.cardGradient
                BWPaperTexture().opacity(0.6)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous)
                .stroke(BWTheme.ink.opacity(0.10), lineWidth: 1)
        )
        .shadow(color: BWTheme.ink.opacity(0.16), radius: 20, x: 0, y: 12)
    }

    /// 卡内右上角：正在走的盲盒（web .boxcard__resume）
    private var resumeChip: some View {
        Button(action: onOpenJourney) {
            HStack(spacing: 3) {
                Text("继续 · \(store.session?.remainingMeters ?? 0) m")
                    .font(.system(size: 12.5, weight: .semibold))
                    .monospacedDigit()
                Image(systemName: "chevron.right")
                    .font(.system(size: 10.5, weight: .semibold))
            }
            .foregroundStyle(BWTheme.ink.opacity(0.68))
            .padding(.horizontal, 10)
            .frame(height: 24)
            .background(BWTheme.paper.opacity(0.6))
            .clipShape(Capsule())
            .overlay(Capsule().stroke(BWTheme.ink.opacity(0.12), lineWidth: 1))
        }
        .buttonStyle(BWPressEffectStyle())
        .accessibilityLabel("继续这趟散步")
    }

    // MARK: 快捷统计：本周惊喜值 / 收集卡片 / 连续天数

    private var statsRow: some View {
        BWStatsRow(items: [
            ("\(store.weeklySurprise)", "本周惊喜值"),
            ("\(store.profile.cards.count)", "收集卡片"),
            ("\(store.profile.streakDays)", "连续天数")
        ])
    }

    // MARK: 好友在走

    private var friendsRow: some View {
        HStack(alignment: .center, spacing: 15) {
            HStack(spacing: -7) {
                ForEach(friends) { friend in
                    friendAvatar(friend)
                }
            }

            VStack(alignment: .leading, spacing: 1) {
                Text("3 个朋友")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(BWTheme.ink2)
                Text("今晚也在散步")
                    .font(.system(size: 13))
                    .foregroundStyle(BWTheme.ink3)
            }
            .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 0)
        }
    }

    private func friendAvatar(_ friend: Friend) -> some View {
        VStack(spacing: 3) {
            ZStack(alignment: .bottomTrailing) {
                Text(friend.emoji)
                    .font(.system(size: 19))
                    .frame(width: 42, height: 42)
                    .background(BWTheme.paper)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(BWTheme.line, lineWidth: 1))

                if friend.isOnline {
                    Circle()
                        .fill(BWTheme.teal)
                        .frame(width: 10, height: 10)
                        .overlay(Circle().stroke(BWTheme.cream, lineWidth: 2))
                        .offset(x: 1, y: 1)
                }
            }

            Text(friend.name)
                .font(.system(size: 10.5))
                .foregroundStyle(BWTheme.ink3)
                .lineLimit(1)
                .fixedSize()
        }
    }

    // MARK: 上一次的惊喜 / 第一盒还没开

    @ViewBuilder
    private var lastSurpriseSection: some View {
        if let place = lastCollectedPlace, let card = store.card(for: place.id) {
            Button(action: onOpenCards) {
                HStack(spacing: 12) {
                    Text(place.emoji)
                        .font(.system(size: 20))
                        .frame(width: 46, height: 56)
                        .background(BWKraft.thumbGradient)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(BWTheme.ink.opacity(0.08), lineWidth: 1)
                        )

                    VStack(alignment: .leading, spacing: 2) {
                        BWMicroLabel("上一次的惊喜")
                        Text(place.name)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(BWTheme.ink)
                            .lineLimit(1)
                        Text(BWFormat.dayPhrase(since: card.collectedAt))
                            .font(BWType.caption(11))
                            .foregroundStyle(BWTheme.ink3)
                    }

                    Spacer(minLength: 0)

                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(BWTheme.ink3)
                }
                .padding(.leading, 10)
                .padding(.trailing, 14)
                .padding(.vertical, 10)
                .background(BWTheme.paper)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .stroke(BWTheme.line, lineWidth: 1)
                )
                .shadow(color: BWTheme.ink.opacity(0.05), radius: 12, x: 0, y: 8)
            }
            .buttonStyle(BWPressEffectStyle())
            .accessibilityLabel("去回忆册看上一次的惊喜")
        } else {
            VStack(alignment: .leading, spacing: 4) {
                Text("第一盒还没开。")
                    .font(.system(size: 14.5, weight: .semibold))
                    .foregroundStyle(BWTheme.ink)
                Text("城市已经准备好了。")
                    .font(.system(size: 13))
                    .foregroundStyle(BWTheme.ink3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 18)
            .padding(.vertical, 15)
            .background(BWTheme.paper.opacity(0.5))
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(BWTheme.line, style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
            )
        }
    }

    // MARK: 数据

    private var lastCollectedPlace: Place? {
        let cards = store.profile.cards
        guard let card = cards.max(by: { $0.collectedAt < $1.collectedAt }) else {
            return nil
        }
        // 内置地点查不到时，可能是后台「编辑精选」策展点
        return PlaceCatalog.place(id: card.placeID)
            ?? AdminPOIService.shared.place(for: card.placeID)
    }
}
