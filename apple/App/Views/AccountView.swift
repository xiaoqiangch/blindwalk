import SwiftUI

// MARK: - 账号（docs/parity.md §4 / account/docs/API.md）
//
// 未登录：本地单机可用；登录后：同步到账号 / 从账号恢复 / 退出 / 删除账号。
// 服务地址可配置，默认 https://xqlounge.top。

struct AccountView: View {

    let store: WalkaholicStore

    @Environment(\.dismiss) private var dismiss
    @State private var account = AccountService.shared
    @State private var baseURL = ""
    @State private var username = ""
    @State private var password = ""
    @State private var deletePassword = ""
    @State private var showDeleteConfirm = false
    @State private var localMessage: String?

    @AppStorage("wa.soundEnabled") private var soundEnabled = true
    @AppStorage("wa.hapticsEnabled") private var hapticsEnabled = true

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 16) {
                    statusCard
                    if account.isLoggedIn {
                        syncCard
                    } else {
                        loginCard
                    }
                    hintCard
                }
                .padding(20)
            }
            .background(WAPaperBackground())
            .navigationTitle("账号")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("完成") { dismiss() }
                }
            }
            .onAppear {
                baseURL = account.baseURL
                Task {
                    await account.refresh()
                    baseURL = account.baseURL
                    let env = ProcessInfo.processInfo.environment
                    if env["WA_ACCOUNT_AUTO_LOGIN"] == "1", !account.isLoggedIn {
                        let username = env["WA_ACCOUNT_USER"] ?? "wascreenshot"
                        let password = env["WA_ACCOUNT_PASS"] ?? "screenshot123"
                        if !(await account.login(username: username, password: password)) {
                            _ = await account.register(username: username, password: password)
                        }
                        localMessage = account.lastMessage
                        if env["WA_ACCOUNT_AUTO_SYNC"] == "1", account.isLoggedIn {
                            let envelope = AccountSyncEnvelope(
                                profile: store.profile,
                                surprises: store.surprises,
                                settings: ["sound": soundEnabled, "haptics": hapticsEnabled]
                            )
                            _ = await account.push(envelope)
                            localMessage = account.lastMessage
                        }
                        if env["WA_ACCOUNT_AUTO_SYNC"] == "1", account.isLoggedIn {
                            let envelope = AccountSyncEnvelope(
                                profile: store.profile,
                                surprises: store.surprises,
                                settings: ["sound": soundEnabled, "haptics": hapticsEnabled]
                            )
                            _ = await account.push(envelope)
                            localMessage = account.lastMessage
                        }
                    }
                }
            }
            .alert("删除账号？", isPresented: $showDeleteConfirm) {
                SecureField("输入密码确认", text: $deletePassword)
                Button("删除", role: .destructive) {
                    Task {
                        if await account.deleteAccount(password: deletePassword) {
                            deletePassword = ""
                            localMessage = account.lastMessage
                        }
                    }
                }
                Button("取消", role: .cancel) { deletePassword = "" }
            } message: {
                Text("删除后账号、云端资料和所有会话都会被清掉，不能恢复。")
            }
        }
    }

    // MARK: 当前状态

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: account.isLoggedIn ? "person.crop.circle.badge.checkmark" : "person.crop.circle")
                    .font(.system(size: 20))
                    .foregroundStyle(account.isLoggedIn ? WATheme.teal : WATheme.ink3)
                VStack(alignment: .leading, spacing: 2) {
                    Text(account.isLoggedIn ? "已登录：\(account.user?.username ?? "")" : "未登录 · 数据只存在这台设备")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(WATheme.ink)
                    Text(account.isLoggedIn ? account.baseURL : "不登录也能用，数据留在本机。")
                        .font(.system(size: 13))
                        .foregroundStyle(WATheme.ink3)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }

            if let message = localMessage ?? account.lastMessage {
                Text(message)
                    .font(.system(size: 13))
                    .foregroundStyle(WATheme.teal)
            }
            if let error = account.lastError {
                Text(error)
                    .font(.system(size: 13))
                    .foregroundStyle(WATheme.ember)
            }

            HStack(spacing: 14) {
                stat("\(store.profile.cards.count)", "卡片")
                stat("\(store.profile.xp)", "探索值")
                stat("\(store.surprises.count)", "惊喜")
                Spacer(minLength: 0)
            }
        }
        .padding(16)
        .background(WATheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(WATheme.line, lineWidth: 1))
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.system(size: 18, weight: .bold)).monospacedDigit().foregroundStyle(WATheme.ink)
            Text(label).font(.system(size: 12)).foregroundStyle(WATheme.ink3)
        }
    }

    // MARK: 未登录：登录 / 注册

    private var loginCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            field("账号服务地址", text: $baseURL, placeholder: "https://xqlounge.top", secure: false)
            field("用户名", text: $username, placeholder: "3–24 个字符", secure: false)
            field("密码", text: $password, placeholder: "至少 6 位", secure: true)

            HStack(spacing: 10) {
                Button {
                    commitBaseURL()
                    Task {
                        localMessage = nil
                        if await account.login(username: username, password: password) {
                            localMessage = account.lastMessage
                        }
                    }
                } label: {
                    buttonLabel("登录", filled: true)
                }
                .buttonStyle(WAPressEffectStyle())

                Button {
                    commitBaseURL()
                    Task {
                        localMessage = nil
                        if await account.register(username: username, password: password) {
                            localMessage = account.lastMessage
                        }
                    }
                } label: {
                    buttonLabel("注册并登录", filled: false)
                }
                .buttonStyle(WAPressEffectStyle())
            }
            .disabled(account.isBusy || username.isEmpty || password.isEmpty)

            if account.isBusy {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.small)
                    Text("正在连接账号服务…").font(.system(size: 13)).foregroundStyle(WATheme.ink3)
                }
            }
        }
        .padding(16)
        .background(WATheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(WATheme.line, lineWidth: 1))
    }

    private func field(_ label: String, text: Binding<String>, placeholder: String, secure: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 12, weight: .semibold)).foregroundStyle(WATheme.ink3)
            Group {
                if secure {
                    SecureField(placeholder, text: text)
                } else {
                    TextField(placeholder, text: text)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
            }
            .font(.system(size: 14))
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(WATheme.paper2)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(WATheme.line, lineWidth: 1))
        }
    }

    // MARK: 已登录：同步 / 恢复 / 退出 / 删号

    private var syncCard: some View {
        VStack(spacing: 10) {
            Button {
                Task {
                    localMessage = nil
                    let envelope = AccountSyncEnvelope(
                        profile: store.profile,
                        surprises: store.surprises,
                        settings: ["sound": soundEnabled, "haptics": hapticsEnabled]
                    )
                    _ = await account.push(envelope)
                    localMessage = account.lastMessage
                }
            } label: {
                buttonLabel("同步到账号（覆盖云端）", filled: true)
            }
            .buttonStyle(WAPressEffectStyle())

            Button {
                Task {
                    localMessage = nil
                    if let envelope = await account.pull() {
                        if let profile = envelope.profile {
                            store.applyRemote(profile: profile, surprises: envelope.surprises)
                        }
                        if let settings = envelope.settings {
                            if let sound = settings["sound"] { soundEnabled = sound }
                            if let haptics = settings["haptics"] { hapticsEnabled = haptics }
                        }
                        localMessage = account.lastMessage
                    }
                }
            } label: {
                buttonLabel("从账号恢复（覆盖本机）", filled: false)
            }
            .buttonStyle(WAPressEffectStyle())

            Button {
                Task {
                    await account.logout()
                    localMessage = account.lastMessage
                }
            } label: {
                buttonLabel("退出登录", filled: false)
            }
            .buttonStyle(WAPressEffectStyle())

            Button {
                showDeleteConfirm = true
            } label: {
                Text("删除账号")
                    .font(.system(size: 14.5, weight: .medium))
                    .foregroundStyle(WATheme.ember)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
            }
            .buttonStyle(WAPressEffectStyle())
        }
        .padding(16)
        .background(WATheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(WATheme.line, lineWidth: 1))
        .disabled(account.isBusy)
    }

    private var hintCard: some View {
        Text("账号是可选的。不登录也能用，数据留在本机。\n默认连公网 https://xqlounge.top（已部署），单元测试/本地开发也可改成 http://127.0.0.1:8803。")
            .font(.system(size: 13))
            .foregroundStyle(WATheme.ink3)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func buttonLabel(_ title: String, filled: Bool) -> some View {
        Text(title)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(filled ? WATheme.paper : WATheme.ink)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 11)
            .background(filled ? WATheme.amberDeep : WATheme.paper2)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(filled ? Color.clear : WATheme.line, lineWidth: 1))
    }

    private func commitBaseURL() {
        account.setBaseURL(baseURL)
        baseURL = account.baseURL
    }
}
