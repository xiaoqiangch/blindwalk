import Foundation

// MARK: - 地图 Key 下发（docs/parity.md §1）
//
// 用户不填 Key，也不硬编码：
//   1. 同 bundle 内 mapkeys.json（部署产物）
//   2. 远程 https://xiaoqiangch.github.io/blindwalk/mapkeys.json
//   3. 后台公开端点 {adminBase}/api/public/mapkeys（可选）
// 缓存 12 小时；都没有时只用 OSM + 维基。

struct MapKeys: Codable, Hashable, Sendable {
    var amap: String = ""
    var baidu: String = ""

    var hasAny: Bool { !amap.isEmpty || !baidu.isEmpty }
}

@MainActor
final class MapKeysService {

    static let shared = MapKeysService()

    private static let remoteURL = "https://xiaoqiangch.github.io/blindwalk/mapkeys.json"
    private static let cacheTTL: TimeInterval = 12 * 3600
    private static let dataKey = "bw.mapkeys.data.v1"
    private static let dateKey = "bw.mapkeys.date.v1"

    private(set) var keys = MapKeys()
    private(set) var lastSource = "none"
    private var loaded = false
    private var loadingTask: Task<MapKeys, Never>?

    private struct Payload: Codable {
        let keys: MapKeys?
    }

    private init() {}

    func load(force: Bool = false) async -> MapKeys {
        if !force, loaded, keys.hasAny { return keys }
        if !force, let cached = cachedKeys(), cached.hasAny {
            keys = cached
            loaded = true
            lastSource = "cache"
            return keys
        }
        if let task = loadingTask { return await task.value }
        let task = Task { await self.resolveKeys() }
        loadingTask = task
        let resolved = await task.value
        loadingTask = nil
        keys = resolved
        loaded = true
        return keys
    }

    // MARK: 读取顺序

    private func resolveKeys() async -> MapKeys {
        // 1. bundle 内 mapkeys.json
        if let bundled = bundledKeys(), bundled.hasAny {
            saveCache(bundled)
            lastSource = "bundle"
            return bundled
        }
        // 2. 远程 Pages 部署产物
        if let remote = await fetchKeys(urlString: Self.remoteURL) {
            saveCache(remote)
            lastSource = "remote"
            return remote
        }
        // 3. 后台公开端点（可选，用 BW_ADMIN_BASE 覆盖）
        let env = ProcessInfo.processInfo.environment
        let adminBase = env["BW_ADMIN_BASE"] ?? UserDefaults.standard.string(forKey: "bw.adminBase.v1") ?? ""
        if !adminBase.isEmpty,
           let admin = await fetchKeys(urlString: adminBase.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/api/public/mapkeys") {
            saveCache(admin)
            lastSource = "admin"
            return admin
        }
        if let cached = cachedKeys(), cached.hasAny {
            lastSource = "cache"
            return cached
        }
        lastSource = "none"
        return MapKeys()
    }

    private func bundledKeys() -> MapKeys? {
        guard let url = Bundle.main.url(forResource: "mapkeys", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return decodeKeys(data)
    }

    private func fetchKeys(urlString: String) async -> MapKeys? {
        let env = ProcessInfo.processInfo.environment
        // 离线/失败模拟：`BW_MAPKEYS_URL=https://invalid.invalid/mapkeys.json`
        let rawURL = env["BW_MAPKEYS_URL"] ?? urlString
        guard let url = URL(string: rawURL) else { return nil }

        var request = URLRequest(url: url)
        request.timeoutInterval = 3
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
            return decodeKeys(data)
        } catch {
            return nil
        }
    }

    private func decodeKeys(_ data: Data) -> MapKeys? {
        guard let payload = try? JSONDecoder().decode(Payload.self, from: data),
              let keys = payload.keys else { return nil }
        var cleaned = MapKeys()
        cleaned.amap = keys.amap.trimmingCharacters(in: .whitespacesAndNewlines)
        cleaned.baidu = keys.baidu.trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.hasAny ? cleaned : nil
    }

    // MARK: 缓存 12h

    private func cachedKeys() -> MapKeys? {
        let defaults = UserDefaults.standard
        guard let stamp = defaults.object(forKey: Self.dateKey) as? Date,
              Date().timeIntervalSince(stamp) < Self.cacheTTL,
              let data = defaults.data(forKey: Self.dataKey),
              let payload = try? JSONDecoder().decode(Payload.self, from: data),
              let keys = payload.keys, keys.hasAny else { return nil }
        return keys
    }

    private func saveCache(_ keys: MapKeys) {
        let defaults = UserDefaults.standard
        guard let data = try? JSONEncoder().encode(Payload(keys: keys)) else { return }
        defaults.set(data, forKey: Self.dataKey)
        defaults.set(Date(), forKey: Self.dateKey)
    }
}
