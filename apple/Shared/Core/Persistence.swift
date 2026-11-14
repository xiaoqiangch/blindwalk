import Foundation

// MARK: - 持久化抽象
//
// 演示 / 截图专用的是内存实现，正式运行用 UserDefaults。
// 为什么要有内存实现：`WalkaholicStore.demo()` 以前直接用默认的 `UserDefaultsProfileStore()`，
// 也就是**真实存档**。只要在演示模式下发生一次写操作（到达 / 收卡 / 埋惊喜），
// 20 张演示卡就会覆盖用户自己的进度 —— 那是真丢数据，不是显示问题。

/// 持久化抽象：iOS / watchOS 用 UserDefaults，Web 用 localStorage。
public protocol ProfilePersisting: Sendable {
    func loadProfile() -> Profile?
    func saveProfile(_ profile: Profile)
    func clear()
}

/// 只活在内存里的存档：演示 / 截图模式用，绝不碰用户的真实进度。
public final class InMemoryProfileStore: ProfilePersisting, @unchecked Sendable {
    private var profile: Profile?
    private var surprises: [BuriedSurprise] = []

    public init(profile: Profile? = nil, surprises: [BuriedSurprise] = []) {
        self.profile = profile
        self.surprises = surprises
    }

    public func loadProfile() -> Profile? { profile }
    public func saveProfile(_ profile: Profile) { self.profile = profile }
    public func clear() { profile = nil; surprises = [] }

    public func loadSurprises() -> [BuriedSurprise] { surprises }
    public func saveSurprises(_ surprises: [BuriedSurprise]) { self.surprises = surprises }
}

extension InMemoryProfileStore: SurprisePersisting {}

public final class UserDefaultsProfileStore: ProfilePersisting, @unchecked Sendable {
    private let defaults: UserDefaults
    private let key: String
    private let surprisesKey: String
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(
        defaults: UserDefaults = .standard,
        key: String = "walkaholic.profile.v1",
        surprisesKey: String = "walkaholic.surprises.v1"
    ) {
        self.defaults = defaults
        self.key = key
        self.surprisesKey = surprisesKey
    }

    public func loadProfile() -> Profile? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? decoder.decode(Profile.self, from: data)
    }

    public func saveProfile(_ profile: Profile) {
        guard let data = try? encoder.encode(profile) else { return }
        defaults.set(data, forKey: key)
    }

    public func clear() {
        defaults.removeObject(forKey: key)
        defaults.removeObject(forKey: surprisesKey)
    }
}

// MARK: - 埋惊喜的持久化

/// 惊喜单独存一份：它不属于 `Profile`（有照片、有别人埋的），
/// 单独 key 才能在 App 重启后仍然存在。
public protocol SurprisePersisting: Sendable {
    func loadSurprises() -> [BuriedSurprise]
    func saveSurprises(_ surprises: [BuriedSurprise])
}

public final class UserDefaultsSurpriseStore: SurprisePersisting, @unchecked Sendable {
    private let defaults: UserDefaults
    private let key: String
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(defaults: UserDefaults = .standard, key: String = "walkaholic.surprises.v1") {
        self.defaults = defaults
        self.key = key
    }

    public func loadSurprises() -> [BuriedSurprise] {
        guard let data = defaults.data(forKey: key) else { return [] }
        return (try? decoder.decode([BuriedSurprise].self, from: data)) ?? []
    }

    public func saveSurprises(_ surprises: [BuriedSurprise]) {
        guard let data = try? encoder.encode(surprises) else { return }
        defaults.set(data, forKey: key)
    }
}
