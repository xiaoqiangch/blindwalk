import SwiftUI

// MARK: - 今日 Home（design-system §5.1）

struct HomeView: View {

    let store: BlindWalkStore
    var onOpenSetup: () -> Void
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
                VStack(alignment: .leading, spacing: 20) {
                    topBar
                    hero
                    blindBoxCard
                    statsRow
                    friendsRow
                    if let place = lastCollectedPlace {
                        lastSurprise(place)
                    }
                    if store.hasActiveQuest {
                        activeQuestRow
                    }
                }
                .padding(.horizontal, BWTheme.pagePadding)
                .padding(.top, 8)
                .padding(.bottom, 28)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    // MARK: 顶栏：问候 + 连续天数

    private var topBar: some View {
        HStack(alignment: .center, spacing: 12) {
            Text(BWFormat.greeting(name: store.profile.displayName))
                .font(BWTheme.title(15))
                .foregroundStyle(BWTheme.ink2)

            Spacer(minLength: 0)

            HStack(spacing: 5) {
                Text("🔥").font(.system(size: 12))
                Text("\(store.profile.streakDays) 天")
                    .font(BWTheme.caption(12))
                    .foregroundStyle(BWTheme.ink2)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(BWTheme.paper2)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(BWTheme.line, lineWidth: 1))
        }
    }

    // MARK: 大头文案

    private var hero: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("今天，想去哪儿？")
                .font(BWTheme.title(26))
                .foregroundStyle(BWTheme.ink)
            Text("不用选。让城市替你选。")
                .font(BWTheme.body(15))
                .foregroundStyle(BWTheme.ink2)
        }
    }

    // MARK: 今晚的盲盒主卡

    private var blindBoxCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                BWMicroLabel("今日盲盒")
                Spacer(minLength: 8)
                Text("预计 \(store.selectedDuration.rawValue) 分钟 · \(BWFormat.distanceKilometers(store.selectedDuration.radiusMeters)) 内")
                    .font(BWTheme.caption(10))
                    .foregroundStyle(BWTheme.ink3)
            }

            HStack {
                Spacer(minLength: 0)
                BWBoxIllustration(size: 124)
                Spacer(minLength: 0)
            }
            .padding(.vertical, 2)

            BWPrimaryButton(
                title: "开一个盲盒",
                icon: "shippingbox",
                action: onOpenSetup
            )
        }
        .padding(20)
        .background(
            ZStack {
                LinearGradient(
                    colors: [BWTheme.paper2, BWTheme.paper, BWTheme.amber.opacity(0.16)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                BWPaperTexture().opacity(0.5)
            }
        )
        .clipShape(RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous)
                .stroke(BWTheme.line, lineWidth: 1)
        )
        .shadow(color: BWTheme.ink.opacity(0.10), radius: 18, x: 0, y: 12)
    }

    // MARK: 快捷统计：本周惊喜值 / 收集卡片 / 连续天数

    private var statsRow: some View {
        HStack(spacing: 0) {
            BWStatTile(value: "\(store.weeklySurprise)", title: "本周惊喜值")
            statDivider
            BWStatTile(value: "\(store.profile.cards.count)", title: "收集卡片")
            statDivider
            BWStatTile(value: "\(store.profile.streakDays)", title: "连续天数")
        }
        .padding(.vertical, 14)
        .background(BWTheme.paper.opacity(0.7))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(BWTheme.line, lineWidth: 1)
        )
    }

    private var statDivider: some View {
        Rectangle()
            .fill(BWTheme.line)
            .frame(width: 1, height: 28)
    }

    // MARK: 好友在走

    private var friendsRow: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
                ForEach(friends) { friend in
                    VStack(spacing: 6) {
                        ZStack(alignment: .bottomTrailing) {
                            Text(friend.emoji)
                                .font(.system(size: 24))
                                .frame(width: 48, height: 48)
                                .background(BWTheme.paper2)
                                .clipShape(Circle())
                                .overlay(Circle().stroke(BWTheme.line, lineWidth: 1))

                            if friend.isOnline {
                                Circle()
                                    .fill(BWTheme.teal)
                                    .frame(width: 11, height: 11)
                                    .overlay(Circle().stroke(BWTheme.cream, lineWidth: 2))
                            }
                        }

                        Text(String(friend.name.prefix(1)))
                            .font(BWTheme.caption(10))
                            .foregroundStyle(BWTheme.ink3)
                    }
                }
                Spacer(minLength: 0)
            }

            Text("3 个朋友今晚也在散步")
                .font(BWTheme.caption(12))
                .foregroundStyle(BWTheme.ink2)
        }
    }

    // MARK: 上一次的惊喜

    private func lastSurprise(_ place: Place) -> some View {
        Button(action: onOpenCards) {
            HStack(spacing: 14) {
                VStack(spacing: 4) {
                    Text(place.emoji)
                        .font(.system(size: 24))
                    Circle()
                        .fill(BWTheme.rarityColor(place.rarity))
                        .frame(width: 6, height: 6)
                }
                .frame(width: 58, height: 66)
                .background(BWTheme.paper)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(BWTheme.line, lineWidth: 1)
                )

                VStack(alignment: .leading, spacing: 4) {
                    BWMicroLabel("上一次的惊喜")
                    Text(place.name)
                        .font(BWTheme.title(15))
                        .foregroundStyle(BWTheme.ink)
                        .lineLimit(1)
                    if let card = store.card(for: place.id) {
                        Text(BWFormat.dayPhrase(since: card.collectedAt))
                            .font(BWTheme.caption(11))
                            .foregroundStyle(BWTheme.ink3)
                    }
                }

                Spacer(minLength: 0)

                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(BWTheme.ink3)
            }
            .padding(14)
            .background(BWTheme.paper.opacity(0.7))
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(BWTheme.line, lineWidth: 1)
            )
        }
        .buttonStyle(BWPressEffectStyle())
    }

    // MARK: 正在走的盲盒（演示状态快捷入口）

    private var activeQuestRow: some View {
        Button(action: onOpenJourney) {
            HStack(spacing: 12) {
                Image(systemName: "figure.walk")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(BWTheme.amberDeep)

                VStack(alignment: .leading, spacing: 2) {
                    Text("今晚的盲走还在继续")
                        .font(BWTheme.caption(13))
                        .foregroundStyle(BWTheme.ink)
                    if let remaining = store.session?.remainingMeters {
                        Text("还剩 \(remaining) 米 · 目的地保密中")
                            .font(BWTheme.caption(11))
                            .foregroundStyle(BWTheme.ink3)
                    }
                }

                Spacer(minLength: 0)

                Text("继续")
                    .font(BWTheme.caption(12))
                    .foregroundStyle(BWTheme.amberDeep)
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(BWTheme.amberDeep)
            }
            .padding(14)
            .background(BWTheme.amber.opacity(0.10))
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(BWTheme.amber.opacity(0.35), lineWidth: 1)
            )
        }
        .buttonStyle(BWPressEffectStyle())
    }

    // MARK: 数据

    private var lastCollectedPlace: Place? {
        let cards = store.profile.cards
        guard let card = cards.max(by: { $0.collectedAt < $1.collectedAt }) else {
            return nil
        }
        return PlaceCatalog.place(id: card.placeID)
    }
}
