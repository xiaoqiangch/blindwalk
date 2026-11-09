# 地图 Key 统一管理

> 结论先行：**用户不需要、也无法自己填 Key**。Key 由后台数据库统一配置，客户端启动时自动获取。

## 架构

```
管理员登录后台  →  设置 / 测试 / 轮换 Key
                        ↓  (SQLite: app_keys 表，已 gitignore)
        ┌───────────────┴────────────────┐
        │                                │
部署时注入 gh-pages 快照           后台公开端点
mapkeys.json（不进主仓）      GET /api/public/mapkeys
        │                                │
        └──────────→ PWA 启动时自动加载 ←─┘
                         ↓
              providers.setKeys({amap,baidu})
```

客户端加载优先级（`app.js` 的 `loadMapKeys()`）：

1. `mapkeys.json`（部署时从后台 DB 生成，随 Pages 发布）
2. 后台公开端点 `/api/public/mapkeys`（本地开发 / 局域网，地址可存 `localStorage['bw.mapkeys.endpoint']`）
3. 都没有 → 只用免费源（OpenStreetMap + 中文维基），功能不受影响

## 后台怎么用

```bash
# 启动后台（密码自己定）
BW_ADMIN_PASSWORD='你的密码' bash scripts/start-admin.sh
# 打开 http://127.0.0.1:8802/admin → 登录 → 顶栏「地图 Key」
```

面板支持：

| 操作 | 接口 | 说明 |
|---|---|---|
| 查看 | `GET /api/mapkeys` | **只回显掩码**（`52da…f425`），从不返回完整 Key |
| 保存/清除 | `PUT /api/mapkeys` | `{"keys":{"amap":"…","baidu":""}}`，空串＝清除 |
| 测试连接 | `POST /api/mapkeys/test` | 服务端真实调用一次（高德 place/around），返回命中数量 |

## 客户端怎么拿到

| 场景 | Key 来源 |
|---|---|
| 公网 PWA（GitHub Pages） | 部署时注入的 `mapkeys.json` |
| 本地 `python3 serve.py` 调试 | 同目录 `mapkeys.json`（可手动生成）或后台端点 |
| 都没有 | 免费源照常工作，`我的 → 数据源` 显示「后台未配置」 |

## 安全模型（重要，别误解）

这个架构能保证的：

- ✅ Key **不进 git 仓库**（主仓没有 `mapkeys.json`，已 gitignore）
- ✅ 后台界面**不回显完整 Key**，只给掩码
- ✅ 公开端点有 **来源白名单**（默认只允许 `https://xiaoqiangch.github.io` 与 localhost），非白名单 403
- ✅ 公开端点 `Cache-Control: no-store`，不落 CDN
- ✅ 可以随时在后台**轮换/清除**，客户端下次启动自动生效
- ✅ 客户端代码里**没有任何硬编码 Key**

这个架构**做不到**的：

- ❌ 浏览器端调用地图 API 时，Key 一定出现在网络请求里，**任何用户打开开发者工具都能看到**。
  这是"纯静态前端 + JSONP"的固有限制，不是实现瑕疵。

因此建议：

1. 用**独立、限额、可随时吊销**的 Key（不要用账号主 Key）
2. 发现异常流量 → 后台清空 Key 并重建
3. 如果要求 Key 对用户完全不可见，必须改成**服务端代理**：
   PWA → 自家后端 `/api/poi/nearby` → 后端带 Key 调高德。
   本项目已有 `admin/` 服务端，加这个代理是可行的下一步（需要把后台部署到公网 HTTPS）。

## Key 类型

- 高德：必须申请「**Web 服务**」类型的 Key（不是 Web端 JS API / iOS / Android 的 Key）
- 百度：申请「**服务端**」AK，并开启「地点检索 v2」

## 坐标系

高德 GCJ-02、百度 BD-09、OSM/维基 WGS-84。`providers.js` 内部双向转换，对外统一 WGS-84（往返误差 <3m/<5m，有测试断言）。

## 实测结果

| 检查项 | 结果 |
|---|---|
| 后台「测试连接」 | `{ok:true, provider:"amap", count:16}` |
| 浏览器内真实抓取（苏州） | 高德 12–25 条 + 维基 1 条，去重后 8 个候选 |
| 公开端点（Pages 来源） | 200 + `no-store` + 回显白名单 Origin |
| 非白名单来源 | 403 |
| 主仓是否含 Key | 否（`git grep` 近 50 个提交无命中） |
