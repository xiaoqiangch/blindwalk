# 盲走 BlindWalk

> **不看见终点，才看得见路。**
> 打开一个「散步盲盒」，它只带你走，不告诉你去哪；到了，才揭晓这个地方藏着的小惊喜。
> 给一个人散步的孤独时刻，一点未知、一点仪式感、一张可以收藏的卡片。

**项目位置**：`~/Projects/BlindWalk`（即 `/Volumes/XQProjects/projects/BlindWalk`），git 仓库随目录一起。

这是 **v0.1 原型**，包含两部分交付：

| 形态 | 位置 | 状态 | 用途 |
|---|---|---|---|
| Web 高保真交互原型 | `prototype/web/` | ✅ 可直接体验 | 立即看效果、走完整闭环、演示截图 |
| iOS + watchOS SwiftUI 源码 | `apple/` | ✅ 已构建成功（Xcode 27.2 / iOS 27.2 SDK） | 正式 App 的起点，可模拟器运行、可连真机 |

项目由 DSH Super Agent（1 名 Lead + 3 名并行开发代理）管理，进度见 [`docs/status.md`](docs/status.md)。

---

## 一、立即体验（1 分钟）

**方式 A（最简单）**：双击打开 `prototype/web/index.html`，或在浏览器中打开：

```bash
open prototype/web/index.html
```

**方式 B（推荐，体验稳定）**：本地起一个静态服务再打开：

```bash
cd prototype/web && python3 -m http.server 8788
# 浏览器访问 http://127.0.0.1:8788/index.html
```

### 演示路径

| 访问 | 看到什么 |
|---|---|
| `index.html#/home` | 首页（默认展示「正在走第 3 个盲盒」的丰富演示态） |
| `index.html?demo=1#/home` | 预置完整演示数据（18 张卡 / 12 天连续 / Lv.6） |
| `index.html?demo=1#/journey` | 旅程页：点 **「模拟步行 +50m」** 推进，线索依次解锁，≤30m 自动开盒 |
| `index.html?demo=1#/reveal` | 直接看揭晓卡（旧码头边的石阶） |
| `index.html?demo=1#/cards` | 回忆册 / 图鉴 |
| `index.html?demo=1#/social` | 圈子：同频码、周榜、动态流（可点赞、可发布） |
| `index.html?demo=1#/achievements` | 10 个成就 |
| `watch.html` | Apple Watch 三块表盘（进度 / 线索 / 揭晓） |
| `index.html?fresh=1` | 清空本地数据，从新用户开始玩 |

> 原型用「模拟步行」代替真实 GPS，方便在电脑/手机浏览器上完整体验。
> 预约体验闭环：首页 →「开一个盲盒」→ 选时长/心情 → 摇盒 → 旅程 → 到达揭晓 → 收进图鉴 → 分享到圈子 → 看成就。

---

## 二、项目结构

```
BlindWalk/
├── README.md
├── docs/
│   ├── PRD.md              # 需求、用户、核心循环、功能清单、指标、风险
│   ├── design-system.md    # 品牌/视觉 token/页面规格/文案声线/实现契约（唯一设计依据）
│   ├── architecture.md     # 技术架构、数据模型、抽盒与线索规则、工程门禁
│   ├── roadmap.md          # v0.1 → v0.4 路线图
│   ├── decisions.md        # 关键决策（双形态交付、抽象地图、本地优先等）
│   └── status.md           # Super Agent 项目进度看板
├── prototype/web/          # 零依赖 Web 原型（index.html / styles.css / app.js / data.js / watch.html）
├── apple/
│   ├── project.yml         # XcodeGen 工程描述（生成 .xcodeproj）
│   ├── Shared/Core/        # Foundation-only 业务内核（iOS/watch 共用）
│   ├── Shared/Design/      # Theme.swift 视觉 token
│   ├── App/                # iOS SwiftUI 客户端
│   ├── WatchApp/           # watchOS SwiftUI 客户端
│   └── Info/               # Info.plist（由 XcodeGen 生成）
├── scripts/
│   ├── check-swift.sh      # 共享内核 typecheck + 全部 Swift 语法检查
│   ├── screenshot.mjs      # CDP 精确模拟 390×844 @2x 截取全部页面
│   ├── smoke-test.mjs      # Web 原型端到端冒烟测试（抽盒→揭晓→收录→分享）
│   └── compose-showcase.py # 拼合展示长图
└── screenshots/            # 截图与 showcase.png
```

---

## 三、iOS / watchOS 构建（需 Xcode）

本机已安装 **Xcode 27.2**（App Store），`xcode-select` 指向 `/Applications/Xcode.app/Contents/Developer`。
**iOS + watchOS 两个 target 已真实构建成功**（`xcodebuild ... -destination 'generic/platform=iOS Simulator'` → BUILD SUCCEEDED）。

```bash
cd apple
open BlindWalk.xcodeproj          # 直接在 Xcode 里 Run
# 或命令行构建：
../scripts/build-native.sh
```

- 选择 `BlindWalk` scheme → iOS 模拟器 / 真机 Run；App 内自动嵌入 `BlindWalkWatch`
- `BlindWalkWatch` scheme → Apple Watch 模拟器（watchOS runtime 需在 Xcode Settings → Components 下载）
- 工程已配置定位权限文案、watch 伴随 App、`WKCompanionAppBundleIdentifier`
- 真实定位需要在 `App/Services/LocationService.swift` 里把 `LiveLocationService` 接上（骨架已留，含权限/距离/方位角）

> 构建期修正记录：`WatchApp/Haptics.swift` 的 `WKInterfaceDevice.WKHapticType` → 顶层 `WKHapticType`（watchOS SDK 实际定义）。

> 注意：XcodeGen 生成后，watch App 的嵌入关系若提示异常，在 Xcode 的
> `BlindWalk → General → Frameworks/Libraries/Embedded Content` 里确认 `BlindWalkWatch.app` 已嵌入即可（XcodeGen 版本差异）。

### 真机体验要点

- 真实定位替换 `LiveLocationService`（`App/LocationService.swift`，已留骨架）后，用距离推进旅程；
- 手表与手机通过 `WatchConnectivity` 同步（`WatchApp/WatchBridge.swift`，已留骨架）；
- 后台定位、本地通知、锁屏提醒是 v0.2 内容。

---

## 四、产品与设计速览

- **核心循环**：抽盒（时长 + 心情）→ 保密导航（只给方向/距离/三阶线索）→ 到达揭晓（地点卡 + 稀有度 + 小任务）→ 收藏 → 社交/成就。
- **情绪价值**：把「不知道去哪」变成一次轻量冒险；用小任务让用户真的停下来看看。
- **游戏性**：稀有度（常见/稀有/史诗/隐藏）、编号卡、惊喜值 XP、Lv.1–10、连续天数、10 个成就。
- **社交**：同频码（各自开盒，结束交换线索）、动态流、周榜、分享卡；MVP 全部本地 mock，无后端。
- **安全**：地点限定公共场所；夜间只推明亮、人多类别；不向他人暴露实时位置（详见 PRD §7）。

设计细节（颜色、字号、页面逐屏规格、所有文案）见 [`docs/design-system.md`](docs/design-system.md)。

---

## 五、当前限制与下一步

| 项 | 状态 |
|---|---|
| Web 原型交互闭环 | ✅ 完成（14/14 冒烟测试通过） |
| Web 原型视觉 | ✅ 完成（见 `screenshots/showcase.png`） |
| iOS / watchOS 源码 | ✅ 完成（13+8 文件），⚠️ 待 Xcode 编译 |
| 共享内核校验 | ✅ typecheck 通过 + 全部 Swift 语法通过 |
| 真实定位 / 后台提醒 | ⏳ v0.2 |
| 账号 / 后端 / 真实好友 | ⏳ v0.3 |
| 真实地点库 / 安全分级 | ⏳ v0.3 |
| App 图标 / TestFlight / 上架合规 | ⏳ v0.2+ |

完整路线图见 [`docs/roadmap.md`](docs/roadmap.md)。

---

## 六、Super Agent 协作方式

- **Lead**：需求与设计契约、共享内核、工程配置、校验与集成、最终验收。
- **proto-dev**：`prototype/web/` 高保真交互原型。
- **ios-dev**：`apple/App/` iOS SwiftUI 客户端。
- **watch-dev**：`apple/WatchApp/` watchOS 客户端与触感。

任务拆分、写作用域、验收标准与完成记录都在 `docs/status.md` 与 team task board 中。
