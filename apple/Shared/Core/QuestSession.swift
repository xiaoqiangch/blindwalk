import Foundation

/// 旅程事件：由定位推进产生，UI 据此播放线索解锁 / 到达动画 / 揭晓。
public enum QuestEvent: Equatable, Sendable {
    case hintUnlocked(index: Int)
    case arrived
    case revealed
}

public extension QuestSession {

    /// 用「剩余距离」推进旅程，返回本次产生的事件。
    /// 规则：起点即显示第 1 条线索；剩余 ≤200m 解锁第 2 条；≤60m 解锁第 3 条；≤30m 到达。
    @discardableResult
    mutating func update(remainingMeters newRemaining: Int) -> [QuestEvent] {
        guard phase == .walking || phase == .arrived else { return [] }
        var events: [QuestEvent] = []
        let clamped = max(0, min(totalMeters, newRemaining))
        remainingMeters = clamped

        while unlockedHintCount < 3, let threshold = nextHintThreshold, clamped <= threshold {
            unlockedHintCount += 1
            events.append(.hintUnlocked(index: unlockedHintCount - 1))
        }

        if clamped <= Self.arriveThreshold, phase == .walking {
            phase = .arrived
            events.append(.arrived)
        }
        return events
    }

    /// 立即到达（「我到了」/ 演示用）
    @discardableResult
    mutating func forceArrive() -> [QuestEvent] {
        guard phase == .walking else { return [] }
        phase = .arrived
        remainingMeters = min(remainingMeters, Self.arriveThreshold)
        return [.arrived]
    }

    /// 播放完揭晓动画后调用
    mutating func confirmReveal() {
        guard phase == .arrived else { return }
        phase = .revealed
    }

    /// 卡片已收录
    mutating func markCollected() {
        guard phase == .revealed || phase == .arrived else { return }
        phase = .collected
    }

    /// 箭头方向（演示用，按剩余距离变化）
    var bearing: String {
        switch remainingMeters {
        case 361...: return "↖"
        case 241...360: return "↑"
        case 121...240: return "↗"
        default: return "→"
        }
    }

    /// 剩余距离下一条线索提示
    var nextHintCopy: String {
        guard let threshold = nextHintThreshold else { return "线索已全部解锁" }
        let gap = max(0, remainingMeters - threshold)
        return "再走 \(gap) 米，解锁下一条线索"
    }
}
