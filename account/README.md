# 盲走 · 账号服务

个人账号：注册 / 登录 / 会话 / 资料同步（把本机的进度、卡片、惊喜整包同步到账号）。

```bash
bash scripts/start-account.sh
# → http://127.0.0.1:8803/api/health
```

| 文档 | 内容 |
|---|---|
| [docs/API.md](docs/API.md) | 接口契约 + curl 示例 |
| [prototype/web/providers.md](../prototype/web/providers.md) | POI 数据源（高德/百度/OSM/维基）配置 |

## 客户端怎么用

App → **我的 → 账号**：
1. 填服务地址（默认 `http://127.0.0.1:8803`）
2. 注册或登录
3. 登录后点「同步到账号」，其他设备登录后可「从账号恢复」

> ⚠️ 浏览器安全限制：HTTPS 页面（GitHub Pages）不能直接调用 `http://` 的本地服务（混合内容）。
> 所以云端账号需要在 **http 环境**下用（本地 `serve.py` 打开），或把账号服务部署到 HTTPS 域名。
> 未登录时 App 完全离线可用，数据只存在本机。

## 安全说明

- 密码用 `scrypt` 加盐哈希存储，不存明文
- 会话是 HttpOnly Cookie，30 天有效
- 登录失败限流：同 IP 10 分钟 8 次
- 账号数据（SQLite）不提交进仓库
