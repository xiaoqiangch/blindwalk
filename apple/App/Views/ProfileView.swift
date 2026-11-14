import SwiftUI

// MARK: - 我的 Profile（design-system §5.7，视觉基准：web 原型 #/profile）

struct ProfileView: View {

    let store: BlindWalkStore

    @AppStorage("bw.soundEnabled") private var soundEnabled = true
    @AppStorage("bw.hapticsEnabled") private var hapticsEnabled = true
    /// 地图朝向：true=跟随我转身；false=固定北朝上
    @AppStorage("bw.mapFollowsHeading") private var mapFollowsHeading = true

    @State private var toast: BWToast?
    @State private var showClearConfirm = false
    @State private var showAccount = false
    @State private var account = AccountService.shared
    /// 仅用于截图/演示：`SIMCTL_CHILD_BW_PREVIEW=achievements` 直达成就页
    @State private var showAchievements = false

    var body: some View {
        ZStack {
            BWPaperBackground()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    levelCard.padding(.top, 12)
                    achievementStrip.padding(.top, 20)
                    settingsSection.padding(.top, 20)
                    versionFooter.padding(.top, 22)
                }
                .padding(.horizontal, BWTheme.pagePadding)
                .padding(.top, 6)
                .padding(.bottom, 26)
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
        .bwTabBarChrome()
        .bwTypeBounds()
        .navigationDestination(isPresented: $showAchievements) {
            AchievementsView(store: store)
        }
        .sheet(isPresented: $showAccount) {
            AccountView(store: store)
        }
        .onAppear {
            let environment = ProcessInfo.processInfo.environment
            if environment["BW_PREVIEW"] == "profile" {
                if environment["BW_PREVIEW_SUBPAGE"] == "achievements" {
                    showAchievements = true
                } else if environment["BW_PREVIEW_SUBPAGE"] == "account" {
                    showAccount = true
                }
            }
            Task { await account.refresh() }
        }
    }

    // MARK: 顶栏

    private var header: some View {
        HStack(alignment: .center) {
            Text("我的")
                .font(BWType.pageTitle())
                .foregroundStyle(BWTheme.ink)
            Spacer(minLength: 0)
        }
        .padding(.bottom, 12)
    }

    // MARK: 等级卡
    //
    // 富细节放在「进度 + 三个读数」上，卡片本身保持白面。
    // 上一版用主色渐变铺满整张卡，导致它抢走整屏注意力，且和首页盲盒卡看不出主次。

    private var levelCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("散步 Lv.\(store.profile.level)")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(BWTheme.ink)
                    Text(store.profile.levelName)
                        .font(.system(size: 12.5))
                        .foregroundStyle(BWTheme.ink3)
                }
                .lineLimit(1)
                .minimumScaleFactor(0.8)

                Spacer(minLength: 0)

                Text(store.profile.displayName.prefix(1))
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(BWTheme.ink2)
                    .frame(width: 40, height: 40)
                    .background(BWTheme.paper2)
                    .clipShape(Circle())
            }

            VStack(alignment: .leading, spacing: 6) {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(BWTheme.paper2)
                        Capsule()
                            .fill(BWTheme.amber)
                            .frame(width: max(0, geo.size.width * CGFloat(store.profile.levelProgress)))
                    }
                }
                .frame(height: 6)

                HStack {
                    Text("\(store.profile.xp - store.profile.levelFloorXP) / 800")
                        .monospacedDigit()
                    Spacer(minLength: 0)
                    Text("还差 \(max(0, 800 - (store.profile.xp - store.profile.levelFloorXP))) 升下一级")
                        .monospacedDigit()
                }
                .font(.system(size: 11.5))
                .foregroundStyle(BWTheme.ink3)
            }
            .padding(.top, 16)

            HStack(spacing: 16) {
                levelStat(value: BWFormat.decimal1(store.profile.totalKm), unit: "km", title: "累计里程")
                levelStat(value: "\(store.profile.boxesOpened)", unit: nil, title: "开盒")
                levelStat(value: "\(store.profile.streakDays)", unit: nil, title: "连续天数")
            }
            .padding(.top, 18)
        }
        .padding(18)
        .background(BWTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous)
                .stroke(BWTheme.line, lineWidth: 1)
        )
    }

    private func levelStat(value: String, unit: String?, title: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value)
                    .font(.system(size: 16, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(BWTheme.ink)
                if let unit {
                    Text(unit)
                        .font(.system(size: 11))
                        .foregroundStyle(BWTheme.ink3)
                }
            }
            Text(title)
                .font(.system(size: 11.5))
                .foregroundStyle(BWTheme.ink3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var levelStatDivider: some View {
        Rectangle()
            .fill(BWTheme.ink.opacity(0.10))
            .frame(width: 1, height: 26)
    }

    // MARK: 成就横向滚动

    private var achievementStrip: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("成就")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(BWTheme.ink)

                Spacer(minLength: 0)

                NavigationLink {
                    AchievementsView(store: store)
                } label: {
                    HStack(spacing: 2) {
                        Text("全部")
                            .font(.system(size: 12.5))
                        Image(systemName: "chevron.right")
                            .font(.system(size: 9, weight: .semibold))
                    }
                    .foregroundStyle(BWTheme.ink3)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("查看全部成就")
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(achievements) { achievement in
                        NavigationLink {
                            AchievementsView(store: store)
                        } label: {
                            achievementBadge(achievement)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 2)
            }
            .padding(.horizontal, -BWTheme.pagePadding)
            .padding(.horizontal, BWTheme.pagePadding)
        }
    }

    private func achievementBadge(_ achievement: Achievement) -> some View {
        VStack(spacing: 6) {
            Group {
                if achievement.isUnlocked {
                    Text(achievement.icon)
                        .font(.system(size: 20))
                } else {
                    Image(systemName: "lock")
                        .font(.system(size: 14, weight: .regular))
                        .foregroundStyle(BWTheme.ink3)
                }
            }
            .frame(width: 46, height: 46)
            .background(achievement.isUnlocked ? BWTheme.paper2 : BWTheme.paper)
            .clipShape(Circle())
            .overlay(
                Circle().stroke(achievement.isUnlocked ? BWTheme.line : BWTheme.line, lineWidth: 1)
            )
            .opacity(achievement.isUnlocked ? 1 : 0.7)

            Text(achievement.name)
                .font(.system(size: 11))
                .foregroundStyle(achievement.isUnlocked ? BWTheme.ink2 : BWTheme.ink3)
                .lineLimit(1)
                .frame(width: 62)
        }
        .frame(width: 54)
        .accessibilityLabel("\(achievement.name)\(achievement.isUnlocked ? "，已获得" : "，未解锁")")
    }

    // MARK: 设置

    // MARK: - 账号卡片

    private var accountCard: some View {
        Button {
            showAccount = true
        } label: {
            HStack(spacing: 12) {
                Image(systemName: account.user == nil ? "icloud" : "person.crop.circle")
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(BWTheme.ink2)
                    .frame(width: 30, height: 30)
                    .background(BWTheme.paper2)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                VStack(alignment: .leading, spacing: 2) {
                    Text(account.user == nil ? "登录账号" : "已登录 · " + (account.user?.username ?? ""))
                        .font(.system(size: 14.5))
                        .foregroundStyle(BWTheme.ink)
                    Text(account.user == nil
                         ? "卡片和进度存到云端，换手机也不丢"
                         : "进度可跨设备同步")
                        .font(.system(size: 12))
                        .foregroundStyle(BWTheme.ink3)
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(BWTheme.ink3)
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 54)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var settingsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("设置")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(BWTheme.ink)

            VStack(spacing: 0) {
                settingRow {
                    Text("音效")
                        .font(.system(size: 14.5))
                        .foregroundStyle(BWTheme.ink)
                    Spacer(minLength: 0)
                    Toggle("", isOn: Binding(
                        get: { soundEnabled },
                        set: { soundEnabled = $0 }
                    ))
                    .labelsHidden()
                    .tint(BWTheme.amber)
                    .scaleEffect(0.84)
                    .frame(width: 44)
                }

                BWHairline()

                settingRow {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("地图跟随我转身")
                            .font(.system(size: 14.5))
                            .foregroundStyle(BWTheme.ink)
                        Text(mapFollowsHeading ? "开 · 转身地图会转" : "关 · 地图固定北朝上")
                            .font(.system(size: 12))
                            .foregroundStyle(BWTheme.ink3)
                    }
                    Spacer(minLength: 0)
                    Toggle("", isOn: $mapFollowsHeading)
                        .labelsHidden()
                        .tint(BWTheme.amber)
                        .scaleEffect(0.84)
                        .frame(width: 44)
                }

                BWHairline()

                settingRow {
                    Text("触感")
                        .font(.system(size: 14.5))
                        .foregroundStyle(BWTheme.ink)
                    Spacer(minLength: 0)
                    Toggle("", isOn: Binding(
                        get: { hapticsEnabled },
                        set: { value in
                            hapticsEnabled = value
                            BWHaptics.isEnabled = value
                        }
                    ))
                    .labelsHidden()
                    .tint(BWTheme.amber)
                    .scaleEffect(0.84)
                    .frame(width: 44)
                }
            }
            .background(BWTheme.paper)
            .clipShape(RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous)
                    .stroke(BWTheme.line, lineWidth: 1)
            )

            VStack(spacing: 0) {
                accountCard

                BWHairline()

                settingLink {
                    showToast("位置只在本地判断距离，不上传任何坐标。", icon: "lock.shield")
                } label: {
                    Text("隐私与安全")
                        .font(.system(size: 14.5))
                        .foregroundStyle(BWTheme.ink)
                }

                BWHairline()

                settingLink {
                    showToast("当前使用模拟步行；接入后端坐标后可切真实定位。", icon: "location")
                } label: {
                    HStack(spacing: 8) {
                        Text("定位方式")
                            .font(.system(size: 14.5))
                            .foregroundStyle(BWTheme.ink)
                        Spacer(minLength: 0)
                        Text("模拟步行")
                            .font(.system(size: 12.5))
                            .foregroundStyle(BWTheme.ink3)
                    }
                }

                BWHairline()

                settingLink {
                    showToast("步谜 0.1 · 不看见终点，才看得见路。", icon: "info.circle")
                } label: {
                    Text("关于")
                        .font(.system(size: 14.5))
                        .foregroundStyle(BWTheme.ink)
                }

                BWHairline()

                settingLink {
                    showClearConfirm = true
                } label: {
                    Text("清除演示数据")
                        .font(.system(size: 14.5))
                        .foregroundStyle(BWTheme.ember)
                }
            }
            .background(BWTheme.paper)
            .clipShape(RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: BWTheme.cardRadius, style: .continuous)
                    .stroke(BWTheme.line, lineWidth: 1)
            )
        }
    }

    private func settingRow<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        HStack(spacing: 12) {
            content()
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 50)
    }

    private func settingLink<Label: View>(
        action: @escaping () -> Void,
        @ViewBuilder label: () -> Label
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                label()
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(BWTheme.ink3)
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 50)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: 版本

    private var versionFooter: some View {
        Text("步谜 0.1 · 原型")
            .font(.system(size: 12))
            .foregroundStyle(BWTheme.ink3)
            .frame(maxWidth: .infinity)
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
