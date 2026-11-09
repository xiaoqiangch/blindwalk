# 盲走 BlindWalk · 账号服务 API

> 版本 1 · 零依赖 Node.js（`node:sqlite` + `node:crypto`）· 默认端口 `8803`
> 用途：给盲走 PWA 提供个人账号登录与「资料整包同步」。

启动：

```bash
cd /Users/chenxiaoqiang/Projects/BlindWalk
PORT=8803 node account/server/index.mjs
# 或：cd account && npm start
```

数据落盘：`account/data/blindwalk-users.db`（SQLite，WAL）。

---

## 1. CORS（必须带凭证）

服务对**所有响应**（含错误、204 预检）返回：

```
Access-Control-Allow-Origin: <请求的 Origin>     # 回显，禁止 *
Access-Control-Allow-Credentials: true
Access-Control-Allow-Headers: content-type
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Vary: Origin
```

- `OPTIONS` 预检直接 **204**。
- 请求没有 `Origin`（curl / 同源）时**不返回** `Access-Control-Allow-Origin: *`。
- 可用 `BW_ALLOWED_ORIGINS`（逗号分隔）限制回显白名单；不配置时回显任意 Origin（方便本地预览）。
- 前端 `fetch` 必须带 `credentials: 'include'`，否则浏览器不会保存/回传 Cookie。

## 2. 会话 Cookie

```
Set-Cookie: bw_uid=<64 位 hex>; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000
```

- 30 天有效；`HttpOnly`（JS 读不到），`SameSite=Lax`。
- **本地 http 不加 `Secure`**；部署到 HTTPS 时设置 `BW_COOKIE_SECURE=1`，服务会给 Cookie 追加 `Secure`。
- 会话存在 SQLite `sessions` 表，重启服务不会掉登录。

## 3. 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | `{ ok:true, version:"1", time: ms }`，无鉴权 |
| POST | `/api/auth/register` | body `{username, password}`；用户名 3–24 字符（字母数字下划线中文），密码 6–128 位；成功 `{ ok:true, user:{id,username,createdAt} }` + Set-Cookie |
| POST | `/api/auth/login` | body `{username,password}`；成功同上；失败 401 `BAD_CREDENTIALS` |
| POST | `/api/auth/logout` | 清 Cookie，`{ ok:true }` |
| GET | `/api/auth/me` | 有会话 → `{ user:{id,username,createdAt}, profile:object\|null }`；无 → 401 `UNAUTHENTICATED` |
| PUT | `/api/me/profile` | body `{ profile: object }`（整包同步，上限 256KB）；→ `{ ok:true, savedAt: ms, bytes:n }` |
| DELETE | `/api/me` | body `{password}` 二次确认；删除账号、profile、全部会话 → `{ ok:true }` |

### 错误结构

```json
{ "error": "人类可读说明", "code": "BAD_REQUEST" }
```

| HTTP | code | 场景 |
|---|---|---|
| 400 | `BAD_REQUEST` | JSON 解析失败 / 用户名密码不合法 / profile 不是对象或超 256KB / 删除缺 password |
| 401 | `BAD_CREDENTIALS` | 登录用户名或密码错误；删号密码错误 |
| 401 | `UNAUTHENTICATED` | 未登录 / 会话过期 / Cookie 无效 |
| 409 | `USERNAME_TAKEN` | 用户名已存在（大小写不敏感） |
| 429 | `TOO_MANY_ATTEMPTS` | 同 IP 10 分钟内登录失败 8 次（响应带 `details.retryAfterMs`） |
| 404 | `NOT_FOUND` | 未知路径 |
| 500 | `INTERNAL` | 未预期错误 |

> 限流口径：前 8 次失败各返回 401，第 9 次起在 10 分钟窗口内返回 429；成功登录会清零该 IP 计数。
> 计数在进程内存里，重启服务清零。

## 4. curl 示例

```bash
# 健康检查
curl -s localhost:8803/api/health

# 注册（带 Origin，保存 Cookie）
curl -s -i -c /tmp/bw-cookie.txt \
  -X POST localhost:8803/api/auth/register \
  -H 'content-type: application/json' \
  -H 'Origin: http://127.0.0.1:8799' \
  -d '{"username":"testuser","password":"secret123"}'

# 当前用户 + 资料（此时 profile 为 null）
curl -s -b /tmp/bw-cookie.txt localhost:8803/api/auth/me

# 整包同步资料
curl -s -b /tmp/bw-cookie.txt \
  -X PUT localhost:8803/api/me/profile \
  -H 'content-type: application/json' \
  -d '{"profile":{"xp":4240,"cards":[{"placeID":"river-steps"}],"settings":{"sound":true}}}'

# 再读（应带 profile）
curl -s -b /tmp/bw-cookie.txt localhost:8803/api/auth/me

# 登出
curl -s -b /tmp/bw-cookie.txt -c /tmp/bw-cookie.txt -X POST localhost:8803/api/auth/logout

# 登录
curl -s -i -c /tmp/bw-cookie.txt \
  -X POST localhost:8803/api/auth/login \
  -H 'content-type: application/json' \
  -H 'Origin: http://127.0.0.1:8799' \
  -d '{"username":"testuser","password":"secret123"}'

# 删除账号（需密码二次确认）
curl -s -b /tmp/bw-cookie.txt \
  -X DELETE localhost:8803/api/me \
  -H 'content-type: application/json' \
  -d '{"password":"secret123"}'

# CORS 预检
curl -s -i -X OPTIONS localhost:8803/api/auth/register \
  -H 'Origin: http://127.0.0.1:8799' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type'
```

## 5. 前端接入注意事项

1. **fetch 要带凭证**：`fetch(url, { credentials: 'include' })`，跨源 http 预览（例如 PWA 在 `http://127.0.0.1:8799`、账号服务在 `http://127.0.0.1:8803`）时 CORS 会回显 Origin。
2. **Cookie 域**：服务通过 `Set-Cookie` 的 `Path=/` 生效；跨源时 Cookie 绑定在**账号服务主机**上，前端不需要手写 Cookie，浏览器自动回传（前提是 `credentials:'include'`）。
3. **SameSite=Lax**：跨站（不同 site）的 `fetch` 仍会带 Cookie（因为请求是显式同源/跨源 XHR，不是顶层跳转）；如果你把前端部署到与账号服务不同的 site 且遇到 Cookie 不落地，优先检查浏览器对第三方 Cookie 的策略，必要时改为同 site 部署（例如同域名不同端口/反代）。
4. **HTTPS**：线上必须走 HTTPS，并设置 `BW_COOKIE_SECURE=1`，否则浏览器会拒绝非 Secure Cookie 或前端请求被 mixed-content 拦截。
5. **CORS 白名单**：生产设置 `BW_ALLOWED_ORIGINS=https://你的前端域名`；本地不设即可。
6. **profile 上限 256KB**（按 JSON 序列化后的 UTF-8 字节）；超出返回 400，前端应提示「资料太大」并裁剪图片/base64。
7. 资料是**整包覆盖**：PUT 的内容就是最终保存内容，不提供部分字段合并。
8. 未登录 `/api/auth/me` 返回 401，前端据此显示登录框；登录态通过 Cookie 自动维持，不需要 token 存储。

## 6. 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8803` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址（对外部署可设 `0.0.0.0`） |
| `BW_DATA_DIR` | `account/data` | 数据目录 |
| `BW_ALLOWED_ORIGINS` | 空（回显任意 Origin） | CORS 白名单，逗号分隔 |
| `BW_COOKIE_SECURE` | `0` | HTTPS 部署时设 `1` |
| `BW_TRUST_PROXY` | `0` | 反向代理后设 `1`，限流取 `X-Forwarded-For` |
