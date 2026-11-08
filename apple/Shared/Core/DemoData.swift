import Foundation

/// 演示种子数据：用于原型首屏「已使用一段时间」的状态，以及手表独立演示。
public enum DemoData {

    public static let collectedPlaceIDs: [String] = [
        // 常见 11
        "river-bench-07", "river-boardwalk", "river-carwash",
        "near-store-hotdrink", "near-swing", "near-basketball", "near-library-steps",
        "near-flower-cart", "old-flower-shop", "old-chess", "old-tailor-eave",
        // 稀有 4
        "river-steps", "river-kites", "river-bookstore", "old-watch-repair",
        // 史诗 2
        "river-graffiti", "old-records",
        // 隐藏 1
        "near-laundromat"
    ]

    public static func demoProfile(now: Date = Date(), calendar: Calendar = .current) -> Profile {
        let cards: [PlaceCard] = collectedPlaceIDs.enumerated().compactMap { index, placeID in
            guard PlaceCatalog.place(id: placeID) != nil else { return nil }
            let dayOffset = -(index + 2)
            let date = calendar.date(byAdding: .day, value: dayOffset, to: now) ?? now
            return PlaceCard(
                placeID: placeID,
                serial: String(format: "%04d", 101 + index * 37 % 9000),
                collectedAt: date,
                taskDone: index % 3 != 0
            )
        }

        // 12 天里每天到达一次，含一次清晨与一次深夜
        var arrivals: [Date] = []
        for day in 0..<12 {
            var components = calendar.dateComponents([.year, .month, .day], from: now)
            components.hour = day == 5 ? 6 : (day == 8 ? 22 : 19)
            components.minute = day == 8 ? 40 : 12
            if let date = calendar.date(from: components),
               let shifted = calendar.date(byAdding: .day, value: -day, to: date) {
                arrivals.append(shifted)
            }
        }

        var profile = Profile(
            xp: 4240,
            streakDays: 12,
            totalKm: 42.6,
            boxesOpened: 18,
            cards: cards,
            posts: madePosts(now: now),
            lastWalkAt: arrivals.first,
            walkArrivalTimes: arrivals,
            togetherCount: 0,
            displayName: "阿澈"
        )
        AchievementEngine.sync(profile: &profile, now: now, calendar: calendar)
        return profile
    }

    /// 演示中的「正在走」旅程：已走 780m，剩余 480m，第 1 条线索已解锁
    public static func demoSession(now: Date = Date()) -> QuestSession {
        QuestSession(
            placeID: "river-steps",
            startedAt: now.addingTimeInterval(-12 * 60 - 34),
            totalMeters: 1260,
            remainingMeters: 480,
            phase: .walking,
            unlockedHintCount: 1
        )
    }

    public static func madePosts(now: Date = Date()) -> [FeedPost] {
        [
            FeedPost(
                authorName: "阿澈",
                authorEmoji: "🫥",
                placeName: "旧仓库改的书店",
                categoryEmoji: "📚",
                rarity: .rare,
                caption: "本来只想路过，结果在里面坐了一个小时。",
                createdAt: now.addingTimeInterval(-26 * 60),
                reactions: ["羡慕": 9, "一起": 2, "下次带我": 4],
                isMine: true
            ),
            FeedPost(
                authorName: "阿澈",
                authorEmoji: "🫥",
                placeName: "河边的第七张长椅",
                categoryEmoji: "🪑",
                rarity: .common,
                caption: "坐了一会儿，什么也没想。",
                createdAt: now.addingTimeInterval(-2 * 86_400),
                reactions: ["羡慕": 4, "一起": 1, "下次带我": 0],
                isMine: true
            )
        ]
    }

    /// 手表演示数据
    public static func demoWatchSession(now: Date = Date()) -> QuestSession {
        demoSession(now: now)
    }
}
