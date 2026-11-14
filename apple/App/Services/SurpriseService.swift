import Foundation
import UIKit

// MARK: - 惊喜跨用户共享（account/docs/API.md + account/server/surprises.mjs）
//
// 为什么需要：惊喜原先只存在本机（作者埋完就结束），别人的「附近的惊喜」永远是空的。
// 账号服务提供三个端点把惊喜变成真正的社区内容：
//   GET  /api/surprises?lat&lon&radius  附近待寻（不需要登录，登录后自动排除自己埋的）
//   POST /api/surprises                 埋下（必须登录）
//   POST /api/surprises/:id/find        认领（必须登录，先到先得）
//
// 保密约束和服务端一致：列表接口不返回照片与正文，照片就是答案。
// 因此本机对远端惊喜只拿到线索、区域、距离。

@MainActor
final class SurpriseService {

    static let shared = SurpriseService()

    private let account = AccountService.shared
    /// 回执同步节流：首页卡片会反复 onAppear，60 秒内不重复打服务端
    private var lastReceiptSync: Date?
    private let receiptSyncInterval: TimeInterval = 60
    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .useDefaultKeys
        return decoder
    }()

    // MARK: 附近

    /// 拉取附近别人埋下的惊喜（未登录也能拉，只是不会排除自己埋的）。
    func fetchNearby(origin: GeoPoint, radiusMeters: Double = 5_000) async -> [BuriedSurprise] {
        var components = URLComponents(string: account.baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/api/surprises")
        components?.queryItems = [
            URLQueryItem(name: "lat", value: String(format: "%.6f", origin.latitude)),
            URLQueryItem(name: "lon", value: String(format: "%.6f", origin.longitude)),
            URLQueryItem(name: "radius", value: String(Int(radiusMeters)))
        ]
        guard let url = components?.url else { return [] }

        do {
            let (data, response) = try await request(url: url, method: "GET", body: nil)
            guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false,
                  let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let items = payload["items"] as? [[String: Any]] else { return [] }
            return items.compactMap(Self.parseRemote)
        } catch {
            return []
        }
    }

    private static func parseRemote(_ item: [String: Any]) -> BuriedSurprise? {
        guard let id = item["id"] as? String,
              let lat = (item["location"] as? [String: Any])?["lat"] as? Double,
              let lon = (item["location"] as? [String: Any])?["lon"] as? Double else { return nil }
        let createdAt = (item["createdAt"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) }
            ?? (item["createdAt"] as? Int64).map { Date(timeIntervalSince1970: Double($0) / 1000) }
            ?? Date()
        return BuriedSurprise.remote(
            id: id,
            authorEmoji: item["authorEmoji"] as? String ?? "🫥",
            areaLabel: item["areaLabel"] as? String ?? "",
            clues: item["clues"] as? [String] ?? [],
            location: GeoPoint(latitude: lat, longitude: lon),
            radiusMeters: (item["radiusMeters"] as? Double) ?? 60,
            createdAt: createdAt
        )
    }

    /// 设备标识：匿名上传时用来区分作者（不含任何个人信息，随机串存在本机）
    private static let deviceKey = "wa.deviceId.v1"

    static var deviceID: String {
        if let existing = UserDefaults.standard.string(forKey: deviceKey), !existing.isEmpty {
            return existing
        }
        let fresh = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        UserDefaults.standard.set(fresh, forKey: deviceKey)
        return fresh
    }

    /// 演示 / 截图运行中：不写服务端。
    /// 演示数据（20 张假卡、假惊喜）一旦上传，就会变成别人的「附近惊喜」，
    /// 是污染生产数据，不是「顺便测一下」。
    private static var isPreviewRun: Bool {
        !(ProcessInfo.processInfo.environment["WA_PREVIEW"] ?? "").isEmpty
    }

    // MARK: 上传

    /// 把一条本机埋下的惊喜上传到服务端。
    /// 登录了就按账号归属；未登录也允许上传（服务端用设备标识区分作者）——
    /// 否则「埋下一个」对没注册的人等于没生效。
    /// 照片以 data URL 上传（服务端上限 220KB，超了只保留哈希，不阻塞上传）。
    func upload(_ surprise: BuriedSurprise, photo: UIImage?) async -> Bool {
        guard !Self.isPreviewRun else { return false }
        let trimmed = account.baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: trimmed + "/api/surprises") else { return false }

        var body: [String: Any] = [
            "lat": surprise.location.latitude,
            "lon": surprise.location.longitude,
            "areaLabel": surprise.areaLabel,
            "message": surprise.message,
            "clues": surprise.clues,
            "radiusMeters": surprise.radiusMeters,
            "authorEmoji": surprise.authorEmoji
        ]
        if let photo, let dataURL = Self.compressedDataURL(photo) {
            body["photoData"] = dataURL
        }

        do {
            let (data, response) = try await request(url: url, method: "POST", body: body)
            guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false,
                  let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  (payload["ok"] as? Bool) == true else { return false }
            return true
        } catch {
            return false
        }
    }

    /// 把历史遗留（埋了但没上传）的惊喜一次性补传。
    @discardableResult
    func uploadPending(_ surprises: [BuriedSurprise], photoProvider: (String) -> UIImage?) async -> [String] {
        var uploaded: [String] = []
        for surprise in surprises {
            let photo = photoProvider(surprise.photoName)
            if await upload(surprise, photo: photo) {
                uploaded.append(surprise.id)
            }
        }
        return uploaded
    }

    /// 从 store 里捞出「本机埋了但还没上传」的，补传并把结果写回 store。
    /// 登录成功、冷启动、进入「我的惊喜」时都调它，保证登录之后不会漏传。
    @discardableResult
    func flushPending(store: WalkaholicStore) async -> Int {
        guard !Self.isPreviewRun else { return 0 }
        let pending = store.pendingUploadSurprises
        guard !pending.isEmpty else { return 0 }
        let uploaded = await uploadPending(pending) { name in
            PhotoLibraryService.load(named: name)
        }
        uploaded.forEach { store.markSurpriseUploaded($0) }
        return uploaded.count
    }

    // MARK: 认领

    /// 找到别人埋的惊喜后通知服务端（先到先得；已被别人抢先时返回 false）。
    func claim(surpriseID: String) async -> Bool {
        guard account.isLoggedIn else { return false }
        let trimmed = account.baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: trimmed + "/api/surprises/" + surpriseID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)! + "/find") else {
            return false
        }
        do {
            let (_, response) = try await request(url: url, method: "POST", body: [:])
            return (response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
        } catch {
            return false
        }
    }

    // MARK: 我的（被找到的回执）

    /// 拉取「我埋的惊喜」的状态。登录按账号，未登录按设备标识 ——
    /// 匿名埋下的惊喜也会被找到，作者同样应该收到回执。
    func fetchMine() async -> [SurpriseReceipt] {
        let trimmed = account.baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: trimmed + "/api/surprises/mine") else { return [] }
        do {
            let (data, response) = try await request(url: url, method: "GET", body: nil)
            guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false,
                  let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let items = payload["items"] as? [[String: Any]] else { return [] }
            return items.compactMap(Self.parseReceipt)
        } catch {
            return []
        }
    }

    /// 同步回执进 store；返回是否出现了新的未读（UI 据此点红点）
    @discardableResult
    func syncMine(store: WalkaholicStore) async -> Bool {
        guard !Self.isPreviewRun else { return false }
        if let last = lastReceiptSync, Date().timeIntervalSince(last) < receiptSyncInterval {
            return false
        }
        lastReceiptSync = Date()
        let receipts = await fetchMine()
        guard !receipts.isEmpty else { return false }
        return store.applyReceipts(receipts)
    }

    private static func parseReceipt(_ item: [String: Any]) -> SurpriseReceipt? {
        guard let id = item["id"] as? String,
              (item["status"] as? String) == "found" else { return nil }
        let foundAt = Self.date(fromMilliseconds: item["foundAt"]) ?? Date()
        let finder = (item["finderName"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "有人"
        return SurpriseReceipt(
            id: id,
            areaLabel: item["areaLabel"] as? String ?? "",
            finderName: finder,
            foundAt: foundAt
        )
    }

    private static func date(fromMilliseconds value: Any?) -> Date? {
        if let number = value as? Double { return Date(timeIntervalSince1970: number / 1000) }
        if let number = value as? Int64 { return Date(timeIntervalSince1970: Double(number) / 1000) }
        if let number = value as? Int { return Date(timeIntervalSince1970: Double(number) / 1000) }
        return nil
    }

    // MARK: HTTP

    /// 复用 AccountService 的会话 Cookie（同一 URLSession 配置里的 HTTPCookieStorage）
    private func request(url: URL, method: String, body: [String: Any]?) async throws -> (Data, URLResponse) {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        // 未登录也能埋：服务端用这个随机设备串区分匿名作者（不含任何个人信息）
        request.setValue(Self.deviceID, forHTTPHeaderField: "X-WA-Device")
        request.timeoutInterval = 12
        if let body {
            request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        return try await URLSession.shared.data(for: request)
    }

    // MARK: 照片压缩

    /// 长边 900、质量 0.72 的 JPEG data URL（与 Web 端压缩策略一致）
    private static func compressedDataURL(_ image: UIImage) -> String? {
        let maxSide: CGFloat = 900
        let side = max(image.size.width, image.size.height)
        let ratio = side > 0 ? min(1, maxSide / side) : 1
        let size = CGSize(width: image.size.width * ratio, height: image.size.height * ratio)

        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true
        let rendered = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        guard let data = rendered.jpegData(compressionQuality: 0.72) else { return nil }
        return "data:image/jpeg;base64," + data.base64EncodedString()
    }
}
