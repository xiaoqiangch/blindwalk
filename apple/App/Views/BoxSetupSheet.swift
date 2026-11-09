import SwiftUI
import Foundation

// MARK: - 抽盒设置 Sheet（design-system §5.2，视觉基准：web 原型 #/setup）

struct BoxSetupSheet: View {

    let store: BlindWalkStore
    var onStart: () -> Void
    var onCancel: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shakeAngle: Double = 0
    @State private var isShaking = false
    @State private var startFailed = false
    @State private var isLookingUp = false

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
        .onAppear(perform: handleAppear)
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

            if isLookingUp {
                HStack(spacing: 6) {
                    ProgressView()
                        .controlSize(.mini)
                    Text("正在看附近有什么…")
                        .font(.system(size: 11.5))
                        .foregroundStyle(BWTheme.ink3)
                }
                .frame(maxWidth: .infinity)
            }

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

    /// 抽盒优先级：后台「编辑精选」策展 POI → MapKit 真实 POI → 内置地点（演示）。
    /// 策展数据 3 秒超时 / 失败 / 为空时静默退回原逻辑，不阻塞、不弹错。
    private func startQuest() {
        let origin = store.lastKnownOrigin
        guard let origin else {
            // 还没有定位：走内置地点（演示模式）
            let place = store.startQuest()
            guard place != nil else { startFailed = true; return }
            BWHaptics.medium()
            onStart()
            return
        }

        isLookingUp = true
        Task { @MainActor in
            // ① 后台策展 POI（人工审核过的点最可靠）
            await AdminPOIService.shared.prepare()
            let seed = UInt64(Date().timeIntervalSince1970)
            if let curated = AdminPOIService.shared.pickCuratedPlace(
                origin: origin,
                mood: store.selectedMood,
                startMeters: store.selectedDuration.startMeters,
                seed: seed
            ) {
                isLookingUp = false
                guard store.startQuest(origin: origin) != nil else {
                    startFailed = true
                    return
                }
                adopt(curatedPlace: curated, origin: origin)
                let photo = AdminPOIService.shared.info(for: curated)?.photoURL != nil
                debugLog("curated pick name=\(curated.name) id=\(curated.id) source=\(curated.source) photo=\(photo) pool=\(AdminPOIService.shared.cachedCount)")
                BWHaptics.medium()
                onStart()
                return
            }
            debugLog("curated miss (pool=\(AdminPOIService.shared.cachedCount)) → MapKit fallback")

            // ② 现有 MapKit 真实 POI 流程（行为保持不变）
            let candidates = await MapKitPlaceService.shared.nearbyPlaces(
                around: origin,
                radiusMeters: store.selectedDuration.radiusMeters,
                moods: [store.selectedMood]
            )
            isLookingUp = false

            let picked = RealPlaceFactory.pick(
                from: candidates,
                origin: origin,
                mood: store.selectedMood,
                startMeters: store.selectedDuration.startMeters,
                seed: UInt64(Date().timeIntervalSince1970)
            )

            guard store.startQuest(origin: origin) != nil else {
                startFailed = true
                return
            }

            if let picked {
                let hour = Calendar.current.component(.hour, from: Date())
                let realPlace = RealPlaceFactory.scrub(RealPlaceFactory.makePlace(
                    from: picked,
                    origin: origin,
                    mood: store.selectedMood,
                    hour: hour,
                    startMeters: store.selectedDuration.startMeters
                ))
                // 覆盖成真实 POI：目的地坐标 + 展示用真实地点
                store.session?.target = realPlace.coordinate
                store.currentPlace = realPlace
                debugLog("mapkit pick name=\(realPlace.name) id=\(realPlace.id) source=\(realPlace.source)")
            } else {
                debugLog("mapkit empty → catalog demo")
            }

            BWHaptics.medium()
            onStart()
        }
    }

    /// 把「编辑精选」Place 覆盖进 store：
    /// - 目的地坐标 = 策展点真实坐标；展示地点 = 策展 Place
    /// - 总路程改成「起点 → 目的地的真实距离」，避免出现「刚到就已走 300 米」的假进度；
    /// - 用 store.updateLocation 正规推进一次，让线索按真实剩余距离解锁。
    private func adopt(curatedPlace place: Place, origin: GeoPoint) {
        guard let coordinate = place.coordinate, let current = store.session else {
            store.currentPlace = place
            return
        }
        let distance = max(Double(QuestSession.arriveThreshold + 1), GeoMath.distance(from: origin, to: coordinate))
        let total = max(Int(distance.rounded()), QuestSession.arriveThreshold + 1)
        let bearing = GeoMath.bearing(from: origin, to: coordinate)

        // QuestSession.totalMeters 是 let，只能整体重建（保持 id / placeID / startedAt 不变）。
        let session = QuestSession(
            id: current.id,
            placeID: current.placeID,
            startedAt: current.startedAt,
            totalMeters: total,
            remainingMeters: total,
            phase: .walking,
            unlockedHintCount: 1,
            target: coordinate,
            currentBearing: bearing
        )
        store.session = session
        store.currentPlace = place

        // 起点即按真实距离解锁线索（剩余 ≤200 → 第二条；不会触发到达，因为 total ≥ 31）。
        _ = store.updateLocation(distanceMeters: Double(total), bearingDegrees: bearing)
    }

    // MARK: 截图 / 自检辅助

    /// 截图自检：`BW_PREVIEW=setup` + `BW_AUTO_START=1` 时自动用模拟器坐标摇一次盲盒。
    private func handleAppear() {
        // 提前预热策展数据（不阻塞 UI；3 秒超时在服务内部）
        Task { await AdminPOIService.shared.prepare() }

        let env = ProcessInfo.processInfo.environment
        guard env["BW_AUTO_START"] == "1" else { return }
        if store.lastKnownOrigin == nil {
            store.lastKnownOrigin = GeoPoint(latitude: 31.2304, longitude: 121.4737)
        }
        bwAfter(0.9) { startQuest() }
    }

    private func debugLog(_ message: String) {
        guard ProcessInfo.processInfo.environment["BW_DEBUG_POI"] == "1" else { return }
        print("[BlindWalk][poi] \(message)")
    }
}
