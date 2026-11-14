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
    /// 失败的具体原因（定位权限 / 超时等），有就显示
    var diagnostic: String? = nil
    var onRetryLocation: (() -> Void)? = nil
    var onOpenSettings: (() -> Void)? = nil
    /// 这一次是走路还是远程漫游：文案必须说实话，别把「10 公里外没找到」说成「附近没有」
    var scope: ExploreScope = .walk

    private var reasonText: String {
        switch reason {
        case "network":
            return scope == .roam
                ? "网络不给力，周边城市的地图数据没取到"
                : "网络不给力，地图数据没取到"
        case "location":
            return "现在还没有拿到你的真实位置，没法找附近可以走到的真实地点"
        default:
            return scope == .roam
                ? "10 公里外的环带里暂时没有搜到适合走的地点"
                : "这一带暂时没有适合走过去的真实地点"
        }
    }

    private var titleText: String {
        if reason == "location" { return "还没拿到你的位置" }
        return scope == .roam ? "周边没有搜到值得开过去的地点" : "附近没有能走过去的地点"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(titleText, systemImage: "exclamationmark.triangle")
                .font(.headline)
                .foregroundStyle(WATheme.ink)

            Text("\(reasonText)。不会用虚构地点糊弄你。")
                .font(.subheadline)
                .foregroundStyle(WATheme.ink2)
                .fixedSize(horizontal: false, vertical: true)

            if scope == .roam {
                Text("想走走近的，把上面的「怎么去」切回「走路去」。")
                    .font(.footnote)
                    .foregroundStyle(WATheme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let diagnostic {
                Text(diagnostic)
                    .font(.footnote)
                    .foregroundStyle(WATheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.tertiarySystemFill))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }

            if !reports.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(reports) { report in
                        HStack(alignment: .top, spacing: 6) {
                            Image(systemName: report.ok ? "checkmark.circle.fill" : "xmark.circle.fill")
                                .font(.caption)
                                .foregroundStyle(report.ok ? WATheme.teal : WATheme.ember)
                            Text(report.ok
                                 ? "\(report.label)：找到 \(report.count) 个"
                                 : "\(report.label)：\(report.error.isEmpty ? "失败" : report.error)")
                                .font(.footnote)
                                .foregroundStyle(WATheme.ink2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.tertiarySystemFill))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }

            if let onRetryLocation {
                Button("重新获取位置", action: onRetryLocation)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .frame(maxWidth: .infinity)
            }

            if let onOpenSettings {
                Button("打开设置", action: onOpenSettings)
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .frame(maxWidth: .infinity)
            }

            Button("扩大范围再找", action: onExpand)
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .frame(maxWidth: .infinity)

            Button("换个位置", action: onRelocate)
                .buttonStyle(.bordered)
                .controlSize(.large)
                .frame(maxWidth: .infinity)

        }
        .padding(16)
        .background(WATheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: WATheme.cardRadius, style: .continuous))
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

    private var canResolve: Bool {
        !text.trimmingCharacters(in: .whitespaces).isEmpty && !isResolving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("地址或「纬度,经度」", text: $text)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                } footer: {
                    Text("例如：上海人民广场，或 31.2304,121.4737")
                }

                if let error {
                    Section {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(WATheme.ember)
                    }
                }

                Section {
                    Button {
                        resolve()
                    } label: {
                        HStack {
                            if isResolving {
                                ProgressView().controlSize(.small)
                            }
                            Text(isResolving ? "正在定位…" : "用这个位置再找")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .disabled(!canResolve)
                }
            }
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
