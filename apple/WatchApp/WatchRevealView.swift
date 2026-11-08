import Foundation
import SwiftUI

/// §5.9 表盘 3「揭晓」
///
/// 到达前不显示地点名（§5.3「目的地保密中」），只有演示入口；
/// 到达后：大字「到了」+ 地点名「旧码头边的石阶」+ 稀有度小点 + 「轻点打卡」，
/// 打卡触发 `Haptics.checkIn()`（即 `.success`）并把打卡回传给 iPhone。
@MainActor
struct WatchRevealView: View {

    let store: BlindWalkStore
    let bridge: WatchBridge

    @State private var hasCheckedIn = false
    @State private var glow = false

    private var phase: QuestPhase? { store.session?.phase }
    private var isArrived: Bool {
        guard let phase else { return false }
        return phase == .arrived || phase == .revealed || phase == .collected
    }
    private var place: Place? { store.reveal?.place ?? store.currentPlace }
    private var isPhoneDriven: Bool { bridge.source == .phone }

    var body: some View {
        Group {
            if isArrived, let place {
                arrived(place)
            } else {
                locked
            }
        }
        .watchScreen()
        .onChange(of: isArrived) { _, arrived in
            if !arrived { hasCheckedIn = false }
        }
    }

    // MARK: 到达

    private func arrived(_ place: Place) -> some View {
        VStack(spacing: 6) {
            Text("到了")
                .font(.system(size: 26, weight: .bold, design: .rounded))
                .tracking(3)
                .foregroundStyle(BWTheme.amber)
                .accessibilityAddTraits(.isHeader)

            Text(place.name)
                .font(.system(size: 19, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.7)

            HStack(spacing: 4) {
                Circle()
                    .fill(BWTheme.rarityColor(place.rarity))
                    .frame(width: 7, height: 7)
                Text(place.rarity.label)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(BWTheme.rarityColor(place.rarity))
                Text("· \(place.area.label)")
                    .font(.system(size: 11))
                    .foregroundStyle(.white.opacity(0.55))
            }

            Button(action: checkIn) {
                HStack(spacing: 4) {
                    Image(systemName: hasCheckedIn ? "checkmark.circle.fill" : "hand.tap")
                        .font(.system(size: 11, weight: .semibold))
                    Text(hasCheckedIn ? "已打卡" : "轻点打卡")
                        .font(.system(size: 12, weight: .semibold))
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(
                    Capsule().fill(hasCheckedIn ? BWTheme.teal.opacity(0.22) : BWTheme.amber)
                )
                .foregroundStyle(hasCheckedIn ? BWTheme.teal : Color.black)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(hasCheckedIn ? "已打卡" : "轻点打卡")
        }
        .padding(.horizontal, 10)
        .background(glowBackground)
        .onAppear { glow = true }
    }

    /// §5.9「震动/发光动效」：暖光呼吸
    private var glowBackground: some View {
        Circle()
            .fill(BWTheme.amber.opacity(0.16))
            .frame(width: 190, height: 190)
            .blur(radius: 30)
            .scaleEffect(glow ? 1.06 : 0.9)
            .opacity(glow ? 0.9 : 0.45)
            .animation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true), value: glow)
    }

    private func checkIn() {
        guard !hasCheckedIn else { return }
        hasCheckedIn = true
        Haptics.checkIn()
        bridge.sendCheckIn()
    }

    // MARK: 未到达（目的地保密）

    private var locked: some View {
        VStack(spacing: 7) {
            Image(systemName: "shippingbox")
                .font(.system(size: 26))
                .foregroundStyle(.white.opacity(0.5))

            Text("还没到")
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(.white)

            Text("目的地保密中。\n到了，这里才会亮。")
                .font(.system(size: 10))
                .foregroundStyle(.white.opacity(0.5))
                .multilineTextAlignment(.center)

            if !isPhoneDriven {
                Button(action: arriveForDemo) {
                    Text("演示：我到了")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(BWTheme.amber)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 10)
    }

    /// 演示用「我到了」：到达触感由根视图 onChange 统一播放（§8：到达 `.notification`）
    private func arriveForDemo() {
        store.arriveNow()
    }
}
