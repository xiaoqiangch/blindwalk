import SwiftUI

// MARK: - 我的 Profile（design-system §5.7）

struct ProfileView: View {

    let store: BlindWalkStore

    @AppStorage("bw.soundEnabled") private var soundEnabled = true
    @AppStorage("bw.hapticsEnabled") private var hapticsEnabled = true

    @State private var toast: BWToast?
    @State private var showClearConfirm = false

    var body: some View {
        ZStack {
            BWPaperBackground()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    levelCard
                    achievementStrip
                    settingsCard
                    versionFooter
                }
                .padding(.horizontal, BWTheme.pagePadding)
                .padding(.top, 8)
                .padding(.bottom, 24)
            }
        }
        .bwToast($toast)
        .confirmationDialog("清除演示数据？", isPresented: $showClearConfirm, titleVisibility: .visible) {
            Button("清除", role: .destructive) {
                clearDemoData()
            }
            Button("取消", role: .cancel) {
            }
        } message: {
            Text("会清空卡片、成就和动态，回到第一天。")
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    // MARK: 顶栏

    private var header: some View {
        HStack(alignment: .center) {
            Text("我的")
                .font(BWTheme.title(26))
                .foregroundStyle(BWTheme.ink)

            Spacer(minLength: 0)

            Text("🫥")
                .font(.system(size: 26))
                .frame(width: 44, height: 44)
                .background(BWTheme.paper2)
                .clipShape(Circle())
                .overlay(Circle().stroke(BWTheme.line, lineWidth: 1))
        }
    }

    // MARK: 等级卡

    private var levelCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("散步 Lv.\(store.profile.level) · \(store.profile.levelName)")
                    .font(BWTheme.title(20))
                    .foregroundStyle(BWTheme.ink)
                Spacer(minLength: 0)
            }

            VStack(alignment: .leading, spacing: 6) {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(BWTheme.line)
                        Capsule()
                            .fill(
                                LinearGradient(
                                    colors: [BWTheme.amber, BWTheme.amberDeep],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                            .frame(width: max(0, geo.size.width * CGFloat(store.profile.levelProgress)))
                    }
                }
                .frame(height: 8)

                HStack {
                    Text("\(store.profile.xp - store.profile.levelFloorXP) / 800")
                        .font(BWTheme.caption(10))
                        .monospacedDigit()
                        .foregroundStyle(BWTheme.ink3)
                    Spacer(minLength: 0)
                    Text("\(store.profile.xp) XP")
                        .font(BWTheme.caption(10))
                        .monospacedDigit()
                        .foregroundStyle(BWTheme.ink3)
                }
            }

            HStack(spacing: 0) {
                miniStat(value: "\(BWFormat.decimal1(store.profile.totalKm)) km", title: "累计")
                miniStatDivider
                miniStat(value: "\(store.profile.boxesOpened)", title: "盒")
                miniStatDivider
                miniStat(value: "\(store.profile.streakDays)", title: "天")
            }
        }
        .padding(20)
        .background(
            ZStack {
                LinearGradient(
                    colors: [BWTheme.paper, BWTheme.paper2],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                BWPaperTexture().opacity(0.4)
            }
        )
        .clipShape(RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous)
                .stroke(BWTheme.line, lineWidth: 1)
        )
        .shadow(color: BWTheme.ink.opacity(0.08), radius: 16, x: 0, y: 10)
    }

    private func miniStat(value: String, title: String) -> some View {
        VStack(spacing: 3) {
            Text(value)
                .font(BWTheme.caption(14))
                .monospacedDigit()
                .foregroundStyle(BWTheme.ink)
            Text(title)
                .font(BWTheme.caption(10))
                .foregroundStyle(BWTheme.ink3)
        }
        .frame(maxWidth: .infinity)
    }

    private var miniStatDivider: some View {
        Rectangle()
            .fill(BWTheme.line)
            .frame(width: 1, height: 24)
    }

    // MARK: 成就横向滚动

    private var achievementStrip: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text("成就")
                    .font(BWTheme.title(17))
                    .foregroundStyle(BWTheme.ink)

                Spacer(minLength: 0)

                NavigationLink {
                    AchievementsView(store: store)
                } label: {
                    HStack(spacing: 2) {
                        Text("全部成就")
                            .font(BWTheme.caption(12))
                        Image(systemName: "chevron.right")
                            .font(.system(size: 9, weight: .semibold))
                    }
                    .foregroundStyle(BWTheme.amberDeep)
                }
                .buttonStyle(.plain)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(achievements) { achievement in
                        VStack(spacing: 6) {
                            Text(achievement.icon)
                                .font(.system(size: 22))
                                .frame(width: 48, height: 48)
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

                            Text(achievement.name)
                                .font(.system(size: 9))
                                .foregroundStyle(
                                    achievement.isUnlocked ? BWTheme.ink2 : BWTheme.ink3
                                )
                                .lineLimit(1)
                                .frame(width: 64)
                        }
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    // MARK: 设置

    private var settingsCard: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                settingIcon("speaker.wave.2")
                Text("音效")
                    .font(BWTheme.body(14))
                    .foregroundStyle(BWTheme.ink)
                Spacer(minLength: 0)
                Toggle(
                    "",
                    isOn: Binding(
                        get: { soundEnabled },
                        set: { newValue in
                            soundEnabled = newValue
                        }
                    )
                )
                .labelsHidden()
                .tint(BWTheme.amberDeep)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            settingDivider

            HStack(spacing: 12) {
                settingIcon("hand.tap")
                Text("触感")
                    .font(BWTheme.body(14))
                    .foregroundStyle(BWTheme.ink)
                Spacer(minLength: 0)
                Toggle(
                    "",
                    isOn: Binding(
                        get: { hapticsEnabled },
                        set: { newValue in
                            hapticsEnabled = newValue
                            BWHaptics.isEnabled = newValue
                        }
                    )
                )
                .labelsHidden()
                .tint(BWTheme.amberDeep)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            settingDivider

            Button {
                showToast("位置只在本地判断距离，不上传任何坐标。", icon: "lock.shield")
            } label: {
                HStack(spacing: 12) {
                    settingIcon("lock.shield")
                    Text("隐私与安全")
                        .font(BWTheme.body(14))
                        .foregroundStyle(BWTheme.ink)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(BWTheme.ink3)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            settingDivider

            Button {
                showToast("当前使用模拟步行；接入后端坐标后可切真实定位。", icon: "location")
            } label: {
                HStack(spacing: 12) {
                    settingIcon("location")
                    Text("定位方式")
                        .font(BWTheme.body(14))
                        .foregroundStyle(BWTheme.ink)
                    Spacer(minLength: 0)
                    Text("模拟步行")
                        .font(BWTheme.caption(11))
                        .foregroundStyle(BWTheme.ink3)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(BWTheme.ink3)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            settingDivider

            Button {
                showClearConfirm = true
            } label: {
                HStack(spacing: 12) {
                    settingIcon("trash", tint: BWTheme.ember)
                    Text("清除演示数据")
                        .font(BWTheme.body(14))
                        .foregroundStyle(BWTheme.ember)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(BWTheme.ember.opacity(0.6))
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            settingDivider

            Button {
                showToast("BlindWalk 0.1 · 不看见终点，才看得见路。", icon: "info.circle")
            } label: {
                HStack(spacing: 12) {
                    settingIcon("info.circle")
                    Text("关于")
                        .font(BWTheme.body(14))
                        .foregroundStyle(BWTheme.ink)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(BWTheme.ink3)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .background(BWTheme.paper.opacity(0.8))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(BWTheme.line, lineWidth: 1)
        )
    }

    private func settingIcon(_ systemName: String, tint: Color = BWTheme.ink3) -> some View {
        Image(systemName: systemName)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(tint)
            .frame(width: 22)
    }

    private var settingDivider: some View {
        Rectangle()
            .fill(BWTheme.line)
            .frame(height: 1)
            .padding(.leading, 50)
    }

    // MARK: 版本

    private var versionFooter: some View {
        Text("BlindWalk 0.1 · 原型")
            .font(BWTheme.caption(11))
            .foregroundStyle(BWTheme.ink3)
            .frame(maxWidth: .infinity)
            .padding(.top, 8)
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

    // MARK: 操作

    private func showToast(_ text: String, icon: String) {
        withAnimation(BWAnimation.regular) {
            toast = BWToast(text: text, icon: icon)
        }
    }

    private func clearDemoData() {
        store.reset()
        soundEnabled = true
        hapticsEnabled = true
        BWHaptics.isEnabled = true
        withAnimation(BWAnimation.regular) {
            toast = BWToast(text: "演示数据已清除", icon: "trash", tint: BWTheme.ember)
        }
    }
}
