import SwiftUI

// MARK: - 成就 Achievements（design-system §5.8，push 页；视觉基准：web 原型 #/achievements）

struct AchievementsView: View {

    let store: BlindWalkStore

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            BWPaperBackground()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    VStack(spacing: 9) {
                        ForEach(achievements) { achievement in
                            achievementRow(achievement)
                        }
                    }
                    .padding(.top, 6)
                }
                .padding(.horizontal, BWTheme.pagePadding)
                .padding(.top, 4)
                .padding(.bottom, 26)
            }
        }
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .navigationBar)
        .bwTypeBounds()
    }

    // MARK: 顶栏

    private var header: some View {
        HStack(spacing: 6) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(BWTheme.ink)
                    .frame(width: 30, height: 34)
                    .contentShape(Rectangle())
            }
            .buttonStyle(BWPressEffectStyle())
            .accessibilityLabel("返回")

            Text("成就")
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(BWTheme.ink)

            Spacer(minLength: 0)

            Text("\(unlockedCount)/\(achievements.count)")
                .font(BWType.caption(11))
                .monospacedDigit()
                .foregroundStyle(BWTheme.ink3)
        }
        .padding(.bottom, 10)
    }

    // MARK: 成就行

    private func achievementRow(_ achievement: Achievement) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Text(achievement.icon)
                .font(.system(size: 18))
                .frame(width: 40, height: 40)
                .background(BWTheme.paper2)
                .clipShape(Circle())
                .saturation(achievement.isUnlocked ? 1 : 0)
                .opacity(achievement.isUnlocked ? 1 : 0.45)

            VStack(alignment: .leading, spacing: 0) {
                Text(achievement.name)
                    .font(.system(size: 13.5, weight: .semibold))
                    .foregroundStyle(BWTheme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)

                Text(achievement.detail)
                    .font(BWType.caption(10.5))
                    .foregroundStyle(BWTheme.ink3)
                    .padding(.top, 2)
                    .padding(.bottom, 7)

                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(BWTheme.paper2)
                        Capsule()
                            .fill(achievement.isUnlocked ? BWTheme.amber : BWTheme.ink3.opacity(0.55))
                            .frame(width: max(0, geo.size.width * CGFloat(achievement.fraction)))
                    }
                }
                .frame(height: 4)
            }

            Spacer(minLength: 4)

            if achievement.isUnlocked {
                Text("已获得")
                    .font(.system(size: 9, weight: .bold))
                    .tracking(0.5)
                    .foregroundStyle(BWTheme.amberDeep)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .overlay(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .stroke(BWTheme.amberDeep.opacity(0.5), lineWidth: 1)
                    )
                    .rotationEffect(.degrees(-6))
            } else {
                Text("\(achievement.progress)/\(achievement.target)")
                    .font(.system(size: 10))
                    .monospacedDigit()
                    .foregroundStyle(BWTheme.ink3)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background {
            if achievement.isUnlocked {
                LinearGradient(
                    colors: [BWTheme.paper.opacity(0.0), BWTheme.amber.opacity(0.06)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .background(BWTheme.paper)
            } else {
                BWTheme.paper
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(
                    achievement.isUnlocked ? BWTheme.amber.opacity(0.48) : BWTheme.line,
                    lineWidth: 1
                )
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
