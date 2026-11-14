# 步迷 · 账号服务（Cloudflare Workers + D1）

为什么需要这个：**GitHub Pages 只能托管静态文件**（HTML/CSS/JS），不能执行后端代码、不能连数据库、不能存会话。
账号功能一定需要一个"能跑代码 + 能写数据库"的地方。Cloudflare Workers 免费额度足够个人用，
而且 **D1 就是 SQLite**，和本仓库 `account/` 的表结构一致。

## 一次性部署（约 5 分钟，需要你自己的 Cloudflare 账号，免费）

```bash
cd serverless/cloudflare
npm install                      # 只装 wrangler（不参与构建产物）
npx wrangler login               # 浏览器授权

# 1) 建数据库
npx wrangler d1 create walkaholic_account
#   → 输出里有 database_id，复制到 wrangler.toml 的 database_id

# 2) 建表
npx wrangler d1 execute walkaholic_account --remote --file=./schema.sql

# 3) 部署
npx wrangler deploy
#   → https://walkaholic-account.<你的子域>.workers.dev
```

部署后：
- `GET /api/health` 应该返回 `{"ok":true,...}`
- 把 `https://walkaholic-account.xxx.workers.dev` 填进 App：**我的 → 账号 → 账号服务地址**

## 配置来源白名单

`wrangler.toml` 里：

```toml
[vars]
ALLOWED_ORIGINS = "https://xiaoqiangch.github.io,http://127.0.0.1:*,http://localhost:*"
```

支持 `*` 前缀通配。跨站 Cookie 用 `SameSite=None; Secure`（Workers 默认 HTTPS，满足要求）。

## 接口

与 `account/docs/API.md` 完全一致：

| 方法 | 路径 |
|---|---|
| GET | `/api/health` |
| POST | `/api/auth/register` |
| POST | `/api/auth/login` |
| POST | `/api/auth/logout` |
| GET | `/api/auth/me` |
| PUT | `/api/me/profile` |
| DELETE | `/api/me` |

## 本地跑测试

```bash
node --test tests/     # 密码哈希 / token / cookie / CORS 校验
```

## 其他可选方案（对比）

| 方案 | 成本 | 优点 | 缺点 |
|---|---|---|---|
| **Cloudflare Workers + D1**（本目录） | 免费额度足够 | 与现有 SQLite schema 一致，全球边缘，HTTPS | 需要一次 wrangler 部署 |
| Supabase（Postgres + Auth） | 免费 500MB | 自带注册/登录/第三方登录，前端 SDK 直连 | SQL 需要改写，依赖 SDK |
| Vercel / Netlify Functions | 免费额度 | 部署简单 | 数据库要另配（Neon/Upstash） |
| 自己的 Mac + Cloudflare Tunnel | 免费 | 直接复用 `account/` 代码 | Mac 必须常开，不稳 |
| 纯本地账号（设备内） | 0 | 无需服务器 | 不能跨设备同步 |
