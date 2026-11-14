import Foundation

/// 社交演示数据与工具（MVP 无后端，全部本地 mock）
public enum SocialFeed {

    /// 同频码：6 位大写字母 + 数字，去掉易混字符
    public static func makeTogetherCode(seed: UInt64 = UInt64(Date().timeIntervalSince1970)) -> String {
        let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
        var generator = SeededGenerator(seed: seed)
        return String((0..<6).map { _ in alphabet[Int.random(in: 0..<alphabet.count, using: &generator)] })
    }

    /// 周榜：只有本人。没有后端就没有别人的成绩，不编造对手。
    public static func leaderboard(profile: Profile) -> [LeaderboardEntry] {
        let me = LeaderboardEntry(
            id: "me",
            name: profile.displayName,
            emoji: "🫥",
            score: profile.weeklySurprise,
            isMe: true
        )
        return [me]
    }
}
