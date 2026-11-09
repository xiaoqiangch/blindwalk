#!/usr/bin/env bash
# 按地址抓取兴趣点（地理编码 → 后台 ingest）
#   bash scripts/ingest-address.sh "南京市鼓楼区金银街16号"            # 默认半径 1500m
#   bash scripts/ingest-address.sh "南京市鼓楼区金银街16号" 2500 20
#
# 需要：后台已启动（scripts/start-admin.sh），并设置 BW_ADMIN_PASSWORD
set -uo pipefail
ADDRESS="${1:-}"
RADIUS="${2:-1500}"
LIMIT="${3:-20}"
BASE="${BW_ADMIN_URL:-http://127.0.0.1:8802}"
PASS="${BW_ADMIN_PASSWORD:-}"

if [ -z "$ADDRESS" ]; then
  echo "用法：bash scripts/ingest-address.sh \"<地址>\" [半径米] [数量]"
  exit 1
fi
if [ -z "$PASS" ]; then
  echo "需要 BW_ADMIN_PASSWORD（后台登录密码）"
  exit 1
fi

# 地址常有门牌号在 OSM 里查不到：逐级退化成「街道」「区+街道」再试
geocode() {
  local q="$1"
  curl -s -m 20 -H 'User-Agent: BlindWalkPrototype/0.1 (contact: dev@blindwalk.local)' \
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=zh-CN&q=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$q")" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);if(!j.length){console.log('')}else{console.log(j[0].lat+','+j[0].lon+'|'+j[0].display_name)}}catch(e){console.log('')}})"
}

echo "① 地理编码：${ADDRESS}"
CANDIDATES="$ADDRESS"
# 用 Python 生成退化候选（BSD sed 的 ERE 不支持 .*?，避免踩坑）
CANDIDATES=$(python3 - "$ADDRESS" <<'PYEOF'
import re, sys
addr = sys.argv[1].strip()
out = [addr]
# 1) 去掉门牌号（末尾的数字 + 号/弄/栋/室/楼）
stripped = re.sub(r'[0-9]+[号弄栋室楼]?$', '', addr).strip()
if stripped and stripped != addr:
    out.append(stripped)
# 2) 只保留「区/县 + 后面部分」
m = re.search(r'[^省市]*?[区县].*$', addr)
if m and m.group(0) not in out:
    out.append(m.group(0))
# 3) 最后再退到「街道/路」本身
m2 = re.search(r'([\u4e00-\u9fa5]{2,8}(?:街|路|大道|巷|胡同))', addr)
if m2 and m2.group(1) not in out:
    out.append(m2.group(1))
print('\n'.join(out))
PYEOF
)

COORD=""
MATCHED=""
while IFS= read -r q; do
  [ -z "${q:-}" ] && continue
  RES=$(geocode "$q")
  if [ -n "$RES" ]; then
    COORD="${RES%%|*}"
    MATCHED="${RES#*|}"
    echo "  → 命中「${q}」：${MATCHED}"
    break
  fi
  sleep 1   # Nominatim 限速：每秒最多 1 次
done <<< "$CANDIDATES"

if [ -z "$COORD" ]; then
  echo "  ✗ 没找到这个地址。可以手工指定坐标："
  echo "     curl -X POST $BASE/api/ingest -H 'content-type: application/json' -d '{\"lat\":32.0598,\"lon\":118.7713,\"radius\":1500}'"
  exit 1
fi
LAT="${COORD%%,*}"
LON="${COORD##*,}"
echo "  坐标：${LAT}, ${LON}"

echo "② 登录后台"
COOKIE="/tmp/bw-ingest-cookie.$$"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -c "$COOKIE" -X POST "$BASE/api/auth/login" \
  -H 'content-type: application/json' -d "{\"password\":\"$PASS\"}")
if [ "$CODE" != "200" ]; then
  echo "  ✗ 登录失败（HTTP $CODE），检查 BW_ADMIN_PASSWORD"
  rm -f "$COOKIE"; exit 1
fi
echo "  ✓ 已登录"

echo "③ 抓取附近 ${RADIUS}m（最多 ${LIMIT} 条）"
curl -s -b "$COOKIE" -m 90 -X POST "$BASE/api/ingest" -H 'content-type: application/json' \
  -d "{\"lat\":$LAT,\"lon\":$LON,\"radius\":$RADIUS,\"limit\":$LIMIT}" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      try{const j=JSON.parse(s);
        console.log('  新增 '+j.added+' 条，跳过 '+j.skipped+' 条（来源：'+j.source+'）');
        (j.items||[]).forEach(p=>console.log('   • '+p.name+' ['+p.category+']'+(p.photoUrl?' 📷':'')));
      }catch(e){console.log('  解析失败：'+s.slice(0,300))}})"

echo
echo "④ 下一步：打开 $BASE/admin 勾选这些草稿 → 「AI 整理」→「通过」→「导出到 App」"
rm -f "$COOKIE"
