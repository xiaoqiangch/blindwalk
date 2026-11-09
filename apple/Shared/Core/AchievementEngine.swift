import Foundation

/// 成就定义（与 docs/design-system.md §5.8 完全一致）
public struct AchievementDefinition: Identifiable, Sendable {
    public let id: String
    public let name: String
    public let icon: String
    public let detail: String
    public let target: Int

    public init(id: String, name: String, icon: String, detail: String, target: Int) {
        self.id = id
        self.name = name
        self.icon = icon
        self.detail = detail
        self.target = target
    }
}

public enum AchievementEngine {

    public static let definitions: [AchievementDefinition] = [
        .init(id: "first_box", name: "第一次拆盒", icon: "🎁", detail: "完成第 1 次盲走", target: 1),
        .init(id: "walker_10", name: "城市漫游者", icon: "🚶", detail: "完成 10 次盲走", target: 10),
        .init(id: "rare_first", name: "稀有体质", icon: "💎", detail: "首次获得稀有卡", target: 1),
        .init(id: "hidden_first", name: "挖到隐藏款", icon: "🗝️", detail: "首次获得隐藏卡", target: 1),
        .init(id: "early_bird", name: "早起的鸟", icon: "🌅", detail: "07:00 前到达", target: 1),
        .init(id: "night_owl", name: "夜行动物", icon: "🌙", detail: "22:00 后到达", target: 1),
        .init(id: "streak_7", name: "七日不断", icon: "🔥", detail: "连续 7 天开盒", target: 7),
        .init(id: "together_1", name: "同频共振", icon: "📡", detail: "完成 1 次同频散步", target: 1),
        .init(id: "share_3", name: "分享欲", icon: "📣", detail: "发布 3 条动态", target: 3),
        .init(id: "km_100", name: "盲走百公里", icon: "🧭", detail: "累计 100 km", target: 100),
        .init(id: "bury_1", name: "埋下一颗", icon: "🌱", detail: "第一次给别人埋下惊喜", target: 1),
        .init(id: "seek_3", name: "寻光者", icon: "🔎", detail: "找到 3 个别人埋的惊喜", target: 3),
        .init(id: "found_5", name: "被找到的人", icon: "💌", detail: "你埋的惊喜被找到 5 次", target: 5)
    ]

    public static func definition(id: String) -> AchievementDefinition? {
        definitions.first { $0.id == id }
    }

    /// 计算当前进度（上限 = target）
    public static func progress(_ id: String, profile: Profile, calendar: Calendar = .current) -> Int {
        let raw: Int
        switch id {
        case "first_box", "walker_10":
            raw = profile.boxesOpened
        case "rare_first":
            raw = profile.rareCount
        case "hidden_first":
            raw = profile.hiddenCount
        case "early_bird":
            raw = profile.walkArrivalTimes.contains { calendar.component(.hour, from: $0) < 7 } ? 1 : 0
        case "night_owl":
            raw = profile.walkArrivalTimes.contains { calendar.component(.hour, from: $0) >= 22 } ? 1 : 0
        case "streak_7":
            raw = profile.streakDays
        case "together_1":
            raw = profile.togetherCount
        case "share_3":
            raw = profile.posts.filter(\.isMine).count
        case "km_100":
            raw = Int(profile.totalKm)
        case "bury_1":
            raw = profile.surprisesBuried
        case "seek_3":
            raw = profile.surprisesSeeked
        case "found_5":
            raw = profile.surprisesFound
        default:
            raw = 0
        }
        guard let target = definition(id: id)?.target else { return raw }
        return min(raw, target)
    }

    /// 同步成就状态，返回本次新解锁的成就（用于 toast）。
    @discardableResult
    public static func sync(
        profile: inout Profile,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> [Achievement] {
        var existing: [String: Achievement] = [:]
        for achievement in profile.achievements {
            existing[achievement.id] = achievement
        }

        var unlockedNow: [Achievement] = []
        var ordered: [Achievement] = []

        for definition in definitions {
            var achievement = existing[definition.id] ?? Achievement(
                id: definition.id,
                name: definition.name,
                icon: definition.icon,
                detail: definition.detail,
                target: definition.target
            )
            achievement.progress = progress(definition.id, profile: profile, calendar: calendar)
            if achievement.unlockedAt == nil, achievement.progress >= achievement.target {
                achievement.unlockedAt = now
                unlockedNow.append(achievement)
            }
            ordered.append(achievement)
        }

        profile.achievements = ordered
        return unlockedNow
    }
}
