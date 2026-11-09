# 盲走 BlindWalk · HarmonyOS 移植

> 状态：v0.6 移植开发中（2026-11-09）
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
│   ├── contract.ts      UI↔逻辑 调用契约（对应 @Observable BlindWalkStore 的公开面）
│   ├── geo.ts           Haversine 距离 / 方位角 / 按方位偏移
│   ├── catalog.ts       24 个内置地点（对应 PlaceCatalog.swift）
│   ├── engine.ts        种子随机 + 抽盒权重 + 序列号 + 心情亲和
│   ├── session.ts       旅程状态机（线索阈值 400/200/60、到达 30m）
│   ├── surprise.ts      dHash 感知哈希 + 汉明距离 + 复刻判定
│   ├── achievements.ts  成就判定
│   ├── demo.ts          演示数据（口径与 Web/iOS 一致）
│   ├── social.ts        圈子动态 + 排行榜
│   ├── store.ts         编排：抽盒/推进/揭晓/收录/埋寻/持久化
│   └── persistence.ts   KeyValueStore（HarmonyOS 端注入 @ohos.data.preferences）
├── theme/Theme.ets      设计 token（奶油底 / 琥珀主色 / 圆角 / 字号）
├── pages/Index.ets      Tab 外壳
├── views/               7 个界面：Home / SetupSheet / Journey / Reveal / Cards / Social / Profile
├── components/          共享小组件
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

最近一次运行（2026-11-09 09:5x）：

```
1. tsc -p tsconfig.test.json --noEmit   → 0 error
2. npm test                             → 39/39 通过
3. ArkTS 静态检查（20 个 .ets）           → 0 error
    ✅ import 路径  ✅ ArkTS 严格模式  ✅ ForEach key
    ✅ @Entry 注册  ✅ 资源引用       ✅ 保密规则  ✅ 工程契约
```

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

代码里已标 `⚠️ 待 DevEco 验证` 的共 5 处（都是 API 签名层面，写法取了官方文档最保守的形式）：

| 文件 | 待验证内容 |
|---|---|
| `entryability/EntryAbility.ets` | `windowStage.loadContent` 回调签名、`setWindowBackgroundColor` |
| `components/Location.ets` | `geoLocationManager.getCurrentLocation` / `on('locationChange')` 的 API 12 写法 |
| `components/PreferencesKV.ets` | `@kit.ArkData` 的 `preferences.getSync / putSync / deleteSync` 签名 |
| `components/AbstractMap.ets` | `CanvasRenderingContext2D` 的字体与 `lineDash` 写法 |
| `components/Async.ets` | `@kit.BasicServicesKit` 的 pasteboard 导入方式 |

首次编译报错大概率集中在这 5 处，改起来都是机械调整。其余（组件树、装饰器、状态管理）是按 ArkTS 规范写的。

## 8. 立即可测的替代路径（今晚就能用）

鸿蒙浏览器（华为浏览器）内核是 Chromium，**现有 PWA 可以直接在鸿蒙手机上跑**：

1. 鸿蒙手机用「浏览器」打开 https://xiaoqiangch.github.io/blindwalk/
2. 菜单 → 添加到桌面
3. 从桌面启动，允许定位，即可体验真实街道 + 真实距离

这条路径已经把「真实地理 + 埋惊喜」全流程跑通，可以用来**先验证产品体验**，再决定原生版要不要继续深做。

---

## 9. 路线图

| 版本 | 内容 |
|---|---|
| v0.6（本轮） | 工程骨架 + 逻辑层（含测试）+ 7 个主界面 + 真实定位 |
| v0.7 | 埋惊喜 / 寻惊喜界面（相机 + 相册 + dHash 取图）、震动反馈 |
| v0.8 | 华为账号登录、云同步、桌面卡片（服务卡片显示「下一个盲盒」） |
| v0.9+ | 折叠屏/平板适配（GridRow 断点）、深色模式、无障碍 |
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
