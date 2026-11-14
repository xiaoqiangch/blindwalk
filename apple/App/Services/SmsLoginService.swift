import Foundation
import SwiftUI

// MARK: - 短信验证码登录（客户端）
//
// 两步：发码 → 验码。两步都由服务端判定，客户端不做任何本地校验（除了格式）。
// 未配置短信服务商时服务端返回 503 + 缺哪几个环境变量，这里如实显示。

@Observable
@MainActor
final class SmsLoginService {

    static let shared = SmsLoginService()

    enum Phase: Equatable {
        case idle
        case sending
        case codeSent(secondsLeft: Int)
        case verifying(String)
        case error(String)
    }

    private(set) var phase: Phase = .idle
    /// 服务端是否已启用短信（进入页面时问一次）
    private(set) var isAvailable = false
    private(set) var missing: [String] = []

    private var countdownTask: Task<Void, Never>?

    private init() {}

    // MARK: 可用性

    func refreshAvailability(baseURL: String) async {
        let trimmed = baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: trimmed + "/api/auth/providers") else { return }
        var request = URLRequest(url: url)
        request.timeoutInterval = 8
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false,
                  let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let providers = payload["providers"] as? [String: Any],
                  let sms = providers["sms"] as? [String: Any] else { return }
            isAvailable = (sms["enabled"] as? Bool) ?? false
            missing = (sms["missing"] as? [String]) ?? []
        } catch {
            isAvailable = false
        }
    }

    // MARK: 发码

    func sendCode(phone: String, baseURL: String, devModeHint: Bool = false) async -> Bool {
        phase = .sending
        let trimmed = baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: trimmed + "/api/auth/sms/send") else {
            phase = .error("服务地址不合法")
            return false
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["phone": phone])

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            guard (200..<300).contains(status) else {
                phase = .error(payload["error"] as? String ?? "发送失败（\(status)）")
                return false
            }
            let ttl = (payload["ttlSeconds"] as? Int) ?? 300
            startCountdown(seconds: ttl)
            return true
        } catch {
            phase = .error("网络请求失败，请稍后重试")
            return false
        }
    }

    /// 校验码；成功后**由调用方**用 code 换会话（AccountService 负责 Cookie）
    func verifyCode(phone: String, code: String, baseURL: String) async -> Bool {
        phase = .verifying(code)
        let trimmed = baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: trimmed + "/api/auth/sms/verify") else {
            phase = .error("服务地址不合法")
            return false
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["phone": phone, "code": code])

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            guard (200..<300).contains(status) else {
                phase = .error(payload["error"] as? String ?? "验证失败（\(status)）")
                return false
            }
            phase = .idle
            return true
        } catch {
            phase = .error("网络请求失败，请稍后重试")
            return false
        }
    }

    func reset() {
        countdownTask?.cancel()
        countdownTask = nil
        phase = .idle
    }

    // MARK: 倒计时

    private func startCountdown(seconds: Int) {
        countdownTask?.cancel()
        var remaining = max(1, seconds)
        phase = .codeSent(secondsLeft: remaining)
        countdownTask = Task { @MainActor [weak self] in
            while remaining > 0 {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                if Task.isCancelled { return }
                remaining -= 1
                self?.phase = remaining > 0 ? .codeSent(secondsLeft: remaining) : .idle
            }
        }
    }
}

// MARK: - 手机号 / 验证码格式

enum PhoneFormat {
    static func isValid(_ phone: String) -> Bool {
        let trimmed = phone.trimmingCharacters(in: .whitespaces)
        guard trimmed.count == 11, trimmed.first == "1" else { return false }
        let second = trimmed.dropFirst().first
        guard let second, "3456789".contains(second) else { return false }
        return trimmed.allSatisfy { $0.isNumber }
    }

    static func isValidCode(_ code: String) -> Bool {
        let trimmed = code.trimmingCharacters(in: .whitespaces)
        return trimmed.count == 6 && trimmed.allSatisfy { $0.isNumber }
    }
}
