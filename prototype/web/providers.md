# POI 多数据源模块（providers.js）

> 状态：v1（2026-11-09）· 零依赖 ES5 风格 IIFE · 供 PWA / GitHub Pages 直接用
> 文件：`prototype/web/providers.js`、`prototype/web/providers.md`、`prototype/web/tests/providers.test.mjs`
> 本模块不改现有 `app.js / geo.js / index.html`，由 Lead 接入。

---

## 1. 它解决什么

「盲走」PWA 原本只有 OSM Overpass + 维基百科两个免费源，用户嫌「地点就那几个」。
这个模块加上 **高德 / 百度**（用户自带 Key，JSONP 绕 CORS），统一去重排序后交给抽盒：

- 纯静态 HTTPS 环境（GitHub Pages）没有服务端代理 → 高德/百度只能走 **JSONP**
- Key 存 `localStorage('bw.keys.v1')`，**不硬编码、不上传到任何服务器**（只随请求发给对应服务商）
- 没配 Key 也能用：默认只跑 OSM + 中文维基
- 坐标统一成 **WGS-84** 再返回（高德 GCJ-02 / 百度 BD-09 在模块内转换，避免抽到点偏移几百米）

---

## 2. 快速接入（给 app.js）

```html
<!-- index.html：放在 app.js 之前 -->
<script src="providers.js"></script>
<script src="geo.js"></script>
<script src="app.js"></script>
```

```js
// 任意需要「附近真实地点」的地方（WGS-84 坐标，通常是 Geolocation）
BW_PROVIDERS.nearby({
  lat: 31.2304,
  lon: 121.4737,
  radius: 1200,
  limit: 30,
  sources: ['amap', 'baidu', 'osm', 'wiki'] // 可省略：有 Key 时全开，无 Key 时 osm+wiki
}).then(function (list) {
  // list 已去重、已按 distance 升序；坐标全部 WGS-84
  // 字段：{ id, name, lat, lon, category, address, photoUrl, photoCredit, source, distance }
});
```

**接入注意（容易踩）：**

1. **传入/拿出都必须当 WGS-84 用**。不要把 `geo.js` 里已转成 GCJ/BD 的坐标再传进来；本模块内部自己转。
2. `nearby` 最长可能等 **8 秒**（JSONP / 免费源超时）。UI 要有 loading；也可以只传 `sources:['osm','wiki']` 先快后补。
3. 某个源失败 **不会 reject**，只会从结果里缺席；用 `BW_PROVIDERS.lastReport()` 看每个源成功/失败（适合调试面板）。
4. 高德/百度返回的照片受服务商条款约束；若不想外链，接 `photoUrl` 时自行决定是否丢弃（`photoCredit` 已带）。
5. 免费源必须署名：OSM 要 `© OpenStreetMap contributors`，维基照片要 `photoCredit`（模块已提供 `Wikimedia Commons`）。
6. 如果页面以后加 CSP，需要放行 JSONP 的 script 域名：
   `script-src 'self' https://restapi.amap.com https://api.map.baidu.com`（按实际启用源）。
7. 图片走 `<img>` 不需要 CORS；JSONP 只负责拿 JSON。

---

## 3. API（唯一契约）

### `nearby(opts) -> Promise<Candidate[]>`

| opts | 说明 |
|---|---|
| `lat`, `lon` | 必填，**WGS-84** |
| `radius` | 米，默认 `1200`，夹在 `100…50000` |
| `limit` | 返回条数，默认 `30`，夹在 `1…100` |
| `sources` | 可选：`['amap','baidu','osm','wiki']`。**省略时**：配了哪个 Key 就带上对应付费源，再固定带 `osm+wiki`；未知值会被忽略 |

返回（已去重、已按 `distance` 升序、带 10% 半径容差过滤）：

```js
{
  id: 'amap-B0FFH1' | 'baidu-<uid>' | 'osm-node-123' | 'wiki-456',
  name: '星巴克(南京东路店)',
  lat: 31.2283, lon: 121.4714,   // WGS-84
  category: 'cafe',              // 17 类之一，见 §5
  address: '南京东路 100 号' | null,
  photoUrl: 'https://…' | null,
  photoCredit: '高德地图' | '百度地图' | 'Wikimedia Commons' | null,
  source: 'amap' | 'baidu' | 'osm' | 'wiki',
  distance: 171.6                // 米，相对 opts.lat/lon
}
```

### 其余契约 API

```js
BW_PROVIDERS.setKeys({ amap: '你的Web服务Key', baidu: '你的服务端AK' });
BW_PROVIDERS.getKeys();   // { amap: '***' | '', baidu: '***' | '' } —— 只回显是否配置，不返回明文
BW_PROVIDERS.status();    // { sources: [{id,label,enabled,reason}], keys: {...} }
BW_PROVIDERS.parseAmap(json);              // 高德响应 → Candidate[]（测试用）
BW_PROVIDERS.parseBaidu(json);             // 百度响应 → Candidate[]（测试用）
BW_PROVIDERS.dedupe(list, radiusMeters);   // 去重（默认 30m；测试/接入用）
```

`status()` 示例（没配 Key）：

```json
{
  "sources": [
    { "id": "amap",  "label": "高德地图",       "enabled": false, "reason": "未配置 Key" },
    { "id": "baidu", "label": "百度地图",       "enabled": false, "reason": "未配置 Key" },
    { "id": "osm",   "label": "OpenStreetMap", "enabled": true,  "reason": "" },
    { "id": "wiki",  "label": "中文维基百科",    "enabled": true,  "reason": "" }
  ],
  "keys": { "amap": "", "baidu": "" }
}
```

### 额外暴露（调试 / 测试 / 坐标转换）

```js
BW_PROVIDERS.mapCategory(raw, name);   // 17 类映射
BW_PROVIDERS.sortByDistance(list, lat, lon, radiusMeters);
BW_PROVIDERS.wgs84ToGcj02(lat, lon);   // 以及 gcj02ToWgs84 / wgs84ToBd09 / bd09ToWgs84
BW_PROVIDERS.lastReport();             // { at, sources: [{id,label,ok,count,error}] } 最近一次 nearby
```

---

## 4. Key 申请步骤

> Key 只存在用户浏览器 `localStorage`。`getKeys()` 永远只返回 `'***'`。
> 注意 JSONP 会把 Key 拼在 script 的 URL 上（浏览器开发者工具/网络日志可见），
> 这是纯静态 PWA 无代理的必然代价 → 建议用**独立、可随时吊销、限额**的 Key。

### 4.1 高德地图（Web 服务 Key）

1. 打开高德开放平台控制台：<https://console.amap.com/dev/key/app>
2. 注册/登录（个人开发者需实名认证）
3. 「应用管理 → 我的应用 → 创建新应用」
4. 添加 Key：**服务平台选「Web 服务」**（不要选「Web端(JS API)」，两者不通用）
5. 把 Key 填进 App 设置：`BW_PROVIDERS.setKeys({ amap: 'xxx' })`
6. 接口文档：<https://lbs.amap.com/api/webservice/guide/api/search>（周边搜索 `/v3/place/around`）
7. 免费额度/并发以控制台为准；Web 服务 Key 支持 IP 白名单，但浏览器端 IP 不固定，通常只能靠限额+吊销控制风险

### 4.2 百度地图（服务端 AK）

1. 打开百度地图开放平台控制台：<https://lbsyun.baidu.com/apiconsole/key>
2. 注册/登录并完成开发者认证
3. 「应用管理 → 创建应用」，应用类型选 **服务端**
4. 创建 AK 后勾选/确认可用服务包含 **地点检索（Place API v2）**
5. 填进 App：`BW_PROVIDERS.setKeys({ baidu: 'xxx' })`
6. 接口文档：<https://lbsyun.baidu.com/faq/api?title=webapi/guide/webservice-placeapi>
7. 注意：百度不同 AK 类型的白名单策略不同；如果返回 `status=2xx` 的权限/白名单错误，按控制台提示处理

### 4.3 OSM Overpass（免费，无需 Key）

- 公共端点（模块内置，按顺序 fallback）：
  - <https://overpass-api.de/api/interpreter>
  - <https://overpass.kumi.systems/api/interpreter>
  - <https://overpass.private.coffee/api/interpreter>
- 使用条款：<https://operations.osmfoundation.org/policies/overpass/>
- 请勿高频/大范围查询；数据署名 `© OpenStreetMap contributors`

### 4.4 中文维基百科（免费，无需 Key）

- 接口：`https://zh.wikipedia.org/w/api.php`（`generator=geosearch` + `origin=*`）
- 文档：<https://www.mediawiki.org/wiki/API:Geosearch>
- 图片要求来自 `thumb.wikimedia.org` / `upload.wikimedia.org`（模块已过滤）
- 文案/图片署名：`Wikimedia Commons`（模块已写入 `photoCredit`）

### 4.5 清空 / 轮换 Key

```js
BW_PROVIDERS.setKeys({ amap: '', baidu: '' }); // 内存 + localStorage 一起清
```

> 如果担心遗留：清空后可在浏览器 DevTools → Application → Local Storage 删除 `bw.keys.v1`。

---

## 5. 类别映射（17 类，与 geo.js `CATEGORY_META` 一致）

`mapCategory(raw, name)` 会把高德 `type`（如 `餐饮服务;咖啡厅;咖啡厅`）、百度 `detail_info.tag`（如 `博物馆`）、
或地点名（类别缺失时兜底）映射到：

| key | 中文 | 命中示例 |
|---|---|---|
| `cafe` | 咖啡窗口 | 咖啡 / 咖啡馆 / 星巴克 / 瑞幸 |
| `bookstore` | 书店 | 书店 / 书城 / 新华书店 |
| `library` | 图书馆 | 图书馆 / 阅览室 |
| `park` | 公园 | 公园 / 植物园 / 绿地 |
| `bench` | 长椅 | 长椅 / 长凳 |
| `bridge` | 桥 | 桥 / 天桥 / 大桥 |
| `art` | 涂鸦墙 | 美术馆 / 画廊 / 涂鸦 / 艺术墙 |
| `river` | 河岸 | 河 / 江 / 湖 / 码头 / 水岸 |
| `convenience` | 便利店 | 便利店 / 超市 / 全家 / 罗森 |
| `viewpoint` | 观景点 | 观景台 / 天台 / 塔 / 瞭望 |
| `garden` | 花园 | 花园 / 花圃 |
| `plaza` | 广场 | 广场 / 步行街 / 兜底 |
| `museum` | 博物馆 | 博物馆 / 纪念馆 / 展览馆 |
| `historic` | 老房子 | 故居 / 旧址 / 历史建筑 / 弄堂 |
| `venue` | 演出场所 | 音乐厅 / 剧院 / 剧场 / 体育场 |
| `temple` | 寺庙教堂 | 寺 / 庙 / 教堂 / 清真 |
| `market` | 市集 | 市集 / 市场 / 菜场 |

映射是**尽力而为**（关键词规则）：拿不准时落到 `plaza`。接入方仍可用 `geo.js` 的 `CATEGORY_META` 生成 emoji/task。

---

## 6. 坐标系（务必看）

| 数据源 / 输入 | 坐标系 | 本模块的处理 |
|---|---|---|
| 浏览器 `navigator.geolocation`、`geo.js`、OSM、维基 | **WGS-84** | 原样使用 |
| 高德 Web 服务（周边搜索） | **GCJ-02**（火星坐标） | 请求前 `WGS84→GCJ02`；解析回来 `GCJ02→WGS84` |
| 百度地图 Place API | **BD-09**（百度坐标） | 请求前 `WGS84→BD09`；解析回来 `BD09→WGS84` |

- 上海地区 GCJ-02 相对 WGS-84 偏移约 **300–500 米**；BD-09 再叠加一层偏移。
- 不做转换的后果：抽到的点会整体偏移，`≤30m 到达判定` 和线索距离都会错。
- 转换算法为业界通用公式；GCJ-02 逆算用 **3 次迭代**，往返误差 **< 3 米**（测试有断言）。
- 境外坐标不做偏移（转换函数里判断 `outOfChina` 直接返回原值）。
- 对外只承诺 **WGS-84**：`nearby` 的输入输出、`parseAmap/parseBaidu` 的输出都是 WGS-84。

---

## 7. 去重与排序规则

- **去重**（`dedupe(list, 30)`）：
  - 同名（去空白、忽略大小写）**或** 距离 < 30m 视为同一点
  - 质量分：`有图 +4`、`有地址 +2`、`高德/百度 +1`；保留分高的一条，并把另一条缺失的 `photoUrl/address/category` 补过来
- **排序**（`sortByDistance`）：按到请求点的 Haversine 距离升序；带 `distance`（米，0.1 精度）
- `nearby` 会按半径过滤，留 **10% 容差**（应对服务商按半径返回边缘点）
- `limit` 在去重排序后截断

---

## 8. 超时与降级

| 源 | 超时 | 失败行为 |
|---|---|---|
| 高德 JSONP | 8s | 该源返回空，其它源照常 |
| 百度 JSONP | 8s | 同上（含 status≠0 的权限/配额错误） |
| OSM Overpass | 单端点 4.5s，整体 8s，失败换下一个端点 | 同上 |
| 维基百科 | 8s | 同上 |

- 所有源失败时 `nearby` 返回 `[]`，**不 reject**（只有 `lat/lon` 非法才 reject）。
- **未配置 Key 的源不会发请求**：`status()` 里 `enabled:false, reason:'未配置 Key'`；`nearby` 的 `lastReport()` 里也会记录 `error:'未配置 Key'`。
- JSONP 实现：动态 `<script>` + 唯一全局回调 `bwCb_N_xxx`；**8s 超时清理**；结束（成功/失败/超时）都会 `delete window[callback]` 并移除 script 节点，不留全局污染。

---

## 9. 安全与合规提示

1. **Key 安全**：只存 `localStorage`；`getKeys()` 只回 `'***'`；不向任何第三方服务器发送（只在请求高德/百度时拼进 URL）。JSONP 的 Key 会出现在网络日志里，属于纯静态前端的固有限制。
2. **JSONP 不能带 Cookie / 自定义 Header**：script 标签只能 GET；不要期望带 Authorization；两个服务商的 JSONP 只依赖 `key/ak` 参数。
3. **服务商条款**：高德/百度对 POI 展示、图片外链、署名/Logo 有各自要求（例如地图展示通常要求版权署名）。本模块只取数据和 `photoUrl`，是否展示由接入方决定；正式上线前请按各自条款补署名/Logo。
4. **免费源署名**：OSM `© OpenStreetMap contributors`；维基/图片 `Wikimedia Commons`（模块写入 `photoCredit`）。
5. **频率限制**：Overpass 是公共公益服务，请避免高频抽盒；高德/百度按账号配额，超限会返回错误 status（模块会在 `lastReport` 里显示）。

---

## 10. 测试

```bash
cd /Users/chenxiaoqiang/Projects/BlindWalk
node --test prototype/web/tests/providers.test.mjs
```

当前覆盖（14 个用例，全部纯函数、无网络）：

- WGS84↔GCJ02 / WGS84↔BD09 往返误差（<3m / <5m）、境外坐标不变
- `parseAmap`：字段映射、类别、图片、地址、GCJ→WGS、坏数据
- `parseBaidu`：字段映射、类别、图片、地址、BD→WGS、坏数据
- `mapCategory`：17 类规则 + 兜底
- `dedupe`：同名合并、30m 内合并、优先有图/有地址、半径参数
- `sortByDistance`：升序 + distance + 半径过滤
- `status/getKeys/setKeys`：无 Key 降级、脱敏、localStorage 持久化
- `nearby`：非法坐标 reject；无 Key 默认只尝试 osm+wiki；显式 sources 过滤未知源

---

## 11. 已知限制 / 可以下一轮做的事

1. **没有缓存**：每次 `nearby` 都会请求（JSONP 无法设置自定义 cache header）。可以在 `app.js` 层按坐标+半径做 6h 缓存，减少配额消耗。
2. **百度固定 `query=生活服务`**：返回偏「生活服务」类目；若要更全，需要多 query 并发（当前契约按一条实现）。
3. **无分页**：高德 `offset` 上限 25、百度 `page_size` 上限 20、维基 20 条；`limit` 只是上限，实际受各家单页限制。
4. **类别映射是关键词规则**：高德/百度长尾类别可能落到 `plaza`，接入方可以按 `name` 再修正。
5. **无服务端去重**：只在本模块结果内去重；与后台策展 `pois.json` / 已有卡片去重要在 `app.js` 层做（现有 geo.js 已有类似逻辑）。
6. **JSONP 失败只能拿到 `script.onerror`**：拿不到 HTTP 状态码；高德/百度的业务错误（Key 无效、配额）会以 JSON `status/info` 形式返回，模块会抛出可读错误并记录到 `lastReport`。
