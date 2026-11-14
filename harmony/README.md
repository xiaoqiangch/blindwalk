# 步迷 Walkaholic · HarmonyOS

HarmonyOS NEXT（API 12）移植版，ArkTS + ArkUI 声明式。

- **怎么在 DevEco Studio 里跑**：[docs/HARMONY.md](docs/HARMONY.md) §3
- **架构与移植对照**：[docs/HARMONY.md](docs/HARMONY.md) §1
- **三端对齐规格**：[../docs/parity.md](../docs/parity.md)（唯一规格，改动需三端同步）
- **本机可跑的校验**：`bash ../scripts/check-harmony.sh`
- **立即可测路径**：鸿蒙浏览器打开 https://xiaoqiangch.github.io/walkaholic/ → 添加到桌面

```
entry/src/main/ets/
├── core/    纯 TypeScript 逻辑层（不依赖 @ohos.*，可 Node 测试）
│   ├── parity.ts   三档放宽 / 硬帽 / 黑名单 / 去重 / 类别多样性
│   ├── providers.ts 高德 / 百度 / OSM / 维基
│   ├── mapkeys.ts  地图 Key 下发（包内→Pages→后台→免费源）
│   ├── search.ts   三档搜索 + 策展优先 + 明确失败（绝不虚构）
│   ├── fog.ts      迷雾路径几何（纯函数）
│   ├── hints.ts    图鉴「附近惊喜」隐晦提示 + 探寻线索解锁（保密铁律）
│   ├── account.ts  账号（手动 Cookie）
│   └── …           地理 / 抽盒 / 会话 / dHash / 成就 / 持久化 / store
├── pages/   路由外壳（Index）
├── views/   7 个界面
├── components/ 共享组件 + 平台注入（HttpClient / Location / PreferencesKV）
└── theme/   设计 token（字号已按 parity.md §5 对齐 Web v32）
```

## 本机校验结果

```
tsc --noEmit          0 error
npm test              117/117 通过
ArkTS 静态检查        26 个 .ets，0 error（含「附近惊喜保密」守卫）
```

> `.hap` 编译仍需 DevEco Studio；需要真机确认的 API 清单见 [docs/HARMONY.md](docs/HARMONY.md) §7。
