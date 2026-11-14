# 步迷 · 兴趣点管理后台

给「步迷」的 POI 数据做管理：**公开数据收集 → 大模型整理/分析 → 人工审核 → 导出给 App**。

```bash
bash scripts/start-admin.sh
# → http://127.0.0.1:8802/admin
```

| 文档 | 内容 |
|---|---|
| [docs/CONTRACT.md](docs/CONTRACT.md) | 数据模型 + HTTP API 契约（前后端唯一真相） |
| [docs/SETUP-LLM.md](docs/SETUP-LLM.md) | 配置大模型（DeepSeek / 火山 / 百炼 / 本地 Ollama） |

## 三块能力

| 能力 | 说明 |
|---|---|
| **收集整理** | 按坐标+半径从中文维基百科 / OpenStreetMap 抓真实地标，落成草稿 |
| **编辑处理** | 人工编辑全字段；也可让大模型改写文案、生成三阶线索、补任务 |
| **分析判断** | 大模型评估「适不适合做盲盒目的地」（可达性/安全/独特/保密），给出 verdict |
| **导出上架** | 审核通过的点导出成 `prototype/web/pois.json`，App 优先使用 |

## 数据流

```
公开数据（维基 / OSM）
      ↓  POST /api/ingest
   admin/data/pois.json（草稿）
      ↓  AI 整理 / 编辑 / 分析 + 人工审核
   status = approved
      ↓  POST /api/export
prototype/web/pois.json
      ↓
   App（PWA）启动时读取，优先于自动抓取
```

## v2 新增

| 项 | 说明 |
|---|---|
| **登录** | 必须登录才能访问；`WA_ADMIN_PASSWORD` 或首次启动自动生成随机密码（见 [docs/SECURITY.md](docs/SECURITY.md)） |
| **SQLite** | 存储从 JSON 改为 `node:sqlite`（仍零 npm 依赖），启动自动迁移旧数据 |
| **安全分级** | 每条 POI 有 `safety.day / night / nightVerdict`，用于判断「夜里安不安全」；导出到 App 时一并带上 |
