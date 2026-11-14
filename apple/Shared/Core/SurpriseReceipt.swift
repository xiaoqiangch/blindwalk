import Foundation

// MARK: - 埋惊喜回执
//
// 埋惊喜是「给予」，但之前给完就断了：别人找到你的照片，你永远不知道。
// 这一层把「被找到」变成一条回执，并在入口上点一个红点 ——
// 成本最低的社交闭环：不用聊天、不用关注，只要有人走过你留照片的地方。
//
// 数据来源：GET /api/surprises/mine（登录用户或匿名设备标识都能查自己的）。
// 服务端只回状态，不回照片正文；本机自己的原图本来就在沙盒里。

public struct SurpriseReceipt: Codable, Identifiable, Hashable, Sendable {
    /// 惊喜 id（=BuriedSurprise.id）
    public let id: String
    public var areaLabel: String
    public var finderName: String
    public var foundAt: Date
    /// 用户看过这条回执的时间；nil = 未读（入口红点看它）
    public var readAt: Date?

    public init(
        id: String,
        areaLabel: String,
        finderName: String,
        foundAt: Date,
        readAt: Date? = nil
    ) {
        self.id = id
        self.areaLabel = areaLabel
        self.finderName = finderName
        self.foundAt = foundAt
        self.readAt = readAt
    }

    public var isUnread: Bool { readAt == nil }
}

/// 回执的本地存档（UserDefaults）。
/// 单独一个 key：它不属于 Profile，也不该跟着「清除演示数据」以外的东西变动。
public final class SurpriseReceiptStore: @unchecked Sendable {

    public static let shared = SurpriseReceiptStore()

    private static let key = "walkaholic.surprise.receipts.v1"
    private let defaults: UserDefaults
    private let lock = NSLock()

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func load() -> [SurpriseReceipt] {
        lock.lock()
        defer { lock.unlock() }
        guard let data = defaults.data(forKey: Self.key),
              let list = try? JSONDecoder().decode([SurpriseReceipt].self, from: data) else { return [] }
        return list.sorted { $0.foundAt > $1.foundAt }
    }

    /// 合并服务端回执：新条目插入，已有条目只更新寻者与时间，保留本地已读状态。
    /// 返回是否有「新的未读」——有才值得点红点。
    @discardableResult
    public func merge(_ remote: [SurpriseReceipt]) -> (list: [SurpriseReceipt], hasNew: Bool) {
        guard !remote.isEmpty else { return (load(), false) }
        lock.lock()
        defer { lock.unlock() }
        var current = loadLocked()
        var index = Dictionary(uniqueKeysWithValues: current.map { ($0.id, $0) })
        var hasNew = false
        for receipt in remote {
            if var existing = index[receipt.id] {
                existing.areaLabel = receipt.areaLabel
                existing.finderName = receipt.finderName
                existing.foundAt = receipt.foundAt
                index[receipt.id] = existing
            } else {
                index[receipt.id] = receipt
                hasNew = true
            }
        }
        current = index.values.sorted { $0.foundAt > $1.foundAt }
        persistLocked(current)
        return (current, hasNew)
    }

    public func markAllRead(now: Date = Date()) {
        lock.lock()
        defer { lock.unlock() }
        var list = loadLocked()
        var changed = false
        for index in list.indices where list[index].readAt == nil {
            list[index].readAt = now
            changed = true
        }
        if changed { persistLocked(list) }
    }

    public func removeAll() {
        lock.lock()
        defer { lock.unlock() }
        defaults.removeObject(forKey: Self.key)
    }

    // MARK: 私有（调用前必须已持锁）

    private func loadLocked() -> [SurpriseReceipt] {
        guard let data = defaults.data(forKey: Self.key),
              let list = try? JSONDecoder().decode([SurpriseReceipt].self, from: data) else { return [] }
        return list
    }

    private func persistLocked(_ list: [SurpriseReceipt]) {
        guard let data = try? JSONEncoder().encode(list) else { return }
        defaults.set(data, forKey: Self.key)
    }
}
