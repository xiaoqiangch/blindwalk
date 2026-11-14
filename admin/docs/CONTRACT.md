# 兴趣点管理后台 · 接口契约

> 版本 v1（2026-11-09）· 由 Lead 定义，**后端与前端都必须按这个契约实现，不得改名**

前端与后端是两条并行工作流。任何一方觉得契约需要改，先告诉 Lead，由 Lead 统一改本文件。

---

## 1. 目标

给「步迷 Walkaholic」的兴趣点（POI）建一个**可管理的数据后台**：

1. **收集整理**：按坐标+半径从公开数据（中文维基百科 / OpenStreetMap）抓候选，落成草稿
2. **编辑处理**：人工编辑字段；也可让大模型改写文案、生成线索、补任务
3. **分析判断**：让大模型评估「适不适合做盲盒目的地」（可达性 / 安全 / 独特性 / 保密性）
4. **导出上架**：把审核通过的点导出成 App 直接消费的 JSON

---

## 2. POI 数据模型（唯一真相）

```jsonc
{
  "id": "poi-7f3a9c",              // 服务端生成，poi- + 6 位十六进制
  "name": "上海音乐厅",              // 展示名（去掉了维基的括号消歧义）
  "lat": 31.22888889,              // 真实坐标（必填）
  "lon": 121.47333333,
  "category": "venue",             // 见 §3 类别表
  "emoji": "🎻",                    // 默认取类别的 emoji，可覆盖
  "rarity": "epic",                // common | rare | epic | hidden
  "area": "near",                  // near | river | oldtown
  "address": "黄浦区 · 延安东路",     // 可为 null
  "photoUrl": "https://…",         // 可为 null；必须能直接 <img> 加载
  "photoCredit": "Wikimedia Commons", // 有 photoUrl 时必填
  "summary": "原名南京大戏院…",       // 一句话介绍（≤120 字）
  "why": "你选了「放空」…",           // 揭晓卡「为什么是这里」
  "task": "找一张演出海报…",          // 1 分钟小任务
  "hints": ["…", "…", "…"],        // 三阶线索，**绝不能含地名**
  "tags": ["历史建筑", "音乐"],
  "safety": {                       // 大模型 / 规则产出
    "score": 4,                     // 1–5，综合安全分（白天口径，保留向后兼容）
    "walkable": true,               // 是否适合步行到达
    "crowded": "low|medium|high",
    "notes": "主干道旁，人行道宽",
    "day": 4,                       // 白天安全分 1–5
    "night": 2,                     // 夜间安全分 1–5（没有街灯/人流依据时按类别保守给分）
    "nightVerdict": "avoid|caution|ok",  // 夜间是否推荐：avoid 不建议夜间去 / caution 结伴 / ok 可以
    "reasons": ["类别：博物馆", "有实景照片", "人流：medium"]  // 打分依据（便于人工复核）
  },
  "llm": {
    "normalizedAt": 1731030000000,  // 毫秒时间戳；0 = 未做过
    "analyzedAt": 1731030000000,
    "model": "deepseek-chat",       // 最后一次调用的模型名
    "mode": "llm"                   // llm | offline（离线规则）
  },
  "status": "draft",                // draft | review | approved | rejected
  "source": "wikipedia",            // wikipedia | osm | manual
  "createdAt": 1731030000000,
  "updatedAt": 1731030000000
}
```

**必填**：`id / name / lat / lon / category / status / source / createdAt / updatedAt`
**导出到 App 时**只导出 `status === "approved"` 的点，字段裁剪见 §5。

---

## 3. 类别表（与 App 的 `geo.js` 保持一致，勿自造）

| category | 中文 | emoji | 默认 rarity |
|---|---|---|---|
| cafe | 咖啡窗口 | ☕️ | common |
| bookstore | 书店 | 📚 | rare |
| library | 图书馆 | 📖 | rare |
| park | 公园 | 🌳 | common |
| bench | 长椅 | 🪑 | common |
| bridge | 桥 | 🌉 | rare |
| art | 涂鸦墙 | 🎨 | epic |
| river | 河岸 | 🌊 | epic |
| convenience | 便利店 | 🥫 | common |
| viewpoint | 观景点 | 🔭 | epic |
| garden | 花园 | 🌷 | rare |
| plaza | 广场 | ⛲️ | common |
| museum | 博物馆 | 🏛️ | rare |
| historic | 老房子 | 🏮 | rare |
| venue | 演出场所 | 🎻 | epic |
| temple | 寺庙教堂 | ⛩️ | rare |
| market | 市集 | 🛒 | common |

---

## 3.1 认证（v2 新增）

后台默认**必须登录**才能访问 `/admin` 与 `/api/*`（`/api/auth/*` 除外）。

| 端点 | 说明 |
|---|---|
| `GET /api/auth/status` | `{ "authenticated": bool, "passwordSet": bool }`，无鉴权可访问 |
| `POST /api/auth/login` | body `{ "password": "…" }`；成功设置 HttpOnly 会话 Cookie，返回 `{ "ok": true }`；失败 401 `BAD_PASSWORD` |
| `POST /api/auth/logout` | 清除会话，返回 `{ "ok": true }` |

规则：
- 密码来源：环境变量 `WA_ADMIN_PASSWORD`；未设置时**首次启动**生成随机密码写入 `admin/data/admin.secret.json`（文件权限 0600）并在启动日志打印一次
- 密码哈希：`node:crypto` 的 `scrypt`，每个密码独立 salt；**不存明文**
- 会话：随机 32 字节 token，`HttpOnly; SameSite=Strict; Path=/`，有效期 12 小时；持久化到 `admin/data/sessions.json`（重启不丢）
- 本地 http 调试时 Cookie **不加 `Secure`**；部署到 HTTPS 时应在反代或代码里补 `Secure`（见 docs/SECURITY.md）
- 登录失败限流：同一 IP 10 分钟内失败 5 次；**前 5 次返回 401，第 6 次起返回 429**；
  计数在进程内存里（重启清零，够用即可）
- 未登录访问 `/api/*` → 401 `UNAUTHENTICATED`；访问 `/admin` → 302 到 `/admin/login`
- `/admin/login` 由服务端内置一个极简登录页（不依赖前端打包）

## 3.2 存储（v2 改为 SQLite）

- 使用 **Node 内置 `node:sqlite`**（`DatabaseSync`），仍然零 npm 依赖
- 文件：`admin/data/walkaholic.db`；`PRAGMA journal_mode=WAL`
- 表：`pois`（字段同 §2，`tags`/`safety`/`llm` 用 JSON 文本列）、`meta`（schema 版本）、`sessions`（预留，v2 未使用）
- **会话权威存储是 `admin/data/sessions.json`**（§3.1）；SQLite 的 `sessions` 表只是预留，不要写它
- **自动迁移**：首次启动若存在 `admin/data/pois.json` 且库为空 → 全量导入并备份为 `pois.json.migrated-<ts>`
- 旧数据只有 `safety.score` 时：**score 视为 day 保留**，`night/nightVerdict/reasons` 用规则补齐
- `PoiStore` 的公开方法签名保持不变（`load/save/all/get/list/create/update/remove/findDuplicate/addCandidates/stats/approved`），只换底层实现

## 4. HTTP API

服务默认监听 `http://127.0.0.1:8802`（可用 `PORT` 覆盖）。
所有响应 `Content-Type: application/json; charset=utf-8`。
错误统一：`{ "error": "错误说明", "code": "BAD_REQUEST" | "NOT_FOUND" | "LLM_UNAVAILABLE" | "INTERNAL" }`。

### 4.1 列表与查询
```
GET /api/pois?status=draft&q=音乐&category=venue&hasPhoto=1&limit=100&offset=0
→ { "total": 42, "items": [ Poi, … ] }
```
- `status` 不传 = 全部；`q` 匹配 name/summary/tags；`category` 精确匹配
- **`hasPhoto`**（可选）：`1` = 只看有图，`0` = 只看无图；不传 = 全部
- 前端在 `total ≤ 100` 时允许客户端过滤，超过后必须改用服务端 `hasPhoto`（保证分页准确）
- 排序：`updatedAt` 倒序

### 4.2 单条
```
GET    /api/pois/:id        → Poi
POST   /api/pois            body: 部分 Poi（无 id/时间戳）→ 新建，返回 Poi
PUT    /api/pois/:id        body: 部分字段 → 合并更新，返回 Poi
DELETE /api/pois/:id        → { "ok": true }
```

### 4.3 收集整理（公开数据 → 草稿）
```
POST /api/ingest
body: { "lat": 31.2304, "lon": 121.4737, "radius": 1200, "limit": 20 }
→ { "added": 8, "skipped": 3, "items": [Poi, …], "source": "wikipedia|osm|mixed" }
```
- 抓取顺序：中文维基百科地理搜索（有图优先）→ OpenStreetMap Overpass（备选）
- **无缩略图的维基条目默认跳过**（盲盒揭晓需要图片，见 docs/real-geo.md §5.3）
- **去重**：同名或距离 < 30m 的已存在 POI 跳过（计入 skipped）
- 新建的点 `status = "draft"`、`source = 数据源`
- 每条抓取结果都要写入 `name/lat/lon/category/photoUrl/summary`

### 4.4 大模型：整理 / 编辑 / 分析
```
POST /api/llm/normalize   body: { "id": "poi-xxx" }   → { "poi": Poi, "changed": ["why","task","hints"] }
POST /api/llm/edit        body: { "id": "poi-xxx", "instruction": "把线索写得更口语一点" }
                           → { "poi": Poi, "changed": [...] }
POST /api/llm/analyze     body: { "ids": ["poi-x", "poi-y"] }   → { "items": [ { "id", "safety", "suggestion", "verdict" } ] }
POST /api/llm/analyze-all body: { "status": "draft" }           → { "analyzed": 12, "items": [...] }
```
- `analyze` 的 `verdict`：`"good" | "risky" | "reject"`，并给一句中文 `suggestion`
- **响应可带顶层 `mode`**：`"llm" | "offline" | "mixed"`，UI 用它提示「这条是模型产出还是规则产出」
- **保密校验（两条路径，语义不同）**：
  - **人工写入**（`POST/PUT /api/pois`）的 `hints` 含地名 → **拒绝**，返回 400 `NAME_LEAK`
  - **模型产出**的 `hints` 含地名 → **自动替换为「那里」**，不中断流程

### 4.5 大模型状态
```
GET /api/llm/status
→ { "mode": "llm" | "offline", "model": "deepseek-chat", "baseUrl": "https://api.deepseek.com/v1", "ready": true }
```
- 环境变量：`WA_LLM_BASE_URL`、`WA_LLM_API_KEY`、`WA_LLM_MODEL`
- **无 Key 时 `model` 返回 `"offline-rules"`**（不是配置里的模型名），避免让人误以为模型在跑
- **`ready` 的语义**：表示「服务端可以响应请求」，**不代表模型可用**；
  判断是否用真模型一律看 `mode`（`ready` 在离线时也可能为 `true`）
- **没有 key 时必须自动降级为 `offline` 规则模式**（见 §6），并在 UI 上明示「离线规则模式」

### 4.6 导出
```
POST /api/export
→ { "ok": true, "path": "../prototype/web/pois.json", "count": 18 }
```
导出格式（App 直接消费）：
```jsonc
{
  "version": 1,
  "exportedAt": 1731030000000,
  "count": 18,
  "pois": [
    {
      "id": "poi-7f3a9c", "name": "上海音乐厅",
      "lat": 31.22888889, "lon": 121.47333333,
      "category": "venue", "emoji": "🎻", "rarity": "epic", "area": "near",
      "address": "黄浦区 · 延安东路",
      "photoUrl": "https://…", "photoCredit": "Wikimedia Commons",
      "summary": "…", "why": "…", "task": "…", "hints": ["…","…","…"],
      "safety": { "day": 4, "night": 2, "nightVerdict": "caution" }
    }
  ]
}
```

### 4.7 统计
```
GET /api/stats
→ { "total": 40, "byStatus": { "draft": 20, "review": 8, "approved": 10, "rejected": 2 },
    "byCategory": { "museum": 5, … }, "withPhoto": 22, "withHints": 18 }
```

### 4.8 用户惊喜审核（读账号服务的 surprises 表）

惊喜存在**账号服务**的 SQLite（`<data>/account/blindwalk-users.db` 或 `walkaholic-users.db`），
不是后台自己的库。后台通过 `admin/server/surprises.mjs` 直接打开该库读写，
数据库路径优先级：`BW_ACCOUNT_DB` / `WA_ACCOUNT_DB` > `<admin data 的上级>/account/*.db` > `./account/data/*.db` > `/var/lib/blindwalk|walkaholic/account/*.db`。

`status` 语义：`waiting`（待寻，列表可见）/ `found`（已被找到）/ `hidden`（后台下架，列表不可见）。
账号服务的 `/api/surprises` 只查 `status='waiting'`，所以下架立刻生效，无需重启账号服务。

```
GET    /api/surprises/status
→ { "available": true, "dbPath": "/var/lib/blindwalk/account/blindwalk-users.db", "error": "" }

GET    /api/surprises?status=waiting|found|hidden|all&q=&limit=50&offset=0
→ { "items": [ {
      "id": "surprise-…", "authorName": "burier9424", "authorEmoji": "🐱",
      "areaLabel": "鼓楼 · 金银街", "message": "来找我", "clues": ["…","…"],
      "lat": 32.05975, "lon": 118.7713, "radiusMeters": 60,
      "status": "waiting", "finderName": null, "foundAt": null, "createdAt": 1794379424787,
      "hasPhoto": true, "photoBytes": 152340
    } ],
    "total": 1, "counts": { "waiting": 1, "found": 0, "hidden": 0 }, "limit": 50, "offset": 0 }
  # 注意：这里**会**返回 message 和照片是否存在（审核要看内容），
  # 与账号服务面向客户端的列表刻意隐藏 message/photo 的约束不同。

GET    /api/surprises/:id       → 同上单条
GET    /api/surprises/:id/photo → image/jpeg 二进制（作者原图；无图 404 NO_PHOTO）
PUT    /api/surprises/:id  { "status": "hidden" | "waiting" }
→ 更新后的单条。`found` 不允许手动改（409 ALREADY_FOUND）。
DELETE /api/surprises/:id       → { "ok": true }（彻底删除，不可恢复）

错误：`SURPRISES_UNAVAILABLE`（503，账号库不存在/无 surprises 表）/ `NOT_FOUND` / `NO_PHOTO` / `BAD_REQUEST`
```

---

## 5. 前端（管理界面）要求

单页应用，由同一个 Node 服务在 `/admin` 提供静态文件（`admin/public/`）。零外部依赖（不引 CDN、不用框架）。

必须包含：
1. **左侧筛选栏**：状态（草稿/待审/已通过/已拒绝）、类别、关键词搜索、有无图片
2. **中间列表**：缩略图 + 名称 + 类别 + 状态 + 更新时间；支持多选
3. **右侧编辑面板**：全字段可编辑（含 hints 三条分开输入、tags、safety）
4. **顶部操作条**：
   - 「抓取附近」：输入经纬度+半径 → 调 `/api/ingest`
   - 「AI 整理」「AI 编辑」「AI 分析」「AI 批量分析」
   - 「通过」「拒绝」「删除」
   - 「导出到 App」
5. **LLM 模式提示**：右上角显示 `大模型已就绪 / 离线规则模式`（调 `/api/llm/status`）
6. **保密检查**：hints 输入框旁边实时提示「⚠️ 含地名」并拒绝保存
7. 视觉沿用 App 的设计 token：奶油底 `#F5EEE2`、琥珀 `#E89B4C`、墨色 `#171410`、圆角 14–18px

---

## 6. 离线规则模式（没有 API Key 时的降级）

不能用「假装 AI」。没有 key 时：
- `normalize`：按类别模板补齐 `why/task/hints`（复用 `prototype/web/geo.js` 的 CATEGORY_META / HINTS 思路），返回 `mode: "offline"`
- `edit`：返回 400 `LLM_UNAVAILABLE`，并提示「需要配置 WA_LLM_API_KEY」
- `analyze`：用规则打分（有图片 +1、类别是公园/河岸 +1、hints 含地名 -3、缺 why/task -1），`verdict` 按分数给出
- UI 必须显式标注「离线规则模式（未配置大模型）」，让用户知道这不是模型输出

---

## 6.1 存储文件格式（内部实现约定，供需要兼容持久层时参考）

```jsonc
// admin/data/pois.json
{ "version": 1, "updatedAt": 1731030000000, "items": [ Poi, … ] }
```

- 写入：先写 `pois.json.tmp` 再 `rename`（原子）
- 文件损坏：备份为 `pois.json.corrupt-<ts>`，从空库启动，不崩
- 导出备份：`admin/data/pois.export.json`

## 7. 启动方式

```bash
cd admin
node server/index.mjs          # → http://127.0.0.1:8802/admin
```

可选环境变量：
```bash
WA_LLM_BASE_URL=https://api.deepseek.com/v1
WA_LLM_API_KEY=sk-xxxx
WA_LLM_MODEL=deepseek-chat
PORT=8802
```

---

## 8. 验收标准

| 项 | 要求 |
|---|---|
| 启动 | `node server/index.mjs` 一条命令起来，无外网依赖也能跑 |
| 数据 | `admin/data/pois.json` 原子写入（先写临时文件再 rename），坏文件不崩 |
| 接口 | §4 全部端点可用；参数错误返回 400，缺 id 返回 404 |
| 抓取 | 给定上海人民广场坐标能抓到 ≥5 个真实地标（含图片） |
| 模型 | 有 key 时真实调用；无 key 时降级且 UI 明示 |
| 保密 | hints 含地名（含前 2 字）时拒绝保存并提示 |
| 导出 | 生成 `prototype/web/pois.json`，App 能读到并优先使用 |
| 测试 | `node --test admin/tests/` 全绿（至少覆盖 CRUD / 去重 / 保密 / 导出 / 离线降级） |

---

## 8.1 待办

- [ ] 「＋ 新建空白 POI」入口（契约已支持 `POST /api/pois`，界面暂缺）
- [ ] 批量通过/拒绝改批量端点（当前逐条 PUT，量小无所谓）
- [ ] 真实大模型联调（需配置 `WA_LLM_API_KEY`）

## 9. 实现状态（2026-11-09）

| 模块 | 状态 |
|---|---|
| 服务端全部端点 | ✅ 51 项测试通过 |
| 管理界面（三栏 + AI 操作台） | ✅ 真实 API 联调通过 |
| 离线规则模式 | ✅ normalize/analyze 可用，edit 明确 400 |
| 导出 → App | ✅ `prototype/web/pois.json`，App 端 `source: "curated"` |
| 真实大模型调用 | ⏳ 待用户配置 `WA_LLM_API_KEY` |

### 4.9 服务端设置（AI 模型 / 微信登录）

后台顶部「设置」按钮打开。**保存后立即生效，不需要重启任何服务**。
实现方式：设置写数据库，服务端每次请求现读（AI 走后台自己的 `app_keys`，微信走账号库的 `settings`）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/llm/settings` | `{ settings: { 'llm.apiKey': {configured, value(掩码)}, 'llm.baseUrl', 'llm.model' }, llmEnabled, source }` |
| PUT | `/api/llm/settings` | body `{ settings: { ... } }`；空串 = 清除该项；未出现的项保持不动 |
| POST | `/api/llm/test` | 真的打一次模型（`max_tokens: 1`），返回 `{ ok, model }` 或 `{ ok:false, error }`；错误信息里的 Key 会换成掩码 |
| GET | `/api/account/settings` | 微信：`{ settings: { 'wechat.appid', 'wechat.secret'(掩码), 'wechat.universalLink' }, wechatEnabled, missing[], dbPath }` |
| PUT | `/api/account/settings` | 同上；直连账号库写入，账号服务下次请求即读到 |
| GET | `/api/account/settings/status` | `{ available, dbPath, error }`——账号库没建好时给明确原因 |

优先级：**数据库 > 环境变量 > 默认值**。所以老部署继续只靠 `BW_*` / `WA_*` 环境变量也能跑，
装了后台之后可以在线改，不用登服务器。

安全：
- 所有读接口只回掩码（前 4 + 后 4），绝不下发明文 Key / Secret
- `llm.test` 的失败信息会把 Key 替换成掩码（DeepSeek 的 401 会把 Key 后半段回显）
- 账号库没有 `settings` 表时返回 503 `SETTINGS_UNAVAILABLE` 并说明「重启一次账号服务」，
  **不会在这个进程里偷偷建表**（避免两处 schema 分叉）
