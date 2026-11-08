# 项目进度看板（Super Agent 协作）

> 维护：Lead。每次里程碑完成后更新。
> 工作目录：`/Users/chenxiaoqiang/.dsh/profiles/desktop/Projects/BlindWalk`
> 最终同步位置：`~/Projects/BlindWalk`（外部卷 `/Volumes/XQProjects/projects/BlindWalk`）

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
| task-1 | Web 高保真交互原型 | proto-dev | 进行中 | 9 路由直达、闭环可走、`?demo=1`、截图友好、无外部依赖 |
| task-2 | iOS SwiftUI App（8 页） | ios-dev | 进行中 | 与 design-system §5.1–5.8 对应、swiftc -parse 通过 |
| task-3 | watchOS SwiftUI App（4 界面 + 触感） | watch-dev | 进行中 | §5.9 对应、WCSession 骨架、swiftc -parse 通过 |
| — | 共享内核 + 工程配置 | Lead | ✅ 完成 | Core typecheck 通过、project.yml 就绪 |
| — | 校验/截图/展示图 | Lead | 待开始 | check-swift.sh + screenshot.sh + showcase.png |
| — | 同步到 ~/Projects | Lead | 待开始 | rsync 到外部卷 |

## 3. 里程碑

| 时间 | 事件 |
|---|---|
| 2026-11-08 21:29 | 环境侦察：无 Xcode/iOS SDK；`~/Projects` 外部卷；决定双形态交付 |
| 2026-11-08 21:31 | 项目骨架 + PRD + 设计系统 + 架构/路线图/ADR |
| 2026-11-08 21:36 | 共享内核（Models/Catalog/Engine/Session/Achievements/Social/Store）+ project.yml 完成，Core typecheck 通过 |
| 2026-11-08 21:37 | 任务板建立，proto-dev / ios-dev / watch-dev 三路并行启动 |
| 2026-11-08 21:4x | Lead：Swift 校验脚本 / 截图脚本 / 展示图脚本 |
| 2026-11-08 22:0x | 集成：代码审查、截图、展示图、README 定稿 |
| 2026-11-08 22:1x | 同步到 ~/Projects/BlindWalk，交付用户 |

## 4. 关键验证记录

| 验证项 | 命令 | 结果 |
|---|---|---|
| 共享内核编译 | `xcrun --sdk macosx swiftc -typecheck Shared/Design/Theme.swift Shared/Core/*.swift` | ✅ 0 error |
| 全量 Swift 语法 | `./scripts/check-swift.sh` | 记于验收时 |
| Web 截图 | `./scripts/screenshot.sh` | 记于验收时 |
| Web 交互 | Chrome 走查 抽盒→走→揭晓→收录→分享→成就 | 记于验收时 |

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 本机无 Xcode，native 无法编译 | iOS/watch 代码可能残留编译错误 | 共享内核已 typecheck；UI 用保守 API；README 标注待验证项；下一步在 Xcode 环境首编 |
| Web 原型无真实定位 | 体验依赖「模拟步行」 | 演示模式显式标注「演示」；真实定位为 v0.2 |
| 设计文档与实现偏差 | 三端不一致 | 契约唯一来源 design-system.md；Lead 终审截图与文案 |
| 地点数据为虚构 | 不能直接上线 | 文档标注；v0.3 接真实 POI + 安全分级 |

## 6. 变更记录

- 2026-11-08 21:29 立项，确定产品名「盲走 BlindWalk」、双形态交付。
- 2026-11-08 21:35 统一演示数据口径（xp 4240 / Lv.6 黄昏猎人 / 18 张卡 / 周惊喜值 305 / 旅程 1260m 已走 780m）。
- 2026-11-08 21:36 项目从「沙箱内 workspace」定位更新：批准策略调整为 danger-full-access，交付时复制到用户真实 `~/Projects`。
