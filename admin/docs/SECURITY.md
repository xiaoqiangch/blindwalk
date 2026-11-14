# 后台安全说明（v2）

## 登录

后台**默认必须登录**才能访问 `/admin` 与 `/api/*`。

| 项 | 做法 |
|---|---|
| 密码来源 | 环境变量 `WA_ADMIN_PASSWORD`；未设置时首次启动生成随机密码，写入 `admin/data/admin.secret.json`（权限 0600），启动日志打印一次 |
| 密码存储 | `node:crypto` 的 `scrypt` + 每密码独立 salt，**不存明文** |
| 会话 | 随机 32 字节 token，Cookie 为 `HttpOnly; SameSite=Strict; Path=/`，12 小时过期，持久化到 `admin/data/sessions.json` |
| 失败限流 | 同 IP 10 分钟内失败 5 次 → `429 TOO_MANY_ATTEMPTS` |
| 未登录 | `/api/*` → `401 UNAUTHENTICATED`；`/admin` → 302 `/admin/login` |

## 部署建议（如果要放到内网/云上）

1. **必须设强密码**：`WA_ADMIN_PASSWORD=<至少 16 位随机串>`，不要用默认生成的
2. **走 HTTPS**：Cookie 目前没加 `Secure`（本地 http 调试需要），上云后在反代上加 `Secure`
3. **只监听内网**：默认 `127.0.0.1`，需要局域网访问再改 `HOST=0.0.0.0` 并配防火墙
4. **限制来源 IP**：反代层做 allowlist
5. **定期备份** `admin/data/walkaholic.db`（SQLite 单文件，`sqlite3 walkaholic.db ".backup ..."`）
6. **不要把 `admin/data/` 提交进仓库**：`.gitignore` 已排除 `.db`、`.secret`、`sessions`

## 风险边界（诚实说明）

- 这是**单人后台**，没有多用户/权限分级。多人协作需要再加用户表与角色
- 没有 CSRF token，靠 `SameSite=Strict` + 只接受 JSON 请求体来降低风险
- 没有审计日志。谁改了哪条 POI 查不到（v3 可加 `audit_log` 表）
