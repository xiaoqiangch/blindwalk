import SwiftUI

// MARK: - 抽盒设置 Sheet（design-system §5.2，视觉基准：web 原型 #/setup）

struct BoxSetupSheet: View {

    let store: BlindWalkStore
    var onStart: () -> Void
    var onCancel: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shakeAngle: Double = 0
    @State private var isShaking = false
    @State private var startFailed = false

    var body: some View {
        ZStack {
            BWTheme.paper.ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("这次的盲盒，你想要什么？")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(BWTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)

                    Text("选完就出发，目的地保密。")
                        .font(.system(size: 12.5))
                        .foregroundStyle(BWTheme.ink3)
                        .padding(.top, 4)
                        .padding(.bottom, 18)

                    durationSection
                    moodSection.padding(.top, 15)
                    areaSection.padding(.top, 15)
                    actionSection.padding(.top, 17)
                }
                .padding(.horizontal, BWTheme.pagePadding)
                .padding(.top, 10)
                .padding(.bottom, 22)
            }
        }
        .presentationDetents([.fraction(0.92)])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(BWTheme.panelRadius)
        .presentationBackground(BWTheme.paper)
        .bwTypeBounds()
    }

    // MARK: 时长 3 选 1（web .segmented：纸色凹槽 + 白纸浮起块）

    private var durationSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            BWMicroLabel("时长")

            HStack(spacing: 4) {
                ForEach(WalkDuration.allCases) { duration in
                    durationButton(duration)
                }
            }
            .padding(4)
            .background(BWTheme.paper2)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(BWTheme.line, lineWidth: 1)
            )
        }
    }

    private func durationButton(_ duration: WalkDuration) -> some View {
        let selected = store.selectedDuration == duration
        return Button {
            selectDuration(duration)
        } label: {
            VStack(spacing: 1) {
                Text("\(duration.rawValue) 分钟")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(selected ? BWTheme.ink : BWTheme.ink2)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text(durationCaption(duration))
                    .font(.system(size: 9.5))
                    .foregroundStyle(selected ? BWTheme.amberDeep : BWTheme.ink3)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background {
                if selected {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(BWTheme.paper)
                        .shadow(color: BWTheme.ink.opacity(0.10), radius: 3, x: 0, y: 2)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(BWTheme.amber.opacity(0.55), lineWidth: 1)
                        )
                }
            }
        }
        .buttonStyle(BWPressEffectStyle())
        .accessibilityLabel(duration.title)
    }

    private func durationCaption(_ duration: WalkDuration) -> String {
        switch duration {
        case .m15: return "一小圈"
        case .m30: return "刚好"
        case .m60: return "走远点"
        }
    }

    // MARK: 心情 3 卡

    private var moodSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            BWMicroLabel("心情")

            VStack(spacing: 7) {
                ForEach(Mood.allCases) { mood in
                    moodRow(mood)
                }
            }
        }
    }

    private func moodRow(_ mood: Mood) -> some View {
        let selected = store.selectedMood == mood
        return Button {
            selectMood(mood)
        } label: {
            HStack(spacing: 12) {
                Text(mood.emoji)
                    .font(.system(size: 17))
                    .frame(width: 34, height: 34)
                    .background(selected ? BWTheme.amber.opacity(0.16) : BWTheme.paper2)
                    .clipShape(Circle())

                VStack(alignment: .leading, spacing: 1) {
                    Text(mood.title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(BWTheme.ink)
                    Text(mood.subtitle)
                        .font(.system(size: 10.5))
                        .foregroundStyle(BWTheme.ink3)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                }

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? BWTheme.amber.opacity(0.07) : BWTheme.paper)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(selected ? BWTheme.amber.opacity(0.70) : BWTheme.line, lineWidth: 1)
            )
        }
        .buttonStyle(BWPressEffectStyle())
        .accessibilityLabel("\(mood.title)：\(mood.subtitle)")
    }

    // MARK: 区域 3 chips

    private var areaSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            BWMicroLabel("区域")

            HStack(spacing: 8) {
                areaChip(title: "附近", isSelected: store.selectedArea == nil) {
                    store.selectedArea = nil
                }
                ForEach([Area.river, Area.oldtown], id: \.self) { area in
                    areaChip(title: area.label, isSelected: store.selectedArea == area) {
                        store.selectedArea = (store.selectedArea == area ? nil : area)
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }

    private func areaChip(title: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        BWPill(title: title, selected: isSelected, action: action)
    }

    // MARK: 按钮

    private var actionSection: some View {
        VStack(spacing: 4) {
            BWPrimaryButton(
                title: "摇一个盲盒",
                action: shakeAndStart
            )
            .rotationEffect(.degrees(shakeAngle))
            .disabled(isShaking)
            .opacity(isShaking ? 0.7 : 1)

            Button(action: onCancel) {
                Text("今天不想出门")
                    .font(.system(size: 13.5, weight: .medium))
                    .foregroundStyle(BWTheme.ink2)
                    .frame(maxWidth: .infinity)
                    .frame(height: 42)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if startFailed {
                Text("这一次没抽到，再试一次。")
                    .font(.system(size: 12))
                    .foregroundStyle(BWTheme.ember)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: 交互

    private func selectDuration(_ duration: WalkDuration) {
        guard store.selectedDuration != duration else { return }
        store.selectedDuration = duration
        BWHaptics.light()
    }

    private func selectMood(_ mood: Mood) {
        guard store.selectedMood != mood else { return }
        store.selectedMood = mood
        BWHaptics.light()
    }

    /// 摇盒 600ms（±6° 三次）→ 抽盒 → 关闭 sheet 进入旅程
    private func shakeAndStart() {
        guard !isShaking else { return }
        startFailed = false

        if reduceMotion {
            startQuest()
            return
        }

        isShaking = true
        BWHaptics.light()

        withAnimation(.easeInOut(duration: 0.1).repeatCount(6, autoreverses: true)) {
            shakeAngle = 6
        }

        bwAfter(0.7) {
            withAnimation(BWAnimation.quick) {
                shakeAngle = 0
            }
            isShaking = false
            startQuest()
        }
    }

    private func startQuest() {
        let place = store.startQuest()
        guard place != nil else {
            startFailed = true
            return
        }
        BWHaptics.medium()
        onStart()
    }
}
