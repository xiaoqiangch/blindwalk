# 盲走 BlindWalk · HarmonyOS

HarmonyOS NEXT（API 12）移植版，ArkTS + ArkUI 声明式。

- **怎么在 DevEco Studio 里跑**：[docs/HARMONY.md](docs/HARMONY.md) §3
- **架构与移植对照**：[docs/HARMONY.md](docs/HARMONY.md) §1
- **本机可跑的校验**：`bash ../scripts/check-harmony.sh`
- **立即可测路径**：鸿蒙浏览器打开 https://xiaoqiangch.github.io/blindwalk/ → 添加到桌面

```
entry/src/main/ets/
├── core/    纯 TypeScript 逻辑层（不依赖 @ohos.*，可 Node 测试）
├── pages/   路由外壳
├── views/   7 个界面
└── theme/   设计 token
```
