import Foundation

// MARK: - 时段（环境性盲盒）
//
// 为什么要有它：盲盒如果一天 24 小时都长一样，用户上午开一个、晚上开一个，
// 拿到的其实是同一批地点 —— 「今天」就没有意义。
//
// 规则很克制，只做两件事：
//   1. 文案跟着时段变（清晨的盲盒 / 黄昏的盲盒 …），给出当下去哪儿的理由；
//   2. 抽点权重跟着时段变（黄昏更偏河边与观景、夜里避开公园和菜市场）。
// 不做硬排除：城市里的好地方本来就该被走到，权重压到 0.45 已经足够让它退居其次。
public enum DayMoment: String, Codable, CaseIterable, Sendable {

    case dawn      // 05–08 清晨
    case morning   // 08–11 上午
    case noon      // 11–14 正午
    case afternoon // 14–17 下午
    case dusk      // 17–20 黄昏
    case night     // 20–05 夜里

    /// 当前时刻对应的时段（按本地时区）
    public static var now: DayMoment { at(Date()) }

    public static func at(_ date: Date, calendar: Calendar = .current) -> DayMoment {
        switch calendar.component(.hour, from: date) {
        case 5..<8: return .dawn
        case 8..<11: return .morning
        case 11..<14: return .noon
        case 14..<17: return .afternoon
        case 17..<20: return .dusk
        default: return .night
        }
    }

    public var title: String {
        switch self {
        case .dawn: return "清晨"
        case .morning: return "上午"
        case .noon: return "正午"
        case .afternoon: return "下午"
        case .dusk: return "黄昏"
        case .night: return "夜里"
        }
    }

    /// 盲盒卡上的小标题
    public var boxTitle: String { "\(title)的盲盒" }

    /// 一句「现在出门」的理由（不承诺地点，只承诺氛围）
    public var line: String {
        switch self {
        case .dawn:
            return "城市刚醒，去有晨雾和早摊的地方走走。"
        case .morning:
            return "光还斜着，适合去有树影、有长椅的地方。"
        case .noon:
            return "日头正高，找有屋檐、有阴凉的一段路。"
        case .afternoon:
            return "一天里最宽松的时候，适合进馆、进书店。"
        case .dusk:
            return "天要暗下来，往有水和有光的地方走。"
        case .night:
            return "夜里的城市只剩灯，去灯最好看的地方。"
        }
    }

    public var symbol: String {
        switch self {
        case .dawn: return "sunrise"
        case .morning: return "sun.max"
        case .noon: return "sun.max.fill"
        case .afternoon: return "sun.haze"
        case .dusk: return "sunset"
        case .night: return "moon.stars"
        }
    }

    /// 该时段更值得去的类别
    public var favored: Set<RealPlaceCategory> {
        switch self {
        case .dawn: return [.park, .river, .market, .garden]
        case .morning: return [.park, .cafe, .market, .library]
        case .noon: return [.market, .plaza, .cafe, .library]
        case .afternoon: return [.museum, .art, .library, .historic, .bookstore]
        case .dusk: return [.river, .viewpoint, .bridge, .plaza]
        case .night: return [.viewpoint, .bridge, .plaza, .cafe]
        }
    }

    /// 该时段不太合适的类别（降权，不排除）
    public var avoided: Set<RealPlaceCategory> {
        switch self {
        case .dawn: return [.venue, .market]
        case .morning: return []
        case .noon: return [.viewpoint]
        case .afternoon: return []
        case .dusk: return [.library, .museum]
        case .night: return [.park, .garden, .market, .historic]
        }
    }

    /// 抽点权重乘数
    public func affinity(for category: RealPlaceCategory) -> Double {
        if favored.contains(category) { return 1.45 }
        if avoided.contains(category) { return 0.45 }
        return 1
    }
}
