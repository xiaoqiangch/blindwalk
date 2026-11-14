# 步迷 Walkaholic · HarmonyOS 移植

> 状态：v0.7 功能对齐 Web v32 完成（2026-11-09）
> 目标平台：**HarmonyOS NEXT**（API 12 / 5.0.0），ArkTS + ArkUI 声明式
> 本机限制：**没有 DevEco Studio / hvigor / ohpm**，所以 `.hap` 编译需在你装的 DevEco 里完成；逻辑层已用 TypeScript + Node 做真实校验。

---

## 1. 为什么是 ArkTS + ArkUI

| 候选方案 | 结论 |
|---|---|
| **ArkTS + ArkUI 原生**（本项目） | ✅ 采用。鸿蒙官方唯一一等公民路线，能上架、能调定位/相机/文件、性能好 |
| 打包 PWA 成 WebView 外壳 | 备选。零成本、立即可用，但拿不到系统能力、上架受限；见 §7 |
| Flutter / React Native 三方壳 | ❌ 不采用。鸿蒙上生态支持弱、体积大 |

架构上和苹果版保持**同一套分层**，便于三端（iOS / Web / HarmonyOS）语义一致：

```
entry/src/main/ets/
├── core/            ← 纯逻辑（TypeScript，可在 Node 里跑测试，不依赖 ArkUI）
│   ├── types.ts         数据契约（对应 apple/Shared/Core/Models.swift）
│   ├── contract.ts      UI↔逻辑 调用契约（对应 @Observable WalkaholicStore 的公开面）
│   ├── geo.ts           Haversine 距离 / 方位角 / 按方位偏移 / WGS↔GCJ↔BD 坐标转换
│   ├── catalog.ts       24 个内置地点（对应 PlaceCatalog.swift）
│   ├── engine.ts        种子随机 + 抽盒权重 + 序列号 + 心情亲和
│   ├── session.ts       旅程状态机（线索阈值 400/200/60、到达 30m）
│   ├── surprise.ts      dHash 感知哈希 + 汉明距离 + 复刻判定
│   ├── achievements.ts  成就判定
│   ├── demo.ts          演示数据（口径与 Web/iOS 一致）
│   ├── social.ts        圈子动态 + 排行榜
│   ├── store.ts         编排：抽盒/推进/揭晓/收录/埋寻/持久化/真实地点入口
│   ├── persistence.ts   KeyValueStore（HarmonyOS 端注入 @ohos.data.preferences）
│   ├── parity.ts        三端对齐规格：三档放宽/硬帽/黑名单/去重/类别多样性（parity.md §2）
│   ├── http.ts          HttpClient 接口（平台实现由 UI 注入）
│   ├── providers.ts     高德/百度/OSM/维基解析与编排（parity.md §1）
│   ├── mapkeys.ts       地图 Key 下发（包内→Pages→后台→免费源，12h 缓存）
│   ├── search.ts        三档搜索编排 + 策展优先 + **明确失败**（绝不虚构）
│   ├── flow.ts          抽盒完整编排（Key→策展→搜索）+ 路线规划
│   ├── route.ts         Valhalla 步行路线（polyline6 解码）
│   ├── fog.ts           迷雾路径几何（parity.md §3，纯函数可测）
│   ├── geocode.ts       地址 → 坐标（GPS 不可用时的真实地点出口）
│   ├── hints.ts         图鉴「附近惊喜」隐晦提示 + 探寻页线索解锁（保密铁律）
│   └── account.ts       账号服务（手动 Cookie 管理）
├── theme/Theme.ets      设计 token（奶油底 / 琥珀主色 / 圆角 / 字号）
├── pages/Index.ets      Tab 外壳
├── views/               7 个界面：Home / SetupSheet / Journey / Reveal / Cards / Social / Profile
├── components/          共享小组件 + 平台注入（HttpClient / Location / PreferencesKV）
│                        + 迷雾路径 Canvas（FogPath）+ 失败面板 + 账号/数据源面板
└── entryability/        EntryAbility（窗口、定位权限）
```

**关键决策：`core/` 全部是纯 TypeScript，不 import 任何 `@ohos.*`。**
好处：逻辑可以脱离鸿蒙设备在 Node 里跑单元测试（本机就是这么验证的），未来也不会被平台 API 变更拖累。

---

## 2. 已经做了什么

| 项 | 状态 |
|---|---|
| DevEco 标准工程结构（AppScope / entry / hvigorfile / build-profile / oh-package / module.json5） | ✅ |
| 应用图标、启动页背景、权限声明（INTERNET / LOCATION / APPROXIMATELY_LOCATION） | ✅ |
| 数据契约 + UI 调用契约（`core/types.ts`、`core/contract.ts`） | ✅ 类型检查 0 error |
| 逻辑层移植（地理 / 抽盒 / 会话 / dHash / 成就 / 演示数据 / store / 持久化） | ✅ **39 项单元测试全绿**，见 §4 |
| ArkUI 界面（7 个主界面 + 8 个共享组件，共 4206 行） | ✅ 代码完成，静态检查 20 个 .ets 全通过，**待 DevEco 首编验证** |
| 真实定位（`@ohos.geoLocationManager`） | ✅ 已接，权限拒绝会降级到演示模式 |
| 真实地图 | ⏳ 本轮用 ArkUI Canvas 手绘抽象街区（和 Web 版同源），不引入需 AGC 配置的 Map Kit |
| 埋惊喜 / 寻惊喜界面 | ⏳ 逻辑层已备好；界面本轮只放首页入口卡片 |
| **真实 POI 数据源**（高德/百度/OSM/维基） | ✅ v0.7 完成，ArkTS 直接 HTTP（无 CORS） |
| **三档放宽 + 硬帽 + 黑名单**（parity.md §2） | ✅ v0.7 完成，纯 TS 单测覆盖 |
| **明确失败面板**（绝不虚构兜底） | ✅ v0.7 完成，三按钮同 Web |
| **迷雾路径视图**（parity.md §3） | ✅ v0.7 几何层单测覆盖；Canvas 绘制待 DevEco 首编 |
| **账号**（登录/同步/恢复/退出/删号） | ✅ v0.7 完成（手动 Cookie） |
| **图鉴「附近惊喜」隐晦提示**（对齐 Web v46） | ✅ v0.8 完成，纯 TS 单测 + 静态守卫双重保密 |
| **探寻面板**（三阶线索按距离解锁） | ✅ v0.8 完成（拍照/对比待相机接入） |
| **字号对齐 Web v32**（无 <10pt） | ✅ v0.7 完成 |

---

## 3. 怎么在 DevEco Studio 里跑起来

```bash
# 1. 装 DevEco Studio（免费）
#    https://developer.huawei.com/consumer/cn/deveco-studio/
#    安装时勾选 HarmonyOS SDK（API 12 或更高）

# 2. 打开工程
DevEco Studio → Open → 选择仓库里的 harmony/ 目录（不是仓库根目录）

# 3. 等 Sync 完成（hvigor 会自动拉 oh_modules）

# 4. 签名（首次必须）
File → Project Structure → Signing Configs → 勾选 Automatically generate signature
（需要登录华为开发者账号，免费）

# 5. 运行
选模拟器（Device Manager 里下 Phone）或真机（开发者模式 + USB 调试）
 → Run 'entry'
```

### 常见首编问题
| 现象 | 原因 | 处理 |
|---|---|---|
| `hvigor-ohos-plugin not found` | 没 Sync 或网络问题 | File → Sync and Refresh Project |
| `Signature not configured` | 没配签名 | §3 第 4 步 |
| 定位无反应 | 权限未授予 | 首次进入点「允许」；模拟器需在 Device Manager 里设置虚拟位置 |
| `Cannot find module './core/xxx'` | 大小写或路径拼错 | 鸿蒙对路径大小写敏感 |

---

## 4. 逻辑层校验（本机可跑，真实结果）

最近一次运行（2026-11-09 23:1x，v0.7 对齐后）：

```
1. tsc -p tsconfig.test.json --noEmit   → 0 error
2. npm test                             → 98/98 通过（原 39 项 + 新增 59 项）
3. ArkTS 静态检查（25 个 .ets）           → 0 error
    ✅ import 路径  ✅ ArkTS 严格模式  ✅ ForEach key
    ✅ @Entry 注册  ✅ 资源引用       ✅ 保密规则  ✅ 工程契约
```

新增 59 项测试覆盖（对照 docs/parity.md）：

| 分组 | 内容 |
|---|---|
| 坐标系 | WGS↔GCJ↔BD 往返误差 < 3m；境外不偏移 |
| 三档放宽 | min/max 距离公式、距离硬帽、层级单调 |
| 质量门槛 | 硬排除（公厕/加油站）、软降权（便利店 ×0.22）、类别权重 |
| 去重/多样性 | 30m 或同名合并、每类最多 5、按距离排序 |
| 择优 | 前 40%（≥3）加权随机，软黑名单不优先 |
| 数据源解析 | 高德/百度/OSM/维基 fixture（含坐标转换、过滤规则） |
| 数据源编排 | 无 Key 只跑 OSM+维基、单源失败不影响其他源 |
| 三档搜索 | 找到 / 全失败 / 档位放宽 / 最后用软黑名单点 / 策展优先 |
| Key 下发 | 包内→Pages→后台→免费源四级降级、12h 缓存、掩码 |
| 账号 | Set-Cookie 提取、本地校验、同步超限、401 清会话、恢复 |
| 迷雾几何 | 窗口公式、沿线投影、两端渐隐、箭头 55m、<60m 隐藏、指北针 |
| 抽盒编排 | prepareQuest 成功/失败路径、策展 6h 缓存 |
| 地址/路线 | 地址→坐标三级、polyline6 往返、Valhalla 解析、10min 缓存 |
| 保密 | 照片/署名/简介到达前必须抹掉（快照 JSON 不含图片域名） |

Lead 还做了一轮**不依赖队友测试的独立复核**（自己写脚本 import 编译产物）：

| 复核项 | 结果 |
|---|---|
| 北京→上海距离 ≈ 1067 km（Haversine） | ✅ 1067 km |
| 正北偏移 100m 后距离 ≈ 100m、方位角 ≈ 0° | ✅ 100.00m / 0.00° |
| 线索阈值：300m 不解锁第 2 条；199m 解锁第 2 条；50m 解锁第 3 条 | ✅ |
| 20m 触发 `arrived` | ✅ |
| 15 分钟档 300 次抽盒：hidden = 0 | ✅ |
| 60 分钟档 300 次抽盒：出现 hidden | ✅ |
| 快照必填字段齐全（含 places=24 / togetherCode） | ✅ |
| 真实坐标会话 → 走到目的地自动到达 | ✅ |
| dHash 1 位差 → 相似度 0.96875、完全相同 → 1.0 | ✅ |
| 到达前快照不含真实地点名 | ✅（修了下面这个漏洞） |

### 4.1 独立复核时发现并修掉的保密漏洞

原实现 `maskPlaceForWalking()` 只清 `name` 和 `address`，但 `why` 会描述地点特征：
```jsonc
// 到达前仍能被看到：
"why": "花店开在菜场后门，门口永远湿漉漉的。\n老板会把卖剩的花扎成一把…",
"name": ""   // 名字遮了，why 却把人带到花店
```
已改为 `why` / `task` 一并清空，`hints` 再过一遍 `scrubHints()`，并补了对应测试。
**这条规则现在有测试守着**，后续改动不会退化。

```bash
bash scripts/check-harmony.sh
```

包含三步：
1. **类型检查**：`tsc -p tsconfig.test.json --noEmit` → 0 error
2. **单元测试**：地理距离、会话推进、抽盒权重、dHash 相似度、埋/寻结算、成就解锁、保密规则
3. **ArkTS 静态检查**：import 路径存在、无 `any`、`ForEach` 有 keyGenerator、页面注册、资源引用存在

> 这套校验**不等于**编译通过。`.ets` 的 ArkUI 语法（装饰器、组件树）只有 DevEco 的 ArkTS 编译器能验。

---

## 5. 与苹果版的对齐点（改动前必须一致）

| 规则 | 值 |
|---|---|
| 到达阈值 | 30 米 |
| 线索阈值 | 第 2 条 400m / 第 3 条 200m / 到达前 60m |
| 抽盒权重 | 常见 70 / 稀有 22 / 史诗 6 / 隐藏 2 |
| 隐藏款限制 | 只在 60 分钟档位出现 |
| 时长档位 | 15 分钟 300m / 30 分钟 480m / 60 分钟 900m |
| 抽盒半径 | 900m / 1600m / 3000m |
| dHash 判定 | 64 位汉明距离 → `max(0, 1 - dist/32)`，≥ 0.45 通过 |
| 埋惊喜奖励 | 埋下 +30，寻到方 +80，作者 +40，未中 +10（每颗只发一次） |
| 演示口径 | 周惊喜值 305 / 18 张卡 / 连续 12 天 / Lv.6 黄昏猎人 / 稀有 7 / 隐藏 1 |

**保密规则（产品灵魂）**：到达前任何界面不得出现目的地名称；线索不得含地名（含前两字）。

---

## 6. HarmonyOS 与 iOS 的平台差异清单

| 能力 | iOS | HarmonyOS | 移植处理 |
|---|---|---|---|
| 定位 | CoreLocation | `@ohos.geoLocationManager` | 已接，含权限申请与降级 |
| 持久化 | UserDefaults | `@ohos.data.preferences` | `KeyValueStore` 注入 |
| 照片选择 | PhotosPicker | `@ohos.file.picker`（PhotoViewPicker） | 埋惊喜界面待做 |
| 相机 | AVFoundation | `@ohos.multimedia.camera` + `CameraPicker` | 同上 |
| 感知哈希 | CoreImage 解码后自己算 | `@ohos.multimedia.image` 解码成 PixelMap → 取灰度 | 算法已移植，取图待接 |
| 手表端 | watchOS App | 华为手表是另一套（Lite Wearable / Wearable） | **本轮不做**，见 §8 |
| 小地图 | MapKit | 需 AGC 配置 Map Kit | 本轮用 Canvas 手绘，保持「不显示目的地」 |
| 震动反馈 | CoreHaptics / UIImpactFeedback | `@ohos.vibrator` | 待接 |

---

## 7. 待 DevEco 首编验证的点

代码里已标 `⚠️ 待 DevEco 验证` 的共 8 处（都是 API 签名层面，写法取了官方文档最保守的形式）：

| 文件 | 待验证内容 |
|---|---|
| `entryability/EntryAbility.ets` | `windowStage.loadContent` 回调签名、`setWindowBackgroundColor` |
| `components/Location.ets` | `geoLocationManager.getCurrentLocation` / `on('locationChange')` 的 API 12 写法 |
| `components/PreferencesKV.ets` | `@kit.ArkData` 的 `preferences.getSync / putSync / deleteSync` 签名 |
| `components/AbstractMap.ets` | `CanvasRenderingContext2D` 的字体与 `lineDash` 写法 |
| `components/FogPath.ets` | **Canvas 的 `rotate` / `setLineDash` / `globalAlpha` / `arc` 四件套**（迷雾路径全部靠它） |
| `components/HttpClient.ets` | **`http.createHttp()` / `request()` 的 API 12 签名**、`expectDataType`、`header` 键名大小写、`responseCode` 类型 |
| `components/HttpClient.ets` | **`resourceManager.getRawFileContent('mapkeys.json')`**（包内 Key 下发；文件不存在时必须走 catch 分支） |
| `components/AccountPanel.ets` | `TextInput` 的 `InputType.Password`、`promptAction.showToast` |
| `components/SeekPanel.ets` | `@Prop @Watch` 多字段联动（hints 数组 + 坐标同时变）是否只触发一次；`WaQuietButton` 的 `tag` 参数（本轮未用 tag） |

首次编译报错大概率集中在这 8 处，改起来都是机械调整。其余（组件树、装饰器、状态管理）是按 ArkTS 规范写的。

### v0.7 新增、需要真机确认的行为

| 行为 | 本机无法验证的原因 | 真机上怎么确认 |
|---|---|---|
| 高德/百度 Key 真实可用 | 没有真 Key（Key 由后台下发，主仓不存） | 「我的 → 数据源」显示「已由后台配置 ✓」；抽盒成功 |
| 高德返回 GCJ-02 已正确转回 WGS | 需要真实响应 | 抽到的地点距离与地图 App 大体一致（偏差应在几十米内，不是几百米） |
| 迷雾路径 Canvas 绘制 | 需要渲染 | 旅程页看到琥珀色前方路径 + 灰褐已走段 + 两端渐隐 + 指北针 |
| 剩余 < 60m 隐藏整段 | 需要走完一段 | 接近终点时路径消失，只剩「就在附近 · 抬头看看周围」 |
| 账号 Cookie 持久化 | 需要 `@ohos.net.http` 真实响应头 | 登录后杀进程重开，仍是登录态 |
| 图鉴「附近的惊喜」三张卡 | 需要渲染 | 统计条下面出现 3 张卡（🐱/🎧/🌙），点任意一张进探寻页 |
| 探寻页线索按距离解锁 | 需要真实走动 | 起点 1/3 → 走近到 180m 内 2/3 → 60m 内 3/3 |
| 账号 CORS/地址 | 鸿蒙无 CORS，但要注意「真机不能访问 127.0.0.1」 | 把服务地址改成电脑局域网 IP（如 `http://192.168.1.5:8803`） |

## 8. 立即可测的替代路径（今晚就能用）

鸿蒙浏览器（华为浏览器）内核是 Chromium，**现有 PWA 可以直接在鸿蒙手机上跑**：

1. 鸿蒙手机用「浏览器」打开 https://xiaoqiangch.github.io/walkaholic/
2. 菜单 → 添加到桌面
3. 从桌面启动，允许定位，即可体验真实街道 + 真实距离

这条路径已经把「真实地理 + 埋惊喜」全流程跑通，可以用来**先验证产品体验**，再决定原生版要不要继续深做。

---

## 9. 路线图

| 版本 | 内容 |
|---|---|
| v0.6（本轮） | 工程骨架 + 逻辑层（含测试）+ 7 个主界面 + 真实定位 |
| v0.7 | 功能对齐 Web v32：多数据源真实 POI、三档放宽、明确失败面板、迷雾路径、账号、字号 |
| **v0.8（本轮）** | **图鉴「附近惊喜」隐晦提示 + 探寻面板**（对齐 Web v46）；拍照/对比仍待相机接入 |

### v0.8 图鉴「附近惊喜」（对齐 Web v46 / iOS）

图鉴页在统计条之后、筛选 chips 之前新增「附近的惊喜」区块。

**分层**：
- `core/hints.ts`（纯 TS，可单测）：`distanceBucket` / `hintForSurprise` / `nearbyHints`
  + `seekClueState` / `seekLeadText`（探寻页解锁判定）
- `views/CardsView.ets`：提示区块（最多 3 张卡 / 空状态 CTA）
- `components/SeekPanel.ets`：探寻面板（三阶线索 + 距离 + 「当作到了（演示）」）
- `pages/Index.ets`：`onOpenSeek` 注入 → 打开 SeekPanel

**保密铁律**（`NearHint` 只能由三类东西组成）：
1. 固定文案（7 档距离 + 7 条氛围池）
2. 作者 emoji（三端唯一允许的社交信息）
3. 一个**取整后的距离**（只用于选分档，不直接出现在文案里）

**绝不能**出现：`areaWord`（区域名会缩小范围）、`hints`（作者提示，要走近才解锁）、
`photoUri` / `photoHash`（照片 = 答案）、`location` 坐标、`authorName`（谁埋的）。

三道防线守护这条铁律：

| 防线 | 位置 | 作用 |
|---|---|---|
| 类型 | `NearHint` 接口只有 5 个字段 | 结构上就没有地方放剧透字段 |
| 单测 | `npm test` 的「保密（铁律）」5 项 | 断言序列化后的 JSON 不含任何剧透串 |
| 静态检查 | `check-arkts.mjs` 的「附近惊喜保密」 | UI 一旦直接读 `.areaWord` / `.photoUri` / `.authorName` 就报错 |

三处都做了**变异测试**验证真的会红（往 NearHint 里加 areaWord、往 CardsView 里读 areaWord）。

**线索解锁规则**（与 Web `seekDetailHTML` 一致）：
- 起点即第 1 条（`makeClues()` 保证第 1 条是通用句，不含作者提示）
- `≤ 3×半径`（默认 180m）解锁第 2 条
- `≤ 半径`（默认 60m）解锁第 3 条 → 进入「这样拍一张」
- 点「当作到了（演示）」全解锁，但 UI 必须标注「演示」（`demoArrived` 字段）
- 没定位 → 只有第 1 条 + 明确提示「拿不到定位，线索暂时解锁不了」（**不假装解锁**）

### v0.7 联调实测发现并修掉的问题（真实网络，不是纸面推演）

用真实的高德 Key + 公网维基跑了 `nearby` / `findRealPlace`，抓出 4 个真 bug：

| # | 问题 | 现象 | 修法 |
|---|---|---|---|
| 1 | **维基 / Overpass 缺 User-Agent** | 直连返回 403 / 406（浏览器会自动带 UA，原生 HTTP 客户端不会）→ 免费源全挂 | `core/providers.ts` 导出 `USER_AGENT`，所有 GET/POST 显式带上；`geocode.ts` / `route.ts` / `search.ts` / `mapkeys.ts` 同改 |
| 2 | **地标关键字整串传给高德** | `keywords=公园\|风景名胜\|…` 返回 `status=1` 但 `count=0`（**静默空结果**，最阴的一个） | `parity.landmarkKeywordList()` 拆成单词逐个查，只查前 `LANDMARK_KEYWORD_LIMIT=3` 个（兼顾高德 QPS） |
| 3 | **类别判定顺序错** | 「国际饭店」因简介提到「人民公园」被判成 `park`；维基条目尤其严重 | `mapCategory()` 改为**名称优先、原始类别兜底**；维基改用 `categoryFromWikiTitle()`（只信标题） |
| 4 | **去重时跨 POI 借类别** | 30m 内的餐厅把隔壁寺庙的 `temple` 借走（「鲜得来 → 寺庙」） | `mergeMissing()` 只在**同名**时互补类别；照片/地址这类客观属性仍可互补 |
| 5 | **rawfile 逐字节解码** | `String.fromCharCode` 把 UTF-8 中文解成乱码 → `JSON.parse` 失败 | `util.TextDecoder.create('utf-8')`（`components/HttpClient.ets`） |

> 修完后实测：高德 95 条 + 维基 7 条 → 去重后 40 条候选，抽到的是「上海博物馆 / 延福绿地 / 人民广场」这类**真的值得走过去**的地方，不再是楼下的餐厅。

#### 本机网络环境的已知限制

- **Overpass 三个镜像从本机全部超时**（`overpass-api.de` / `kumi` / `private.coffee`）。
  Web 版用同样的三个端点，同样失败 → 确认是**本机网络环境**（代理/出口）问题，不是代码。
  代码侧已按 parity 实现「3 镜像 × 4.5s 超时、整体 8s」，失败只影响 OSM 一个源，不影响整体（维基 + 高德照常）。
- 维基、高德、Valhalla 从本机可正常访问（已实测 200）。
| v0.9 | 埋惊喜界面（相机 + 相册 + dHash 取图）、探寻「先拍后揭晓」对比、震动反馈 |
| v0.10 | 华为账号登录（替代自建账号）、桌面卡片（服务卡片显示「下一个盲盒」） |
| v0.11+ | 折叠屏/平板适配（GridRow 断点）、深色模式、无障碍 |
| 待评估 | 华为手表端（Wearable 是独立技术栈，工作量和手机端相当） |

---

## 10. 目录速查

```
harmony/
├── AppScope/app.json5                应用级配置（bundleName / 版本 / 图标 / 名称）
├── build-profile.json5               构建配置（compatibleSdkVersion 5.0.0(12)）
├── hvigorfile.ts                     app 级构建脚本
├── oh-package.json5                  依赖
├── entry/                            主模块
│   ├── build-profile.json5
│   ├── hvigorfile.ts
│   ├── oh-package.json5
│   └── src/main/
│       ├── module.json5              模块/Ability/权限声明
│       ├── ets/                      ArkTS 源码（见 §1 结构图）
│       └── resources/                字符串/颜色/图标/页面清单
├── tests/                            Node 单元测试（逻辑层）
├── scripts/check-arkts.mjs           ArkTS 静态检查
├── docs/HARMONY.md                   本文
├── package.json                      TypeScript + 测试脚本（仅开发用）
└── tsconfig.test.json                逻辑层类型检查配置
```
