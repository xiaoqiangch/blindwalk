# iOS 版测试报告（2026-11-13）

环境：Xcode 27.2 / iOS 27.2 SDK / iPhone 18 Pro 模拟器 / 定位设为南京金银街 32.0597,118.7713

## 1. 构建

```bash
xcodebuild -project apple/BlindWalk.xcodeproj -scheme BlindWalk \
  -destination 'platform=iOS Simulator,id=34802F5B-…' \
  -derivedDataPath /tmp/bw-dd-t4 CODE_SIGNING_ALLOWED=NO build
→ ** BUILD SUCCEEDED **
```

> ⚠️ 踩坑记录：**不要重新跑 `xcodegen generate`**。xcodegen 2.44.1 生成的工程里
> `PRODUCT_NAME` 为空、`SUPPORTED_PLATFORMS` 落到 `macosx`，导致
> "iPhone's iOS platform doesn't match .app's supported platforms"。
> 用 git 里的 pbxproj（`git checkout -- apple/BlindWalk.xcodeproj/`）可直接构建。

## 2. 页面走查（截图 `screenshots/ios-test/`）

| 页面 | 结果 | 备注 |
|---|---|---|
| 首页 `01-home.png` | ✅ | 冷调配色、盲盒卡、统计、惊喜社区入口正常 |
| 图鉴 `02-cards.png` | ✅ | 「附近的惊喜」3 条提示 + 卡片网格 + 锁定卡 |
| 旅程 `03-journey.png` | ✅ | 演示模式抽象地图、480 米、进度条、三阶线索 |
| 我的 `03-profile.png` | ✅ | 等级卡、成就、音效/朝向开关、账号卡片 |
| 圈子 / 揭晓 | 待补 | 预览路由未覆盖 |

## 3. 与鸿蒙的一致性

| 功能 | Web | iOS | 鸿蒙 | 结论 |
|---|---|---|---|---|
| 图鉴附近惊喜（独立区块） | ❌ 已改网格 | ✅ | ✅ | iOS = 鸿蒙 ✅ |
| 迷雾路径 | ✅ | ✅ | ✅ | 一致 |
| 三档搜索 / 距离硬帽 | ✅ | ✅ | ✅ | 一致 |
| 失败面板（不编造地点） | ✅ | ✅ | ✅ | 一致 |
| 账号（登录/同步/恢复） | ✅ | ✅ | ✅ | 一致 |
| 地图朝向开关 | ✅ | ✅ | ✅ | 一致 |
| **网格内嵌惊喜卡** | ✅ | ❌ | ❌ | **iOS = 鸿蒙**（两端都还没做） |
| **跨用户惊喜 API** | ✅ | ❌ | ❌ | **iOS = 鸿蒙**（两端都还没做） |

**结论：iOS 与鸿蒙当前功能完全一致。** 两端同时落后于 Web 的两项是
「网格内嵌惊喜卡」和「惊喜服务端共享」，属于同一批待做工作。

## 4. 本轮修的问题

| 问题 | 修复 |
|---|---|
| 「我的」页出现**两个账号入口**（上方卡片 + 设置列表里的「账号」行） | 删除设置列表里重复的行，只保留上方显眼卡片 |
| 重新跑 xcodegen 导致工程无法构建 | 已在报告中记录，构建时不要重跑 xcodegen |

## 5. 待做（两端同步）

1. 图鉴网格内嵌惊喜卡（锁 + 提示词 + 距离），替代独立区块
2. 惊喜服务端共享（`/api/surprises` 拉取 + 埋时上传 + 找到后认领）
3. iOS 「这样拍一张」已有相机；鸿蒙仍缺（相机 + dHash）
