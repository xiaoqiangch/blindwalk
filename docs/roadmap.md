# 路线图

## v0.1 原型（本次，2026-11-08）
- Web 高保真可交互原型（iPhone + Watch 预览）
- SwiftUI iOS/watchOS 源码工程（可配置 XcodeGen 生成，待 Xcode 构建）
- 设计系统 / PRD / 架构文档
- 演示截图 + 体验说明

## v0.2 可上真机（进行中）
- [x] Xcode 27.2 安装、iOS/watchOS 构建通过
- [x] iPhone 18 Pro 模拟器跑通 6 屏；Apple Watch Series 9 模拟器跑通 4 屏
- [x] 真实 CoreLocation 定位链路（Best 精度 / 5m 滤波 / heading 朝向 / 三态降级）
- [x] WatchConnectivity 双向同步（摘要推送 + 手表打卡回传，端到端实测通过）
- [x] 原生 UI 对齐 Web 高保真原型（10 个文件重写，含 iOS 27 浮动玻璃 TabBar 兜底）
- [ ] 真机跑通 GPS + 后台定位（需 Xcode 登录 Apple ID + 手机开发者模式）
- [ ] 后台唤醒 + 本地通知（Always 授权升级开关）
- [ ] App 图标 / 启动图 / TestFlight 打包

## v0.3 社交
- Sign in with Apple + Supabase/Firebase 后端
- 真实好友、同频房间、动态审核、举报
- 真实地点库（高德/Apple Maps POI）+ 安全分级（夜间只推公共场所）
- 分享卡片生成图片（ShareLink）

## v0.4 留存与商业化
- 每日一盒、季节限定隐藏款、城市联名
- 会员：更多抽盒次数 / 隐藏款概率
- 线下合作：咖啡馆/书店核销券（B 端）

## 待办（原型已知缺口）
- [ ] 本机无 Xcode：iOS/watchOS 未经完整编译
- [ ] 地点数据为虚构演示数据，非真实 POI
- [ ] 无账号/服务端，社交为本地 mock
- [ ] 语音/音效未实现（仅设计）
