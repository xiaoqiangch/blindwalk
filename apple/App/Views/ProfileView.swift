import SwiftUI

// MARK: - 我的 Profile（design-system §5.7，视觉基准：web 原型 #/profile）

struct ProfileView: View {

    let store: WalkaholicStore

    @AppStorage("wa.soundEnabled") private var soundEnabled = true
    @AppStorage("wa.hapticsEnabled") private var hapticsEnabled = true
    /// 地图朝向：true=跟随我转身；false=固定北朝上
    @AppStorage("wa.mapFollowsHeading") private var mapFollowsHeading = true

    @State private var toast: WAToast?
    @State private var showClearConfirm = false
    @State private var showAccount = false
    @State private var account = AccountService.shared
    /// 仅用于截图/演示：`SIMCTL_CHILD_WA_PREVIEW=achievements` 直达成就页
    @State private var showAchievements = false

    var body: some View {
        List {
            Section {
                levelCard
                    .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16))
                    .listRowBackground(Color.clear)
            }

            Section("我的城市") {
                NavigationLink {
                    CityMapView(store: store)
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "map")
                            .font(.body)
                            .foregroundStyle(WATheme.amber)
                            .frame(width: 26)

                        VStack(alignment: .leading, spacing: 2) {
                            Text("个人城市地图")
                            Text(cityMapCaption)
                                .font(.caption)
                                .foregroundStyle(WATheme.ink2)
                                .monospacedDigit()
                        }
                    }
                }
            }

            Section("成就") {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 14) {
                        ForEach(achievements) { achievement in
                            NavigationLink {
                                AchievementsView(store: store)
                            } label: {
                                achievementBadge(achievement)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))

                NavigationLink {
                    AchievementsView(store: store)
                } label: {
                    Label("全部成就", systemImage: "rosette")
                }
            }

            Section("账号") {
                Button {
                    showAccount = true
                } label: {
                    HStack {
                        Label(account.user == nil ? "登录账号" : (account.user?.username ?? ""), systemImage: account.user == nil ? "icloud" : "person.crop.circle.badge.checkmark")
                        Spacer()
                        Text(account.user == nil ? "未登录" : "已同步")
                            .font(.subheadline)
                            .foregroundStyle(WATheme.ink2)
                    }
                }
            }

            Section("设置") {
                Toggle("音效", isOn: $soundEnabled)
                Toggle("触感", isOn: Binding(
                    get: { hapticsEnabled },
                    set: { value in
                        hapticsEnabled = value
                        WAHaptics.isEnabled = value
                    }
                ))
                Toggle("地图跟随我转身", isOn: $mapFollowsHeading)
            }

            Section {
                Button("隐私与安全") {
                    showToast("位置只在本地判断距离，不上传任何坐标。", icon: "lock.shield")
                }
                Button("关于") {
                    showToast("步迷 0.1 · 不看见终点，才看得见路。", icon: "info.circle")
                }
                Button("清除演示数据", role: .destructive) {
                    showClearConfirm = true
                }
            }
        }
        .listStyle(.insetGrouped)
        .background(WATheme.cream)
        .navigationTitle("我的")
        .waToast($toast)
        .confirmationDialog("清除演示数据？", isPresented: $showClearConfirm, titleVisibility: .visible) {
            Button("清除", role: .destructive) {
                clearDemoData()
            }
            Button("取消", role: .cancel) {
            }
        } message: {
            Text("会清空卡片、成就和动态，回到第一天。")
        }
        .waTypeBounds()
        .navigationDestination(isPresented: $showAchievements) {
            AchievementsView(store: store)
        }
        .sheet(isPresented: $showAccount) {
            AccountView(store: store)
        }
        .onAppear {
            let environment = ProcessInfo.processInfo.environment
            if environment["WA_PREVIEW"] == "profile" {
                if environment["WA_PREVIEW_SUBPAGE"] == "achievements" {
                    showAchievements = true
                } else if environment["WA_PREVIEW_SUBPAGE"] == "account" {
                    showAccount = true
                }
            }
            Task { await account.refresh() }
        }
    }

    // MARK: 等级卡
    //
    // 富细节放在「进度 + 三个读数」上，卡片本身保持白面。
    // 上一版用主色渐变铺满整张卡，导致它抢走整屏注意力，且和首页盲盒卡看不出主次。

    private var levelCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Text(store.profile.displayName.prefix(1))
                    .font(.title3.weight(.medium))
                    .foregroundStyle(WATheme.ink2)
                    .frame(width: 48, height: 48)
                    .background(Color(.secondarySystemFill))
                    .clipShape(Circle())

                VStack(alignment: .leading, spacing: 2) {
                    Text(store.profile.displayName)
                        .font(.headline)
                    Text("散步 Lv.\(store.profile.level) · \(store.profile.levelName)")
                        .font(.subheadline)
                        .foregroundStyle(WATheme.ink2)
                }
                .lineLimit(1)
                .minimumScaleFactor(0.8)

                Spacer(minLength: 0)
            }

            VStack(alignment: .leading, spacing: 4) {
                ProgressView(value: store.profile.levelProgress)
                    .tint(WATheme.amber)
                HStack {
                    Text("\(store.profile.xp - store.profile.levelFloorXP) / 800")
                        .monospacedDigit()
                    Spacer(minLength: 0)
                    Text("还差 \(max(0, 800 - (store.profile.xp - store.profile.levelFloorXP))) 升下一级")
                        .monospacedDigit()
                }
                .font(.caption)
                .foregroundStyle(WATheme.ink2)
            }

            HStack(spacing: 0) {
                levelStat(value: WAFormat.decimal1(store.profile.totalKm), unit: "km", title: "累计里程")
                Divider().frame(height: 28)
                levelStat(value: "\(store.profile.boxesOpened)", unit: nil, title: "开盒")
                Divider().frame(height: 28)
                levelStat(value: "\(store.profile.streakDays)", unit: nil, title: "连续天数")
            }
        }
        .padding(16)
        .background(WATheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
    }

    private func levelStat(value: String, unit: String?, title: String) -> some View {
        VStack(spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value)
                    .font(.headline)
                    .monospacedDigit()
                if let unit {
                    Text(unit)
                        .font(.caption)
                        .foregroundStyle(WATheme.ink2)
                }
            }
            Text(title)
                .font(.caption)
                .foregroundStyle(WATheme.ink2)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: 成就横向滚动

    private func achievementBadge(_ achievement: Achievement) -> some View {
        VStack(spacing: 6) {
            Group {
                if achievement.isUnlocked {
                    Text(achievement.icon)
                        .font(.system(size: 20))
                } else {
                    Image(systemName: "lock")
                        .font(.system(size: 14, weight: .regular))
                        .foregroundStyle(WATheme.ink3)
                }
            }
            .frame(width: 48, height: 48)
            .background(Color(.secondarySystemFill))
            .clipShape(Circle())
            .opacity(achievement.isUnlocked ? 1 : 0.45)

            Text(achievement.name)
                .font(.caption2)
                .foregroundStyle(achievement.isUnlocked ? WATheme.ink : WATheme.ink2)
                .lineLimit(1)
                .frame(width: 62)
        }
        .frame(width: 54)
        .accessibilityLabel("\(achievement.name)\(achievement.isUnlocked ? "，已获得" : "，未解锁")")
    }

    // MARK: 数据

    private var cityMapCaption: String {
        let track = WalkTrackStore.shared
        if track.isEmpty {
            return "走完第一个盲盒，这里会长出你的路"
        }
        let km = WAFormat.decimal1(track.totalMeters / 1000)
        return "\(track.walkedDayCount) 天 · \(km) 公里 · \(track.exploredCellCount) 个街区"
    }

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
        withAnimation(WAAnimation.regular) {
            toast = WAToast(text: text, icon: icon)
        }
    }

    private func clearDemoData() {
        store.reset()
        soundEnabled = true
        hapticsEnabled = true
        WAHaptics.isEnabled = true
        withAnimation(WAAnimation.regular) {
            toast = WAToast(text: "演示数据已清除", icon: "trash", tint: WATheme.ember)
        }
    }
}
