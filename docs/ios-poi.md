# iOS 接入后台策展 POI + 揭晓照片

> 状态：v1 已实现并在 iPhone 18 Pro 模拟器（iOS 27.2）验证；真机待复核（见 §7）。
> 后台契约：`admin/docs/CONTRACT.md` §4.6；Web 参考实现：`prototype/web/geo.js` 的 `loadCuratedPOIs / pickCurated / makeCuratedPlace`。
> 写作用域：`apple/App/Services/AdminPOIService.swift`（新增）、`apple/App/Views/BoxSetupSheet.swift`、`RevealView.swift`、`JourneyView.swift`；未改 `apple/Shared/**`。

---

## 1. 一句话

iOS 抽盒现在**优先**用后台审核通过的「编辑精选」兴趣点（`pois.json`）；
揭晓页展示实景照片 + 编辑精选标记 + 图片来源署名；
断网 / 超时 / 导出为空时**静默**退回原有 MapKit 真实 POI，再不行退回内置演示地点，行为与之前一致。

---

## 2. 数据流

```
admin 后台（人工审核 + AI 整理/分析）
        │  POST /api/export
        ▼
prototype/web/pois.json  ──部署──▶  https://xiaoqiangch.github.io/walkaholic/pois.json
        │
        │  URLSession（3s 超时）
        ▼
AdminPOIService（内存 6h + UserDefaults 落盘）
        │  pickCuratedPlace(origin, mood, startMeters, seed)
        ▼
BoxSetupSheet：curated Place  ──覆盖──▶  store.session.target / store.currentPlace
        │                                 （失败则原 MapKit 流程，完全不变）
        ▼
JourneyView：来源标签（编辑精选 / 真实地标 / 演示）+「这是编辑精选的地点」提示
        │  （到达前不展示 name / address / why / task / photo）
        ▼
RevealView：AsyncImage 实景照片 + 「编辑精选」标记 + 图片署名
```

---

## 3. AdminPOIService（新增）

文件：`apple/App/Services/AdminPOIService.swift`

| 能力 | 行为 |
|---|---|
| 数据源 | 默认 `https://xiaoqiangch.github.io/walkaholic/pois.json`；环境变量 `WA_POIS_URL` 可覆盖（调试 / 内网） |
| 超时 | `URLRequest.timeoutInterval = 3`；失败静默（不弹错、不阻塞抽盒、不崩） |
| 内存缓存 | 6 小时（按 `fetchedAt` 判断），过期才重新拉取 |
| 落盘兜底 | `UserDefaults` 保存原始 JSON + 拉取时间；冷启动先读盘；**断网 / URL 失效时继续用上次数据** |
| 空导出 | `pois` 为空数组时清空内存并返回 nil → 完全退回 MapKit |
| 抽取规则 | 与 `geo.js / pickCurated` 对齐：距离 ∈ `[max(110, 0.35×startMeters), 1.7×startMeters]`；心情权重 drift→park/river/temple/historic 1.5、discover→art/library/viewpoint/museum 1.7、lively→plaza/market/cafe 1.6；`seed` 用 `SeededGenerator` 可复现 |
| 映射 | `Place.id = "curated-" + poi.id`、`source = "curated"`、`coordinate/address` 取真实值；`why/task/hints` 优先用策展文案，缺失时按类别兜底；`mapPoint` 按 Web 的极坐标投影公式生成；`radiusMeters = max(800, startMeters + 400)` |
| 保密双保险 | 线索写入前再洗一遍：完整地名 + **名称前 2 个字**都替换成「那里」 |
| 照片 side-channel | `Place`（`Shared/Core`，Lead 拥有）没有 `photoUrl/photoCredit/summary` 字段 → 服务内部维护 `placeID → CuratedPlaceInfo`；落盘数据冷启动后仍能按 placeID 找回照片。`info(for:)` 供 Reveal 使用 |
| 预留 | `place(for: placeID)` 可按 id 还原策展 Place，供后续图鉴 / 首页接入（见 §8 已知缺口） |

调试用日志（仅 `WA_DEBUG_POI=1` 时输出）：`[Walkaholic][poi] curated pick name=… id=… source=curated photo=true pool=3`。

---

## 4. 抽盒顺序（BoxSetupSheet）

1. **无 `store.lastKnownOrigin`**：保持原行为，内置地点（演示）。
2. **有起点**：
   1. `await AdminPOIService.shared.prepare()`（最多 3s；失败静默）
   2. `pickCuratedPlace(...)` 命中 → `store.startQuest(origin:)` 后覆盖：
      - `store.session.target = curated.coordinate`
      - `store.currentPlace = curated Place`
      - 重建 `QuestSession`：`totalMeters = 起点→目的地的真实距离`，避免「刚到就已走 300 米」的假进度；再用 `store.updateLocation(...)` 正规推进一次，线索按真实距离解锁
   3. 未命中 → **原 MapKit 流程逐行保留**（`MapKitPlaceService` 未改动）
3. Sheet 里新增 loading 文案「正在看附近有什么…」（请求期间）。

---

## 5. UI 改动

### JourneyView
- **来源标签**（不泄露地点）：`编辑精选`（琥珀）/ `真实地标`（青）/ `演示`（灰）。
- 抽到策展点时短暂提示：**「这是编辑精选的地点 / 终点仍然保密。到了才知道是哪里。」**（2.6s 淡出）。
- 保密不变：旅程页不读 `currentPlace.name/address/why/task`；真实地图只画「你」和轨迹。

### RevealView（到达后才展示）
- 顶部右侧：`编辑精选` 胶囊 + 稀有度徽章。
- 实景照片：`AsyncImage`（172pt 高、16pt 圆角、加载中显示 ProgressView、失败静默显示占位图，绝不破图）。
- 照片左上角「编辑精选」，照片下方「图片：Wikimedia Commons」（来自 `photoCredit`）。
- 其它字段（name / area / category / why / task / 分享）沿用原卡片；策展信息缺失时完全降级为原揭晓卡。

---

## 6. 截图自检（`screenshots/ios-poi/`）

| 截图 | 内容 | 结果 |
|---|---|---|
| `00-home-sanity.png` | 正常启动首页（不带任何 preview 环境变量） | ✅ 无回归 |
| `01-setup.png` | `WA_PREVIEW=setup` 抽盒 sheet | ✅ |
| `02-curated-journey.png` | 抽到策展点后的旅程页 | ✅ 来源标签「编辑精选」、提示气泡、真实地图不显终点；剩余 299m、已走 0m、线索 1/3（「再走 99 米」按真实剩余距离计算） |
| `03-curated-reveal.png` | 策展点揭晓页 | ✅ 上海博物馆实景照片、图片署名「Wikimedia Commons」、编辑精选标记 |
| `04-fallback-journey.png` | `WA_POIS_URL` 指向不存在域名（冷启动、无缓存） | ✅ 来源标签「真实地标」，MapKit 兜底（人民公园-相亲角） |
| `05-fallback-reveal.png` | 兜底后的揭晓页 | ✅ 普通卡片，无编辑精选/无照片，不崩 |
| `06-disk-cache-fallback.png` | 先用正常 URL 成功拉取 → 再指向不存在域名重启 | ✅ 仍从 UserDefaults 缓存抽到策展点（落盘兜底生效） |

证据（模拟器 stdout，`SIMCTL_CHILD_WA_DEBUG_POI=1`）：

```
# 命中策展点（不同 seed 会抽到 3 个 approved 点里的不同一个，以下为两轮实测）
[Walkaholic][poi] curated pick name=上海博物馆 id=curated-poi-b2f39b source=curated photo=true pool=3
[Walkaholic][poi] curated pick name=上海音乐厅 id=curated-poi-191b1b source=curated photo=true pool=3

# 冷启动 + WA_POIS_URL 指向不存在域名 → 降级 MapKit
[Walkaholic][poi] curated miss (pool=0) → MapKit fallback
[Walkaholic][poi] mapkit pick name=人民公园-相亲角 id=real-apple-31.23225_121.47264 source=apple
```

构建：

```bash
cd apple
/tmp/xcodegen-download/xcodegen/bin/xcodegen generate --spec project.yml
xcodebuild -project Walkaholic.xcodeproj -scheme Walkaholic \
  -destination 'platform=iOS Simulator,id=34802F5B-9219-4B7F-A092-81AD670B9D67' \
  -derivedDataPath /tmp/walkaholic-dd-ios-poi CODE_SIGNING_ALLOWED=NO build
# → BUILD SUCCEEDED（0 error；Xcode 27.2 / iOS 27.2 模拟器）
```

> 截图辅助环境变量（都只在显式设置时生效，线上无影响）：
> `WA_PREVIEW=setup` 直达抽盒 sheet；`WA_AUTO_START=1` sheet 出现后自动摇盒（用模拟器坐标 31.2304/121.4737 作为起点）；
> `WA_AUTO_ARRIVE=<毫秒>` 进入旅程后自动触发到达，便于 headless 截揭晓页；`WA_DEBUG_POI=1` 打印抽盒来源。

---

## 7. 真机待验证

1. **真实 GPS + 策展点**：真机定位后抽盒，验证以真实起点计算的距离 / 方位 / 线索解锁 / ≤30m 自动到达。
2. **首次抽盒没有定位**：用户第一次打开 App 直接进抽盒 sheet 时 `lastKnownOrigin` 为空 → 仍走内置演示；需要产品确认是否要在 setup 页也主动请求定位（当前未改，避免新增权限弹窗时机）。
3. **照片加载性能**：Wikimedia 图片在弱网 / 被限流时的加载时间与失败表现（当前失败静默占位）；真机建议再验证一次。
4. **缓存时效**：App 后台驻留 >6h 后再抽盒会重新拉取；观察是否造成可感知延迟（3s 上限）。
5. **ATS / 网络**：正式包默认 HTTPS，无需额外 ATS 例外；真机蜂窝网络下验证超时行为。
6. **手表同步**：策展点揭晓后 `WatchSessionSummary` 的推送字段（当前走 store.currentPlace，应该正常；真机配对复核一次）。
7. **照片合规**：`photoCredit` 来自后台（Wikimedia Commons）；正式上架前确认第三方图片授权/外链策略。

---

## 8. 已知缺口（需后续任务，不在本任务写作用域）

1. **图鉴 / 首页还不认策展卡片**：`CardsView` 与 `HomeView` 目前只用 `PlaceCatalog.place(id:)` 查找地点。
   策展点收录后卡片在 profile 里，但不会出现在图鉴网格；若它是最新一张，首页「上一次的惊喜」会退回「第一盒还没开」的空态。
   解决方案（很小）：在两个 View 里把地点查找改成「`PlaceCatalog.place(id:) ?? AdminPOIService.shared.place(for: id)`」。
   服务端侧已预留 `AdminPOIService.place(for:)`，只等那两个文件的所有者合并（本次任务没有它们的写权限）。
2. **策展点不进去重**：连续抽盒可能重复抽到同一个策展点（与 Web `pickCurated` 当前行为一致）；如需要可加「最近 7 天去过」过滤。
3. **空导出（`{"pois":[]}`）未单独截图**：代码分支与「无缓存 + 拉取失败」相同（`pickCuratedPlace` 返回 nil → MapKit 兜底），冷启动失败用例已覆盖同一路径。
