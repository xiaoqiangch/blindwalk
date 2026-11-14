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
- `WalkaholicStore.startQuest` 增加 `realCandidates: [Place]` 参数（由 App 层先查好传入）
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
- 缓存：`walkaholic:geocache:v1`，0.01° 网格、24h、最多 12 格
- 真实模式：`watchPosition` 实时推进距离/线索、≤30m 自动开盒
- 降级：POI 服务失败 → 真实坐标（仍是真实地理）→ 内置虚构地点（明确标「演示」）

### iOS（`apple/App/Services/MapKitPlaceService.swift` + `Views/RealMapView.swift`）
- `MKLocalSearch` 多组中文 query 并发（咖啡/书店/公园/长椅/便利店/广场/美术馆/桥/市集…）
- `CLGeocoder` 反查区/街道
- `RealMapView`：SwiftUI `Map`，**只画你和走过的轨迹（MapPolyline），不画目的地**
- 24h 内存缓存、3 秒超时降级

## 5.2 修复：没动却自动「到达」（2026-11-09）

用户在鸿蒙浏览器实测报告：开了盲盒、人没动，界面却自动推进并最终揭晓。定位到 3 个叠加原因：

### 原因 1（主因）：真实距离用「差值 + 绝对值」推进，方向错了会反向坍缩
```js
// 旧代码
var events = advanceSession(prev - d);      // d = 到目标的真实距离
// advanceSession 内部：next = remaining - Math.abs(meters)
```
当 `d > remaining`（例如抽盒时用的是旧位置/粗略定位，随后精确 GPS 让距离变大）时，
`meters` 变负数，`Math.abs` 又把它当成「往前走」，于是**距离越大、剩余里程掉得越快**，
连续几次回调就把剩余里程推到 0 → 自动到达。

**修复**：真实定位下把「到目标的实际距离」直接作为剩余里程，不再做增量减法：
```js
session.remainingMeters = clamp(d, 0, session.totalMeters)
```

### 原因 2：目标距离与总里程不匹配
抽盒时按档位写死总里程（30 分钟 = 480m），但真实地标可能在 300m 或 900m 外。
第一次定位时用真实距离重置基线（`totalMeters = 实际距离`），进度从 0 开始。

### 原因 3：单次定位漂移就能触发到达
**修复**：
- 精度闸门：`accuracy > 80m` 的读数不参与到达判定
- 连续两次读数都在 30m 内才算到达（`arriveHits >= 2`）
- 加 2 秒周期复核（有些浏览器 watchPosition 只推一次读数）

### 顺带修的 3 个体验问题
| 问题 | 修复 |
|---|---|
| `watchPosition` 不推初始值 → 一直显示抽盒时的旧距离 | 进入旅程先主动 `getCurrentPosition` 一次 |
| 定位瞬时错误（code 2/3）直接停掉跟踪 | 改为指数退避重试（最多 6 次），只有权限被拒才放弃 |
| 真实进度不落盘，刷新丢失 | 每 3 秒节流 `save()` |

### 验证
| 场景 | 结果 |
|---|---|
| 原地不动 12 秒 | ✅ 仍在 walking，剩余里程不变 |
| 定位跳变 1km 后回到原点 | ✅ 不误判到达 |
| 真正走到目的地 | ✅ 自动到达并揭晓 |
| 首次进入旅程 | ✅ 立即显示真实距离（而不是 480） |

## 5.3 兴趣点与图片：公开数据（2026-11-09）

用户要求：按所在位置用公开数据生成兴趣点，并给兴趣点找图片。

### 数据源
| 来源 | 用途 | 特点 |
|---|---|---|
| **中文维基百科地理搜索** | 真实地标 + 简介 + **代表图片** | 公开、无需 Key、CORS 全开（`access-control-allow-origin: *`）、通常 300~800ms |
| **OpenStreetMap Overpass** | 街边小店/长椅等没有维基条目的 POI | 慢（常 5s+），作为备选 |
| **真实坐标兜底** | 任何城市都能开盒 | 不需要网络，只有方位和距离 |

请求示例（一次拿到名称、坐标、简介、图片）：
```
https://zh.wikipedia.org/w/api.php?action=query&format=json&origin=*
  &generator=geosearch&ggscoord=31.2304|121.4737&ggsradius=900&ggslimit=20
  &prop=pageimages|coordinates|extracts&piprop=thumbnail&pithumbsize=800
```

### 挑选规则
- 距离必须在 `[max(110, 0.35×抽盒距离), 1.7×抽盒距离]` 之间 —— **太近会一开盒就到达**
- 必须有图片（没有图的条目不收）
- 过滤行政区/城市/地铁站/道路这类「不是一个可以走到的地方」
- 去掉维基的括号消歧义：「大世界 (上海市)」→「大世界」
- 心情加权：放空偏公园/河岸/老房子，发现偏美术馆/图书馆，热闹偏广场/市集

### 图片展示（保密规则）
- **旅程中绝不显示图片**（照片会直接泄露目的地）
- 只在「到达后揭晓卡」与「图鉴」展示
- 标注来源「图片 · Wikimedia Commons」

## 5.4 修复：一直是「模拟数据」+ 两台设备显示不一样（2026-11-09）

用户在鸿蒙上实测报告两个现象：
1. 开盲盒看到的仍是演示地点（「河边的第七张长椅」这类虚构地点）
2. Mac 和鸿蒙上打开，显示的内容不一样

### 现象 1 的原因：安装卡二维码里带了 `?demo=1`
二维码链接是 `…/walkaholic/?demo=1#/home`，`demo=1` 会直接灌入演示种子（18 张卡、305 惊喜值、演示旅程），
而且**会持久化到 localStorage**，之后每次打开都还是演示数据。

修复：
- 二维码与文档里的链接去掉 `demo=1`
- `demo` / `fresh` 参数只对「这一次打开」生效，启动后立即用 `history.replaceState` 从地址栏移除
- 数据来源标记写入存档（`demoSeeded`），首页顶部显示「现在看到的是演示数据」+「用真实定位」按钮
- 旅程页状态条加来源标签：`真实地标 / 真实地点 / 编辑精选 / 演示地点`
- 演示模式下额外给一个「用真实定位重开」按钮（清掉演示会话，重新取定位抽盒）

### 现象 2 的原因：桌面端套了「展示用假手机外框」
桌面宽度 ≥480px 时会进入展示模式：390×844 假手机壳 + 深色背景 + 缩放，
而手机上是全屏，所以同一份数据看起来像两个 App。

修复：桌面端不再套假外框，改为**同一套布局 + 最大宽度 460px 居中**。
现在 Mac 与鸿蒙只差宽度（460 vs 390），布局规则完全一致。

另外一个真实的差异源是**本机存档**：两台设备的 localStorage 各自独立（xp、卡片、进行中的旅程都不同），
这是设计使然。为此新增诊断页（我的 → 诊断，或 `#/debug`），把两边的事实列清楚：
启动模式、是否演示数据、地点来源、定位权限、最近精度、窗口尺寸、是否独立启动、存档 xp/卡片数。

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
