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
        ScrollView {
            Group {
                if isWideLayout {
                    VStack(alignment: .leading, spacing: 0) {
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
            .padding(.bottom, 28)
            .frame(maxWidth: isWideLayout ? WATheme.contentMaxWidth : .infinity, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(WATheme.cream)
        .navigationTitle("今天")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                HStack(spacing: 4) {
                    Image(systemName: "flame.fill")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                    Text("\(store.profile.streakDays) 天")
                        .font(.subheadline)
                        .monospacedDigit()
                        .foregroundStyle(WATheme.ink2)
                }
                .accessibilityLabel("连续 \(store.profile.streakDays) 天")
            }
        }
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

    // MARK: 顶部说明
    //
    // 标题交给系统大标题（「今天」），这里只放一句话说明产品规则。

    private var hero: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 5) {
                Image(systemName: DayMoment.now.symbol)
                    .font(.caption)
                Text(DayMoment.now.boxTitle)
                    .font(.footnote.weight(.medium))
                    .monospacedDigit()
            }
            .foregroundStyle(WATheme.amber)

            Text(DayMoment.now.line)
                .font(.subheadline)
                .foregroundStyle(WATheme.ink2)
                .fixedSize(horizontal: false, vertical: true)

            Text("目的地抽到才知道。走过去的路上，它不显示。")
                .font(.caption)
                .foregroundStyle(WATheme.ink3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.bottom, 16)
    }

    // MARK: 盲盒主卡
    //
    // 整屏唯一的彩色是卡里的主按钮。卡片本身是白面 + 发丝描边，
    // 富细节交给盒线稿（这是产品自己的物体，不是装饰）。

    private var blindBoxCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center) {
                Text("今日盲盒")
                    .font(.headline)
                    .foregroundStyle(WATheme.ink)
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
                Image(systemName: store.selectedScope.symbol)
                    .font(.caption)
                Text(scopeCaption)
                    .monospacedDigit()
            }
            .font(.caption)
            .foregroundStyle(WATheme.ink2)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.top, 12)
        }
        .padding(16)
        .background(WATheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
    }

    private var scopeCaption: String {
        switch store.selectedScope {
        case .walk:
            return "\(store.selectedDuration.rawValue) 分钟 · \(WAFormat.distanceKilometers(store.selectedDuration.radiusMeters)) 内"
        case .roam:
            return "10–45 公里 · 先开车再走"
        }
    }

    /// 卡内右上角：正在走的盲盒
    private var resumeChip: some View {
        Button(action: onOpenJourney) {
            HStack(spacing: 3) {
                Text("继续")
                Text("\(store.session?.remainingMeters ?? 0) m")
                    .monospacedDigit()
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
            }
            .font(.footnote.weight(.medium))
            .foregroundStyle(WATheme.amber)
        }
        .buttonStyle(.plain)
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
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(WATheme.ink)
                Text("今晚也在散步")
                    .font(.footnote)
                    .foregroundStyle(WATheme.ink2)
            }
            .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 0)
        }
    }

    private func friendAvatar(_ friend: Friend) -> some View {
        ZStack(alignment: .bottomTrailing) {
            Text(friend.initial)
                .font(.footnote.weight(.medium))
                .foregroundStyle(WATheme.ink2)
                .frame(width: 34, height: 34)
                .background(Color(.secondarySystemFill))
                .clipShape(Circle())

            if friend.isOnline {
                Circle()
                    .fill(.green)
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
                        .font(.title3)
                        .frame(width: 40, height: 40)
                        .background(Color(.secondarySystemFill))
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                    VStack(alignment: .leading, spacing: 2) {
                        Text(place.name)
                            .font(.body)
                            .foregroundStyle(WATheme.ink)
                            .lineLimit(1)
                        Text("上一次 · \(WAFormat.dayPhrase(since: card.collectedAt))")
                            .font(.footnote)
                            .foregroundStyle(WATheme.ink2)
                    }

                    Spacer(minLength: 0)

                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(WATheme.ink3)
                }
                .padding(14)
                .background(WATheme.paper)
                .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
            }
            .buttonStyle(WAPressEffectStyle())
            .accessibilityLabel("去图鉴看上一次的惊喜")
        } else {
            HStack(spacing: 12) {
                Image(systemName: "shippingbox")
                    .font(.body)
                    .foregroundStyle(WATheme.ink2)
                    .frame(width: 40, height: 40)
                    .background(Color(.secondarySystemFill))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                VStack(alignment: .leading, spacing: 2) {
                    Text("第一盒还没开")
                        .font(.body)
                        .foregroundStyle(WATheme.ink)
                    Text("城市已经准备好了")
                        .font(.footnote)
                        .foregroundStyle(WATheme.ink2)
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .background(WATheme.paper)
            .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
        }
    }

    // MARK: 数据

    private var lastCollectedPlace: Place? {
        let cards = store.profile.cards
        guard let card = cards.max(by: { $0.collectedAt < $1.collectedAt }) else {
            return nil
        }
        return PlaceDirectory.shared.place(id: card.placeID)
            ?? AdminPOIService.shared.place(for: card.placeID)
    }
}
