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
            let dayOffset = -(index + 3)
            let date = calendar.date(byAdding: .day, value: dayOffset, to: now) ?? now
            return PlaceCard(
                placeID: placeID,
                serial: String(format: "%04d", 101 + index * 37 % 9000),
                collectedAt: date,
                taskDone: index % 3 != 0
            )
        }

        // 12 天里每天到达一次，含一次清晨与一次深夜。
        // 以本地零点为基准减 N 天，再设时刻；今天那次若还没到点就夹到「现在之前一分钟」，
        // 保证最近 7 个自然日各 1 次（本周惊喜值 305），也不会排到未来。
        var arrivals: [Date] = []
        let todayStart = calendar.startOfDay(for: now)
        for day in 0..<12 {
            var components = calendar.dateComponents([.year, .month, .day], from: todayStart)
            components.hour = day == 5 ? 6 : (day == 8 ? 22 : 19)
            components.minute = day == 8 ? 40 : 12
            guard let anchor = calendar.date(from: components),
                  let shifted = calendar.date(byAdding: .day, value: -day, to: anchor)
            else { continue }
            arrivals.append(shifted > now ? now.addingTimeInterval(-60) : shifted)
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

    /// 预置的「别人埋的惊喜」：已埋下、等你去找到并复刻。
    /// - Parameter origin: 生成基准点。真机上应传用户当前位置，
    ///   这样在杭州/成都打开也能看到「320 米外有一个惊喜」，而不是几千公里。
    ///   传 nil 时回退到人民广场（模拟器/预览用）。
    public static func demoSurprises(around origin: GeoPoint? = nil, now: Date = Date()) -> [BuriedSurprise] {
        let origin = origin ?? GeoPoint(latitude: 31.2304, longitude: 121.4737)
        let oneDay: TimeInterval = 86_400
        return [
            BuriedSurprise(
                authorName: "小满",
                authorEmoji: "🐱",
                photoName: "surprise-seed-1.jpg",
                message: "这张是我在等一杯咖啡时拍的。柜台后面那盏灯，晚上会有很软的一圈光。",
                location: GeoMath.offset(from: origin, meters: 320, bearingDegrees: 24),
                areaLabel: "静安 · 街角",
                clues: BuriedSurprise.makeClues(from: "", hint: "往灯最暖的那扇窗走。"),
                createdAt: now.addingTimeInterval(-oneDay * 3),
                status: .waiting
            ),
            BuriedSurprise(
                authorName: "阿岛",
                authorEmoji: "🎧",
                photoName: "surprise-seed-2.jpg",
                message: "桥洞下的那面墙，早上七点没有人，光会斜着打进来。",
                location: GeoMath.offset(from: origin, meters: 540, bearingDegrees: 118),
                areaLabel: "河岸 · 桥洞",
                clues: BuriedSurprise.makeClues(from: "", hint: "找一块回声很大的地方。"),
                createdAt: now.addingTimeInterval(-oneDay * 5),
                status: .waiting
            ),
            BuriedSurprise(
                authorName: "77",
                authorEmoji: "🌙",
                photoName: "surprise-seed-3.jpg",
                message: "二十四小时的洗衣店，凌晨两点最像宇宙飞船。我拍了它转起来的那个瞬间。",
                location: GeoMath.offset(from: origin, meters: 760, bearingDegrees: 300),
                areaLabel: "附近 · 街口",
                clues: BuriedSurprise.makeClues(from: "", hint: "找一块很亮的玻璃，里面在转。"),
                createdAt: now.addingTimeInterval(-oneDay * 8),
                status: .waiting
            ),
            // 已被别人找到的一条（展示「双方都得到点数」的社区感）
            BuriedSurprise(
                authorName: "老陈",
                authorEmoji: "🍜",
                photoName: "surprise-seed-4.jpg",
                message: "第三张塑料凳，腿短一截。老板故意留的。",
                location: GeoMath.offset(from: origin, meters: 210, bearingDegrees: 200),
                areaLabel: "老城区 · 街口",
                clues: BuriedSurprise.makeClues(from: "", hint: "闻，有热汤的味道。"),
                createdAt: now.addingTimeInterval(-oneDay * 11),
                status: .found,
                finderName: "小满",
                foundAt: now.addingTimeInterval(-oneDay * 9),
                finderPhotoName: "surprise-found-1.jpg",
                matchScore: 0.78
            )
        ]
    }
}
