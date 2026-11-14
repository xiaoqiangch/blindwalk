import Foundation

/// 演示种子数据：**只服务截图 / 走查**，不是产品数据来源。
///
/// 铁律（这条曾经被违反过，导致用户真实进度被覆盖）：
/// 1. 这里的任何东西都只能写进 `InMemoryProfileStore`，绝不碰 UserDefaults；
/// 2. 地点必须是真实地点 —— 从 `PlaceDirectory` 传入，不再引用内置虚构目录；
/// 3. 没有真实地点可展示时，宁可给空状态，也不编造地点。
public enum DemoData {

    /// 演示用的「已使用一段时间」的档案。
    /// - Parameter places: 真实地点（来自 PlaceDirectory）；为空时只给数字、不给卡片。
    public static func demoProfile(
        now: Date = Date(),
        calendar: Calendar = .current,
        places: [Place] = []
    ) -> Profile {
        var profile = Profile()

        // 卡片只从真实地点里取，数量取决于目录里有多少（最多 18 张）
        let pickable = places.filter { $0.coordinate != nil }
        let cards: [PlaceCard] = pickable.prefix(18).enumerated().map { index, place in
            let date = calendar.date(byAdding: .day, value: -(index + 3), to: now) ?? now
            return PlaceCard(
                placeID: place.id,
                serial: String(format: "%04d", 101 + index * 37 % 9000),
                collectedAt: date,
                taskDone: index % 3 != 0
            )
        }
        profile.cards = cards
        profile.boxesOpened = cards.count
        profile.totalKm = Double(cards.count) * 1.2
        profile.xp = cards.count * 180

        // 连续天数与到达时间：给截图一个「正在使用」的样子
        var arrivals: [Date] = []
        let todayStart = calendar.startOfDay(for: now)
        for day in 0..<12 {
            var components = calendar.dateComponents([.year, .month, .day], from: todayStart)
            components.hour = day == 5 ? 6 : (day == 8 ? 22 : 19)
            components.minute = day == 8 ? 40 : 12
            if let date = calendar.date(from: components) {
                arrivals.append(min(date, now.addingTimeInterval(-60)))
            }
        }
        profile.walkArrivalTimes = arrivals.sorted()
        profile.streakDays = min(12, max(1, arrivals.count))
        profile.lastWalkAt = arrivals.last
        _ = AchievementEngine.sync(profile: &profile, now: now)
        return profile
    }

    /// 演示会话：只接受真实地点；没有就返回 nil（调用方给空状态）
    public static func demoSession(place: Place, now: Date = Date()) -> QuestSession {
        QuestSession(
            placeID: place.id,
            startedAt: now.addingTimeInterval(-12 * 60 - 34),
            totalMeters: 1260,
            remainingMeters: 480,
            phase: .walking,
            unlockedHintCount: 1,
            target: place.coordinate,
            currentBearing: 42
        )
    }

    /// 手表侧的演示会话（同一条，带真实坐标）
    public static func demoWatchSession(place: Place, now: Date = Date()) -> QuestSession {
        demoSession(place: place, now: now)
    }
}
