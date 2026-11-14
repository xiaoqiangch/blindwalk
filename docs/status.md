# 项目进度看板（Super Agent 协作）

> 维护：Lead。每次里程碑完成后更新。
> 项目主目录：`/Users/chenxiaoqiang/Projects/Walkaholic`（外部卷 `/Volumes/XQProjects/projects/Walkaholic`）
> 会话内相对路径：`Projects/Walkaholic`（软链，指向主目录）

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
| task-1 | Web 高保真交互原型 | proto-dev | ✅ 完成 | 9 路由直达、闭环可走、``、截图友好、无外部依赖 |
| task-2 | iOS SwiftUI App（8 页） | ios-dev | ✅ 完成 | 13 文件 4032 行，与 §5.1–5.8 对应，parse 全过 |
| task-3 | watchOS SwiftUI App（4 界面 + 触感） | watch-dev | ✅ 完成 | 8 文件 873 行，§5.9 对应，WCSession 骨架 + 触感 |
| task-4 | 真实定位 CoreLocation + 旅程页 | gps-dev | ✅ 完成 | 三态降级；模拟器真 GPS 实测 480→49m 自动开盒 |
| task-5 | iOS→watchOS 实时同步 | sync-dev | ✅ 完成 | 端到端实测：推送→手表 UI 变化→打卡回传 |
| task-6 | iOS 原生 UI 打磨 | polish-dev | ✅ 完成 | 10 文件重写，对齐 Web 原型；构建 + 截图逐屏自检 |
| task-7 | iOS 埋惊喜/寻惊喜 | surprise-dev | ✅ 完成 | 4 新文件，dHash 实拍对比，先拍后看的代码级保证 |
| task-8 | Web PWA 埋惊喜/寻惊喜 | pwa-dev（失败）/ Lead 接手 | ✅ 完成 | dHash + 拍照压缩 + 三阶线索 + 对比结算，全流程实测 |
| — | 共享内核 + 工程配置 | Lead | ✅ 完成 | Core typecheck 通过、project.yml 就绪 |
| — | 校验/截图/展示图 | Lead | ✅ 完成 | check-swift + CDP 截图 + smoke test + showcase.png |
| — | 迁移到 ~/Projects | Lead | ✅ 完成 | 主目录 = /Users/chenxiaoqiang/Projects/Walkaholic，工作区留软链 |

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
| 2026-11-08 22:0x | 同步到 ~/Projects/Walkaholic，交付用户 |
| 2026-11-08 22:0x | 用户要求安装 Xcode + 迁移项目：项目主目录更新为 ~/Projects/Walkaholic（工作区软链） |
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
| 2026-11-09 07:0x | 公网部署：GitHub Pages（xiaoqiangch/walkaholic），https://xiaoqiangch.github.io/walkaholic/ ；PWA 可装主屏 + Service Worker 离线 |
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
| 公网 | ✅ 已部署 walkaholic-v5-duo |

### 2026-11-09 09:55 · v0.6 鸿蒙移植（HarmonyOS NEXT）

| 项 | 结果 |
|---|---|
| 工程骨架（DevEco 标准结构 / AppScope / module.json5 / 权限 / 图标） | ✅ |
| 逻辑层（geo / engine / session / dHash / 成就 / store / 持久化） | ✅ 39/39 单元测试通过 |
| 独立复核（Lead 自写脚本，不依赖队友测试） | ✅ 15 项全过 |
| ArkUI 界面 7 页 + 8 组件（4206 行） | ✅ 静态检查通过，待 DevEco 首编 |
| 修掉的保密漏洞 | ✅ 到达前 `why`/`task` 会泄露地点特征，已清空并补测试 |
| 本地可跑校验 | `bash scripts/check-harmony.sh` |

### 2026-11-09 10:30 · 修复自动到达 + 公开数据兴趣点与图片

| 项 | 结果 |
|---|---|
| 「没动就自动到达」bug | ✅ 修复（真实距离反向坍缩 + 基线不匹配 + 单次漂移即可到达，三处叠加） |
| 维基百科兴趣点 + 实景图片 | ✅ 已接（公开数据、无 Key、CORS 全开） |
| 原地不动 / 定位跳变 / 真正走到 | ✅ 三种场景实测通过 |
| 公网验证 | ✅ 上海音乐厅、国际饭店、上海博物馆等真实地标 + 图片 |
| 顺带修复 | watch 不推初始值、瞬时错误停跟踪、进度不落盘 |

### 2026-11-09 10:45 · v0.8 兴趣点管理后台（Agent Teams 双流并行）

| 项 | 结果 |
|---|---|
| 后台服务端（零依赖 Node，51 项测试） | ✅ 51/51 通过；真实抓取 6 个地标全部带图 |
| 管理界面（三栏 + AI 操作台，零依赖原生 JS） | ✅ 真实 API 联调通过（6 条真实 POI 可编辑） |
| 公开数据收集 | ✅ 中文维基 geosearch + OSM Overpass 双源，去重/过滤/类别推断 |
| 大模型能力 | ✅ 整理/编辑/分析/批量分析；**无 Key 时降级离线规则模式**（不假装 AI） |
| 导出 → App 消费 | ✅ `/api/export` → `prototype/web/pois.json`；App 优先使用（`source: curated`） |
| Agent Teams 组织 | ✅ 契约先行（`admin/docs/CONTRACT.md`），服务端/前端两条并行，Lead 只做契约+集成+验收 |

### 2026-11-09 10:55 · 修复：仍是模拟数据 / 两端不一致

| 项 | 原因 | 处理 |
|---|---|---|
| 开出来一直是演示地点 | 安装卡二维码带 `?demo=1`，且 demo 种子会持久化 | 二维码去参数；demo/fresh 只在当次生效并从 URL 移除；首页加「这是演示数据」提示 + 一键切真实定位 |
| Mac 与鸿蒙显示不同 | 桌面端套了假手机外框（390×844 缩放），手机端全屏 | 桌面统一为同一布局，最大宽度 460px 居中，不再套壳 |
| 难以自查原因 | 没有可对比的信息 | 新增诊断页（我的 → 诊断 / `#/debug`）：启动模式、数据来源、定位权限/精度、窗口、存档 |

### 2026-11-09 11:20 · v2 后台（SQLite + 登录 + 安全分级）+ iOS 接入策展 POI

两条 Agent Teams 工作流并行完成：

| 项 | 结果 |
|---|---|
| 后台存储升级 SQLite（`node:sqlite`，零依赖） | ✅ 迁移 6 条一致，原 JSON 改名备份，WAL |
| 登录鉴权（scrypt + HttpOnly Cookie + 12h 会话 + 限流） | ✅ 未登录 401/302，登录 200，登出 401，第 6 次 429 |
| 安全分级 / 夜间可达性（`safety.day/night/nightVerdict`） | ✅ 人民公园 夜1/avoid；24h 便利店 夜4/ok；导出带 safety |
| 后台测试 | ✅ **67/67 通过**（原 51 + 新增 16） |
| iOS 接入策展 POI（策展优先 → MapKit → 内置） | ✅ 构建通过，模拟器抽到上海博物馆（source=curated, photo=true） |
| iOS 揭晓实景照片 + 编辑精选标记 | ✅ 截图验证，图片来源署名 |
| iOS 断网/坏 URL 降级 | ✅ 冷启动走 MapKit；热缓存用 UserDefaults 兜底 |
| 图鉴/首页辨认策展卡片 | ✅ Lead 补上合并逻辑（`AdminPOIService.place(for:)`），构建通过 |

### 2026-11-09 11:45 · 旅程导航改造：去掉地图 + 转向提前量

| 项 | 结果 |
|---|---|
| 移除手绘地图（旅程页） | ✅ 地图完全移除，遮住目的地的风险也随之消失 |
| 步行转向导航（Valhalla 公共实例，无需 Key） | ✅ 690m 路线、58 个路线点、10 个转向点 |
| 提前量 | ✅ 45 米内提示「X 米后左拐」，12 米内变「现在左拐」，≤25 米高亮 |
| 接下来两步预览 | ✅ 「接下来：左拐 28m / 右拐 167m / 右拐 188m」 |
| 走错路 / 无路由服务 | ✅ 偏离 80m 重算（限频）；服务不可用退回「往西走，还有 N 米」 |
| 视觉 | ✅ 面板贴片式卡片，动作条固定在底部 |

### 2026-11-09 11:50 · 策展数据补南京（用户实际地址）

| 项 | 结果 |
|---|---|
| 问题 | 后台策展 POI 是用「上海人民广场」坐标抓的，用户在南京只能抽到自动抓取的临时点 |
| 修复 | 按用户地址（南京市鼓楼区金银街16号 → 32.05975,118.77130）抓取并审核 7 条南京真实地点 |
| 南京策展点 | 赛珍珠故居 / 南京鼓楼 / 紫峰大厦 / 先锋书店 / 南京师范大学 / 崇實大學 / 国民政府外交部旧址，全部带 Wikimedia 图片 |
| 抽取验证 | 在金银街坐标连抽 5 次：4 次抽到南京策展点（赛珍珠故居 326m、崇實大學 534m、南师大 763m、外交部旧址 788m） |
| 新工具 | `scripts/ingest-address.sh "<地址>" [半径]` —— 任意城市按地址抓取（地址→坐标→抓取→去重） |
| 诊断增强 | 诊断页新增「当前坐标」「最近一次抽到（含来源）」 |

### 2026-11-09 13:00 · 导航重构 v2：单一口径

| 问题（用户反馈） | 修法 |
|---|---|
| 两个数字矛盾 | 全页只保留一个距离数字（沿路线剩余），线索与「接下来」同源 |
| 箭头不准 | 只保留一个箭头＝下一步动作；无路线时不画箭头 |
| 更新周期不对 | 局部刷新（600ms 节流）；线索解锁/到达才整页重渲染 |
| 提示在阈值附近跳 | 转向滞回：喊过「现在左拐」后走过转向点 8 米才换 |
| 「接下来」走一段后不变 | 已跟着刷新；无后续转弯时显示「一路直走到目的地」（不重复数字） |
| 线索解锁后图标不变 | 解锁数量变化时整页重渲染 |

实测（南京金银街 → 紫峰大厦 878m 路线）：剩余里程单调递减；三处距离一致；箭头与文案匹配；无 JS 异常。

### 2026-11-09 14:00 · 修复「直接揭晓无效 / 照片不显示 / 仍抽到虚构地点」

| 问题 | 根因 | 修法 |
|---|---|---|
| 「走累了？直接揭晓」无效 | 按钮 action 还是 `walk`，执行的是「模拟步行 +50m」 | 改为独立 action `reveal-now`，直接进入到达态 |
| 揭晓照片不显示 | Wikimedia 缩略图要 2~4 秒才加载完，期间纯空白；无失败兜底 | 到达时**预加载**；卡片加「照片加载中」骨架；7 秒失败显示占位 + 重新加载 |
| 仍抽到虚构地点 | 定位失败时**静默**退回内置演示地点；旧桌面图标还带 `?demo=1` | 定位失败改为显式阻断面板（重试 / 手动输入位置 / 明确选择演示）；启动时自动清掉演示存档 |
| 类别文案错乱（如鼓楼显示「广场」） | `CATEGORY_META` 缺 `historic/museum/venue`，回落到 plaza | 补齐三类 + 对应线索模板 |

新增能力：**手动输入位置**（地址 → Nominatim/Photon 坐标 → 照常抽真实地点），GPS 不可用时也能玩。

公网验证：南京金银街 → 抽到「南京赛珍珠故居」(curated) → 直接揭晓 → 照片 960px 正常显示 → 「老城区 · 老房子 · 真实地点」文案一致。

### 2026-11-09 14:20 · 鸿蒙上「直接揭晓」无效 → 缓存与可点性修复

| 项 | 结果 |
|---|---|
| 复现 | devtools 触摸事件点击 `reveal-now` → 正常进入 `#/reveal`（本地 + 公网均通过） |
| 判断 | 鸿蒙端极可能仍在跑旧缓存（旧版按钮 action 是 `walk`，只会「模拟步行 +50m」） |
| 机制修复 | SW 主动 `update()` + `updateViaCache: 'none'`；新版本接管时自动刷新（走路/揭晓途中挂起到首页） |
| 自助修复 | 我的 → 诊断 → **「强制更新到最新版」**（清缓存+注销 SW+重开） |
| 版本可见 | 我的页标题旁显示版本号；诊断页显示「页面版本 / SW 缓存版本 / 是否最新」 |
| 可点性加固 | 按钮 `touch-action: manipulation`；底部操作条 `z-index` + 安全区 padding |
| 兜底 | `reveal-now` 1.8 秒未揭晓则强制走一次，不再“点了没反应” |
| 布局修复 | 照片「加载中」占位与图片不再同时占高（卡片被撑出屏幕） |

### 2026-11-09 15:20 · 多数据源 POI + 个人账号

| 项 | 结果 |
|---|---|
| POI 多数据源模块（providers.js，922 行） | ✅ 14/14 测试；高德/百度 JSONP（BYOK）+ OSM/维基；坐标统一 WGS-84 |
| 接入抽盒流程 | ✅ 策展优先 → 多数据源（6s 硬截止）→ 旧链路兜底；苏州实测抽到维基地标 760m |
| 数据源设置页（我的 → 数据源） | ✅ 填 Key、状态、上次抓取报告、当前位置测试 |
| 账号服务（account/，Node+SQLite） | ✅ 19/19 测试；注册/登录/退出/资料同步/恢复/删号；CORS+Cookie |
| 客户端账号页（我的 → 账号） | ✅ 端到端验证：注册→同步 4.4KB→退出→登录→恢复（18 卡 / xp 4240） |
| 混合内容处理 | ✅ HTTPS 页面连 http 账号服务时，界面直接说明原因与两种解法 |

### 2026-11-09 16:45 · 地图 Key 改为后台统一管理

| 项 | 结果 |
|---|---|
| 后台 Key 管理 | ✅ `app_keys` 表 + 掩码回显 + 保存/测试/清除；`node --test admin/tests/` 75/75 |
| 真实高德 Key | ✅ 后台测试连接 `count:16`；浏览器实抓 12–25 条 POI |
| 客户端 | ✅ 启动自动加载（`mapkeys.json` → 后台端点 → 免费源），**用户不再看到 Key 输入框** |
| 公开分发端点 | ✅ CORS 白名单（Pages + localhost）+ `no-store`，非白名单 403 |
| 部署 | ✅ 部署脚本从后台 DB 生成 `mapkeys.json` 注入 gh-pages 快照；**主仓无 Key** |
| 商业 POI 过滤 | ✅ 排除快递柜/美容/中介/停车场等；百科/OSM/有图类别加权 |

### 2026-11-09 16:50 · 改名「步迷」+ 字号整体放大

| 项 | 结果 |
|---|---|
| 应用名 | Web / PWA manifest / 手表页 / 鸿蒙资源 / iOS Info.plist / 后台标题 全部 → **步迷** |
| 字号 | 全文 180 处字号上调（8–17px 档整体 +2px 左右，18px+ 展示型数字不变） |
| 适配 | 新增第 36 节：状态胶囊单行可横滚、卡片标题两行、设置项行高 |
| 溢出检查 | 390×844 与 669×951 下 7 个页面均无横向溢出 |
| 演示模式 | 旅程页不再显示空的路径卡（只有真实会话才渲染） |

### 2026-11-09 17:40 · 正式定名「步迷 Walkaholic」

| 项 | 结果 |
|---|---|
| 名称含义 | 步（走路）+ 谜（不知道目的地），谐音「不明」；英文 Walkaholic，口号「用脚解谜」 |
| 全平台改名 | Web / PWA manifest / 手表页 / 鸿蒙资源 / iOS + watchOS 显示名与权限文案 / 后台标题 / 文档 |
| 兼容 | 内部代号、bundle id、工程名、目录名仍为 Walkaholic（不改，避免破坏构建与已装应用） |
| 验证 | iOS `BUILD SUCCEEDED` + 产物 `CFBundleDisplayName=步迷`；鸿蒙检查通过；冒烟测试通过 |
| 公网 | `walkaholic-v28-bumi` |

### 2026-11-09 23:40 · 三端功能对齐（Web v33 / iOS / HarmonyOS）

| 功能 | Web | iOS | HarmonyOS |
|---|---|---|---|
| 真实 POI 多源（高德/百度/OSM/维基） | ✅ | ✅ | ✅ |
| Key 后台下发（不写死、不让用户填） | ✅ | ✅（构建时注入，**不进 git**） | ✅ |
| 三档放宽 + 质量门槛 + 距离硬帽 | ✅ | ✅ | ✅ |
| 真实模式失败面板（不编造） | ✅ | ✅ | ✅ |
| 迷雾路径视图 | ✅ | ✅（Canvas） | ✅（Canvas） |
| 账号登录/同步/恢复 | ✅ | ✅ | ✅ |
| 字号对齐 | ✅ | ✅ | ✅ |
| 名称「步迷」 | ✅ | ✅ | ✅ |

**跨端联调发现的真实 Bug（三端都修了）**：
1. 高德 `keywords=公园|博物馆|…` 整串传 → `status=1` 但 `count=0` 的**静默空结果**。改为逐词查询（限 2–3 个，间隔 120ms 控 QPS）
2. 原生 HTTP 客户端缺 `User-Agent` → 维基/Overpass 返回 403/406（浏览器自动带 UA，原生不带）
3. 类别判定顺序：名称优先，维基只信标题（避免简介提到"公园"就被判成公园）
4. 去重时跨 POI 借类别（餐厅借走隔壁寺庙的 temple）→ 只在同名时互补
5. 鸿蒙 rawfile 逐字节 `fromCharCode` → UTF-8 中文乱码，改用 `util.TextDecoder`

**测试**：Web 冒烟 ✅ · providers 14/14 · admin 75/75 · account 19/19 · Harmony 100/100（原 39）· ArkTS 25 文件 0 error · iOS BUILD SUCCEEDED

**Key 安全**：iOS 的 `mapkeys.json` 由 `scripts/inject-ios-mapkeys.sh` 从后台 DB 生成，已 gitignore；后台 DB 也不进仓库。主仓无任何真实 Key。

### 2026-11-10 08:10 · GPS 实时性 + 地图跟随转身 + 冷调换肤

| 项 | 结果 |
|---|---|
| GPS 刷新慢 | 根因：`watchPosition` 在部分浏览器/WebView 只推一次；Web 改为**每 1.8s 主动 getCurrentPosition**（maximumAge 0），导航文本刷新节流 600→350ms；iOS 加定位看门狗（5s 无回调主动 requestLocation）；鸿蒙加 3s 轮询兜底 |
| 地图不跟着转身 | 根因：迷雾路径用**路线方向**朝上。改为**设备罗盘**朝上：Web（deviceorientationabsolute / iOS webkitCompassHeading，大角度直接跟上，小角度低通）、iOS（CLLocationManager heading → FogFrame.upBearing）、鸿蒙（@ohos.sensor ORIENTATION → fogGeometry upBearing） |
| 配色 | 从暖褐奶油 → **冷调近白 + 靛蓝主色 + 薄荷/珊瑚/紫罗兰点缀**；三端 token 同步，清掉所有残留暖色（含盒体插画、卡片渐变、缩略图底色） |
| 验证 | Web 模拟行走：12 次移动全部在 ~1.5s 内更新；转向 90° 指北针立即旋转；iOS BUILD SUCCEEDED + 装两台模拟器；鸿蒙 101/101 + 25 文件 0 error |

### 2026-11-10 10:20 · 完整版部署到自有服务器

| 项 | 结果 |
|---|---|
| 服务器 | xqlounge.top（Ubuntu 24.04 / 1.6G 内存 / 9G 空闲） |
| 运行时 | Node 22.23.4 + nginx 1.24 + certbot（Let's Encrypt，自动续期） |
| Web | https://xqlounge.top/ 200，Service Worker 正常，mapkeys.json 已注入 |
| 账号 | 同源 `/api/*`，注册/登录/同步实测通过；数据 `/var/lib/walkaholic/account/` |
| 后台 | `/admin/`（nginx 剥前缀），登录/POI/地图 Key 实测通过；数据 `/var/lib/walkaholic/admin/` |
| 客户端 | 同源自动识别账号地址；iOS/鸿蒙默认账号地址改为 https://xqlounge.top |
| 部署脚本 | `scripts/deploy-server.sh`（幂等，含权限修正、systemd、nginx、certbot、验证） |

### 2026-11-10 20:45 · 图鉴「附近惊喜隐晦提示」三端完成

| 端 | 状态 |
|---|---|
| Web | ✅ v46（`nearbyHintsHTML` + `start-seek-journey`）|
| iOS | ✅ 已构建安装（`nearbyHintsSection` + `SeekSurpriseView(focusID:)`）|
| 鸿蒙 | ✅ 26 文件 0 error / 117 测试（`core/hints.ts` + `SeekPanel.ets`）|

**保密设计（三端统一）**：提示卡只给「距离粗档 + 通用氛围句 + emoji」，不含地名 / 作者昵称 / 照片 / 坐标 / 精确米数。
鸿蒙额外加了静态守卫：直接读 `areaWord`/`photoUri`/`photoHash`/`authorName` 会报错，且每道防线都做了变异测试。

**顺带修复**：`geoDistance()` 只读 `b.lng`，而定位回调给的是 `lon` → NaN → 所有惊喜距离显示「位置未知」。已兼容三种字段名。

**已知缺口**：鸿蒙的「这样拍一张」（相机 + dHash 对比）和埋惊喜 UI 尚未移植；`.hap` 需 DevEco 才能编译验证。

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 本机无 Xcode，native 无法编译 | iOS/watch 代码可能残留编译错误 | 共享内核已 typecheck；UI 用保守 API；README 标注待验证项；下一步在 Xcode 环境首编 |
| Web 原型无真实定位 | 体验依赖「模拟步行」 | 演示模式显式标注「演示」；真实定位为 v0.2 |
| 设计文档与实现偏差 | 三端不一致 | 契约唯一来源 design-system.md；Lead 终审截图与文案 |
| 地点数据为虚构 | 不能直接上线 | ✅ v0.4 已接真实 POI（OSM / MapKit） |
| 后台单用户、无审计日志 | 多人协作受限 | v2 已加登录；审计/多用户列入 v3 |
| 本机无大模型 API Key | 后台模型能力无法实测 | 已实现离线规则降级并在 UI 明示；用户配置 Key 后即为真实模型（见 admin/docs/SETUP-LLM.md） |
| 本机无 DevEco Studio / hvigor | 鸿蒙 UI 未经真实编译 | 逻辑层用 tsc+Node 校验；ArkTS 侧写静态检查脚本；5 处 API 签名标 `待 DevEco 验证`，首编按错误清单机械调整 |
| 折叠屏模拟器无法 headless 驱动 | iOS 宽屏布局未视觉复核 | 已实现并构建通过；需在 Xcode/DeviceHub 手动展开 Duo 复核；Web 侧已验证等价布局 |

## 6. 变更记录

- 2026-11-08 21:29 立项，确定产品名「步迷 Walkaholic」、双形态交付。
- 2026-11-08 21:35 统一演示数据口径（xp 4240 / Lv.6 黄昏猎人 / 18 张卡 / 周惊喜值 305 / 旅程 1260m 已走 780m）。
- 2026-11-08 21:36 项目从「沙箱内 workspace」定位更新：批准策略调整为 danger-full-access，交付时复制到用户真实 `~/Projects`。
