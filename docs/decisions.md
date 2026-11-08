# 关键决策记录（ADR）

## ADR-001 双形态交付：Web 原型 + SwiftUI 源码
- 背景：本机无 Xcode/iOS SDK，无法构建或运行 iOS/watchOS 模拟器。
- 决策：交付 ① 零依赖 Web 高保真原型供立即体验/评审；② 可被 XcodeGen 生成的 SwiftUI 源码作为正式实现。
- 影响：用户「看效果」看 Web；正式开发在 Xcode 环境继续，共享 Core 已可本机编译校验，降低返工。

## ADR-002 项目放在工作区 Projects/ 而非 ~/Projects
- 背景：`~/Projects` 是指向外部卷 `/Volumes/XQProjects/projects` 的软链，当前会话沙箱不允许写入；用户原有项目在外部卷。
- 决策：在 `/Users/chenxiaoqiang/.dsh/profiles/desktop/Projects/BlindWalk/` 创建项目；提供 `scripts/export-to-xqprojects.sh` 供用户批准后复制到外部卷。
- 影响：项目可立即读写、版本可控；迁移只需一次复制。

## ADR-003 目的地保密 = 不接真实地图
- 决策：两端都用抽象手绘街区（Web SVG / SwiftUI Canvas），只显示方向、距离、路线，不显示终点标记。
- 理由：产品核心是「不知道去哪」的仪式感；同时规避地图 SDK 依赖与 POI 真实性问题。

## ADR-004 本地优先，社交 mock
- 决策：MVP 无后端；好友/榜/同频均本地 mock，同频码真实生成但加入为模拟。
- 理由：原型验证体验，不验证网络；接入成本后置。

## ADR-005 视觉方向：黄昏旧地图 / 奶油纸 + 琥珀光
- 决策：不做科技蓝、玻璃拟态；用牛皮纸、暖光、手写标签、纸张纹理建立「被晒旧的温柔感」。
- 理由：与「孤独的人的小惊喜」气质一致，区别于泛运动/地图 App。

## ADR-006 分享与安全
- 决策：MVP 不展示用户真实位置给他人；分享只分享地点卡与文字。真实版本上线前补齐安全分级与隐私政策。
