import Foundation

/// 社交演示数据与工具（MVP 无后端，全部本地 mock）
public enum SocialFeed {

    /// 同频码：6 位大写字母 + 数字，去掉易混字符
    public static func makeTogetherCode(seed: UInt64 = UInt64(Date().timeIntervalSince1970)) -> String {
        let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
        var generator = SeededGenerator(seed: seed)
        return String((0..<6).map { _ in alphabet[Int.random(in: 0..<alphabet.count, using: &generator)] })
    }

    /// 好友动态（相对时间）
    public static func mockPosts(now: Date = Date()) -> [FeedPost] {
        [
            FeedPost(
                authorName: "小满",
                authorEmoji: "🐱",
                placeName: "旧仓库改的书店",
                categoryEmoji: "📚",
                rarity: .rare,
                caption: "本来只想路过，结果在里面坐了一个小时。",
                createdAt: now.addingTimeInterval(-12 * 60),
                reactions: ["羡慕": 12, "一起": 3, "下次带我": 5]
            ),
            FeedPost(
                authorName: "阿岛",
                authorEmoji: "🎧",
                placeName: "桥洞下的小块涂鸦墙",
                categoryEmoji: "🎨",
                rarity: .epic,
                caption: "桥洞里回声很大，我对着墙说了句「你好」，它回了我三遍。",
                createdAt: now.addingTimeInterval(-48 * 60),
                reactions: ["羡慕": 21, "一起": 6, "下次带我": 9]
            ),
            FeedPost(
                authorName: "77",
                authorEmoji: "🌙",
                placeName: "24 小时自助洗衣店",
                categoryEmoji: "🧺",
                rarity: .hidden,
                caption: "凌晨两点，洗衣机转起来像宇宙飞船。",
                createdAt: now.addingTimeInterval(-3 * 3600),
                reactions: ["羡慕": 31, "一起": 2, "下次带我": 14]
            ),
            FeedPost(
                authorName: "老陈",
                authorEmoji: "🍜",
                placeName: "小馄饨摊的第三张塑料凳",
                categoryEmoji: "🥟",
                rarity: .rare,
                caption: "第三张凳子真的会晃。老板说那是他故意的。",
                createdAt: now.addingTimeInterval(-6 * 3600),
                reactions: ["羡慕": 8, "一起": 4, "下次带我": 2]
            )
        ]
    }

    /// 周榜（含本人）
    public static func leaderboard(profile: Profile) -> [LeaderboardEntry] {
        let others = [
            LeaderboardEntry(id: "u1", name: "小满", emoji: "🐱", score: 520),
            LeaderboardEntry(id: "u2", name: "阿岛", emoji: "🎧", score: 465),
            LeaderboardEntry(id: "u3", name: "77", emoji: "🌙", score: 400),
            LeaderboardEntry(id: "u4", name: "老陈", emoji: "🍜", score: 320)
        ]
        let me = LeaderboardEntry(id: "me", name: profile.displayName, emoji: "🫥", score: profile.weeklySurprise, isMe: true)
        return (others + [me]).sorted { $0.score > $1.score }
    }
}
