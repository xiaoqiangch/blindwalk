# 账号功能为什么不能"直接部署在 GitHub Pages 上"？

**GitHub Pages 是纯静态托管**：它只把你仓库里的文件（HTML/CSS/JS/图片）通过 CDN 发出去，
不执行任何服务端代码、不提供数据库、不保存会话。账号功能恰恰需要这三样：

| 账号需要什么 | Pages 能否提供 | 说明 |
|---|---|---|
| 执行注册/登录逻辑 | ❌ | 没有运行时，只有静态文件 |
| 存用户和密码哈希 | ❌ | 没有数据库（Pages 不是存储服务） |
| 保存登录会话（Cookie） | ❌ | 发 Cookie 需要服务端响应头 |
| HTTPS | ✅ | Pages 自带，但仅限静态资源 |
| 自定义域名 | ✅ | 与账号无关 |

所以不是"配置问题"，是托管类型的边界。

## 三种解法

### 方案 A（推荐）：Cloudflare Workers + D1 — 本仓库已备好代码

`serverless/cloudflare/` 是一个完整的账号服务实现（与 `account/` 接口完全一致）：

- D1 就是 SQLite，表结构复用
- 免费额度：每天 10 万请求、D1 5GB 存储
- 部署：`npx wrangler login` → `d1 create` → `d1 execute schema.sql` → `wrangler deploy`
- 得到 `https://xxx.workers.dev` 后填进 App「我的 → 账号 → 账号服务地址」

详见 [serverless/cloudflare/README.md](../serverless/cloudflare/README.md)。

**注意事项**：跨站请求（github.io → workers.dev）需要服务端设置
`SameSite=None; Secure` 的 Cookie —— 本实现已经这么做了。

### 方案 B：Supabase / Firebase

用它们的 Auth 服务，前端直接调 SDK，不需要自己写后端。
优点：自带注册/登录/第三方登录/找回密码；缺点：SQL 要改写、引入 SDK、数据模型受约束。

### 方案 C：继续用本地 `account/` 服务

- 只在本机 http 页面下可用（HTTPS 页面不能调 http 本地服务，属混合内容拦截）
- 适合开发调试，不适合公网用户

## 现状

| 能力 | 状态 |
|---|---|
| Web 本地账号（http://127.0.0.1:8803） | ✅ 已实现并验证 |
| iOS / 鸿蒙连本地账号 | ✅ 已实现（模拟器可直连 127.0.0.1） |
| 公网 HTTPS 账号（Cloudflare Worker） | ✅ 代码与部署脚本已备好，**待你注册 Cloudflare 账号执行部署** |
| 公网 HTTPS 账号（Supabase） | ⬜ 未实现 |
