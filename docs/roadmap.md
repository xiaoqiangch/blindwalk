# 路线图

## v0.1 原型（本次，2026-11-08）
- Web 高保真可交互原型（iPhone + Watch 预览）
- SwiftUI iOS/watchOS 源码工程（可配置 XcodeGen 生成，待 Xcode 构建）
- 设计系统 / PRD / 架构文档
- 演示截图 + 体验说明

## v0.2 可上真机（下一步）
- 装 Xcode 后修编译、真机跑通 GPS + 后台定位
- CoreLocation 地理围栏替代距离阈值；后台唤醒 + 本地通知
- WatchConnectivity 实时同步；手表独立开盒
- App 图标 / 启动图 / TestFlight 打包

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
