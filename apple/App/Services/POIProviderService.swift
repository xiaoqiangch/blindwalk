import Foundation
import CoreLocation

// MARK: - 真实 POI 多数据源（docs/parity.md §1）
//
// 高德 + 百度（Key 由后台下发）+ OSM Overpass + 中文维基 geosearch。
// 全部统一成 WGS-84 的 POICandidate；30m 去重、按距离排序、类别多样性截断。
// 任何单源失败/超时都不影响其它源；最终仍为空由调用方显示失败面板。

struct ProviderFetchResult {
    let candidates: [POICandidate]
    let reports: [POISourceReport]
}

private enum ProviderError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self {
        case .message(let text): return text
        }
    }
}

final class POIProviderService: @unchecked Sendable {

    static let shared = POIProviderService()

    private let session: URLSession
    private let decoder = JSONDecoder()

    private init() {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 8
        config.timeoutIntervalForResource = 10
        config.httpShouldSetCookies = false
        session = URLSession(configuration: config)
    }

    /// 一次多源并发查询；4.5 秒后不再等慢源（与 Web 的 deadlineMs 对齐）
    func fetchNearby(
        origin: GeoPoint,
        startMeters: Int,
        relax: Int,
        mood: Mood,
        deadline: TimeInterval = 4.5,
        scope: ExploreScope = .walk
    ) async -> ProviderFetchResult {
        let keys = await MapKeysService.shared.load()
        let radius = scope == .roam
            ? POISelection.roamSearchRadius(relax: relax)
            : POISelection.searchRadius(startMeters: startMeters, relax: relax)
        let limit = relax >= 1 ? 60 : 40

        var reports: [POISourceReport] = []
        var tasks: [(String, @Sendable () async throws -> [POICandidate])] = []

        if keys.amap.isEmpty {
            reports.append(POISourceReport(id: "amap", label: "高德地图", ok: false, count: 0, error: "未配置 Key"))
        } else {
            let key = keys.amap
            tasks.append(("amap", { [weak self] in
                guard let self else { return [] }
                return try await self.fetchAmap(origin: origin, radius: radius, limit: limit, key: key)
            }))
        }

        if keys.baidu.isEmpty {
            reports.append(POISourceReport(id: "baidu", label: "百度地图", ok: false, count: 0, error: "未配置 Key"))
        } else {
            let key = keys.baidu
            tasks.append(("baidu", { [weak self] in
                guard let self else { return [] }
                return try await self.fetchBaidu(origin: origin, radius: radius, limit: limit, key: key)
            }))
        }

        tasks.append(("osm", { [weak self] in
            guard let self else { return [] }
            return try await self.fetchOSM(origin: origin, radius: radius)
        }))
        tasks.append(("wiki", { [weak self] in
            guard let self else { return [] }
            return try await self.fetchWiki(origin: origin, radius: radius, limit: limit)
        }))

        let results = await withTaskGroup(of: (String, Result<[POICandidate], Error>).self) { group in
            for (id, operation) in tasks {
                group.addTask {
                    do {
                        let list = try await withTimeout(deadline) { try await operation() }
                        return (id, .success(list))
                    } catch {
                        return (id, .failure(error))
                    }
                }
            }
            var output: [(String, Result<[POICandidate], Error>)] = []
            for await item in group { output.append(item) }
            return output
        }

        var merged: [POICandidate] = []
        for (id, result) in results {
            let label = Self.label(for: id)
            switch result {
            case .success(let list):
                reports.append(POISourceReport(id: id, label: label, ok: true, count: list.count, error: ""))
                merged.append(contentsOf: list)
            case .failure(let error):
                let text = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                reports.append(POISourceReport(id: id, label: label, ok: false, count: 0, error: text))
            }
        }

        let deduped = POISelection.dedupe(merged, thresholdMeters: 30)
        let sorted = deduped.sorted {
            GeoMath.distance(from: origin, to: $0.coordinate) < GeoMath.distance(from: origin, to: $1.coordinate)
        }
        let limited = POISelection.trimDiverse(sorted, origin: origin, limit: limit)
        reports.sort { Self.sourceOrder($0.id) < Self.sourceOrder($1.id) }
        return ProviderFetchResult(candidates: limited, reports: reports)
    }

    // MARK: - 远程漫游（10–45 公里环带）

    /// 远程漫游的取点方式与「附近搜索」不同，原因很实际：
    ///
    /// 高德 / 百度的 around 接口**按距离升序返回**，在 50 公里半径下第一页永远是最里面的
    /// 几百米 —— 想拿到 10–45 公里的点得翻 30 页，不现实。
    ///
    /// 所以改成「在环带上撒几个点，每个点做一次 3 公里的小范围搜索」：
    /// 命中率够高、只要 4–6 次请求，而且天然覆盖各个方向。
    func fetchRoamNearby(
        origin: GeoPoint,
        relax: Int,
        mood: Mood,
        deadline: TimeInterval = 9,
        seed: UInt64 = UInt64(Date().timeIntervalSince1970)
    ) async -> ProviderFetchResult {
        let keys = await MapKeysService.shared.load()
        var reports: [POISourceReport] = []

        // 没有地图 Key 也能漫游：维基 geosearch 是公开接口（带实景照片），
        // 只是地标密度不如高德/百度。缺 Key 的源在失败面板里如实标注。
        if keys.amap.isEmpty {
            reports.append(POISourceReport(id: "amap", label: "高德地图", ok: false, count: 0, error: "未配置 Key"))
        }
        if keys.baidu.isEmpty {
            reports.append(POISourceReport(id: "baidu", label: "百度地图", ok: false, count: 0, error: "未配置 Key"))
        }

        // 环带采样：4 个方向，落点让「采样圆」正好盖住整个环带
        // （圆心离下限 2 公里 → 覆盖 8 公里起；离上限 1.2 公里 → 45 公里也在圆内）
        let band = POISelection.roamRange(relax: relax)
        let low = max(band.lowerBound + 2_000, 12_000)
        let high = max(low + 1_000, min(band.upperBound - 1_200, 43_000))
        var generator = SeededGenerator(seed: seed &+ 0x5EED)
        var centers: [GeoPoint] = []
        for index in 0..<4 {
            // 四个方向各撒一个点，再用 ±30° 抖动打破「正东南西北」的机械感
            let bearing = Double(index) * 90 + Double(Int.random(in: -30...30, using: &generator))
            let meters = low + (high - low) * Double(Int.random(in: 15...85, using: &generator)) / 100
            centers.append(GeoMath.offset(
                from: origin,
                meters: meters,
                bearingDegrees: (bearing + 360).truncatingRemainder(dividingBy: 360)
            ))
        }

        var merged: [POICandidate] = []
        var amapTotal = 0
        var baiduTotal = 0
        var wikiTotal = 0
        var lastError = ""

        for center in centers {
            if !keys.amap.isEmpty {
                do {
                    let list = try await withTimeout(deadline) {
                        try await self.fetchAmap(
                            origin: center, radius: 3_200, limit: 20, key: keys.amap, lightweight: true
                        )
                    }
                    amapTotal += list.count
                    merged.append(contentsOf: list)
                } catch {
                    lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                }
            }
            if !keys.baidu.isEmpty {
                do {
                    let list = try await withTimeout(deadline) {
                        try await self.fetchBaidu(origin: center, radius: 3_200, limit: 20, key: keys.baidu)
                    }
                    baiduTotal += list.count
                    merged.append(contentsOf: list)
                } catch {
                    lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                }
            }
            // 维基 geosearch 单次上限 10 公里 —— 但采样点本身就在 10 公里外，
            // 以小半径绕采样点查，等效于查到了远程的地标（还带实景照片）。
            do {
                let list = try await withTimeout(deadline) {
                    try await self.fetchWiki(origin: center, radius: 3_200, limit: 12)
                }
                wikiTotal += list.count
                merged.append(contentsOf: list)
            } catch {
                if lastError.isEmpty {
                    lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                }
            }
        }

        if !keys.amap.isEmpty {
            reports.append(POISourceReport(id: "amap", label: "高德地图", ok: amapTotal > 0, count: amapTotal,
                                           error: amapTotal > 0 ? "" : (lastError.isEmpty ? "环带内没搜到地点" : lastError)))
        }
        if !keys.baidu.isEmpty {
            reports.append(POISourceReport(id: "baidu", label: "百度地图", ok: baiduTotal > 0, count: baiduTotal, error: ""))
        }
        reports.append(POISourceReport(id: "osm", label: "OpenStreetMap", ok: false, count: 0, error: "远程漫游不支持（半径过大）"))
        reports.append(POISourceReport(
            id: "wiki", label: "中文维基百科", ok: wikiTotal > 0, count: wikiTotal,
            error: wikiTotal > 0 ? "" : "环带内没查到地标词条"
        ))

        let deduped = POISelection.dedupe(merged, thresholdMeters: 120)
        // 只留真正落在漫游环带里的（采样点 3 公里范围可能有一部分掉到环带外）
        let inBand = deduped.filter { band.contains(GeoMath.distance(from: origin, to: $0.coordinate)) }
        let sorted = inBand.sorted {
            GeoMath.distance(from: origin, to: $0.coordinate) < GeoMath.distance(from: origin, to: $1.coordinate)
        }
        reports.sort { Self.sourceOrder($0.id) < Self.sourceOrder($1.id) }
        return ProviderFetchResult(candidates: Array(sorted.prefix(40)), reports: reports)
    }

    // MARK: - 高德

    private func fetchAmap(
        origin: GeoPoint,
        radius: Int,
        limit: Int,
        key: String,
        lightweight: Bool = false
    ) async throws -> [POICandidate] {
        let gcj = ChinaCoordinate.wgs84ToGcj02(origin)
        var collected: [POICandidate] = []

        // 地标关键字：高德不接受 "公园|博物馆|…" 整串（会返回 status=1 但 count=0 的静默空结果），
        // 必须逐词查；为控制 QPS，只查前 3 个（远程漫游再收到 1 个），每次间隔 120ms。
        let keywordLimit = lightweight ? 1 : 3
        let keywordList = POISelection.landmarkKeywords
            .split(separator: "|")
            .map { String($0).trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .prefix(keywordLimit)
        for (index, kw) in keywordList.enumerated() {
            if index > 0 { try? await Task.sleep(nanoseconds: 120_000_000) }
            if let list = try? await amapPage(
                gcj: gcj, radius: radius, key: key, page: 1, keywords: kw
            ) {
                collected.append(contentsOf: list)
            }
        }

        // 有关键字时只翻 2 页，减少总调用数（QPS 限制）；远程漫游只取第 1 页
        let pages = lightweight ? 1 : min(keywordList.isEmpty ? 3 : 2, max(1, Int(ceil(Double(limit) / 25.0))))
        for page in 1...pages {
            do {
                let list = try await amapPage(gcj: gcj, radius: radius, key: key, page: page, keywords: nil)
                collected.append(contentsOf: list)
                if list.count < 25 { break }
            } catch {
                if page == 1, collected.isEmpty { throw error }
                break
            }
        }

        guard !collected.isEmpty else { throw ProviderError.message("高德没有返回结果") }
        return collected
    }

    private func amapPage(
        gcj: GeoPoint,
        radius: Int,
        key: String,
        page: Int,
        keywords: String?
    ) async throws -> [POICandidate] {
        var components = URLComponents(string: "https://restapi.amap.com/v3/place/around")!
        var items = [
            URLQueryItem(name: "key", value: key),
            URLQueryItem(name: "location", value: String(format: "%.6f,%.6f", gcj.longitude, gcj.latitude)),
            URLQueryItem(name: "radius", value: "\(radius)"),
            URLQueryItem(name: "offset", value: "25"),
            URLQueryItem(name: "page", value: "\(page)"),
            URLQueryItem(name: "extensions", value: "all")
        ]
        if let keywords, !keywords.isEmpty {
            items.append(URLQueryItem(name: "keywords", value: keywords))
        }
        components.queryItems = items
        guard let url = components.url else { throw ProviderError.message("高德 URL 无效") }

        let data = try await requestData(url: url, timeout: 8)
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ProviderError.message("高德响应无法解析")
        }
        let status = String(describing: root["status"] ?? "")
        guard status == "1" else {
            let info = root["info"] as? String ?? "unknown"
            throw ProviderError.message("高德返回错误：status=\(status) info=\(info)")
        }
        guard let pois = root["pois"] as? [[String: Any]] else { return [] }

        return pois.compactMap { poi -> POICandidate? in
            guard let name = (poi["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !name.isEmpty,
                  let location = poi["location"] as? String else { return nil }
            let parts = location.split(separator: ",")
            guard parts.count >= 2,
                  let gcjLon = Double(parts[0]),
                  let gcjLat = Double(parts[1]) else { return nil }
            let wgs = ChinaCoordinate.gcj02ToWgs84(GeoPoint(latitude: gcjLat, longitude: gcjLon))

            let typeText = poi["type"] as? String
            var address = (poi["address"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            if address?.isEmpty == true { address = nil }
            if address == nil {
                let city = poi["cityname"] as? String
                let district = poi["adname"] as? String
                let joined = [city, district].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
                if !joined.isEmpty { address = joined }
            }
            var photo: String?
            if let photos = poi["photos"] as? [[String: Any]], let first = photos.first {
                photo = first["url"] as? String
            }
            let typeLast = typeText?.split(separator: ";").last.map(String.init) ?? typeText
            let category = POISelection.mapCategory(raw: typeLast, name: name)
            let id = (poi["id"] as? String) ?? String(format: "%.6f_%.6f", gcjLat, gcjLon)
            return POICandidate(
                id: "amap-\(id)",
                name: name,
                coordinate: wgs,
                address: address,
                category: category,
                source: "amap",
                photoUrl: photo,
                photoCredit: photo == nil ? nil : "高德地图"
            )
        }
    }

    // MARK: - 百度

    private func fetchBaidu(origin: GeoPoint, radius: Int, limit: Int, key: String) async throws -> [POICandidate] {
        let bd = ChinaCoordinate.wgs84ToBd09(origin)
        var components = URLComponents(string: "https://api.map.baidu.com/place/v2/search")!
        components.queryItems = [
            URLQueryItem(name: "query", value: "生活服务"),
            URLQueryItem(name: "location", value: String(format: "%.6f,%.6f", bd.latitude, bd.longitude)),
            URLQueryItem(name: "radius", value: "\(radius)"),
            URLQueryItem(name: "output", value: "json"),
            URLQueryItem(name: "ak", value: key),
            URLQueryItem(name: "scope", value: "2"),
            URLQueryItem(name: "page_size", value: "\(min(20, max(1, limit)))"),
            URLQueryItem(name: "page_num", value: "1")
        ]
        guard let url = components.url else { throw ProviderError.message("百度 URL 无效") }
        let data = try await requestData(url: url, timeout: 8)
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ProviderError.message("百度响应无法解析")
        }
        let status = String(describing: root["status"] ?? "")
        guard status == "0" else {
            let message = root["message"] as? String ?? "unknown"
            throw ProviderError.message("百度返回错误：status=\(status) message=\(message)")
        }
        guard let results = root["results"] as? [[String: Any]] else { return [] }

        return results.compactMap { result -> POICandidate? in
            guard let name = (result["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !name.isEmpty,
                  let location = result["location"] as? [String: Any],
                  let lat = location["lat"] as? Double,
                  let lng = location["lng"] as? Double else { return nil }
            let wgs = ChinaCoordinate.bd09ToWgs84(GeoPoint(latitude: lat, longitude: lng))
            var address = (result["address"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            if address?.isEmpty == true { address = nil }
            let detail = result["detail_info"] as? [String: Any]
            let tag = detail?["tag"] as? String
            let photo = (detail?["image_url"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let category = POISelection.mapCategory(raw: tag, name: name)
            let id = (result["uid"] as? String) ?? String(format: "%.6f_%.6f", lat, lng)
            return POICandidate(
                id: "baidu-\(id)",
                name: name,
                coordinate: wgs,
                address: address,
                category: category,
                source: "baidu",
                photoUrl: photo?.isEmpty == true ? nil : photo,
                photoCredit: photo?.isEmpty == true ? nil : "百度地图"
            )
        }
    }

    // MARK: - OSM Overpass（3 镜像，单端点 4.5s / 整体 8s）

    private struct OSMRule {
        let key: String
        let value: String
        let category: RealPlaceCategory
    }

    private static let osmRules: [OSMRule] = [
        OSMRule(key: "amenity", value: "cafe", category: .cafe),
        OSMRule(key: "amenity", value: "library", category: .library),
        OSMRule(key: "shop", value: "books", category: .bookstore),
        OSMRule(key: "amenity", value: "bench", category: .bench),
        OSMRule(key: "leisure", value: "park", category: .park),
        OSMRule(key: "leisure", value: "garden", category: .garden),
        OSMRule(key: "tourism", value: "viewpoint", category: .viewpoint),
        OSMRule(key: "tourism", value: "artwork", category: .art),
        OSMRule(key: "amenity", value: "arts_centre", category: .art),
        OSMRule(key: "man_made", value: "bridge", category: .bridge),
        OSMRule(key: "amenity", value: "marketplace", category: .market),
        OSMRule(key: "leisure", value: "common", category: .plaza),
        OSMRule(key: "place", value: "square", category: .plaza),
        OSMRule(key: "shop", value: "convenience", category: .convenience),
        OSMRule(key: "historic", value: "yes", category: .historic),
        OSMRule(key: "amenity", value: "place_of_worship", category: .temple),
        OSMRule(key: "tourism", value: "museum", category: .museum),
        OSMRule(key: "amenity", value: "theatre", category: .venue)
    ]

    private func fetchOSM(origin: GeoPoint, radius: Int) async throws -> [POICandidate] {
        let endpoints = [
            "https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.private.coffee/api/interpreter"
        ]
        let clauses = Self.osmRules.map { rule in
            "node[\"\(rule.key)\"=\"\(rule.value)\"](around:\(radius),\(origin.latitude),\(origin.longitude));"
        }.joined()
        let query = "[out:json][timeout:15];(\(clauses));out body 120;"
        var lastError: Error = ProviderError.message("Overpass 所有端点都失败")

        for endpoint in endpoints {
            do {
                let list = try await withTimeout(4.5) { [session] in
                    try await self.requestOSM(endpoint: endpoint, query: query, session: session)
                }
                if !list.isEmpty { return list }
            } catch {
                lastError = error
            }
        }
        throw lastError
    }

    private func requestOSM(endpoint: String, query: String, session: URLSession) async throws -> [POICandidate] {
        guard let url = URL(string: endpoint) else { throw ProviderError.message("Overpass URL 无效") }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(("data=" + query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed).orEmpty).utf8)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ProviderError.message("Overpass HTTP 请求失败")
        }
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let elements = root["elements"] as? [[String: Any]] else { return [] }

        var out: [POICandidate] = []
        var seen = Set<String>()
        for element in elements {
            guard let tags = element["tags"] as? [String: Any],
                  let name = tags["name"] as? String,
                  let lat = element["lat"] as? Double,
                  let lon = element["lon"] as? Double else { continue }
            guard let rule = Self.osmRules.first(where: { tags[$0.key] as? String == $0.value }) else { continue }
            let elementType = element["type"] as? String ?? "node"
            let elementID = element["id"] as? Int ?? Int(lat * 1e6)
            let candidateID = "osm-\(elementType)-\(elementID)"
            guard !seen.contains(candidateID) else { continue }
            seen.insert(candidateID)

            var addressParts: [String] = []
            for key in ["addr:street", "addr:district", "addr:suburb"] {
                if let value = tags[key] as? String, !value.isEmpty { addressParts.append(value) }
            }
            out.append(POICandidate(
                id: candidateID,
                name: name,
                coordinate: GeoPoint(latitude: lat, longitude: lon),
                address: addressParts.isEmpty ? nil : addressParts.joined(separator: " · "),
                category: rule.category,
                source: "osm"
            ))
        }
        return out
    }

    // MARK: - 中文维基 geosearch

    private func fetchWiki(origin: GeoPoint, radius: Int, limit: Int) async throws -> [POICandidate] {
        var components = URLComponents(string: "https://zh.wikipedia.org/w/api.php")!
        components.queryItems = [
            URLQueryItem(name: "action", value: "query"),
            URLQueryItem(name: "format", value: "json"),
            URLQueryItem(name: "origin", value: "*"),
            URLQueryItem(name: "generator", value: "geosearch"),
            URLQueryItem(name: "ggscoord", value: "\(origin.latitude)|\(origin.longitude)"),
            URLQueryItem(name: "ggsradius", value: "\(min(10_000, max(100, radius)))"),
            URLQueryItem(name: "ggslimit", value: "\(min(20, max(1, limit)))"),
            URLQueryItem(name: "prop", value: "pageimages|coordinates|extracts"),
            URLQueryItem(name: "piprop", value: "thumbnail"),
            URLQueryItem(name: "pithumbsize", value: "800"),
            URLQueryItem(name: "exintro", value: "1"),
            URLQueryItem(name: "explaintext", value: "1"),
            URLQueryItem(name: "exchars", value: "120")
        ]
        guard let url = components.url else { throw ProviderError.message("维基 URL 无效") }
        let data = try await requestData(url: url, timeout: 8)
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let query = root["query"] as? [String: Any],
              let pages = query["pages"] as? [String: Any] else { return [] }

        var out: [POICandidate] = []
        for (_, value) in pages {
            guard let page = value as? [String: Any],
                  let title = page["title"] as? String,
                  let coordinate = (page["coordinates"] as? [[String: Any]])?.first,
                  let lat = coordinate["lat"] as? Double,
                  let lon = coordinate["lon"] as? Double,
                  let thumbnail = page["thumbnail"] as? [String: Any],
                  let photo = thumbnail["source"] as? String else { continue }
            guard photo.contains("thumb.wikimedia.org") || photo.contains("upload.wikimedia.org") else { continue }
            if title.range(of: "[省市县区镇]$", options: .regularExpression) != nil { continue }
            if ["中国", "上海", "北京", "广州", "深圳", "杭州", "成都", "南京", "武汉", "西安", "重庆", "天津", "苏州"].contains(title) { continue }
            if title.range(of: "站$|站 \\(|号线|铁路|高速公路|立交|隧道|大桥工程", options: .regularExpression) != nil { continue }
            let displayName = title.replacingOccurrences(of: "\\s*[（(][^）)]*[）)]\\s*$", with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if displayName.isEmpty { continue }
            let extract = page["extract"] as? String ?? ""
            out.append(POICandidate(
                id: "wiki-\(page["pageid"] as? Int ?? abs(title.hashValue))",
                name: displayName,
                coordinate: GeoPoint(latitude: lat, longitude: lon),
                address: nil,
                category: POISelection.mapCategory(raw: extract, name: displayName),
                source: "wiki",
                photoUrl: photo,
                photoCredit: "Wikimedia Commons",
                summary: extract
            ))
        }
        return out
    }

    // MARK: - 网络

    private func requestData(url: URL, timeout: TimeInterval) async throws -> Data {
        try await withTimeout(timeout) { [session] in
            var request = URLRequest(url: url)
            request.timeoutInterval = timeout
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw ProviderError.message("HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0)")
            }
            return data
        }
    }

    private static func label(for id: String) -> String {
        switch id {
        case "amap": return "高德地图"
        case "baidu": return "百度地图"
        case "osm": return "OpenStreetMap"
        case "wiki": return "中文维基百科"
        default: return id
        }
    }

    private static func sourceOrder(_ id: String) -> Int {
        switch id {
        case "amap": return 0
        case "baidu": return 1
        case "osm": return 2
        case "wiki": return 3
        default: return 9
        }
    }
}

// MARK: - 小工具

private extension Optional where Wrapped == String {
    var orEmpty: String { self ?? "" }
}

private func withTimeout<T>(
    _ seconds: TimeInterval,
    _ operation: @escaping @Sendable () async throws -> T
) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await operation() }
        group.addTask {
            try await Task.sleep(nanoseconds: UInt64(max(0.05, seconds) * 1_000_000_000))
            throw ProviderError.message("请求超时")
        }
        let value = try await group.next()!
        group.cancelAll()
        return value
    }
}
