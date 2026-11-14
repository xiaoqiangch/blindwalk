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
    /// 微信登录：服务端是否启用 + 是否有码
    @State private var wechatConfig: WeChatLoginService.Config?
    @State private var wechatLoading = false
    private let wechat = WeChatLoginService()

    /// Apple 登录
    @State private var appleLoading = false
    private let apple = AppleLoginService()

    /// 短信登录
    @State private var sms = SmsLoginService.shared
    @State private var smsPhone = ""
    @State private var smsCode = ""
    @State private var smsExpanded = false

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
                Task { wechatConfig = await wechat.loadConfig(baseURL: account.baseURL) }
                Task { await sms.refreshAvailability(baseURL: account.baseURL) }
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

    // MARK: 未登录：微信 / 账号密码

    private var loginCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            appleButton
            smsSection
            wechatSection

            HStack(spacing: 8) {
                Rectangle().fill(WATheme.line).frame(height: 1)
                Text("或用账号密码").font(.footnote).foregroundStyle(WATheme.ink2).fixedSize()
                Rectangle().fill(WATheme.line).frame(height: 1)
            }

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
                            let count = await SurpriseService.shared.flushPending(store: store)
                            if count > 0 { localMessage = "已登录 · 补传了 \(count) 个之前埋下的惊喜" }
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
                            let count = await SurpriseService.shared.flushPending(store: store)
                            if count > 0 { localMessage = "注册成功 · 补传了 \(count) 个之前埋下的惊喜" }
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

    // MARK: Sign in with Apple

    private var appleButton: some View {
        VStack(spacing: 6) {
            Button {
                Task { await loginWithApple() }
            } label: {
                HStack(spacing: 8) {
                    if appleLoading {
                        ProgressView().controlSize(.small).tint(.white)
                    } else {
                        Image(systemName: "apple.logo")
                            .font(.title3)
                    }
                    Text(appleLoading ? "正在验证…" : "通过 Apple 登录")
                        .font(.body.weight(.medium))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 48)
                .background(Color.black)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(WAPressEffectStyle())
            .disabled(appleLoading || account.isBusy)

            Text("Apple 只把你的姓名和邮箱交给步迷，不会拿到你的 Apple ID。")
                .font(.caption2)
                .foregroundStyle(WATheme.ink3)
                .multilineTextAlignment(.center)
        }
    }

    private func loginWithApple() async {
        appleLoading = true
        defer { appleLoading = false }
        localMessage = nil
        commitBaseURL()
        do {
            let credential = try await apple.requestCredential()
            if await account.loginWithApple(
                identityToken: credential.identityToken,
                nonce: credential.nonce,
                fullName: credential.fullName
            ) {
                localMessage = account.lastMessage
                let count = await SurpriseService.shared.flushPending(store: store)
                if count > 0 { localMessage = "已用 Apple 登录 · 补传了 \(count) 个之前埋下的惊喜" }
            } else {
                localMessage = account.lastError
            }
        } catch AppleLoginService.LoginError.cancelled {
            // 用户取消，不用提示
        } catch {
            localMessage = (error as? LocalizedError)?.errorDescription ?? "\(error)"
        }
    }

    // MARK: 短信验证码

    @ViewBuilder
    private var smsSection: some View {
        if sms.isAvailable {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: "phone")
                        .font(.footnote)
                        .foregroundStyle(WATheme.ink2)
                    Text("手机号登录")
                        .font(.subheadline.weight(.medium))
                    Spacer(minLength: 0)
                    Button(smsExpanded ? "收起" : "展开") {
                        withAnimation(WAAnimation.quick) { smsExpanded.toggle() }
                    }
                    .font(.footnote)
                    .foregroundStyle(WATheme.amber)
                }

                if smsExpanded {
                    HStack(spacing: 8) {
                        TextField("11 位手机号", text: $smsPhone)
                            .keyboardType(.numberPad)
                            .textContentType(.telephoneNumber)
                            .font(.body)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .background(Color(.tertiarySystemFill))
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                        Button {
                            Task { await sendSmsCode() }
                        } label: {
                            Text(sendButtonTitle)
                                .font(.footnote.weight(.medium))
                                .frame(width: 92, height: 40)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(!PhoneFormat.isValid(smsPhone) || isCountingDown || sms.phase == .sending)
                    }

                    if case .codeSent = sms.phase {
                        HStack(spacing: 8) {
                            TextField("6 位验证码", text: $smsCode)
                                .keyboardType(.numberPad)
                                .textContentType(.oneTimeCode)
                                .font(.body)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 10)
                                .background(Color(.tertiarySystemFill))
                                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                            Button {
                                Task { await verifySmsCode() }
                            } label: {
                                Text(sms.phase == .verifying(smsCode) ? "验证中…" : "登录")
                                    .font(.footnote.weight(.medium))
                                    .frame(width: 76, height: 40)
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(!PhoneFormat.isValidCode(smsCode))
                        }
                    }

                    if case .error(let message) = sms.phase {
                        Text(message)
                            .font(.caption)
                            .foregroundStyle(WATheme.ember)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(14)
            .background(WATheme.paper)
            .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
        } else if !sms.missing.isEmpty {
            // 未配置：如实说明缺什么，不假装可用
            VStack(alignment: .leading, spacing: 3) {
                Label("手机号登录暂不可用", systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(WATheme.ink2)
                Text("服务端还没配置短信服务（缺 \(sms.missing.joined(separator: "、"))）。")
                    .font(.caption2)
                    .foregroundStyle(WATheme.ink3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var isCountingDown: Bool {
        if case .codeSent = sms.phase { return true }
        return false
    }

    private var sendButtonTitle: String {
        switch sms.phase {
        case .sending: return "发送中…"
        case .codeSent(let left): return "\(left) 秒后重发"
        default: return "获取验证码"
        }
    }

    private func sendSmsCode() async {
        commitBaseURL()
        localMessage = nil
        await sms.sendCode(phone: smsPhone, baseURL: account.baseURL)
    }

    private func verifySmsCode() async {
        commitBaseURL()
        localMessage = nil
        guard PhoneFormat.isValidCode(smsCode) else { return }
        if await account.loginWithSms(phone: smsPhone, code: smsCode) {
            localMessage = account.lastMessage
            sms.reset()
            smsCode = ""
            let count = await SurpriseService.shared.flushPending(store: store)
            if count > 0 { localMessage = "已用手机号登录 · 补传了 \(count) 个之前埋下的惊喜" }
        } else {
            // 服务端返回的错误（验证码不对 / 过期 / 太频繁）已经写进 sms.phase 更贴切，
            // 这里把 AccountService 的文案也带出来，避免「什么都没发生」的感觉
            localMessage = account.lastError
        }
    }

    // MARK: 微信登录

    /// 微信区块：能登就一个按钮，不能登就如实说是服务端没配（不假装可用）
    @ViewBuilder
    private var wechatSection: some View {
        if let config = wechatConfig {
            if config.enabled {
                Button {
                    Task { await loginWithWeChat() }
                } label: {
                    HStack(spacing: 8) {
                        if wechatLoading {
                            ProgressView().controlSize(.small).tint(.white)
                        } else {
                            Image(systemName: "message.fill")
                                .font(.body)
                        }
                        Text(wechatLoading ? "正在唤起微信…" : "微信一键登录")
                            .font(.body.weight(.medium))
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .background(Color(red: 0.02, green: 0.72, blue: 0.32))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(WAPressEffectStyle())
                .disabled(wechatLoading || account.isBusy)

                Text("登录后卡片和进度会存到云端，换手机也能找回。")
                    .font(.caption)
                    .foregroundStyle(WATheme.ink2)
            } else {
                Label("微信登录暂不可用", systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(WATheme.ink2)
                Text("服务端还没配置 \(config.missingList.joined(separator: "、"))。用下面的账号密码登录不受影响。")
                    .font(.caption)
                    .foregroundStyle(WATheme.ink3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } else {
            HStack(spacing: 6) {
                ProgressView().controlSize(.mini)
                Text("正在检查微信登录…").font(.caption).foregroundStyle(WATheme.ink3)
            }
        }
    }

    private func loginWithWeChat() async {
        guard let config = wechatConfig else { return }
        wechatLoading = true
        defer { wechatLoading = false }
        localMessage = nil
        do {
            let code = try await wechat.requestCode(config: config, callbackScheme: "walkaholic")
            if await account.loginWithWeChat(code: code) {
                localMessage = account.lastMessage
                let count = await SurpriseService.shared.flushPending(store: store)
                if count > 0 { localMessage = "已用微信登录 · 补传了 \(count) 个之前埋下的惊喜" }
            } else {
                localMessage = account.lastError
            }
        } catch WeChatLoginService.LoginError.cancelled {
            // 用户自己取消，什么都不用说
        } catch {
            localMessage = (error as? LocalizedError)?.errorDescription ?? "\(error)"
        }
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
