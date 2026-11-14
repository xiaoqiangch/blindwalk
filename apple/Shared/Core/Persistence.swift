import Foundation

/// 持久化抽象：iOS / watchOS 用 UserDefaults，Web 用 localStorage。
public protocol ProfilePersisting: Sendable {
    func loadProfile() -> Profile?
    func saveProfile(_ profile: Profile)
    func clear()
}

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
