import SwiftUI

// MARK: - 抽盒设置 Sheet（design-system §5.2）

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
                VStack(alignment: .leading, spacing: 24) {
                    header
                    durationSection
                    moodSection
                    areaSection
                    actionSection
                }
                .padding(.horizontal, BWTheme.pagePadding)
                .padding(.top, 28)
                .padding(.bottom, 36)
            }
        }
        .presentationDetents([.fraction(0.92)])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(BWTheme.panelRadius)
        .presentationBackground(BWTheme.paper)
    }

    // MARK: 标题

    private var header: some View {
        HStack(alignment: .center, spacing: 16) {
            BWBoxIllustration(size: 72, floating: false, glow: true)
                .rotationEffect(.degrees(shakeAngle))

            VStack(alignment: .leading, spacing: 6) {
                Text("这次的盲盒，你想要什么？")
                    .font(BWTheme.title(22))
                    .foregroundStyle(BWTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text("选完就出发，目的地保密。")
                    .font(BWTheme.body(14))
                    .foregroundStyle(BWTheme.ink2)
            }

            Spacer(minLength: 0)
        }
    }

    // MARK: 时长 3 选 1

    private var durationSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            BWMicroLabel("想走多久")

            HStack(spacing: 8) {
                ForEach(WalkDuration.allCases) { duration in
                    Button {
                        selectDuration(duration)
                    } label: {
                        Text(duration.title)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(store.selectedDuration == duration ? BWTheme.ink : BWTheme.ink2)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 11)
                            .padding(.horizontal, 4)
                            .background(
                                store.selectedDuration == duration
                                    ? BWTheme.amber.opacity(0.20)
                                    : BWTheme.paper2
                            )
                            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 16, style: .continuous)
                                    .stroke(
                                        store.selectedDuration == duration
                                            ? BWTheme.amber.opacity(0.6)
                                            : BWTheme.line,
                                        lineWidth: 1
                                    )
                            )
                    }
                    .buttonStyle(BWPressEffectStyle())
                }
            }
        }
    }

    // MARK: 心情 3 卡

    private var moodSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            BWMicroLabel("此刻的心情")

            VStack(spacing: 10) {
                ForEach(Mood.allCases) { mood in
                    Button {
                        selectMood(mood)
                    } label: {
                        HStack(spacing: 12) {
                            Text(mood.emoji)
                                .font(.system(size: 22))

                            VStack(alignment: .leading, spacing: 2) {
                                Text(mood.title)
                                    .font(BWTheme.title(15))
                                    .foregroundStyle(BWTheme.ink)
                                Text(mood.subtitle)
                                    .font(BWTheme.caption(11))
                                    .foregroundStyle(BWTheme.ink2)
                            }

                            Spacer(minLength: 0)

                            Image(systemName: store.selectedMood == mood ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 18))
                                .foregroundStyle(
                                    store.selectedMood == mood ? BWTheme.amberDeep : BWTheme.ink3
                                )
                        }
                        .padding(14)
                        .background(
                            store.selectedMood == mood
                                ? BWTheme.amber.opacity(0.12)
                                : BWTheme.paper2
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .stroke(
                                    store.selectedMood == mood
                                        ? BWTheme.amber.opacity(0.55)
                                        : BWTheme.line,
                                    lineWidth: 1
                                )
                        )
                    }
                    .buttonStyle(BWPressEffectStyle())
                }
            }
        }
    }

    // MARK: 区域 3 chips

    private var areaSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            BWMicroLabel("往哪个方向")

            HStack(spacing: 8) {
                areaChip(title: "附近", isSelected: store.selectedArea == nil) {
                    store.selectedArea = nil
                }
                ForEach([Area.river, Area.oldtown], id: \.self) { area in
                    areaChip(
                        title: area.label,
                        isSelected: store.selectedArea == area
                    ) {
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
        VStack(spacing: 10) {
            BWPrimaryButton(
                title: "摇一个盲盒",
                icon: "dice",
                action: shakeAndStart
            )
            .disabled(isShaking)
            .opacity(isShaking ? 0.7 : 1)

            Button(action: onCancel) {
                Text("今天不想出门")
                    .font(BWTheme.body(13))
                    .foregroundStyle(BWTheme.ink3)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
            }
            .buttonStyle(.plain)

            if startFailed {
                Text("这一次没抽到，再试一次。")
                    .font(BWTheme.caption(12))
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
