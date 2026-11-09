import Foundation

/// 「埋惊喜」：用户在自己喜欢的地方，放下一张照片 + 一句话，
/// 由其他盲走的用户去找到、去拍出同款，双方都得奖励。
///
/// 设计要点（产品）：
/// - 埋 = 给予，不是任务指派：作者不指定谁来，而是留在那里等有缘人
/// - 寻 = 复刻，不是打卡：找到后要**拍一张同款照片**才算完成，逼你真的看一眼
/// - 双方奖励：作者得「被找到」的成就感和点数；寻者得探索点数；比单向打卡更有社交回报
public struct BuriedSurprise: Codable, Identifiable, Hashable, Sendable {

    public enum Status: String, Codable, Sendable {
        /// 已埋下，等第一位有缘人
        case waiting
        /// 已被找到并复刻
        case found
        /// 作者收回 / 过期
        case retired
    }

    public let id: String
    /// 作者展示名
    public var authorName: String
    public var authorEmoji: String
    /// 照片文件名（本地沙盒 Documents/Surprises/ 下）或远端 URL
    public var photoName: String
    /// 作者写的一句话：为什么埋在这里
    public var message: String
    /// 真实坐标（寻者靠它靠近）。
    /// 可变：演示种子会在拿到真实定位后整体平移到用户附近。
    public var location: GeoPoint
    /// 展示用区域名（如「静安 · 河岸」）
    public var areaLabel: String
    /// 寻者的三阶线索（不含地名/照片内容）
    public var clues: [String]
    /// 找到半径（米）
    public var radiusMeters: Double
    /// 点数奖励：寻者得到点数
    public var seekerPoints: Int
    /// 作者因被找到得到点数
    public var authorPoints: Int
    public var createdAt: Date
    public var status: Status
    /// 被谁找到、什么时候
    public var finderName: String?
    public var foundAt: Date?
    /// 复刻照片文件名（寻者拍摄）
    public var finderPhotoName: String?
    /// 复刻度评估（0…1），用于「像不像」的温和提示
    public var matchScore: Double?

    public init(
        id: String = UUID().uuidString,
        authorName: String,
        authorEmoji: String,
        photoName: String,
        message: String,
        location: GeoPoint,
        areaLabel: String,
        clues: [String],
        radiusMeters: Double = 60,
        seekerPoints: Int = 80,
        authorPoints: Int = 40,
        createdAt: Date = Date(),
        status: Status = .waiting,
        finderName: String? = nil,
        foundAt: Date? = nil,
        finderPhotoName: String? = nil,
        matchScore: Double? = nil
    ) {
        self.id = id
        self.authorName = authorName
        self.authorEmoji = authorEmoji
        self.photoName = photoName
        self.message = message
        self.location = location
        self.areaLabel = areaLabel
        self.clues = clues
        self.radiusMeters = radiusMeters
        self.seekerPoints = seekerPoints
        self.authorPoints = authorPoints
        self.createdAt = createdAt
        self.status = status
        self.finderName = finderName
        self.foundAt = foundAt
        self.finderPhotoName = finderPhotoName
        self.matchScore = matchScore
    }

    public var isWaiting: Bool { status == .waiting }
    public var isMine: Bool { authorName == "阿澈" }

    /// 三阶线索：按距离依次解锁，措辞永远不暴露照片内容
    public static func makeClues(from message: String, hint: String?) -> [String] {
        let base = [
            "有人在这里放下了一张照片。先走近一点。",
            hint?.isEmpty == false ? hint! : "找到能把眼前的画面装进取景框的位置。",
            "就是这儿。抬手机，拍一张和 TA 一样的。"
        ]
        return base
    }
}

/// 埋惊喜的结算结果
public struct SurpriseFindResult: Sendable {
    /// 寻者获得的点数
    public let seekerPoints: Int
    /// 作者获得的点数（作者不在场也记入其档案）
    public let authorPoints: Int
    /// 复刻度 0…1
    public let matchScore: Double
    /// 匹配评价文案
    public let verdict: String
    /// 是否触发了新成就
    public let newAchievements: [Achievement]

    public init(seekerPoints: Int, authorPoints: Int, matchScore: Double, verdict: String, newAchievements: [Achievement]) {
        self.seekerPoints = seekerPoints
        self.authorPoints = authorPoints
        self.matchScore = matchScore
        self.verdict = verdict
        self.newAchievements = newAchievements
    }
}

/// 复刻度评估：真实实现对比两张图的缩略图哈希（dHash）。
/// 这是「拍出同款」的核心判定——不需要 AI，用感知哈希就能给出稳定的相似度。
public enum PhotoMatcher {

    /// 计算 64 位 dHash（8×8 灰度差分）。输入是 9×8 灰度像素值（行优先）。
    public static func dHash(values: [UInt8], width: Int = 9, height: Int = 8) -> UInt64 {
        guard values.count >= width * height else { return 0 }
        var hash: UInt64 = 0
        var bit = 0
        for row in 0..<height {
            for col in 0..<(width - 1) {
                let left = values[row * width + col]
                let right = values[row * width + col + 1]
                if left < right { hash |= (1 << UInt64(bit)) }
                bit += 1
            }
        }
        return hash
    }

    /// 汉明距离（0 = 完全一致，64 = 完全不同）
    public static func hammingDistance(_ a: UInt64, _ b: UInt64) -> Int {
        (a ^ b).nonzeroBitCount
    }

    /// 相似度 0…1：距离越小越像
    public static func similarity(_ a: UInt64, _ b: UInt64) -> Double {
        let distance = Double(hammingDistance(a, b))
        return max(0, 1 - distance / 32.0)  // 32 位差异视为完全不像
    }

    /// 判定文案（温柔，不打击人）
    public static func verdict(for similarity: Double) -> String {
        switch similarity {
        case 0.85...: return "几乎一模一样。你找到了 TA 的视角。"
        case 0.65..<0.85: return "很像。你站的位置差不多就是那个点。"
        case 0.45..<0.65: return "有点像。再往那边挪两步会更接近。"
        default: return "画面不太一样。不过这张也有你自己的意思。"
        }
    }

    /// 达标阈值：低于这个相似度不算「找到」
    public static let passThreshold = 0.45
}

/// 埋惊喜仓库（本地优先；v0.3 换远端同步）
public struct SurpriseRepository: Codable, Sendable {
    public var surprises: [BuriedSurprise]

    public init(surprises: [BuriedSurprise] = []) {
        self.surprises = surprises
    }

    public var waiting: [BuriedSurprise] { surprises.filter(\.isWaiting) }
    public var mine: [BuriedSurprise] { surprises.filter(\.isMine) }
    public var foundByMe: [BuriedSurprise] {
        surprises.filter { $0.status == .found && $0.finderName == "阿澈" }
    }

    public func nearest(to point: GeoPoint) -> BuriedSurprise? {
        waiting.min { a, b in
            GeoMath.distance(from: point, to: a.location) < GeoMath.distance(from: point, to: b.location)
        }
    }

    /// 附近可探索的（按距离升序）
    public func nearby(to point: GeoPoint, within meters: Double = 3000) -> [BuriedSurprise] {
        waiting
            .map { ($0, GeoMath.distance(from: point, to: $0.location)) }
            .filter { $0.1 <= meters }
            .sorted { $0.1 < $1.1 }
            .map(\.0)
    }
}
