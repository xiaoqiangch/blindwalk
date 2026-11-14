#!/usr/bin/env bash
# 把后台数据库里的地图 Key 注入 iOS 资源目录（构建前运行；文件不进 git）
#   bash scripts/inject-ios-mapkeys.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
DB="${WA_ADMIN_DB:-admin/data/walkaholic.db}"
OUT="apple/App/Resources/mapkeys.json"
if [ ! -f "$DB" ]; then
  echo "⚠️  找不到后台数据库 $DB，iOS 将只跑 OSM/维基（或从远程 mapkeys.json 拉取）"
  rm -f "$OUT"
  exit 0
fi
/opt/homebrew/bin/node scripts/export-mapkeys.mjs "$DB" > "$OUT" 2>/dev/null
/opt/homebrew/bin/node -e "
const j=require('./$OUT');
console.log('✅ 已注入 iOS Key：高德=' + (j.keys.amap?'已配置':'未配置') + ' 百度=' + (j.keys.baidu?'已配置':'未配置'));
"
