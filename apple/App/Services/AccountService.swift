import Foundation
import Observation

// MARK: - 账号服务（account/docs/API.md）
//
// Cookie 会话（HttpOnly）；未登录时完全本地可用。
// 默认服务地址 http://127.0.0.1:8803，可在「我的 → 账号」里改。
// 同步是「整包覆盖」：profile + surprises + settings。

struct AccountUser: Codable, Hashable, Sendable {
    let id: String?
    let username: String
    let createdAt: String?
}

struct AccountSyncEnvelope: Codable, Sendable {
    var app: String = "blindwalk"
    var version: Int = 1
    var savedAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    var profile: Profile?
    var surprises: [BuriedSurprise]?
    var settings: [String: Bool]?
}

private struct AccountStoredConfig: Codable {
    var baseUrl: String
    var user: AccountUser?
}

@Observable
@MainActor
final class AccountService {

    static let shared = AccountService()

    private static let storeKey = "bw.account.v1"
    private static let defaultBaseURL = "http://127.0.0.1:8803"

    var baseURL: String
    var user: AccountUser?
    var isBusy = false
    var lastMessage: String?
    var lastError: String?

    private let session: URLSession
    private let decoder = JSONDecoder()

    var isLoggedIn: Bool { user != nil }

    private init() {
        var base = Self.defaultBaseURL
        var storedUser: AccountUser?
        if let data = UserDefaults.standard.data(forKey: Self.storeKey),
           let config = try? JSONDecoder().decode(AccountStoredConfig.self, from: data) {
            if !config.baseUrl.isEmpty { base = config.baseUrl }
            storedUser = config.user
        }
        baseURL = base
        user = storedUser

        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 8
        configuration.timeoutIntervalForResource = 12
        configuration.httpCookieStorage = HTTPCookieStorage.shared
        configuration.httpShouldSetCookies = true
        session = URLSession(configuration: configuration)
    }

    // MARK: 配置

    func setBaseURL(_ value: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        baseURL = trimmed.isEmpty ? Self.defaultBaseURL : trimmed
        persist()
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(AccountStoredConfig(baseUrl: baseURL, user: user)) else { return }
        UserDefaults.standard.set(data, forKey: Self.storeKey)
    }

    private func record(user: AccountUser?) {
        self.user = user
        persist()
    }

    // MARK: 会话

    func refresh() async {
        isBusy = true
        defer { isBusy = false }
        do {
            let payload = try await call(path: "/api/auth/me", method: "GET", body: nil)
            if let dictionary = payload["user"] as? [String: Any] {
                record(user: Self.parseUser(dictionary))
                lastError = nil
            }
        } catch {
            user = nil
            persist()
        }
    }

    func login(username: String, password: String) async -> Bool {
        await authenticate(path: "/api/auth/login", username: username, password: password, success: "已登录")
    }

    func register(username: String, password: String) async -> Bool {
        await authenticate(path: "/api/auth/register", username: username, password: password, success: "注册成功，已登录")
    }

    private func authenticate(path: String, username: String, password: String, success: String) async -> Bool {
        isBusy = true
        lastError = nil
        defer { isBusy = false }
        do {
            let payload = try await call(
                path: path,
                method: "POST",
                body: ["username": username, "password": password]
            )
            guard let dictionary = payload["user"] as? [String: Any] else {
                lastError = "服务返回异常"
                return false
            }
            record(user: Self.parseUser(dictionary))
            lastMessage = success
            return true
        } catch {
            lastError = Self.message(for: error)
            return false
        }
    }

    func logout() async {
        isBusy = true
        defer { isBusy = false }
        _ = try? await call(path: "/api/auth/logout", method: "POST", body: nil)
        record(user: nil)
        lastMessage = "已退出登录"
    }

    func deleteAccount(password: String) async -> Bool {
        isBusy = true
        lastError = nil
        defer { isBusy = false }
        do {
            _ = try await call(path: "/api/me", method: "DELETE", body: ["password": password])
            record(user: nil)
            lastMessage = "账号已删除"
            return true
        } catch {
            lastError = Self.message(for: error)
            return false
        }
    }

    // MARK: 资料同步

    func push(_ envelope: AccountSyncEnvelope) async -> Bool {
        isBusy = true
        lastError = nil
        defer { isBusy = false }
        do {
            // 载荷是 Codable 结构，必须先编码成 JSON 对象再交给 URLSession
            let data = try JSONEncoder().encode(envelope)
            let profileObject = try JSONSerialization.jsonObject(with: data)
            _ = try await call(
                path: "/api/me/profile",
                method: "PUT",
                body: ["profile": profileObject]
            )
            lastMessage = "已同步到账号"
            return true
        } catch {
            lastError = Self.message(for: error)
            return false
        }
    }

    func pull() async -> AccountSyncEnvelope? {
        isBusy = true
        lastError = nil
        defer { isBusy = false }
        do {
            let payload = try await call(path: "/api/auth/me", method: "GET", body: nil)
            guard let profile = payload["profile"] as? [String: Any] else {
                lastError = "账号里还没有同步过数据"
                return nil
            }
            let data = try JSONSerialization.data(withJSONObject: profile)
            let envelope = try decoder.decode(AccountSyncEnvelope.self, from: data)
            guard envelope.profile != nil else {
                lastError = "账号里还没有同步过数据"
                return nil
            }
            lastMessage = "已从账号恢复"
            return envelope
        } catch {
            lastError = Self.message(for: error)
            return nil
        }
    }

    // MARK: HTTP

    private func call(
        path: String,
        method: String,
        body: [String: Any]?
    ) async throws -> [String: Any] {
        let trimmed = baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: trimmed + path) else {
            throw AccountError(message: "服务地址无效")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } else if method == "POST" || method == "PUT" || method == "DELETE" {
            request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
            request.httpBody = Data("{}".utf8)
        }

        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]

        if !(200..<300).contains(status) {
            let message = payload["error"] as? String ?? "请求失败（\(status)）"
            let code = payload["code"] as? String ?? ""
            throw AccountError(message: message, code: code)
        }
        return payload
    }

    private static func parseUser(_ dictionary: [String: Any]) -> AccountUser {
        AccountUser(
            id: dictionary["id"] as? String ?? (dictionary["id"] as? Int).map(String.init),
            username: dictionary["username"] as? String ?? "",
            createdAt: (dictionary["createdAt"] as? String) ?? (dictionary["createdAt"] as? Int).map(String.init)
        )
    }

    private static func message(for error: Error) -> String {
        if let account = error as? AccountError {
            switch account.code {
            case "USERNAME_TAKEN": return "这个用户名已被注册"
            case "BAD_CREDENTIALS": return "用户名或密码不对"
            case "UNAUTHENTICATED": return "登录已过期，请重新登录"
            case "TOO_MANY_ATTEMPTS": return "尝试太频繁，请稍后再试"
            case "BAD_REQUEST": return account.message
            default: return account.message
            }
        }
        return error.localizedDescription
    }
}

private struct AccountError: LocalizedError {
    let message: String
    var code: String = ""

    var errorDescription: String? { message }
}
