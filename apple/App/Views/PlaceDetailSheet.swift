import SwiftUI

// MARK: - 图鉴卡片详情（已解锁）
//
// 换成 List insetGrouped 后，这里只负责「已解锁卡片」的详情内容。
// 未解锁地点的探秘入口在网格里直接点击触发（不再进详情页），
// 这样「点一下就出发」，符合用户「标签块直接完成任务」的偏好。

struct PlaceDetailSheet: View {

    let store: WalkaholicStore
    let place: Place
    var onStartQuest: (() -> Void)? = nil

    var body: some View {
        List {
            Section {
                VStack(spacing: 8) {
                    Text(place.emoji)
                        .font(.largeTitle)
                    Text(place.name)
                        .font(.title3.weight(.semibold))
                        .multilineTextAlignment(.center)
                    if let card = store.card(for: place.id) {
                        Text("\(card.serialDisplay) · \(WAFormat.shortDate(card.collectedAt))")
                            .font(.footnote)
                            .monospacedDigit()
                            .foregroundStyle(WATheme.ink2)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
            }

            if let card = store.card(for: place.id), card.photoName != nil || card.photoRemotePath != nil {
                Section("你拍的") {
                    checkInPhoto(card)
                }
            }

            Section("为什么是这里") {
                Text(place.why)
                    .font(.body)
                    .foregroundStyle(WATheme.ink)
            }

            Section("小任务") {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: store.card(for: place.id)?.taskDone == true ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(store.card(for: place.id)?.taskDone == true ? WATheme.teal : WATheme.ink3)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(place.task)
                            .font(.body)
                        if let card = store.card(for: place.id) {
                            Text(card.taskDone ? "已完成" : "还没打卡 · 下次再去补上")
                                .font(.footnote)
                                .foregroundStyle(WATheme.ink2)
                        }
                    }
                }
            }

            Section {
                HStack {
                    Text("区域")
                    Spacer()
                    Text(WAFormat.areaName(place.area))
                        .foregroundStyle(WATheme.ink2)
                }
                HStack {
                    Text("稀有度")
                    Spacer()
                    WARarityBadge(rarity: place.rarity)
                }
            } footer: {
                if let coordinate = place.coordinate {
                    Text("坐标 \(String(format: "%.5f, %.5f", coordinate.latitude, coordinate.longitude))")
                        .font(.caption)
                        .monospacedDigit()
                }
            }

            if let onStartQuest {
                Section {
                    Button(action: onStartQuest) {
                        Label("再去一次", systemImage: "figure.walk")
                    }
                } footer: {
                    Text("去的还是这个地方，线索会重新按距离解锁。")
                }
            }
        }
        .listStyle(.insetGrouped)
        .background(WATheme.cream)
    }

    /// 到达实拍：本地优先（离线也有），否则从账号拉（换机后仍能看到）
    @ViewBuilder
    private func checkInPhoto(_ card: PlaceCard) -> some View {
        let localImage = card.photoName.flatMap { PhotoLibraryService.load(named: $0) }
        let remoteURL = card.photoRemotePath.flatMap { AccountService.shared.photoURL(path: $0) }

        if let localImage {
            Image(uiImage: localImage)
                .resizable()
                .scaledToFill()
                .frame(height: 200)
                .frame(maxWidth: .infinity)
                .clipped()
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
        } else if let remoteURL {
            AsyncImage(url: remoteURL) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                case .failure:
                    photoFallback
                case .empty:
                    ZStack {
                        WATheme.paper2
                        ProgressView()
                    }
                @unknown default:
                    photoFallback
                }
            }
            .frame(height: 200)
            .frame(maxWidth: .infinity)
            .clipped()
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
        } else {
            photoFallback
        }
    }

    private var photoFallback: some View {
        HStack(spacing: 8) {
            Image(systemName: "photo")
                .foregroundStyle(WATheme.ink3)
            Text("照片暂时打不开")
                .font(.footnote)
                .foregroundStyle(WATheme.ink2)
        }
        .frame(maxWidth: .infinity, minHeight: 80)
    }
}
