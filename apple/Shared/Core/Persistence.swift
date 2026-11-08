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
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(defaults: UserDefaults = .standard, key: String = "blindwalk.profile.v1") {
        self.defaults = defaults
        self.key = key
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
    }
}
