#!/usr/bin/env bash
# 启动账号服务（注册/登录/资料同步）
#   bash scripts/start-account.sh
# 默认 http://127.0.0.1:8803 ；App 里在「我的 → 账号」填这个地址即可
set -uo pipefail
cd "$(dirname "$0")/.."
if [ -f account/.env ]; then
  set -a; . account/.env; set +a
fi
echo "═══════════════════════════════════════════════"
echo " 步迷 · 账号服务"
echo "═══════════════════════════════════════════════"
echo " 接口:     http://127.0.0.1:${PORT:-8803}/api/health"
echo " 数据库:   account/data/walkaholic-users.db"
echo " App 配置: 打开 App → 我的 → 账号 → 服务地址填 http://127.0.0.1:${PORT:-8803}"
echo "═══════════════════════════════════════════════"
exec node account/server/index.mjs
