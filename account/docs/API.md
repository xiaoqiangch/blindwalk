# 步迷 Walkaholic · 账号服务 API

> 版本 1 · 零依赖 Node.js（`node:sqlite` + `node:crypto`）· 默认端口 `8803`
> 用途：给步迷 PWA 提供个人账号登录与「资料整包同步」。

启动：

```bash
cd /Users/chenxiaoqiang/Projects/Walkaholic
PORT=8803 node account/server/index.mjs
# 或：cd account && npm start
```

数据落盘：`account/data/walkaholic-users.db`（SQLite，WAL）。

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
- 可用 `WA_ALLOWED_ORIGINS`（逗号分隔）限制回显白名单；不配置时回显任意 Origin（方便本地预览）。
- 前端 `fetch` 必须带 `credentials: 'include'`，否则浏览器不会保存/回传 Cookie。

## 2. 会话 Cookie

```
Set-Cookie: wa_uid=<64 位 hex>; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000
```

- 30 天有效；`HttpOnly`（JS 读不到），`SameSite=Lax`。
- **本地 http 不加 `Secure`**；部署到 HTTPS 时设置 `WA_COOKIE_SECURE=1`，服务会给 Cookie 追加 `Secure`。
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

### 3.1 微信登录

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/auth/wechat/config` | `{ ok:true, wechat:{ enabled, appid, universalLink, missing[] } }`。**永远不下发 secret**；未配置时 `enabled:false` + 缺哪几个环境变量 |
| POST | `/api/auth/wechat` | body `{ code }`。服务端用 code 换 openid → 找绑定用户（没有就建号）→ Set-Cookie 会话 |

服务端环境变量（AppSecret 只在服务端）：

| 变量 | 说明 |
|---|---|
| `WA_WECHAT_APPID` | 微信开放平台应用 AppID（「网站应用」或「移动应用」） |
| `WA_WECHAT_SECRET` | 同一应用的 AppSecret |
| `WA_WECHAT_UNIVERSAL_LINK` | 可选，iOS 移动应用接 WeChatOpenSDK 时的 Universal Link |

错误码：

| code | 状态 | 含义 |
|---|---|---|
| `WECHAT_NOT_CONFIGURED` | 503 | 服务端缺 AppID / Secret |
| `WECHAT_CODE_INVALID` | 400 | code 已用/过期（errcode 40029 / 40163），客户端应重新授权 |
| `WECHAT_UNREACHABLE` | 502 | 连不上 api.weixin.qq.com |
| `WECHAT_FAILED` | 502 | 其它微信侧失败 |

绑定关系存在 `identities(provider, external_id, user_id, ...)` 表：同一 openid 反复登录始终落到同一个本地账号；
微信用户没有可用密码（服务端写入随机串），只能用微信登录。

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
curl -s -i -c /tmp/wa-cookie.txt \
  -X POST localhost:8803/api/auth/register \
  -H 'content-type: application/json' \
  -H 'Origin: http://127.0.0.1:8799' \
  -d '{"username":"testuser","password":"secret123"}'

# 当前用户 + 资料（此时 profile 为 null）
curl -s -b /tmp/wa-cookie.txt localhost:8803/api/auth/me

# 整包同步资料
curl -s -b /tmp/wa-cookie.txt \
  -X PUT localhost:8803/api/me/profile \
  -H 'content-type: application/json' \
  -d '{"profile":{"xp":4240,"cards":[{"placeID":"river-steps"}],"settings":{"sound":true}}}'

# 再读（应带 profile）
curl -s -b /tmp/wa-cookie.txt localhost:8803/api/auth/me

# 登出
curl -s -b /tmp/wa-cookie.txt -c /tmp/wa-cookie.txt -X POST localhost:8803/api/auth/logout

# 登录
curl -s -i -c /tmp/wa-cookie.txt \
  -X POST localhost:8803/api/auth/login \
  -H 'content-type: application/json' \
  -H 'Origin: http://127.0.0.1:8799' \
  -d '{"username":"testuser","password":"secret123"}'

# 删除账号（需密码二次确认）
curl -s -b /tmp/wa-cookie.txt \
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
4. **HTTPS**：线上必须走 HTTPS，并设置 `WA_COOKIE_SECURE=1`，否则浏览器会拒绝非 Secure Cookie 或前端请求被 mixed-content 拦截。
5. **CORS 白名单**：生产设置 `WA_ALLOWED_ORIGINS=https://你的前端域名`；本地不设即可。
6. **profile 上限 256KB**（按 JSON 序列化后的 UTF-8 字节）；超出返回 400，前端应提示「资料太大」并裁剪图片/base64。
7. 资料是**整包覆盖**：PUT 的内容就是最终保存内容，不提供部分字段合并。
8. 未登录 `/api/auth/me` 返回 401，前端据此显示登录框；登录态通过 Cookie 自动维持，不需要 token 存储。

## 6. 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8803` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址（对外部署可设 `0.0.0.0`） |
| `WA_DATA_DIR` | `account/data` | 数据目录 |
| `WA_ALLOWED_ORIGINS` | 空（回显任意 Origin） | CORS 白名单，逗号分隔 |
| `WA_COOKIE_SECURE` | `0` | HTTPS 部署时设 `1` |
| `WA_TRUST_PROXY` | `0` | 反向代理后设 `1`，限流取 `X-Forwarded-For` |

### 3.2 后台设置接口（微信 AppID / Secret）

> 这是给**管理后台**用的，不是给客户端。需要 `X-WA-Admin-Token` 请求头。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/settings` | `{ settings: { 'wechat.appid', 'wechat.secret'(掩码), 'wechat.universalLink' }, wechatEnabled, adminTokenConfigured }` |
| PUT | `/api/admin/settings` | body `{ settings: { ... } }`；空串 = 清除 |

鉴权：请求头 `X-WA-Admin-Token` 必须等于服务端环境变量 `WA_ADMIN_TOKEN`（或 `BW_ADMIN_TOKEN`）。
**没配令牌时一律拒绝（503 `ADMIN_TOKEN_MISSING`）**，绝不因为「没配」就放行。

配置优先级：`settings` 表 > 环境变量（`WA_WECHAT_APPID` / `WA_WECHAT_SECRET`）。
保存后 `/api/auth/wechat/config` 与 `/api/auth/wechat` 立即读到新值，无需重启。

线上实际使用时，浏览器走的是后台的 `/admin/api/account/settings`（后台服务直连账号库），
这样管理令牌不必发到前端。上面这两个接口用于脚本 / 运维。

### 3.3 Sign in with Apple

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/apple` | body `{ identityToken, nonce, fullName? }` → 验签、建号/登录、Set-Cookie |

服务端**自己验 RS256 签名**（`https://appleid.apple.com/auth/keys`），不做「只解 base64 就信」那种错事。校验项：

| 项 | 规则 |
|---|---|
| 签名 | RSA-SHA256，按 JWT header 的 `kid` 取公钥；公钥缓存 1 小时，验签失败会强制刷新一次（处理 Apple 轮换） |
| `iss` | 必须 `https://appleid.apple.com` |
| `aud` | 必须等于 `WA_APPLE_CLIENT_ID`（默认 `com.walkaholic.app`） |
| `exp` | 未过期（允许 60 秒时钟偏差） |
| `iat` | 不能在未来（允许 60 秒） |
| `nonce` | 若客户端传了，必须等于 `SHA256(原始 nonce)` |

错误码：`APPLE_NOT_CONFIGURED`(503) / `APPLE_BAD_TOKEN` / `APPLE_BAD_SIGNATURE` / `APPLE_BAD_ISSUER` / `APPLE_BAD_AUDIENCE` / `APPLE_EXPIRED` / `APPLE_BAD_NONCE` / `APPLE_JWKS_FAILED`(502)

账号绑定存在 `identities(provider='apple', external_id=sub)`，同一 Apple 账号反复登录始终同一本地账号。

### 3.4 短信验证码登录

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/sms/send` | body `{ phone }` → `{ ok, ttlSeconds, devMode }` |
| POST | `/api/auth/sms/verify` | body `{ phone, code }` → 建号/登录 + Set-Cookie |

| 项 | 值 |
|---|---|
| 验证码 | 6 位数字，`crypto.randomInt`，只存 SHA256 |
| 有效期 | 5 分钟，一次性（验过即删） |
| 发送限流 | 同一手机号 10 分钟内 5 次；同一 IP 10 分钟内 20 次 |
| 试错限流 | 同一验证码最多试 5 次，超过作废 |
| 存储 | `sms_codes` 表（重启不丢） |

服务商：阿里云短信 `SendSms`（RPC v1 签名，`HMAC-SHA1`）。环境变量：

| 变量 | 说明 |
|---|---|
| `WA_SMS_ACCESS_KEY_ID` | 阿里云 AccessKeyId |
| `WA_SMS_ACCESS_KEY_SECRET` | 阿里云 AccessKeySecret |
| `WA_SMS_SIGN_NAME` | 短信签名（需备案过的签名） |
| `WA_SMS_TEMPLATE_CODE` | 验证码模板号，模板里写 `${code}` |
| `WA_SMS_DEV_MODE=1` | 开发模式：不发真短信，验证码打到日志 |

未配置时 `/api/auth/sms/send` 返回 503 `SMS_NOT_CONFIGURED` 并列出缺哪几个变量。

错误码：`BAD_PHONE` / `SMS_NOT_CONFIGURED`(503) / `SMS_TOO_MANY_SENDS`(429) / `SMS_SEND_FAILED`(502) /
`SMS_NO_CODE` / `SMS_EXPIRED` / `SMS_WRONG_CODE` / `SMS_TOO_MANY_ATTEMPTS`(429)

### 3.5 登录方式可用性

```
GET /api/auth/providers
→ { ok:true, providers: {
     password: { enabled: true },
     apple:    { enabled: true, clientId: "com.walkaholic.app" },
     sms:      { enabled: false, missing: ["WA_SMS_ACCESS_KEY_ID", ...] },
     wechat:   { enabled: false, appid: null, missing: [...] }
   } }
```
客户端启动时问一次，用于决定「哪些登录按钮显示、哪些显示为不可用并说明原因」。**绝不下发任何 secret。**

---

## 4. 惊喜（跨用户共享）

保密约定：列表接口**不返回**照片正文、dHash、作者 id；坐标只用于本机算距离。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/surprises?lat&lon&radius` | 可选 | 附近待寻惊喜（登录后自动排除自己埋的），只回 id / emoji / 区域 / 线索 / 半径 / 距离 |
| POST | `/api/surprises` | 登录或 `X-WA-Device` | 埋下一个（照片以 data URL 上传，超 220KB 只保留哈希） |
| GET | `/api/surprises/mine` | 登录或 `X-WA-Device` | **我埋的**：状态 / 寻者名 / 找到时间 —— 作者侧「回执」的数据源 |
| POST | `/api/surprises/:id/find` | 登录 | 认领（先到先得；不能找自己埋的） |

`GET /api/surprises/mine` 的鉴权规则：

- 已登录 → 按账号 id 查；
- 未登录 → 必须带 `X-WA-Device`（客户端自动生成并持久化的随机串），按 `anon-<device>` 查；
- 两者都没有 → 401 `UNAUTHENTICATED`。

响应示例：

```json
{ "ok": true, "items": [
  { "id": "surprise-...", "areaLabel": "鼓楼 · 巷口", "status": "found",
    "finderName": "小满", "foundAt": 1763000000000, "createdAt": 1762900000000, "radiusMeters": 60 }
] }
```

客户端只在 `status == "found"` 时生成一条未读回执；入口红点在用户点「知道了」或打开「我的惊喜」后清除。

---

## 5. 到达照片（check-in photo）

到达揭晓页用户拍的那张照片，按「用户 + 地点」存一张；不进 profile 同步包（256KB 上限），
只把远端路径写进卡片的 `photoRemotePath`（一个短字符串），所以同步不会变重。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/photos` | 必须登录 | body：`{ placeId, dataUrl }`；dataUrl 仅接受 `image/jpeg` / `image/png` 的 base64；上限 600KB（`PHOTO_TOO_LARGE` 413） |
| GET | `/api/photos/:placeId` | 必须登录 | 直接返回图片字节（`image/jpeg` / `image/png`），只能取自己的 |

- 同一 `(user, placeId)` 再次上传 = 覆盖（重拍 / 换一张）。
- 未登录时客户端只保存到本机，不调用这两个接口。
