# 配置大模型

后台的「收集整理 / 编辑处理 / 分析判断」三组能力都通过**同一个 OpenAI 兼容接口**调用，
所以国内常用的大模型服务都能接。

## 支持的服务

| 服务 | WA_LLM_BASE_URL | WA_LLM_MODEL |
|---|---|---|
| **DeepSeek**（推荐，便宜） | `https://api.deepseek.com/v1` | `deepseek-chat` |
| **火山方舟 Ark** | `https://ark.cn-beijing.volces.com/api/v3` | 你的推理接入点 ID（`ep-xxxx`）或模型名 |
| **阿里云百炼** | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| **Moonshot** | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o-mini` |
| 本地 Ollama | `http://127.0.0.1:11434/v1` | `qwen2.5:7b` |

## 配置方法（任选一种）

### 方式 1：环境变量（临时）
```bash
WA_LLM_API_KEY=sk-xxxx \
WA_LLM_BASE_URL=https://api.deepseek.com/v1 \
WA_LLM_MODEL=deepseek-chat \
bash scripts/start-admin.sh
```

### 方式 2：`.env` 文件（推荐，一次配好）
```bash
cp admin/.env.example admin/.env
# 编辑 admin/.env，填入 key
bash scripts/start-admin.sh
```

`.env` 会被 `.gitignore` 忽略，不会被提交。

## 验证是否生效

```bash
curl -s http://127.0.0.1:8802/api/llm/status
# 期望：{"mode":"llm","model":"deepseek-chat","ready":true,...}
```

打开管理界面右上角应显示「大模型已就绪 · deepseek-chat」。

## 没有 key 会怎样

**不会假装在调用模型。** 后台会自动进入「离线规则模式」：

| 能力 | 离线模式行为 |
|---|---|
| 收集整理 | 用内置类别模板生成 why / task / hints（和 App 内置文案同源），足够冷启动 |
| 编辑处理 | 不支持，返回 400 并提示「需要配置 WA_LLM_API_KEY」 |
| 分析判断 | 用规则打分（有图 +1、公园/河岸 +1、hints 含地名 -3、缺 why/task -1）给出 verdict |

界面右上角会明确写「离线规则模式（未配置大模型）」，AI 编辑按钮置灰。

## 成本参考

整理一条 POI 大约 800~1500 tokens（输入+输出）。
按 DeepSeek 价格，**整理 1000 条大约几块钱**。批量分析更便宜（只要结构化判断，不需要长文案）。
