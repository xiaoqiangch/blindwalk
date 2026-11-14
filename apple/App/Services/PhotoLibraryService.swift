import Foundation
import SwiftUI
import UIKit
import PhotosUI
import CoreLocation
import CoreImage
import Observation

// MARK: - 惊喜照片的本地仓库
//
// 为什么存「文件名」而不是 UIImage：`BuriedSurprise` 要 Codable、要能被 Shared/Core
// 持久化，二进制塞进去会又大又慢；照片本体放 `Documents/Surprises/<uuid>.jpg`，
// 记录里只留名字，读的时候再取。
//
// 照片生命周期：
// - 埋：作者拍照/选图 → 存盘 → 名字写进 BuriedSurprise.photoName
// - 寻：寻者先拍 → 存盘 → 名字写进 finderPhotoName（只有达标才落盘，避免重拍留下孤儿文件）

enum PhotoLibraryService {

    /// 惊喜照片的沙盒子目录
    static let directoryName = "Surprises"

    /// 照片在沙盒里的绝对路径（文件名会做一层清洗，避免 `../` 这类路径穿越）
    static func url(for name: String) -> URL {
        directory.appendingPathComponent((name as NSString).lastPathComponent)
    }

    static var directory: URL {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return documents.appendingPathComponent(directoryName, isDirectory: true)
    }

    static func exists(_ name: String) -> Bool {
        !name.isEmpty && FileManager.default.fileExists(atPath: url(for: name).path)
    }

    /// 把 UIImage 压到长边 1400px 后存成 JPEG，返回文件名（如 `A0F3....jpg`）
    @discardableResult
    static func save(_ image: UIImage) throws -> String {
        let name = UUID().uuidString.replacingOccurrences(of: "-", with: "") + ".jpg"
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let scaled = downscaled(image, maxPixel: 1400)
        // 用 0.95 而不是 0.82：dHash 是对 9×8 灰度做差分，JPEG 在高对比边缘的块效应
        // 会翻转几个 bit（实测 0.82 时「同一张图存盘再读回」只剩 0.84 相似度），
        // 而照片本来就要多次比对，宁可多占一点空间也不要把判定裕度吃掉。
        guard let data = scaled.jpegData(compressionQuality: 0.95) else {
            throw PhotoStoreError.encodeFailed
        }
        try data.write(to: url(for: name), options: .atomic)
        return name
    }

    static func delete(_ name: String) {
        guard exists(name) else { return }
        try? FileManager.default.removeItem(at: url(for: name))
    }

    /// 从文件名读回 UIImage（文件不存在 → nil，调用方自己给占位）
    static func load(named name: String) -> UIImage? {
        guard exists(name) else { return nil }
        guard let data = try? Data(contentsOf: url(for: name)) else { return nil }
        return UIImage(data: data)
    }

    // MARK: 相册 / 相机 → UIImage

    /// PhotosPicker 选中的条目 → UIImage（异步解码，调用方回主线程）
    static func loadImage(from item: PhotosPickerItem) async -> UIImage? {
        if let data = try? await item.loadTransferable(type: Data.self),
           let image = UIImage(data: data) {
            return image
        }
        // 兜底：某些（iCloud 未下载完成的）条目只有 file 形式
        if let file = try? await item.loadTransferable(type: URL.self),
           let image = UIImage(contentsOfFile: file.path) {
            return image
        }
        return nil
    }

    /// 是否真的可以用相机（模拟器 / 无前摄设备为 false）
    static var isCameraAvailable: Bool {
        UIImagePickerController.isSourceTypeAvailable(.camera)
    }

    /// 长边缩到 maxPixel，同时**应用 imageOrientation**（相机/相册图常见 `.right`，
    /// 不处理会导致 dHash 按旋转前的像素算，跟人眼看到的画面不匹配）
    static func downscaled(_ image: UIImage, maxPixel: CGFloat) -> UIImage {
        let size = image.size
        guard size.width > 1, size.height > 1 else { return image }
        let longest = max(size.width, size.height)
        guard longest > maxPixel else {
            // 尺寸已经在范围内，但仍要把方向「熨平」，否则存盘/缩略图会歪
            if image.imageOrientation == .up { return image }
            return redrawn(image, size: size)
        }
        let ratio = maxPixel / longest
        let target = CGSize(
            width: max(1, (size.width * ratio).rounded()),
            height: max(1, (size.height * ratio).rounded())
        )
        return redrawn(image, size: target)
    }

    private static func redrawn(_ image: UIImage, size: CGSize) -> UIImage {
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true
        format.preferredRange = .standard
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    // MARK: - dHash（感知哈希）
    //
    // 与 `Shared/Core/Surprise.swift` 的 `PhotoMatcher` 共用同一算法：
    // 9×8 灰度 → 每行相邻像素比较 → 64 位。这里只负责「UIImage → 9×8 灰度」。

    /// UIImage → 64 位 dHash。失败返回 0（0 不参与判定，调用方要处理）
    static func dHash(of image: UIImage) -> UInt64 {
        guard let values = grayValues(of: image, width: 9, height: 8) else { return 0 }
        return PhotoMatcher.dHash(values: values, width: 9, height: 8)
    }

    /// UIImage → 9×8 灰度（行优先 72 字节）。
    /// 实现在意的是**稳**：先把方向与尺寸一次解决（`UIImage.draw` 会应用方向），
    /// 再画进自己分配的 8bpc 灰度位图，读写用同一个 bytesPerRow，绝不越界。
    static func grayValues(of image: UIImage, width: Int = 9, height: Int = 8) -> [UInt8]? {
        guard width > 1, height > 1 else { return nil }
        guard image.size.width > 0, image.size.height > 0 else { return nil }

        // 1) 方向 + 尺寸一次到位（这一步也可能把 HEIC/超大方图降采样）
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true
        // 统一到 sRGB 标准范围：rendered image 默认是 extended sRGB，
        // 存成 JPEG 再读回会走一次色彩空间转换，9×8 的灰度值会小幅漂移。
        format.preferredRange = .standard
        let tiny = UIGraphicsImageRenderer(
            size: CGSize(width: CGFloat(width), height: CGFloat(height)),
            format: format
        ).image { _ in
            image.draw(in: CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
        }
        guard let cgImage = tiny.cgImage else { return nil }

        // 2) 8bpc 灰度位图：单通道字节数 = width，alphaInfo = .none
        var values = [UInt8](repeating: 0, count: width * height)
        let bytesPerRow = width
        let drawn: Bool = values.withUnsafeMutableBytes { raw in
            guard let base = raw.baseAddress else { return false }
            guard let context = CGContext(
                data: base,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: bytesPerRow,
                space: CGColorSpaceCreateDeviceGray(),
                bitmapInfo: CGImageAlphaInfo.none.rawValue
            ) else { return false }
            context.interpolationQuality = .high
            context.setAllowsAntialiasing(false)
            context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn else { return nil }
        return values
    }

    // MARK: - 复刻度判定

    /// 拿寻者的照片和「作者照片文件名」比对。
    /// - 作者照片在本地 → 真实 dHash 对比（`isDemo == false`）
    /// - 作者照片不在本地（演示种子数据没有像素文件）→ 演示相似度，
    ///   调用方**必须**在 UI 上标注「演示匹配」，不能假装是真判定
    static func match(finderImage: UIImage, authorPhotoName: String) -> PhotoMatchOutcome {
        let finderHash = dHash(of: finderImage)

        if let authorImage = load(named: authorPhotoName) {
            let authorHash = dHash(of: authorImage)
            if authorHash != 0, finderHash != 0 {
                let score = PhotoMatcher.similarity(authorHash, finderHash)
                return PhotoMatchOutcome(
                    score: score,
                    isDemo: false,
                    verdict: PhotoMatcher.verdict(for: score)
                )
            }
        }

        let score = demoSimilarity(finderHash: finderHash)
        return PhotoMatchOutcome(
            score: score,
            isDemo: true,
            verdict: PhotoMatcher.verdict(for: score)
        )
    }

    /// 演示相似度：用寻者照片哈希里的两段 6 bit 拼成 0.55…0.92。
    /// 数值是真随图变的（重拍会变），但来源不是作者原图，所以 UI 标注「演示匹配」。
    static func demoSimilarity(finderHash: UInt64) -> Double {
        let low = Double((finderHash >> 6) & 0x3F) / 63.0
        let high = Double((finderHash >> 38) & 0x3F) / 63.0
        let mixed = low * 0.65 + high * 0.35
        return 0.55 + mixed * 0.37
    }

    // MARK: - DEBUG 自检
    //
    // 照片流程是明天真机测试的关键路径，但它依赖相机/相册这些「没法在 CI 里点」的东西。
    // 这里把可自动验证的部分（灰度化 → dHash → 相似度 → 存盘读回）做成一次自检，
    // 启动时用 `SIMCTL_CHILD_WA_PREVIEW=dhash-check` 触发，日志里看结果。

    #if DEBUG
    @discardableResult
    static func runSelfCheck() -> Bool {
        // 用「像照片」的平滑图做样本：debugPlaceholderImage 里那层 7px 横纹是
        // 1 像素高频纹理，缩到 9×8 会严重混叠，不适合拿来验证 JPG 往返。
        let base = demoStandInImage(seed: "selfcheck")

        // ① 同一张图，自己跟自己 = 1.0
        let selfScore = PhotoMatcher.similarity(dHash(of: base), dHash(of: base))

        // ② 加亮 12 级：dHash 比的是相邻像素，整体提亮不该改变结果
        let brighter = brightened(base, by: 0.05)
        let brightScore = PhotoMatcher.similarity(dHash(of: base), dHash(of: brighter))

        // ③ 反色：应当完全不同
        let invertedScore = PhotoMatcher.similarity(dHash(of: base), dHash(of: inverted(base)))

        // ④ 存盘 → 读回 → dHash 必须一致（JPEG 有损，允许极小的差异）
        var roundTrip: Double? = nil
        if let name = try? save(base) {
            defer { delete(name) }
            if let reloaded = load(named: name) {
                roundTrip = PhotoMatcher.similarity(dHash(of: base), dHash(of: reloaded))
            }
        }

        // 门槛按实测噪声地板定，不写 1.0：
        // - roundTrip：JPEG 有损，同一张图存盘读回会有几个 bit 在「几乎相等」的
        //   邻对上翻转（实测 0.84–0.95）；
        // - bright：9×8 的平滑区域里，缩放亮度会让相邻像素量化成同值，
        //   也会翻几个 bit（实测 0.75–1.0）。
        // 两者都远高于判定阈值 0.45，所以「同一场景不同光线/重新压缩」不会被误判为不像。
        let ok = selfScore >= 0.99
            && brightScore >= 0.6
            && invertedScore <= 0.01
            && (roundTrip ?? 0) >= 0.8

        // 拆成几步拼日志：单行超长插值在这个 Swift 版本上会卡类型检查器
        let roundTripText: String = roundTrip.map { "\($0)" } ?? "nil"
        let selfText: String = "\(selfScore)"
        let brightText: String = "\(brightScore)"
        let invertedText: String = "\(invertedScore)"
        let okText: String = "\(ok)"
        print("[dhash-selfcheck] self=" + selfText
              + " bright=" + brightText
              + " inverted=" + invertedText
              + " roundTrip=" + roundTripText
              + " ok=" + okText)
        return ok
    }

    /// 整体变暗（模拟「同一场景、光线不同」）。
    /// 用**乘性**缩放而不是加法提亮：加法会在亮部截断成 255，
    /// 相邻像素从「左<右」变成「相等」，翻 bit 是测试方法本身的问题，不是 dHash 的问题。
    private static func brightened(_ image: UIImage, by amount: CGFloat) -> UIImage {
        guard let ciImage = CIImage(image: image) else { return image }
        let scale = max(0.05, 1 - amount * 10)
        guard let filter = CIFilter(name: "CIColorMatrix") else { return image }
        filter.setValue(ciImage, forKey: kCIInputImageKey)
        filter.setValue(CIVector(x: scale, y: 0, z: 0, w: 0), forKey: "inputRVector")
        filter.setValue(CIVector(x: 0, y: scale, z: 0, w: 0), forKey: "inputGVector")
        filter.setValue(CIVector(x: 0, y: 0, z: scale, w: 0), forKey: "inputBVector")
        guard let output = filter.outputImage else { return image }
        let context = CIContext()
        guard let cg = context.createCGImage(output, from: output.extent) else { return image }
        return UIImage(cgImage: cg)
    }

    /// 反色（模拟「完全不同的画面」）
    private static func inverted(_ image: UIImage) -> UIImage {
        guard let ciImage = CIImage(image: image),
              let filter = CIFilter(name: "CIColorInvert") else { return image }
        filter.setValue(ciImage, forKey: kCIInputImageKey)
        guard let output = filter.outputImage else { return image }
        let context = CIContext()
        guard let cg = context.createCGImage(output, from: output.extent) else { return image }
        return UIImage(cgImage: cg)
    }
    #endif

    // MARK: - 演示替身图
    //
    // 预置的种子惊喜（DemoData.demoSurprises）只有文件名、没有像素，
    // 但「并排对比」这个界面必须有左右两张图才能成立。这里按 id 生成一张
    // 确定性的纸面替身，UI 会明确标注「演示照片」，不冒充作者真图。

    /// 按 seed 生成一张确定的「像一张照片」的替身（同一 id 每次一致）
    static func demoStandInImage(seed: String) -> UIImage {
        var generator = WAPseudoRandom(seed: UInt64(truncatingIfNeeded: seed.hashValue) | 1)
        let warmth = 0.35 + Double(generator.nextDouble()) * 0.4
        return placeholderImage(
            size: CGSize(width: 600, height: 800),
            warmth: CGFloat(warmth),
            tilt: CGFloat(generator.nextDouble()) * 0.6
        )
    }

    /// 一张暖光纸面占位图（纯代码绘制，无外部资源）
    static func placeholderImage(size: CGSize = CGSize(width: 600, height: 800), warmth: CGFloat = 0.5, tilt: CGFloat = 0) -> UIImage {
        UIGraphicsImageRenderer(size: size).image { context in
            let cg = context.cgContext
            let rect = CGRect(origin: .zero, size: size)
            cg.setFillColor(UIColor(WATheme.paper2).cgColor)
            cg.fill(rect)

            // 斜着的一束暖光
            cg.saveGState()
            cg.translateBy(x: size.width * 0.5, y: size.height * 0.5)
            cg.rotate(by: tilt)
            let glowRect = CGRect(
                x: -size.width * (0.15 + warmth * 0.1),
                y: -size.height * 0.42,
                width: size.width * (0.55 + warmth * 0.25),
                height: size.height * 0.84
            )
            cg.setFillColor(UIColor(WATheme.amber).withAlphaComponent(0.18 + 0.22 * warmth).cgColor)
            cg.fill(glowRect)
            cg.restoreGState()

            // 一扇窗
            cg.setFillColor(UIColor(WATheme.amberDeep).withAlphaComponent(0.22).cgColor)
            cg.fill(CGRect(x: size.width * 0.14, y: size.height * 0.14, width: size.width * 0.34, height: size.height * 0.3))
            cg.stroke(CGRect(x: size.width * 0.14, y: size.height * 0.14, width: size.width * 0.34, height: size.height * 0.3), width: 3)

            // 柜台 / 地面
            cg.setFillColor(UIColor(WATheme.ink).withAlphaComponent(0.22).cgColor)
            cg.fill(CGRect(x: 0, y: size.height * 0.76, width: size.width, height: size.height * 0.24))

            // 一粒灯
            cg.setFillColor(UIColor(WATheme.cream).cgColor)
            cg.fillEllipse(in: CGRect(
                x: size.width * (0.58 + warmth * 0.08),
                y: size.height * 0.3,
                width: size.width * 0.16,
                height: size.width * 0.16
            ))

            // 纸纹：极淡横线，避免「纯色块」的塑料感
            cg.setStrokeColor(UIColor(WATheme.ink).withAlphaComponent(0.035).cgColor)
            cg.setLineWidth(1)
            var y: CGFloat = 4
            while y < size.height {
                cg.move(to: CGPoint(x: 0, y: y))
                cg.addLine(to: CGPoint(x: size.width, y: y))
                y += 7
            }
            cg.strokePath()
        }
    }

    // MARK: - 调试用占位图（只在 DEBUG 里存在，供截图自检 / 预览）

    #if DEBUG
    /// 与 debugPlaceholderImage 结构完全不同的一张图（横向条纹 vs 竖向窗），
    /// 只用于强制走「不达标」分支的设计走查。
    static func debugContrastImage(size: CGSize = CGSize(width: 900, height: 1200)) -> UIImage {
        UIGraphicsImageRenderer(size: size).image { context in
            let cg = context.cgContext
            cg.setFillColor(UIColor(WATheme.cream).cgColor)
            cg.fill(CGRect(origin: .zero, size: size))
            // 竖向黑白条纹：明暗变化方向与占位图（竖向大色块）完全相反
            var x: CGFloat = 0
            var dark = true
            while x < size.width {
                cg.setFillColor((dark ? UIColor(WATheme.ink) : UIColor(WATheme.teal)).withAlphaComponent(0.85).cgColor)
                cg.fill(CGRect(x: x, y: 0, width: size.width / 12, height: size.height))
                dark.toggle()
                x += size.width / 12
            }
        }
        .preparingForDisplay() ?? UIImage()
    }

    /// 一张「像照片」的演示图：暖光窗与灯，不用外部资源。
    /// 只用于 `WA_PREVIEW=bury-filled / seek-compare` 的截图自检，不进产品路径。
    static func debugPlaceholderImage(size: CGSize = CGSize(width: 900, height: 1200)) -> UIImage {
        UIGraphicsImageRenderer(size: size).image { context in
            let cg = context.cgContext
            let colors = [UIColor(WATheme.ink), UIColor(WATheme.amberDeep)].map { $0.cgColor } as CFArray
            if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) {
                cg.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: size.width, y: size.height), options: [])
            }
            // 暖光窗
            cg.setFillColor(UIColor(WATheme.amber).cgColor)
            cg.fill(CGRect(x: size.width * 0.18, y: size.height * 0.16, width: size.width * 0.4, height: size.height * 0.34))
            // 柜台
            cg.setFillColor(UIColor(WATheme.ink).withAlphaComponent(0.9).cgColor)
            cg.fill(CGRect(x: 0, y: size.height * 0.72, width: size.width, height: size.height * 0.28))
            // 灯
            cg.setFillColor(UIColor(WATheme.cream).cgColor)
            cg.fillEllipse(in: CGRect(x: size.width * 0.66, y: size.height * 0.3, width: size.width * 0.16, height: size.width * 0.16))
        }
        .preparingForDisplay() ?? UIImage()
    }
    #endif
}

/// 一次「拍同款」的判定结果
struct PhotoMatchOutcome {
    let score: Double
    /// true = 作者原图不在本机，分数是演示值（UI 必须标注）
    let isDemo: Bool
    let verdict: String

    var passed: Bool { score >= PhotoMatcher.passThreshold }
    var percentText: String { "\(Int((score * 100).rounded()))%" }
}

enum PhotoStoreError: LocalizedError {
    case encodeFailed

    var errorDescription: String? {
        switch self {
        case .encodeFailed: return "这张照片没能存下来。"
        }
    }
}

// MARK: - 相机（UIImagePickerController）
//
// 相册走 SwiftUI 的 `PhotosPicker`（外部进程，不需要相册权限、独立于系统相册 UI）；
// 相机走 UIKit（SwiftUI 没有系统相机控件）。模拟器没有相机时
// `isCameraAvailable == false`，调用方只显示「从相册选」。

struct CameraPhotoPicker: UIViewControllerRepresentable {

    var onPicked: (UIImage) -> Void
    var onCancel: () -> Void = {}

    static var isCameraAvailable: Bool { PhotoLibraryService.isCameraAvailable }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        // 真机用相机；万一某些设备只能相册，至少不会崩
        picker.sourceType = PhotoLibraryService.isCameraAvailable ? .camera : .photoLibrary
        picker.allowsEditing = false
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        private let parent: CameraPhotoPicker

        init(_ parent: CameraPhotoPicker) {
            self.parent = parent
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            let image = (info[.originalImage] as? UIImage) ?? (info[.editedImage] as? UIImage)
            if let image {
                parent.onPicked(image)
            } else {
                parent.onCancel()
            }
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.onCancel()
        }
    }
}

// MARK: - 拍照 / 选图 的一对按钮（埋、寻两个页面共用）

/// 「拍一张 / 从相册选」胶囊按钮组：相机不可用时只显示相册。
struct SurprisePhotoPickRow: View {

    @Binding var pickerItem: PhotosPickerItem?
    var cameraAvailable: Bool
    var onPickCamera: () -> Void
    var primaryTitle: String = "拍一张"
    var albumTitle: String = "从相册选"
    var height: CGFloat = 38

    var body: some View {
        // 相机不可用（模拟器 / 无相机）时，相册就是唯一入口，所以要顶替主按钮文案，
        // 否则「这样拍一张」这个关键引导会整条消失，用户不知道要做什么。
        let album = cameraAvailable ? albumTitle : primaryTitle

        return HStack(spacing: 10) {
            if cameraAvailable {
                Button(action: onPickCamera) {
                    chip(title: primaryTitle, systemName: "camera.fill", emphasized: true)
                }
                .buttonStyle(WAPressEffectStyle())
                .accessibilityLabel("用相机\(primaryTitle)")
            }

            PhotosPicker(selection: $pickerItem, matching: .images, photoLibrary: .shared()) {
                chip(title: album, systemName: "photo.on.rectangle", emphasized: !cameraAvailable)
            }
            .buttonStyle(WAPressEffectStyle())
            .accessibilityLabel("从相册选择照片")
        }
    }

    private func chip(title: String, systemName: String, emphasized: Bool) -> some View {
        HStack(spacing: 6) {
            Image(systemName: systemName)
                .font(.system(size: 12, weight: .semibold))
            Text(title)
                .font(.system(size: 12.5, weight: .semibold))
        }
        .foregroundStyle(emphasized ? WATheme.ink : WATheme.ink2)
        .padding(.horizontal, 15)
        .frame(height: height)
        .background(emphasized ? WATheme.amber : WATheme.paper)
        .clipShape(Capsule())
        .overlay(Capsule().stroke(emphasized ? Color.clear : WATheme.line, lineWidth: 1))
    }
}

// MARK: - 惊喜用的轻量单次定位
//
// 为什么单独写：`App/Services/LocationService.swift` 是 JourneyView 的持续定位服务
// （它按「到目的地的距离」工作，不适合「我此刻在哪儿」），也不在本次写作用域里。
// 这里只做一件事：进页面时取一次坐标 + 反查一个区域名，拿到就停，省电。
//
// 模拟器 / 未授权 / 超时 → 调用方用 `SurpriseLocation.demoPoint` 兜底，
// 并在界面上明确标注「演示位置」。

@MainActor
@Observable
final class SurpriseLocationProbe {

    /// 最近一次有效坐标（真实定位）
    private(set) var origin: GeoPoint?
    /// 水平精度（米）
    private(set) var horizontalAccuracy: Double?
    /// 反查出来的展示区域名，如「静安区 · 附近」
    private(set) var areaLabel: String?
    private(set) var authorization: LocationAuthorization = .notDetermined
    /// 正在等一次定位
    private(set) var isSearching = false
    /// 等不到定位（无权限 / 无信号 / 超时）→ 调用方降级演示
    private(set) var didGiveUp = false

    private let manager = CLLocationManager()
    private let proxy = LocationProbeDelegate()
    private var started = false
    private var didReverseGeocode = false
    private var timeoutTask: Task<Void, Never>?

    init() {
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = 10
        manager.delegate = proxy
        authorization = Self.map(manager.authorizationStatus)

        proxy.onLocation = { [weak self] location in
            Task { @MainActor in self?.receive(location) }
        }
        proxy.onAuthorization = { [weak self] status in
            Task { @MainActor in self?.receiveAuthorization(status) }
        }
        proxy.onFailure = { [weak self] error in
            Task { @MainActor in self?.receiveFailure(error) }
        }
    }

    // 不用 deinit 取消 timeoutTask：它持有的是 weak self，6 秒后自然结束；
    // 而 @MainActor 类的 deinit 是非隔离上下文，碰隔离属性会编译报错。

    /// 进页面时调用：
    /// - store 里已经有上次旅程的定位点 → 直接用它（还能顺便反查区域名），不再开 GPS
    /// - 没有 → 主动取一次定位；授权被拒 / 6 秒无点 → 走演示兜底
    func startIfNeeded(storeOrigin: GeoPoint?) {
        guard !started else { return }
        started = true
        authorization = Self.map(manager.authorizationStatus)

        if let storeOrigin {
            origin = storeOrigin
            Task { @MainActor in await self.reverseGeocode(storeOrigin) }
            return
        }

        isSearching = true
        didGiveUp = false

        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
            scheduleTimeout()
        case .authorizedAlways, .authorizedWhenInUse:
            manager.requestLocation()
            scheduleTimeout()
        case .denied, .restricted:
            isSearching = false
            didGiveUp = true
        @unknown default:
            isSearching = false
            didGiveUp = true
        }
    }

    func stop() {
        timeoutTask?.cancel()
        manager.stopUpdatingLocation()
        isSearching = false
    }

    // MARK: 内部

    private func receive(_ location: CLLocation) {
        guard location.horizontalAccuracy >= 0 else { return }
        // 拒绝明显过期的缓存点（模拟器重建时可能给旧点）
        guard abs(location.timestamp.timeIntervalSinceNow) < 60 else { return }

        let point = GeoPoint(
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude
        )
        origin = point
        horizontalAccuracy = location.horizontalAccuracy
        isSearching = false
        didGiveUp = false
        timeoutTask?.cancel()
        manager.stopUpdatingLocation()

        if !didReverseGeocode {
            Task { @MainActor in await self.reverseGeocode(point) }
        }
    }

    private func receiveAuthorization(_ status: CLAuthorizationStatus) {
        authorization = Self.map(status)
        switch status {
        case .authorizedAlways, .authorizedWhenInUse:
            if isSearching { manager.requestLocation() }
        case .denied, .restricted:
            isSearching = false
            didGiveUp = true
        default:
            break
        }
    }

    private func receiveFailure(_ error: Error) {
        // 已拒绝由 receiveAuthorization 处理；其余（信号弱）等超时兜底，别在第 1 次失败就降级
        guard authorization.isAllowed else {
            isSearching = false
            didGiveUp = true
            return
        }
    }

    private func scheduleTimeout() {
        timeoutTask?.cancel()
        timeoutTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            guard let self, !Task.isCancelled else { return }
            guard self.origin == nil else { return }
            self.isSearching = false
            self.didGiveUp = true
        }
    }

    private func reverseGeocode(_ point: GeoPoint) async {
        guard !didReverseGeocode else { return }
        didReverseGeocode = true
        let geocoder = CLGeocoder()
        let location = CLLocation(latitude: point.latitude, longitude: point.longitude)
        do {
            let placemarks = try await geocoder.reverseGeocodeLocation(location)
            if let label = Self.label(from: placemarks.first) {
                areaLabel = label
            }
        } catch {
            // 反查失败（离线 / 国内地图数据不全）→ 保留 nil，调用方用「附近」兜底
        }
    }

    private static func label(from placemark: CLPlacemark?) -> String? {
        guard let placemark else { return nil }
        // 只要一个层级的地名，后面不再加「· 附近」：
        // 界面自己会在需要的地方补（埋下页是「黄浦区」，完成页是「黄浦区 · 等一个人来找到」）。
        for candidate in [placemark.subLocality, placemark.locality, placemark.administrativeArea, placemark.country] {
            if let candidate, !candidate.isEmpty {
                return candidate
            }
        }
        return nil
    }

    private static func map(_ status: CLAuthorizationStatus) -> LocationAuthorization {
        switch status {
        case .authorizedAlways, .authorizedWhenInUse: return .authorized
        case .denied: return .denied
        case .restricted: return .restricted
        case .notDetermined: return .notDetermined
        @unknown default: return .notDetermined
        }
    }
}

/// CLLocationManager 的代理被 weak 持有，这里单独强引用一个转发对象，
/// 把 CoreLocation 回调（可能在主线程也可能不在）统一丢回主线程。
private final class LocationProbeDelegate: NSObject, CLLocationManagerDelegate {

    var onLocation: ((CLLocation) -> Void)?
    var onAuthorization: ((CLAuthorizationStatus) -> Void)?
    var onFailure: ((Error) -> Void)?

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let latest = locations.last else { return }
        onLocation?(latest)
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        onAuthorization?(manager.authorizationStatus)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        onFailure?(error)
    }
}

// MARK: - 演示位置

/// 模拟器没有定位 / 用户拒绝定位时，用固定演示坐标走通全流程。
/// 界面上必须一直带「演示位置」字样 —— 不能让用户以为自己真的站在这个坐标上。
enum SurpriseLocation {

    static let demoPoint = GeoPoint(latitude: 31.2304, longitude: 121.4737)
    static let demoAreaLabel = "静安 · 演示位置"

    static func coordinateText(_ point: GeoPoint) -> String {
        String(format: "%.5f, %.5f", point.latitude, point.longitude)
    }

    /// 展示用区域名：真实反查结果优先；反查不到给「附近」；演示给固定标签。
    static func areaLabel(probeLabel: String?, isDemo: Bool) -> String {
        if isDemo { return demoAreaLabel }
        if let probeLabel, !probeLabel.isEmpty { return probeLabel }
        return "附近"
    }
}
