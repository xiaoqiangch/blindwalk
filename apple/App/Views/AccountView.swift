import SwiftUI

// MARK: - 账号（docs/parity.md §4 / account/docs/API.md）
//
// 未登录：本地单机可用；登录后：同步到账号 / 从账号恢复 / 退出 / 删除账号。
// 服务地址可配置，默认 http://127.0.0.1:8803。

struct AccountView: View {

    let store: BlindWalkStore

    @Environment(\.dismiss) private var dismiss
    @State private var account = AccountService.shared
    @State private var baseURL = ""
    @State private var username = ""
    @State private var password = ""
    @State private var deletePassword = ""
    @State private var showDeleteConfirm = false
    @State private var localMessage: String?

    @AppStorage("bw.soundEnabled") private var soundEnabled = true
    @AppStorage("bw.hapticsEnabled") private var hapticsEnabled = true

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
            .background(BWPaperBackground())
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
                    if env["BW_ACCOUNT_AUTO_LOGIN"] == "1", !account.isLoggedIn {
                        let username = env["BW_ACCOUNT_USER"] ?? "bwscreenshot"
                        let password = env["BW_ACCOUNT_PASS"] ?? "screenshot123"
                        if !(await account.login(username: username, password: password)) {
                            _ = await account.register(username: username, password: password)
                        }
                        localMessage = account.lastMessage
                        if env["BW_ACCOUNT_AUTO_SYNC"] == "1", account.isLoggedIn {
                            let envelope = AccountSyncEnvelope(
                                profile: store.profile,
                                surprises: store.surprises,
                                settings: ["sound": soundEnabled, "haptics": hapticsEnabled]
                            )
                            _ = await account.push(envelope)
                            localMessage = account.lastMessage
                        }
                        if env["BW_ACCOUNT_AUTO_SYNC"] == "1", account.isLoggedIn {
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
                    .foregroundStyle(account.isLoggedIn ? BWTheme.teal : BWTheme.ink3)
                VStack(alignment: .leading, spacing: 2) {
                    Text(account.isLoggedIn ? "已登录：\(account.user?.username ?? "")" : "未登录 · 数据只存在这台设备")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(BWTheme.ink)
                    Text(account.isLoggedIn ? account.baseURL : "不登录也能用，数据留在本机。")
                        .font(.system(size: 13))
                        .foregroundStyle(BWTheme.ink3)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }

            if let message = localMessage ?? account.lastMessage {
                Text(message)
                    .font(.system(size: 13))
                    .foregroundStyle(BWTheme.teal)
            }
            if let error = account.lastError {
                Text(error)
                    .font(.system(size: 13))
                    .foregroundStyle(BWTheme.ember)
            }

            HStack(spacing: 14) {
                stat("\(store.profile.cards.count)", "卡片")
                stat("\(store.profile.xp)", "探索值")
                stat("\(store.surprises.count)", "惊喜")
                Spacer(minLength: 0)
            }
        }
        .padding(16)
        .background(BWTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(BWTheme.line, lineWidth: 1))
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.system(size: 18, weight: .bold)).monospacedDigit().foregroundStyle(BWTheme.ink)
            Text(label).font(.system(size: 12)).foregroundStyle(BWTheme.ink3)
        }
    }

    // MARK: 未登录：登录 / 注册

    private var loginCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            field("账号服务地址", text: $baseURL, placeholder: "http://127.0.0.1:8803", secure: false)
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
                .buttonStyle(BWPressEffectStyle())

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
                .buttonStyle(BWPressEffectStyle())
            }
            .disabled(account.isBusy || username.isEmpty || password.isEmpty)

            if account.isBusy {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.small)
                    Text("正在连接账号服务…").font(.system(size: 13)).foregroundStyle(BWTheme.ink3)
                }
            }
        }
        .padding(16)
        .background(BWTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(BWTheme.line, lineWidth: 1))
    }

    private func field(_ label: String, text: Binding<String>, placeholder: String, secure: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 12, weight: .semibold)).foregroundStyle(BWTheme.ink3)
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
            .background(BWTheme.paper2)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(BWTheme.line, lineWidth: 1))
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
            .buttonStyle(BWPressEffectStyle())

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
            .buttonStyle(BWPressEffectStyle())

            Button {
                Task {
                    await account.logout()
                    localMessage = account.lastMessage
                }
            } label: {
                buttonLabel("退出登录", filled: false)
            }
            .buttonStyle(BWPressEffectStyle())

            Button {
                showDeleteConfirm = true
            } label: {
                Text("删除账号")
                    .font(.system(size: 14.5, weight: .medium))
                    .foregroundStyle(BWTheme.ember)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
            }
            .buttonStyle(BWPressEffectStyle())
        }
        .padding(16)
        .background(BWTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(BWTheme.line, lineWidth: 1))
        .disabled(account.isBusy)
    }

    private var hintCard: some View {
        Text("账号是可选的。不登录也能用，数据留在本机。\n云端账号需要把 account 服务跑起来（bash scripts/start-account.sh）；模拟器可直接连 http://127.0.0.1:8803。")
            .font(.system(size: 13))
            .foregroundStyle(BWTheme.ink3)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func buttonLabel(_ title: String, filled: Bool) -> some View {
        Text(title)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(filled ? BWTheme.paper : BWTheme.ink)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 11)
            .background(filled ? BWTheme.amberDeep : BWTheme.paper2)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(filled ? Color.clear : BWTheme.line, lineWidth: 1))
    }

    private func commitBaseURL() {
        account.setBaseURL(baseURL)
        baseURL = account.baseURL
    }
}
