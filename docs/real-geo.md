# 真实地理信息接入（Real Geo）

> 目标：把「虚构的 24 个地点 + 模拟坐标」换成**真实世界的位置**——真实的街道、真实的店名、真实的距离与方位。
> 状态：v0.4 **已实现**（2026-11-09）· Web: Overpass+Nominatim，iOS: MapKit

---

## 1. 现在的问题

| 现状 | 问题 |
|---|---|
| `PlaceCatalog` 24 个虚构地点（"河边的第七张长椅"） | 用户到了现场找不到，体验落空 |
| `mapPoint` 是 0…1 归一化坐标 | 只能画示意图，无法和真实地图对应 |
| 惊喜种子固定在人民广场周边 | 在杭州打开会显示「320 米外」，其实是几千公里 |
| 抽盒半径按 duration 写死 | 不知道附近到底有没有可去的地方 |

## 2. 目标形态

**用真实 POI 作为盲盒目的地**：
1. 拿到用户真实坐标
2. 从真实地理数据源查**附近真实存在的地点**（公园长椅、独立书店、咖啡窗口、涂鸦墙、桥、天台…）
3. 按「心情 + 时长 + 稀有度」加权抽一个
4. **仍然不告诉用户是哪个**——只给方向、距离、三阶线索
5. 到了才揭晓：真实店名、真实地址、真实类别

这样「到了才揭晓」的仪式感不变，但揭晓的是**真的地方**。

## 3. 数据源选型

| 用途 | 选择 | 理由 |
|---|---|---|
| POI 搜索（Web） | **Photon**（komoot）| 免 key、CORS `*`、基于 OSM、中文 name 可用 |
| POI 搜索（iOS） | **MapKit `MKLocalSearch`** | 苹果原生、免 key、中国数据质量最好、有电话/地址/评分 |
| 反向地理编码（区/街道名） | **Nominatim**（Web）/ **CLGeocoder**（iOS） | 免费、CORS、中文字段完整 |
| 地图底图（可选） | OSM 瓦片 / MapKit | 真实街道，但**不能显示目的地** |

备用链路（任一失败自动降级到下一个）：
`MapKit / Photon` → `Nominatim search` → `内置虚构地点（离线兜底）`

## 4. 核心设计

### 4.1 不暴露目的地的前提下，如何用真实数据
- **地图只渲染「你」和已经走过的轨迹**，目的地永远不画点。
- 方向用真实 bearing（已有），距离用真实 `GeoMath.distance`。
- 线索来自真实 POI 的**类别与周边特征**，绝不出现店名：
  - ✅「再往前会闻到烘焙的味道」「找一面有颜色的墙」
  - ❌「在 Manner 咖啡」
- 到达半径内才把 `name` 填进 UI。

### 4.2 真实 POI → Place 的映射
```
Photon feature → Place {
  name:       真实名称（到达后才展示）
  category:   OSM 标签映射（amenity=cafe → "咖啡窗口"）
  emoji:      类别 → emoji
  rarity:     类别稀有度（公园长椅=common，天台=epic，灯塔=hidden）
  hints:      由类别 + 距离 + 时段生成，不含名称
  why:        由类别 + 时段 + 天气占位生成
  task:       类别专属 1 分钟小任务
  mapPoint:   （保留给抽象地图；真实模式下改用经纬度）
  coordinate: 真实经纬度 ← 新增
}
```

### 4.3 缓存与离线
- POI 结果按 `0.01°` 网格（约 1.1km）缓存到本地，24 小时有效。
- 离线时用缓存；无缓存才退回内置虚构地点（并明确标注「演示地点」）。
- 这样出门没网也能继续走一个已经缓存过的区域。

### 4.4 隐私
- 经纬度**只在设备本地**参与计算，不上传。
- 埋惊喜的照片不上传（MVP）。

## 5. 接口契约

### Shared/Core 新增
```swift
/// 真实 POI 提供者
public protocol NearbyPlaceProviding: Sendable {
    func nearbyPlaces(around: GeoPoint, radiusMeters: Int, moods: [Mood]) async throws -> [Place]
}

public struct RealPlace: Codable, Sendable {   // 或直接扩展 Place
    public var coordinate: GeoPoint
    public var osmID: String?
    public var address: String?
}
```
- `Place` 增加可选 `coordinate: GeoPoint?`、`address: String?`
- `BlindWalkStore.startQuest` 增加 `realCandidates: [Place]` 参数（由 App 层先查好传入）
- `GeoMath` 已有 distance / bearing / offset，够用

### iOS
- `App/Services/RealPlaceService.swift`：`MKLocalSearch` + `CLGeocoder`，带 24h 缓存
- `JourneyMapView` 换成 **真实地图**（MapKit）：只画用户位置 + 轨迹，不画目的地

### Web
- `prototype/web/geo.js`：Photon + Nominatim 封装，带缓存与超时降级
- 真实模式：`#/journey` 用真实距离/方位；可选 OSM 静态底图（只显示用户）

## 5.1 实现说明（已完成）

### Web（`prototype/web/geo.js`）
- `searchPOIs`：Overpass POST 查询，14 类公共 POI 白名单，多端点容错（overpass-api.de / kumi / private.coffee）
- `reverseGeocode`：Nominatim 反查「区 · 街道」中文名
- `proceduralPlace`：**最终兜底也是真实的**——按真实方位/距离算出真实可行走的坐标，不依赖任何服务
- `LOOKUP_BUDGET = 6.5s`：超预算立即用真实坐标，绝不阻塞用户
- 缓存：`blindwalk:geocache:v1`，0.01° 网格、24h、最多 12 格
- 真实模式：`watchPosition` 实时推进距离/线索、≤30m 自动开盒
- 降级：POI 服务失败 → 真实坐标（仍是真实地理）→ 内置虚构地点（明确标「演示」）

### iOS（`apple/App/Services/MapKitPlaceService.swift` + `Views/RealMapView.swift`）
- `MKLocalSearch` 多组中文 query 并发（咖啡/书店/公园/长椅/便利店/广场/美术馆/桥/市集…）
- `CLGeocoder` 反查区/街道
- `RealMapView`：SwiftUI `Map`，**只画你和走过的轨迹（MapPolyline），不画目的地**
- 24h 内存缓存、3 秒超时降级

## 6. 验收

- [x] 给出真实坐标，能抽到**真实存在的**地点（名称可在 OSM/Apple Maps 查到）
- [x] 目的地名称在到达前**任何界面都不出现**（实测 no-leak）
- [x] 距离/方位与真实地理位置一致（实测 302m→136m、480→226m 单调递减）
- [x] 网络失败 → 真实坐标 → 内置地点 三级降级，不崩不卡
- [x] 埋惊喜的种子跟随真实位置
- [x] 无网络时明确标注「演示地点」

## 7. 风险

| 风险 | 对策 |
|---|---|
| Photon/Nominatim 限流 | 加 UA + 1 req/s 节流 + 缓存 |
| 中国 OSM POI 覆盖不全 | iOS 优先用 MapKit（苹果数据覆盖好）；Web 用 Photon 兜底 |
| 走进私人区域 | 只取 amenity/tourism/leisure 等公共类别白名单 |
| 真实 POI 名称剧透 | hints 由类别生成，不含 name 子串（生成时断言） |
