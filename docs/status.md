# 项目进度看板（Super Agent 协作）

> 维护：Lead。每次里程碑完成后更新。
> 项目主目录：`/Users/chenxiaoqiang/Projects/BlindWalk`（外部卷 `/Volumes/XQProjects/projects/BlindWalk`）
> 会话内相对路径：`Projects/BlindWalk`（软链，指向主目录）

## 0. 一图流

```
需求/设计契约 ──► 共享内核 + 工程配置 ──► 三路并行实现 ──► 校验/截图/集成 ──► 交付
   Lead                Lead                  proto-dev            Lead
                                            ios-dev
                                            watch-dev
```

## 1. 团队与写作用域

| 角色 | 职责 | 写作用域 | 状态 |
|---|---|---|---|
| Lead | PRD/设计系统/架构、共享内核、XcodeGen 配置、校验、截图、集成、最终验收 | `docs/`、`apple/Shared/`、`apple/project.yml`、`scripts/`、`README.md` | 进行中 |
| proto-dev | Web 高保真交互原型（手机 + 手表预览） | `prototype/web/` | 进行中 |
| ios-dev | iOS 17 SwiftUI 客户端 | `apple/App/` | 进行中 |
| watch-dev | watchOS 10 SwiftUI 客户端 | `apple/WatchApp/` | 进行中 |

## 2. 任务板（team task board）

| # | 任务 | Owner | 状态 | 验收要点 |
|---|---|---|---|---|
| task-1 | Web 高保真交互原型 | proto-dev | ✅ 完成 | 9 路由直达、闭环可走、`?demo=1`、截图友好、无外部依赖 |
| task-2 | iOS SwiftUI App（8 页） | ios-dev | ✅ 完成 | 13 文件 4032 行，与 §5.1–5.8 对应，parse 全过 |
| task-3 | watchOS SwiftUI App（4 界面 + 触感） | watch-dev | ✅ 完成 | 8 文件 873 行，§5.9 对应，WCSession 骨架 + 触感 |
| task-4 | 真实定位 CoreLocation + 旅程页 | gps-dev | ✅ 完成 | 三态降级；模拟器真 GPS 实测 480→49m 自动开盒 |
| task-5 | iOS→watchOS 实时同步 | sync-dev | ✅ 完成 | 端到端实测：推送→手表 UI 变化→打卡回传 |
| task-6 | iOS 原生 UI 打磨 | polish-dev | ✅ 完成 | 10 文件重写，对齐 Web 原型；构建 + 截图逐屏自检 |
| task-7 | iOS 埋惊喜/寻惊喜 | surprise-dev | ✅ 完成 | 4 新文件，dHash 实拍对比，先拍后看的代码级保证 |
| task-8 | Web PWA 埋惊喜/寻惊喜 | pwa-dev（失败）/ Lead 接手 | ✅ 完成 | dHash + 拍照压缩 + 三阶线索 + 对比结算，全流程实测 |
| — | 共享内核 + 工程配置 | Lead | ✅ 完成 | Core typecheck 通过、project.yml 就绪 |
| — | 校验/截图/展示图 | Lead | ✅ 完成 | check-swift + CDP 截图 + smoke test + showcase.png |
| — | 迁移到 ~/Projects | Lead | ✅ 完成 | 主目录 = /Users/chenxiaoqiang/Projects/BlindWalk，工作区留软链 |

## 3. 里程碑

| 时间 | 事件 |
|---|---|
| 2026-11-08 21:29 | 环境侦察：无 Xcode/iOS SDK；`~/Projects` 外部卷；决定双形态交付 |
| 2026-11-08 21:31 | 项目骨架 + PRD + 设计系统 + 架构/路线图/ADR |
| 2026-11-08 21:36 | 共享内核（Models/Catalog/Engine/Session/Achievements/Social/Store）+ project.yml 完成，Core typecheck 通过 |
| 2026-11-08 21:37 | 任务板建立，proto-dev / ios-dev / watch-dev 三路并行启动 |
| 2026-11-08 21:44 | proto-dev 产出全部 Web 文件；ios-dev / watch-dev 并行交付
| 2026-11-08 21:50 | Lead：改用 CDP 精确模拟 390×844 截图（Chrome 最小视口问题），修正演示数值（305/第 4 名/手表 1/3） |
| 2026-11-08 21:55 | 集成：WatchSessionSummary 移入 Shared/Core，WatchBridge 复用；XcodeGen 重新生成工程（含全部源码） |
| 2026-11-08 21:57 | 校验：Shared typecheck OK、全量 parse OK、smoke test 14/14 通过 |
| 2026-11-08 22:0x | 截图 9 张 + showcase 展示图；README / 状态看板定稿 |
| 2026-11-08 22:0x | 同步到 ~/Projects/BlindWalk，交付用户 |
| 2026-11-08 22:0x | 用户要求安装 Xcode + 迁移项目：项目主目录更新为 ~/Projects/BlindWalk（工作区软链） |
| 2026-11-08 22:1x | Xcode 27.2 从 App Store 安装完成（mas 需 root，改由用户 GUI 安装）；osascript 管理员授权完成 license accept / first launch |
| 2026-11-08 22:2x | 原生构建：修复 `WKHapticType` 命名空间后，iOS + watchOS 两 target **BUILD SUCCEEDED** |
| 2026-11-08 22:23 | iOS 模拟器 runtime 8.32GB 下载安装完成（iOS 27.2） |
| 2026-11-08 22:24 | iPhone 18 Pro 模拟器实跑：修复 watch 内嵌 `WKApplication` 后安装成功，6 屏原生截图 + native-showcase.png |
| 2026-11-08 22:27 | watchOS 27.2 runtime 安装完成；Apple Watch Series 9 45mm 模拟器跑通 4 屏 + 与 iPhone 配对，截图并入 native-showcase.png |
| 2026-11-08 22:4x | 用户真机 iPhone 16 Pro Max 接入（USB 识别成功）；受阻于 Xcode 未登录 Apple ID（无法签名），经确认先继续开发 |
| 2026-11-08 23:0x | Lead：新增 Geo.swift（真实地理计算）+ QuestSession/Store 的地理字段与 startQuest(origin:)；准备真机安装脚本 |
| 2026-11-09 06:3x | v0.2 集成完成：真实定位 + 手表双向同步 + 原生 UI 打磨三路合入；构建 SUCCEEDED |
| 2026-11-09 06:3x | Lead 集成修复：冷启动手表首帧（start(store:)）、Reveal 关闭按钮、Journey 整页滚动+高度预算（线索被遮挡）、线索文案索引错位、本周惊喜值按自然日计算（不再随时间漂移 305→325） |
| 2026-11-09 06:5x | v0.3 启动：新增 Shared/Core/Surprise.swift（BuriedSurprise / PhotoMatcher dHash / SurpriseRepository），Store 增加 burySurprise / completeSurpriseFind，3 个新成就 |
| 2026-11-09 07:0x | 公网部署：GitHub Pages（xiaoqiangch/blindwalk），https://xiaoqiangch.github.io/blindwalk/ ；PWA 可装主屏 + Service Worker 离线 |
| 2026-11-09 07:2x | surprise-dev 交付 iOS 4 文件（dHash 自检、先拍后看、重拍防刷分、底栏遮挡修复）；pwa-dev 中途失败，Lead 接手实现 Web 版 |
| 2026-11-09 08:0x | Web 全流程实测：埋（照片压缩 + dHash）→ 列表（3 条）→ 三阶线索 → 先拍后看（无原图泄露）→ 81% 匹配 → +80 结算 → 旧 8 路由无回归 |
| 2026-11-09 08:1x | 数据层加固：惊喜独立持久化（杀 App 不丢）；演示种子随真实定位重定位（异地也能看到 320m 外的惊喜） |

## 4. 关键验证记录

| 验证项 | 命令 | 结果 |
|---|---|---|
| 共享内核编译 | `xcrun --sdk macosx swiftc -typecheck Shared/Design/Theme.swift Shared/Core/*.swift` | ✅ 0 error |
| 全量 Swift 语法 | `./scripts/check-swift.sh` | ✅ ALL SWIFT FILES OK |
| Web 截图 | `node scripts/screenshot.mjs` | ✅ 9 张（8 手机 + 1 手表）390×844@2x |
| Web 交互 | `node scripts/smoke-test.mjs` | ✅ 14/14：抽盒→旅程→揭晓→收录→图鉴/圈子/成就/我的，无 JS 异常 |

### 2026-11-09 08:50 · v0.5 折叠屏适配（iPhone Duo）

| 项 | 结果 |
|---|---|
| Web 折叠态 466×678 | ✅ 矮屏压缩节奏；11 路由无溢出 |
| Web 展开态 669×951 | ✅ 双列（首页/旅程）+ 图鉴 5 列；无桌面假外框 |
| 常规 iPhone 回归 | ✅ 402×874 / 375×667 布局不变 |
| iOS 宽屏布局 | ✅ 已实现（size class + 自适应图鉴），构建通过 |
| iOS Duo 模拟器渲染 | ⚠️ headless 无法唤醒外屏（需 GUI 展开），待真机复核 |
| 公网 | ✅ 已部署 blindwalk-v5-duo |

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 本机无 Xcode，native 无法编译 | iOS/watch 代码可能残留编译错误 | 共享内核已 typecheck；UI 用保守 API；README 标注待验证项；下一步在 Xcode 环境首编 |
| Web 原型无真实定位 | 体验依赖「模拟步行」 | 演示模式显式标注「演示」；真实定位为 v0.2 |
| 设计文档与实现偏差 | 三端不一致 | 契约唯一来源 design-system.md；Lead 终审截图与文案 |
| 地点数据为虚构 | 不能直接上线 | ✅ v0.4 已接真实 POI（OSM / MapKit） |
| 折叠屏模拟器无法 headless 驱动 | iOS 宽屏布局未视觉复核 | 已实现并构建通过；需在 Xcode/DeviceHub 手动展开 Duo 复核；Web 侧已验证等价布局 |

## 6. 变更记录

- 2026-11-08 21:29 立项，确定产品名「盲走 BlindWalk」、双形态交付。
- 2026-11-08 21:35 统一演示数据口径（xp 4240 / Lv.6 黄昏猎人 / 18 张卡 / 周惊喜值 305 / 旅程 1260m 已走 780m）。
- 2026-11-08 21:36 项目从「沙箱内 workspace」定位更新：批准策略调整为 danger-full-access，交付时复制到用户真实 `~/Projects`。
