import SwiftUI
import CoreLocation

// MARK: - 真实地点搜索失败面板（docs/parity.md §2）
//
// 文案与出口与 Web 一致：
//   没找到真实地点，这次不抽了
//   不会用虚构地点糊弄你
//   扩大范围再找 / 换个位置 / 改成演示模式（虚构地点）
// 真实模式下绝不自动进入虚构地点。

struct BoxFailureView: View {

    let reason: String
    let reports: [POISourceReport]
    var onExpand: () -> Void
    var onRelocate: () -> Void
    var onDemo: () -> Void

    private var reasonText: String {
        switch reason {
        case "network":
            return "网络不给力，地图数据没取到（可能是 OSM/高德都被挡住或超时）"
        case "location":
            return "现在还没有拿到你的真实位置，没法找附近可以走到的真实地点"
        default:
            return "这一带暂时没有适合走过去的真实地点"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("没找到真实地点，这次不抽了")
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(WATheme.ink)

            Text("\(reasonText)。不会用虚构地点糊弄你。\n试试：换「60 分钟」把范围放大，或改个区域（河边/老城区）。")
                .font(.system(size: 14))
                .foregroundStyle(WATheme.ink2)
                .fixedSize(horizontal: false, vertical: true)

            if !reports.isEmpty {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(reports) { report in
                        HStack(alignment: .top, spacing: 6) {
                            Circle()
                                .fill(report.ok ? WATheme.teal : WATheme.ember)
                                .frame(width: 6, height: 6)
                                .padding(.top, 5)
                            Text(report.ok ? "\(report.label)：找到 \(report.count) 个" : "\(report.label)：\(report.error.isEmpty ? "失败" : report.error)")
                                .font(.system(size: 13))
                                .foregroundStyle(report.ok ? WATheme.ink2 : WATheme.ember)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(WATheme.paper2)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }

            HStack(spacing: 10) {
                Button(action: onExpand) {
                    Text("扩大范围再找")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(WATheme.paper)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(WATheme.amberDeep)
                        .clipShape(Capsule())
                }
                .buttonStyle(WAPressEffectStyle())

                Button(action: onRelocate) {
                    Text("换个位置")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(WATheme.ink)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(WATheme.paper)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(WATheme.line, lineWidth: 1))
                }
                .buttonStyle(WAPressEffectStyle())
            }

            Button(action: onDemo) {
                Text("改成演示模式（虚构地点）")
                    .font(.system(size: 13.5, weight: .medium))
                    .foregroundStyle(WATheme.ink3)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(WAPressEffectStyle())
        }
        .padding(16)
        .background(WATheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(WATheme.ember.opacity(0.25), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }
}

// MARK: - 换个位置（地址 / 坐标）

struct LocationInputSheet: View {

    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var isResolving = false
    @State private var error: String?
    var onResolved: (GeoPoint) -> Void

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Text("输入一个地址，或直接填「纬度,经度」")
                    .font(.system(size: 14))
                    .foregroundStyle(WATheme.ink2)

                TextField("例如：上海人民广场 或 31.2304,121.4737", text: $text)
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)

                if let error {
                    Text(error)
                        .font(.system(size: 13))
                        .foregroundStyle(WATheme.ember)
                }

                Button {
                    resolve()
                } label: {
                    HStack(spacing: 8) {
                        if isResolving { ProgressView().controlSize(.small) }
                        Text(isResolving ? "正在定位…" : "用这个位置再找")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(WATheme.paper)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(WATheme.amberDeep)
                    .clipShape(Capsule())
                }
                .buttonStyle(WAPressEffectStyle())
                .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || isResolving)

                Spacer(minLength: 0)
            }
            .padding(20)
            .background(WATheme.paper)
            .navigationTitle("换个位置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func resolve() {
        let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return }
        let parts = query.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) }
        if parts.count == 2, let lat = Double(parts[0]), let lon = Double(parts[1]),
           abs(lat) <= 90, abs(lon) <= 180 {
            onResolved(GeoPoint(latitude: lat, longitude: lon))
            dismiss()
            return
        }

        isResolving = true
        error = nil
        Task { @MainActor in
            let geocoder = CLGeocoder()
            do {
                let marks = try await geocoder.geocodeAddressString(query, in: nil, preferredLocale: Locale(identifier: "zh_CN"))
                if let location = marks.first?.location {
                    isResolving = false
                    onResolved(GeoPoint(latitude: location.coordinate.latitude, longitude: location.coordinate.longitude))
                    dismiss()
                } else {
                    isResolving = false
                    error = "没找到这个地址，换个说法试试"
                }
            } catch {
                isResolving = false
                self.error = "地址解析失败，可以直接填「纬度,经度」"
            }
        }
    }
}
