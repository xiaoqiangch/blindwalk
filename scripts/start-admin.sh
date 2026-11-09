#!/usr/bin/env bash
# 启动兴趣点管理后台
#   bash scripts/start-admin.sh
#   BW_LLM_API_KEY=sk-xxx bash scripts/start-admin.sh   # 启用大模型
set -uo pipefail
cd "$(dirname "$0")/.."

if [ -f admin/.env ]; then
  set -a; . admin/.env; set +a
fi

echo "═══════════════════════════════════════════════"
echo " 盲走 BlindWalk · 兴趣点管理后台"
echo "═══════════════════════════════════════════════"
echo " 管理界面:  http://127.0.0.1:${PORT:-8802}/admin  （v2 起需要登录）"
echo " 接口状态:  http://127.0.0.1:${PORT:-8802}/api/llm/status"
echo
if [ -z "${BW_ADMIN_PASSWORD:-}" ]; then
  echo " 🔑 未设置 BW_ADMIN_PASSWORD → 首次启动会生成随机密码，看下面的启动日志"
fi
if [ -z "${BW_LLM_API_KEY:-}" ]; then
  echo " ⚠️  未配置 BW_LLM_API_KEY → 大模型将降级为「离线规则模式」"
  echo "    配置方法见 admin/docs/SETUP-LLM.md"
else
  echo " ✅ 大模型已配置: ${BW_LLM_MODEL:-deepseek-chat} @ ${BW_LLM_BASE_URL:-https://api.deepseek.com/v1}"
fi
echo "═══════════════════════════════════════════════"
echo
exec node admin/server/index.mjs
