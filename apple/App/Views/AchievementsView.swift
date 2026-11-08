import SwiftUI

// MARK: - 成就 Achievements（design-system §5.8，push 页）

struct AchievementsView: View {

    let store: BlindWalkStore

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            BWPaperBackground()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    summary

                    VStack(spacing: 12) {
                        ForEach(achievements) { achievement in
                            achievementRow(achievement)
                        }
                    }
                }
                .padding(.horizontal, BWTheme.pagePadding)
                .padding(.top, 8)
                .padding(.bottom, 28)
            }
        }
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .navigationBar)
    }

    // MARK: 顶栏（自定义返回，兼顾 push 与独立呈现）

    private var header: some View {
        HStack(spacing: 12) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(BWTheme.ink2)
                    .frame(width: 34, height: 34)
                    .background(BWTheme.paper)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(BWTheme.line, lineWidth: 1))
            }
            .buttonStyle(BWPressEffectStyle())

            Text("成就")
                .font(BWTheme.title(26))
                .foregroundStyle(BWTheme.ink)

            Spacer(minLength: 0)

            Text("\(unlockedCount)/\(achievements.count)")
                .font(BWTheme.caption(12))
                .monospacedDigit()
                .foregroundStyle(BWTheme.ink3)
        }
    }

    private var summary: some View {
        Text("已经亮起 \(unlockedCount) 个。慢慢走，会有的。")
            .font(BWTheme.caption(12))
            .foregroundStyle(BWTheme.ink2)
    }

    // MARK: 成就行

    private func achievementRow(_ achievement: Achievement) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Text(achievement.icon)
                .font(.system(size: 22))
                .frame(width: 46, height: 46)
                .background(
                    achievement.isUnlocked
                        ? BWTheme.amber.opacity(0.14)
                        : BWTheme.paper2
                )
                .clipShape(Circle())
                .overlay(
                    Circle().stroke(
                        achievement.isUnlocked
                            ? BWTheme.amber.opacity(0.55)
                            : BWTheme.line,
                        lineWidth: 1
                    )
                )
                .saturation(achievement.isUnlocked ? 1 : 0)
                .opacity(achievement.isUnlocked ? 1 : 0.6)

            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text(achievement.name)
                        .font(BWTheme.title(15))
                        .foregroundStyle(BWTheme.ink)

                    Spacer(minLength: 6)

                    if achievement.isUnlocked {
                        Text("已获得")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(BWTheme.amberDeep)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background(BWTheme.amber.opacity(0.16))
                            .clipShape(Capsule())
                            .rotationEffect(.degrees(-4))
                    }
                }

                Text(achievement.detail)
                    .font(BWTheme.caption(11))
                    .foregroundStyle(BWTheme.ink2)

                HStack(spacing: 8) {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(BWTheme.line)
                            Capsule()
                                .fill(
                                    achievement.isUnlocked
                                        ? BWTheme.amber
                                        : BWTheme.ink3.opacity(0.5)
                                )
                                .frame(width: max(0, geo.size.width * CGFloat(achievement.fraction)))
                        }
                    }
                    .frame(height: 5)

                    Text("\(achievement.progress)/\(achievement.target)")
                        .font(.system(size: 9, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(BWTheme.ink3)
                }
            }
        }
        .padding(14)
        .background(BWTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(
                    achievement.isUnlocked
                        ? BWTheme.amber.opacity(0.45)
                        : BWTheme.line,
                    lineWidth: achievement.isUnlocked ? 1.4 : 1
                )
        )
        .shadow(
            color: BWTheme.ink.opacity(achievement.isUnlocked ? 0.08 : 0.04),
            radius: 10,
            x: 0,
            y: 6
        )
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
