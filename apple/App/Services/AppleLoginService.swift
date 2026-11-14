import Foundation
import AuthenticationServices
import CryptoKit

// MARK: - Sign in with Apple（客户端 → 服务端校验）
//
// 客户端只负责：
//   1. 生成一个随机 nonce，交给 Apple（Apple 会把 SHA256(nonce) 写进 identityToken）
//   2. 把 identityToken 原文 + 原始 nonce 交给服务端
// 服务端负责验签名、验 iss/aud/exp/nonce —— 客户端绝不自己判断 token 真伪。
//
// 为什么传原始 nonce：服务端会用 SHA256 算一遍再比对 token 里的 nonce 字段，
// 这是防重放的关键，只传 hash 就没法验证了。

@MainActor
final class AppleLoginService: NSObject {

    enum LoginError: LocalizedError {
        case cancelled
        case missingToken
        case failed(String)

        var errorDescription: String? {
            switch self {
            case .cancelled: return "已取消"
            case .missingToken: return "Apple 没有返回身份凭证，请重试"
            case .failed(let message): return message
            }
        }
    }

    /// 本次授权用的原始 nonce（异步回调里要用）
    private var pendingNonce = ""
    private var continuation: CheckedContinuation<AppleCredential, Error>?

    struct AppleCredential {
        let identityToken: String
        let nonce: String
        /// 只有第一次授权会返回姓名；之后都是 nil
        let fullName: String?
    }

    /// 生成 nonce：32 字节随机 → hex
    static func makeNonce() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    static func sha256(_ input: String) -> String {
        let digest = SHA256.hash(data: Data(input.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    /// 用系统提供的一键授权流程拿 credential。
    /// （UI 层也可以用 SwiftUI 的 SignInWithAppleButton；这里给「自己画按钮」的路径用）
    func requestCredential(presentationAnchor: ASPresentationAnchor? = nil) async throws -> AppleCredential {
        let nonce = Self.makeNonce()
        pendingNonce = nonce
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        // Apple 要求传 SHA256(nonce)，token 里会带回同样的值
        request.nonce = Self.sha256(nonce)

        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = presentationAnchor.map { AnchorProvider(anchor: $0) }
            controller.performRequests()
        }
    }

    fileprivate func finish(result: Result<AppleCredential, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        switch result {
        case .success(let credential): continuation.resume(returning: credential)
        case .failure(let error): continuation.resume(throwing: error)
        }
    }
}

// MARK: - ASAuthorizationControllerDelegate

extension AppleLoginService: ASAuthorizationControllerDelegate {

    nonisolated func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        Task { @MainActor in
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
                finish(result: .failure(LoginError.missingToken))
                return
            }
            guard let tokenData = credential.identityToken,
                  let token = String(data: tokenData, encoding: .utf8), !token.isEmpty else {
                finish(result: .failure(LoginError.missingToken))
                return
            }
            let name: String? = {
                guard let components = credential.fullName else { return nil }
                let parts = [components.givenName, components.familyName]
                    .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
                    .filter { !$0.isEmpty }
                let joined = parts.joined(separator: "")
                return joined.isEmpty ? nil : joined
            }()
            finish(result: .success(AppleCredential(
                identityToken: token,
                nonce: pendingNonce,
                fullName: name
            )))
        }
    }

    nonisolated func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        Task { @MainActor in
            let cancelled = (error as? ASAuthorizationError)?.code == .canceled
            finish(result: .failure(cancelled ? LoginError.cancelled : LoginError.failed(error.localizedDescription)))
        }
    }
}

/// ASAuthorizationController 需要一个 presentation context provider
private final class AnchorProvider: NSObject, ASAuthorizationControllerPresentationContextProviding {
    let anchor: ASPresentationAnchor
    init(anchor: ASPresentationAnchor) { self.anchor = anchor }
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor { anchor }
}
