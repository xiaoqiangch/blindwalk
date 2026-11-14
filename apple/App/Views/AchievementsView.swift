import SwiftUI

// MARK: - 成就 Achievements（design-system §5.8，push 页；视觉基准：web 原型 #/achievements）

struct AchievementsView: View {

    let store: WalkaholicStore

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            Section {
                ForEach(achievements) { achievement in
                    achievementRow(achievement)
                }
            } header: {
                Text("\(unlockedCount)/\(achievements.count) 已获得")
            }
        }
        .listStyle(.insetGrouped)
        .background(WATheme.cream)
        .navigationTitle("成就")
        .navigationBarTitleDisplayMode(.inline)
        .waTypeBounds()
    }

    // MARK: 成就行（系统列表行：图标 + 标题 + 说明 + 细进度条）

    private func achievementRow(_ achievement: Achievement) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(achievement.icon)
                .font(.title3)
                .frame(width: 36, height: 36)
                .background(Color(.secondarySystemFill))
                .clipShape(Circle())
                .saturation(achievement.isUnlocked ? 1 : 0)
                .opacity(achievement.isUnlocked ? 1 : 0.5)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(achievement.name)
                        .font(.body.weight(.medium))
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                    if achievement.isUnlocked {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.footnote)
                            .foregroundStyle(WATheme.teal)
                    }
                }

                Text(achievement.detail)
                    .font(.footnote)
                    .foregroundStyle(WATheme.ink2)
                    .fixedSize(horizontal: false, vertical: true)

                ProgressView(value: achievement.fraction)
                    .tint(achievement.isUnlocked ? WATheme.teal : WATheme.amber)
                    .padding(.top, 2)

                Text(achievement.isUnlocked
                     ? "已获得"
                     : "\(achievement.progress)/\(achievement.target)")
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(WATheme.ink2)
            }
        }
        .padding(.vertical, 4)
    }

    // MARK: 数据

    private var achievements: [Achievement] {
        if !store.profile.achievements.isEmpty {
            return store.profile.achievements
        }
        return AchievementEngine.definitions.map { definition in
            Achievement(
                id: definition.id,
                name: definition.name,
                icon: definition.icon,
                detail: definition.detail,
                target: definition.target,
                progress: AchievementEngine.progress(definition.id, profile: store.profile)
            )
        }
    }

    private var unlockedCount: Int {
        achievements.filter { $0.isUnlocked }.count
    }
}
