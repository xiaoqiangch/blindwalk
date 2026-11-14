#!/usr/bin/env bash
# 用本机 Chrome headless 截取 Web 原型的全部页面，输出到 screenshots/。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/prototype/web"
OUT="$ROOT/screenshots"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
UDD="/tmp/walkaholic-chrome-profile"
mkdir -p "$OUT" "$UDD"

if [[ ! -f "$WEB/index.html" ]]; then
  echo "prototype not ready: $WEB/index.html"
  exit 1
fi

shot() {
  local name="$1" url="$2" w="$3" h="$4"
  "$CHROME" \
    --headless=new --no-sandbox --disable-gpu \
    --disable-crash-reporter --disable-breakpad \
    --no-first-run --no-default-browser-check \
    --user-data-dir="$UDD" \
    --hide-scrollbars --force-device-scale-factor=2 \
    --virtual-time-budget=2200 \
    --window-size="$w,$h" \
    --screenshot="$OUT/$name.png" \
    "$url" >/dev/null 2>&1
  if [[ -f "$OUT/$name.png" ]]; then
    echo "ok  $name.png"
  else
    echo "FAIL $name"
  fi
}

BASE="file://$WEB/index.html"
shot 01-home        "$BASE?demo=1#/home"        390 844
shot 02-setup       "$BASE?demo=1#/setup"       390 844
shot 03-journey     "$BASE?demo=1#/journey"     390 844
shot 04-reveal      "$BASE?demo=1#/reveal"      390 844
shot 05-cards       "$BASE?demo=1#/cards"       390 844
shot 06-social      "$BASE?demo=1#/social"      390 844
shot 07-profile     "$BASE?demo=1#/profile"     390 844
shot 08-achievements "$BASE?demo=1#/achievements" 390 844
shot 09-watch       "file://$WEB/watch.html"    760 360

echo "done -> $OUT"
