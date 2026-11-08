# 技术架构 v1

## 0. 一句话

一个**离线可跑的 Web 高保真原型**（立即体验）+ 一套**共享业务内核的 SwiftUI iOS/watchOS 源码**（待 Xcode 构建）。两端共享同一套数据模型、抽盒规则、成就与文案。

## 1. 仓库结构

```
Projects/BlindWalk/
├── README.md
├── docs/                 # PRD / 设计系统 / 架构 / 路线图 / 决策 / 进度看板
├── prototype/web/        # 零依赖离线原型（index.html / app.js / data.js / watch.html）
├── apple/
│   ├── project.yml       # XcodeGen 工程描述（生成 .xcodeproj）
│   ├── Shared/Core/      # Foundation-only 业务内核（两端共用，可本机 typecheck）
│   ├── Shared/Design/    # Theme.swift 颜色/字体 token
│   ├── App/              # iOS SwiftUI 视图 + CoreLocation
│   ├── WatchApp/         # watchOS SwiftUI 视图 + 触感
│   └── Info/             # 两个 Info.plist
├── scripts/              # check-swift.sh / screenshot.sh / compose-showcase.py
└── screenshots/          # 由脚本生成
```

## 2. 分层

```
UI (SwiftUI / HTML+CSS)
  └── AppState / Store（观察者，驱动页面）
        └── BlindWalkKit（Shared/Core）
              ├── Models            地点/卡片/会话/成就/动态
              ├── PlaceCatalog      24 个内置地点（虚构，坐标归一化）
              ├── BlindBoxEngine    按心情/时长/区域抽盒（可复现随机）
              ├── QuestStateMachine 距离→线索解锁→到达→揭晓→收录
              ├── AchievementEngine 10 个成就判定
              ├── SocialFeed        mock 动态/同频码/周榜
              └── Profile           XP/等级/连续天数/持久化协议
```

- **无网络**：MVP 全部本地。`Persistence` 用协议抽象（native: UserDefaults JSON；web: localStorage）。
- **时间与随机可注入**：`BlindBoxEngine(seed:)`，方便测试与演示复现。
- **定位抽象**：`LocationProviding`（`distanceToTarget`, `bearing`, `authorization`），Live（CoreLocation）与 Simulated 两种实现。

## 3. 数据模型（与 Swift Core 一致）

```swift
enum Rarity: String, Codable { case common, rare, epic, hidden }   // 常见/稀有/史诗/隐藏
enum Mood: String, Codable { case drift, discover, lively }        // 放空/发现/热闹
enum WalkDuration: Int, Codable { case m15 = 15, m30 = 30, m60 = 60 }

Place { id, name, area, category, emoji, rarity, why, task,
        hints: [String], mapPoint: CGPoint(0…1), radiusMeters }
PlaceCard { id, placeID, serial, collectedAt, taskDone }
QuestSession { id, placeID, startedAt, totalMeters, remainingMeters,
               unlockedHintCount, phase: idle/choosing/walking/revealing/collected }
Achievement { id, name, icon, detail, target, progress, unlockedAt }
FeedPost { id, authorName, authorEmoji, placeName, categoryEmoji,
           rarity, caption, createdAt, reactions: [String:Int], isMine }
Profile { xp, level, streakDays, totalKm, boxesOpened, cardsCollected,
          collectedPlaceIDs, achievements, posts, lastWalkAt }
```

## 4. 关键规则

- **抽盒**：`candidates = 未在 7 天内去过的地点 ∩ 区域 ∩ 时长半径`；按心情加权重（放空偏长椅/河堤/公园；发现偏书店/涂鸦/唱片；热闹偏咖啡/球场/便利店）；用 seed 做确定性洗牌。候选为空则放宽到全库。
- **线索**：距离 480m 起。`unlocked = remaining ≤ [400, 200, 60][i]`；第 3 条为「到了你就知道」氛围句，永不泄露地名。
- **揭晓**：`remaining ≤ 30` → phase = revealing，0.9s 动画后展示卡片；收录 → XP += 40 + 稀有度加成（rare+10/epic+20/hidden+40）；写卡片、判成就。
- **稀有度权重**：common 70 / rare 22 / epic 6 / hidden 2（按心情微调，hidden 只在 60 分钟档开放）。
- **同频码**：6 位大写字母+数字（去掉易混 O/0/I/1），本机生成；好友加入为 mock「已同频」状态；完成后双方 +30 XP 与 `together_1`。
- **惊喜指数（周榜）** = 完成次数×20 + 稀有卡×15 + 小任务×5 + 连续天数×3。
- **等级**：每 800 XP 升一级，Lv1–Lv10 名称：出门新手 / 街角观察员 / 城市漫游者 / 惊喜收藏家 / 迷雾探险家 / 黄昏猎人 / 夜路诗人 / 盲走大师 / 城市传说 / 盲盒之神。

## 5. Native 工程

- XcodeGen `project.yml` 定义两个 target：
  - `BlindWalk`（iOS 17，application，sources: Shared/Core + Shared/Design + App，依赖并内嵌 watch）
  - `BlindWalkWatch`（watchOS 10，application，sources: Shared/Core + Shared/Design + WatchApp）
- Swift 6 语言模式关闭（`SWIFT_VERSION: 5.9`）降低学习成本。
- 生成：`brew install xcodegen && cd apple && xcodegen generate` → 打开 `BlindWalk.xcodeproj`。
- **当前环境无法构建**：无 Xcode / iOS SDK（仅 CommandLineTools）。已用 `swiftc -parse` 校验语法，用 macOS SDK `-typecheck` 校验 Shared/Core 类型正确性。UI 层需在装有 Xcode 的机器上首次编译修错。

- **手表同步 Schema**：`Shared/Core/WatchSessionSummary.swift`（Codable，iOS/watchOS 共用，`applicationContext` 传输）；走路途中不下发 `placeName/rarity/areaLabel`，到达后才下发。iOS 发送端为 v0.2（见 roadmap）。

## 6. Web 原型工程

- 纯原生 JS（无框架、无构建），hash 路由 + 状态机 + localStorage。
- 页面全部由一个 `#app` 容器渲染；`data.js` 提供地点库、成就、mock 动态、文案。
- 演示控制：`?demo=1`（预置进度）、`?fresh=1`（重置）、`#/journey`（可点 +50m）。
- 待接入：真实定位 → 用 `navigator.geolocation` 替换模拟步行（P1）。

## 7. 质量门禁

1. `scripts/check-swift.sh`：Shared/Core `swiftc -typecheck`（macOS SDK）+ 全部 Swift `-parse`。
2. `scripts/screenshot.sh`：Chrome headless 截 7 个路由 + watch，输出 `screenshots/`。
3. 手工走查清单见 design-system.md §9。
