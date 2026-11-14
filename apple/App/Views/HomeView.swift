import SwiftUI

// MARK: - 今日 Home
//
// 方向（v3）：中性石墨面 + 靛蓝只出现一次。
// 一屏之内只有「开一个盲盒」这颗按钮是彩色，其余全部中性；
// 富细节集中在盒线稿插画和距离读数两处，不做第二处竞争。

struct HomeView: View {

    let store: WalkaholicStore
    var onOpenSetup: () -> Void

    /// 折叠屏展开态 / iPad 走宽屏双列；常规 iPhone 是 .compact
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    var onOpenJourney: () -> Void
    var onOpenCards: () -> Void

    private struct Friend: Identifiable {
        let id: String
        let name: String
        /// 用首字作头像，不用 emoji（emoji 头像在不同机型上字重不一致，且显得随手）
        let initial: String
        let isOnline: Bool
    }

    private let friends: [Friend] = [
        Friend(id: "f1", name: "小满", initial: "满", isOnline: false),
        Friend(id: "f2", name: "阿岛", initial: "岛", isOnline: false),
        Friend(id: "f3", name: "77", initial: "7", isOnline: true),
        Friend(id: "f4", name: "老陈", initial: "陈", isOnline: false)
    ]

    var body: some View {
        ZStack {
            WAPaperBackground()

            ScrollView(showsIndicators: false) {
                Group {
                    if isWideLayout {
                        VStack(alignment: .leading, spacing: 0) {
                            topBar
                            hero
                            HStack(alignment: .top, spacing: 20) {
                                VStack(alignment: .leading, spacing: 0) {
                                    blindBoxCard
                                    lastSurpriseSection.padding(.top, 16)
                                }
                                VStack(alignment: .leading, spacing: 0) {
                                    statsRow
                                    friendsRow.padding(.top, 24)
                                    SurpriseHubCard(store: store).padding(.top, 24)
                                }
                            }
                        }
                    } else {
                        VStack(alignment: .leading, spacing: 0) {
                            topBar
                            hero
                            blindBoxCard
                            statsRow.padding(.top, 24)
                            friendsRow.padding(.top, 24)
                            lastSurpriseSection.padding(.top, 24)
                            // 惊喜社区入口（埋惊喜 / 寻惊喜）。详情见 docs/surprise-exchange.md
                            SurpriseHubCard(store: store).padding(.top, 24)
                        }
                    }
                }
                .padding(.horizontal, WATheme.pagePadding)
                .padding(.top, 8)
                .padding(.bottom, 28)
                .frame(maxWidth: isWideLayout ? WATheme.contentMaxWidth : .infinity, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .waTabBarChrome()
        .waTypeBounds()
        .onAppear {
            let env = ProcessInfo.processInfo.environment
            if env["WA_PREVIEW"] == "setup" {
                waAfter(0.4) { onOpenSetup() }
            }
            // 真机/模拟器联调：`SIMCTL_CHILD_WA_AUTO_SETUP=1` 在不进入演示数据的前提下
            // 直接打开抽盒 sheet，用来验证「真实定位 → 真实 POI」这条链路。
            if env["WA_AUTO_SETUP"] == "1" {
                waAfter(0.6) { onOpenSetup() }
            }
        }
    }

    private var isWideLayout: Bool { horizontalSizeClass == .regular }

    // MARK: 顶栏
    //
    // 不做「晚上好，阿澈」这类问候式大标题（那是模板特征）。
    // 这一行只放上下文：今天是第几天 + 一个安静的连续天数读数。

    private var topBar: some View {
        HStack(alignment: .center, spacing: 12) {
            Text(WAFormat.shortDate(Date()))
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(WATheme.ink3)
                .monospacedDigit()

            Spacer(minLength: 0)

            HStack(spacing: 4) {
                Image(systemName: "flame")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(WATheme.ink3)
                Text("\(store.profile.streakDays) 天")
                    .font(.system(size: 12.5, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(WATheme.ink2)
            }
        }
    }

    // MARK: 主标题

    private var hero: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("今天，随便走走")
                .font(WAType.hero())
                .foregroundStyle(WATheme.ink)
                .fixedSize(horizontal: false, vertical: true)

            Text("目的地抽到才知道。走过去的路上，它不显示。")
                .font(.system(size: 14))
                .foregroundStyle(WATheme.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 20)
        .padding(.bottom, 18)
    }

    // MARK: 盲盒主卡
    //
    // 整屏唯一的彩色是卡里的主按钮。卡片本身是白面 + 发丝描边，
    // 富细节交给盒线稿（这是产品自己的物体，不是装饰）。

    private var blindBoxCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center) {
                Text("今日盲盒")
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(WATheme.ink3)
                Spacer(minLength: 8)
                if store.hasActiveQuest {
                    resumeChip
                }
            }

            HStack {
                Spacer(minLength: 0)
                WABoxIllustration(width: 116)
                Spacer(minLength: 0)
            }
            .padding(.top, 10)
            .padding(.bottom, 18)

            WAPrimaryButton(title: "开一个盲盒", action: onOpenSetup)

            HStack(spacing: 4) {
                Image(systemName: "figure.walk")
                    .font(.system(size: 10, weight: .medium))
                Text("\(store.selectedDuration.rawValue) 分钟 · \(WAFormat.distanceKilometers(store.selectedDuration.radiusMeters)) 内")
                    .monospacedDigit()
            }
            .font(.system(size: 11.5))
            .foregroundStyle(WATheme.ink3)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.top, 12)
        }
        .padding(18)
        .background(WATheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous)
                .stroke(WATheme.line, lineWidth: 1)
        )
    }

    /// 卡内右上角：正在走的盲盒
    private var resumeChip: some View {
        Button(action: onOpenJourney) {
            HStack(spacing: 3) {
                Text("继续 · \(store.session?.remainingMeters ?? 0) m")
                    .font(.system(size: 12, weight: .medium))
                    .monospacedDigit()
                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .semibold))
            }
            .foregroundStyle(WATheme.amberDeep)
            .padding(.horizontal, 9)
            .frame(height: 24)
            .background(WATheme.amberSoft)
            .clipShape(Capsule())
        }
        .buttonStyle(WAPressEffectStyle())
        .accessibilityLabel("继续这趟散步")
    }

    // MARK: 快捷统计

    private var statsRow: some View {
        WAStatsRow(items: [
            ("\(store.weeklySurprise)", "本周惊喜值"),
            ("\(store.profile.cards.count)", "收集卡片"),
            ("\(store.profile.streakDays)", "连续天数")
        ])
    }

    // MARK: 好友在走

    private var friendsRow: some View {
        HStack(alignment: .center, spacing: 14) {
            HStack(spacing: -6) {
                ForEach(friends) { friend in
                    friendAvatar(friend)
                }
            }

            VStack(alignment: .leading, spacing: 1) {
                Text("3 个朋友")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(WATheme.ink2)
                Text("今晚也在散步")
                    .font(.system(size: 13))
                    .foregroundStyle(WATheme.ink3)
            }
            .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 0)
        }
    }

    private func friendAvatar(_ friend: Friend) -> some View {
        ZStack(alignment: .bottomTrailing) {
            Text(friend.initial)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(WATheme.ink2)
                .frame(width: 34, height: 34)
                .background(WATheme.paper)
                .clipShape(Circle())
                .overlay(
                    Circle()
                        .stroke(friend.isOnline ? WATheme.ink.opacity(0.16) : WATheme.line, lineWidth: 1)
                )

            if friend.isOnline {
                Circle()
                    .fill(WATheme.teal)
                    .frame(width: 8, height: 8)
                    .overlay(Circle().stroke(WATheme.cream, lineWidth: 2))
            }
        }
        .accessibilityLabel(friend.name)
    }

    // MARK: 上一次的惊喜 / 第一盒还没开

    @ViewBuilder
    private var lastSurpriseSection: some View {
        if let place = lastCollectedPlace, let card = store.card(for: place.id) {
            Button(action: onOpenCards) {
                HStack(spacing: 12) {
                    Text(place.emoji)
                        .font(.system(size: 18))
                        .frame(width: 44, height: 44)
                        .background(WATheme.paper2)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                    VStack(alignment: .leading, spacing: 2) {
                        Text(place.name)
                            .font(.system(size: 14.5, weight: .medium))
                            .foregroundStyle(WATheme.ink)
                            .lineLimit(1)
                        Text("上一次 · \(WAFormat.dayPhrase(since: card.collectedAt))")
                            .font(.system(size: 12))
                            .foregroundStyle(WATheme.ink3)
                    }

                    Spacer(minLength: 0)

                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(WATheme.ink3)
                }
                .padding(12)
                .background(WATheme.paper)
                .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous)
                        .stroke(WATheme.line, lineWidth: 1)
                )
            }
            .buttonStyle(WAPressEffectStyle())
            .accessibilityLabel("去回忆册看上一次的惊喜")
        } else {
            HStack(spacing: 12) {
                Image(systemName: "shippingbox")
                    .font(.system(size: 16, weight: .regular))
                    .foregroundStyle(WATheme.ink3)
                    .frame(width: 44, height: 44)
                    .background(WATheme.paper2)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                VStack(alignment: .leading, spacing: 2) {
                    Text("第一盒还没开")
                        .font(.system(size: 14.5, weight: .medium))
                        .foregroundStyle(WATheme.ink)
                    Text("城市已经准备好了")
                        .font(.system(size: 12))
                        .foregroundStyle(WATheme.ink3)
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .background(WATheme.paper.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous)
                    .stroke(WATheme.line, style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
            )
        }
    }

    // MARK: 数据

    private var lastCollectedPlace: Place? {
        let cards = store.profile.cards
        guard let card = cards.max(by: { $0.collectedAt < $1.collectedAt }) else {
            return nil
        }
        return PlaceCatalog.place(id: card.placeID)
            ?? AdminPOIService.shared.place(for: card.placeID)
    }
}
