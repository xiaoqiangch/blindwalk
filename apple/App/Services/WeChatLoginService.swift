import Foundation
import AuthenticationServices
import UIKit

// MARK: - 微信登录（account/server/wechat.mjs 的客户端侧）
//
// 流程：
//   1. GET  /api/auth/wechat/config   → 问服务端能不能用（能拿到 appid，拿不到 secret）
//   2. 打开微信授权页，用户同意后回调带回 code
//   3. POST /api/auth/wechat { code } → 服务端换 openid、建号、下发会话 Cookie
//
// 关于「用哪种授权方式」，这里必须说清楚，不能含糊：
//   - 微信开放平台「网站应用」→ 用 qrconnect 网页授权，纯 HTTP 就能走通，**本实现默认走这条**。
//   - 微信开放平台「移动应用」→ 必须接 WeChatOpenSDK（WXApi.sendReq），
//     因为微信不接受 App 内 WebView / 外部浏览器发起的移动端授权。
//   - 「公众号网页」→ oauth2/authorize，只能在微信内置浏览器里打开。
//
// 所以：AppSecret 全在服务端，客户端只拿 appid 和 code。
// 如果服务端配的是「移动应用」的 appid，页面会提示需要接 SDK —— 这是一种明确的失败，
// 不会假装登录成功。

@MainActor
final class WeChatLoginService: NSObject {

    enum LoginError: LocalizedError {
        case notConfigured(missing: [String])
        case cancelled
        case badCallback
        case failed(String)

        var errorDescription: String? {
            switch self {
            case .notConfigured(let missing):
                return "服务端还没配置微信登录（缺 \(missing.joined(separator: "、"))）"
            case .cancelled:
                return "已取消"
            case .badCallback:
                return "微信没有返回授权码，请重试"
            case .failed(let message):
                return message
            }
        }
    }

    /// 服务端下发的公开配置
    struct Config: Decodable {
        let enabled: Bool
        let appid: String?
        let universalLink: String?
        let missing: [String]?

        var missingList: [String] { missing ?? [] }
    }

    private var session: ASWebAuthenticationSession?

    /// 问服务端是否已启用
    func loadConfig(baseURL: String) async -> Config? {
        let trimmed = baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: trimmed + "/api/auth/wechat/config") else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = 8
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false else { return nil }
            let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            guard let wechat = payload?["wechat"] else { return nil }
            let data2 = try JSONSerialization.data(withJSONObject: wechat)
            return try JSONDecoder().decode(Config.self, from: data2)
        } catch {
            return nil
        }
    }

    /// 走一遍微信授权，拿回 code。用户取消抛 `.cancelled`。
    func requestCode(config: Config, callbackScheme: String) async throws -> String {
        guard config.enabled, let appid = config.appid else {
            throw LoginError.notConfigured(missing: config.missingList)
        }
        let redirect = "walkaholic://wechat/callback"
        var components = URLComponents(string: "https://open.weixin.qq.com/connect/qrconnect")!
        components.queryItems = [
            URLQueryItem(name: "appid", value: appid),
            URLQueryItem(name: "redirect_uri", value: redirect),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "snsapi_login"),
            URLQueryItem(name: "state", value: UUID().uuidString.prefix(8).description)
        ]
        components.fragment = "wechat_redirect"
        guard let authURL = components.url else { throw LoginError.failed("授权地址不合法") }

        return try await withCheckedThrowingContinuation { continuation in
            let webSession = ASWebAuthenticationSession(url: authURL, callbackURLScheme: callbackScheme) { callback, error in
                if let error {
                    let cancelled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
                    continuation.resume(throwing: cancelled ? LoginError.cancelled : LoginError.failed(error.localizedDescription))
                    return
                }
                guard let callback,
                      let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems,
                      let code = items.first(where: { $0.name == "code" })?.value,
                      !code.isEmpty else {
                    continuation.resume(throwing: LoginError.badCallback)
                    return
                }
                continuation.resume(returning: code)
            }
            webSession.presentationContextProvider = self
            webSession.prefersEphemeralWebBrowserSession = false
            self.session = webSession
            if !webSession.start() {
                continuation.resume(throwing: LoginError.failed("没能打开微信授权页"))
            }
        }
    }
}

// MARK: - 弹出授权页所需的锚点

extension WeChatLoginService: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        for scene in scenes {
            if let window = scene.windows.first(where: { $0.isKeyWindow }) { return window }
            if let window = scene.windows.first { return window }
        }
        return ASPresentationAnchor()
    }
}
