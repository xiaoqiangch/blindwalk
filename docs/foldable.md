# 折叠屏适配（iPhone Duo）

> 目标：iPhone Duo 折叠/展开两种形态都能正常用，而不是被拉成一条或错位。
> 状态：v0.5 已完成（Web PWA 全量验证；iOS 已实现，待真机/模拟器 GUI 复核）

---

## 1. 设备形态

| 形态 | 逻辑尺寸 | 特点 | 设计策略 |
|---|---|---|---|
| **折叠（外屏）** | **466 × 678 pt** | 比常规 iPhone 矮 166pt（iPhone 18 Pro 是 874pt 高） | 压缩纵向节奏：地图变矮、字号收敛、留白减少 |
| **展开（内屏）** | **669 × 951 pt** | 接近平板，横向空间充足 | 双列布局 + 内容限宽 620pt |

参考：iPhone 18 Pro = 402 × 874；iPhone SE = 375 × 667。

## 2. Web PWA 适配（已实现，已验证）

### 2.1 关键 bug：展开态被误判成「桌面预览」
原型原来用 `@media (min-width: 480px)` 切到「桌面设备外框预览」。
Duo 展开态 669pt → 会触发这个断点 → 在真机上显示一个**假的 iPhone 外框**，内容被缩到 390pt 宽。
**修复**：桌面外框只给真正的桌面；触摸设备一律全屏。

判定不依赖 `pointer: coarse`（部分环境不可靠），改为 JS 检测后加类：
```js
var coarse = matchMedia('(pointer: coarse)').matches;
var touch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
if (coarse || touch) document.documentElement.classList.add('is-touch');
```
CSS 用 `html.is-touch` 作用域，配合宽度断点。

### 2.2 展开态（≥620pt 且触摸）
- 全屏、无外框、内容最大宽度 620pt
- **首页双列**：左「盲盒主卡 + 上一次的惊喜」，右「统计 + 好友 + 惊喜社区」
- **旅程左右分栏**：左地图（填满），右「距离 + 线索」，底部按钮通栏
- **图鉴 5 列**（`grid-template-columns: repeat(5, …)`）
- 埋/寻列表两列；抽盒 sheet 限宽 620；揭晓卡限宽 460（保持「一张卡」的观感）

### 2.3 折叠态（高度 ≤720pt）
- 首页：标题 22px、主卡插图 92px、统计/好友/入口间距收紧（一屏可见主 CTA）
- 旅程：地图压到 150–200pt，距离数字 52px，按钮 42pt —— 保证「距离 + 3 条线索 + 按钮」同屏
- 图鉴 4 列；揭晓卡/抽盒 sheet 同步收紧

### 2.4 验证结果
11 个路由 × 2 种形态（466×678 / 669×951）：**全部无横向溢出、无纵向溢出、无 JS 异常**；
常规 iPhone（402×874）与 SE（375×667）回归无变化。

## 3. iOS 适配（已实现）

### 3.1 断点（`Shared/Design/Theme.swift`）
```swift
public static let wideBreakpoint: CGFloat = 600        // Duo 展开 669 走宽屏
public static let contentMaxWidth: CGFloat = 620
public static let shortHeightBreakpoint: CGFloat = 720  // Duo 折叠 678 走矮屏
public static func isWide(_ width: CGFloat) -> Bool
public static func isShort(_ height: CGFloat) -> Bool
```

### 3.2 具体改动
- **HomeView**：`horizontalSizeClass == .regular` 时双列（左主卡，右统计+好友+惊喜社区），内容限宽 620 居中
- **JourneyView**：宽屏时左右分栏（左地图 / 右距离+线索），按钮通栏限宽
- **CardsView**：`GridItem(.adaptive(minimum: 96, maximum: 132))` → 常规 3 列、展开态自动 5 列

> ⚠️ 踩坑记录：最初用 `GeometryReader` 判断宽度，导致 iPhone 18 Pro 首页白屏（SwiftUI 嵌套 GeometryReader 的布局问题）。
> 改用 `horizontalSizeClass` 后恢复正常；**不要在 ScrollView 外层再套 GeometryReader 做宽度判断**。

### 3.3 验证状态
- ✅ 构建通过（Xcode 27.2 / iOS 27.2 SDK）
- ✅ iPhone 18 Pro 回归正常（首页/图鉴/旅程截图核对）
- ⚠️ **iPhone Duo 模拟器未能在无 GUI 环境下渲染**：clang 层面无报错、进程存活，但外屏只显示背景与状态栏。
  该设备 profile 需要 Simulator/DeviceHub 的「展开/折叠」交互才能激活内屏；headless `simctl` 无法驱动。
  需在 **Xcode/DeviceHub 里手动展开 Duo 实机或模拟器**复核宽屏双列。

## 3.1 怎么看效果（四种方式）

### 方式 A：并排预览页（最快，浏览器打开即可）
👉 **https://xiaoqiangch.github.io/blindwalk/duo-preview.html**

同一份数据、两套尺寸并排：折叠 466×678 / 展开 669×951。
**iframe 里是真实运行的应用**（不是截图），顶部可切换页面（首页 / 抽盒 / 旅程 / 图鉴 / 我的），两边同步跳转。
本地文件：`prototype/web/duo-preview.html`；截图：`screenshots/duo-preview/`。

### 方式 B：在 iPhone Duo 真机上
浏览器直接打开 https://xiaoqiangch.github.io/blindwalk/ ，折叠/展开时自动切布局。
（SW 有缓存，新版需下拉刷新一次；「我的」页标题旁有版本号可核对。）

### 方式 C：Mac 浏览器模拟
Chrome → DevTools（⌥⌘I）→ 设备图标（⌘⇧M）→ Responsive → 宽度高度填 `466 × 678` 或 `669 × 951`。
触摸设备会走 `is-touch` 分支（双列/紧凑布局），**不会套桌面假手机框**。

### 方式 D：iOS 原生版（Xcode 27）
Xcode 27 用 **DeviceHub** 里的 iPhone Duo 模拟器（不再有独立 Simulator.app）：
```bash
open "/Applications/Xcode.app/Contents/Applications/DeviceHub.app"
```
选 iPhone Duo → 装 App → 运行。**折叠/展开开关在 DeviceHub 的设备控制里，需要在图形界面手动切换**——
命令行（`simctl io screenConfig`）无法唤醒外屏，这点已实测过。

## 4. 未做（后续）
- 折叠状态切换时的连续性（Duo 展开/折叠瞬间 SwiftUI 会自动 relayout，但没有做「保持地图中心/滚动位置」）
- 外屏小组件（Duo 折叠态的 cover widget 适合显示「下一个盲盒」）
- 悬停/半折叠（flex mode）下的特殊布局
