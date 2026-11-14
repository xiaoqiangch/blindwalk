#!/usr/bin/env bash
# 在 iOS 模拟器里跑「步迷」，并把定位/权限一次配好。
#
# 为什么需要这个脚本：
#   模拟器默认没有「当前位置」，CLLocationManager.requestLocation() 会直接
#   kCLErrorLocationUnknown 失败，App 就进入「没找到真实地点」面板 —— 不是代码坏了，
#   是模拟器没有定位数据。simctl location set 之后必须重新启动 App 才会重新取点。
#
# 用法：
#   scripts/sim-run.sh                # 自动选一台已启动/可启动的 iPhone
#   scripts/sim-run.sh <UDID>         # 指定设备
#   LAT=31.2304 LON=121.4737 scripts/sim-run.sh    # 换坐标（默认上海人民广场）
#   scripts/sim-run.sh --walk         # 沿途 1.2km 的模拟步行（会一直动）
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apple"

BUNDLE_ID="com.walkaholic.app"
LAT="${LAT:-31.2304}"
LON="${LON:-121.4737}"
WALK=0
TARGET=""
for arg in "$@"; do
  case "$arg" in
    --walk) WALK=1 ;;
    *) TARGET="$arg" ;;
  esac
done

if [ -z "$TARGET" ]; then
  TARGET=$(xcrun simctl list devices available -j | python3 -c '
import json,sys
d=json.load(sys.stdin)["devices"]
booted=[]; iphones=[]
for runtime, devs in d.items():
    if "iOS" not in runtime: continue
    for dev in devs:
        if dev.get("isAvailable") is False: continue
        if not dev["name"].startswith("iPhone"): continue
        (booted if dev["state"]=="Booted" else iphones).append(dev["udid"])
print((booted or iphones or [""])[0])
')
fi
if [ -z "$TARGET" ]; then echo "❌ 没有可用的 iPhone 模拟器，先在 Xcode > Window > Devices 里建一台。"; exit 1; fi
echo "== 设备 $TARGET"

STATE=$(xcrun simctl list devices | grep "$TARGET" | grep -oE "\((Booted|Shutdown)\)" | tr -d '()')
if [ "$STATE" != "Booted" ]; then
  echo "== 启动模拟器"
  xcrun simctl boot "$TARGET" 2>/dev/null
fi
xcrun simctl bootstatus "$TARGET" -b >/dev/null 2>&1

echo "== 设置定位 $LAT,$LON"
if [ "$WALK" = "1" ]; then
  # 从当前位置往东北走 1.2km，20 个点、每 5 秒一个点
  xcrun simctl location "$TARGET" start --speed=4 \
    "$LAT,$LON" \
    "$(python3 -c "print(f'{$LAT+0.008},{$LON+0.010}')")"
else
  xcrun simctl location "$TARGET" set "$LAT,$LON"
fi

# 只有 App 已安装时才能授权；未安装时忽略失败
xcrun simctl privacy "$TARGET" grant location "$BUNDLE_ID" 2>/dev/null
xcrun simctl privacy "$TARGET" grant location-always "$BUNDLE_ID" 2>/dev/null

echo "== 构建（增量）"
xcodebuild -project Walkaholic.xcodeproj -scheme Walkaholic \
  -destination "id=$TARGET" -derivedDataPath ./build \
  build 2>&1 | grep -E "error:|BUILD SUCCEEDED|BUILD FAILED"

APP=./build/Build/Products/Debug-iphonesimulator/Walkaholic.app
[ -d "$APP" ] || { echo "❌ 构建产物不存在：$APP"; exit 1; }

echo "== 安装 + 启动"
xcrun simctl install "$TARGET" "$APP"
xcrun simctl terminate "$TARGET" "$BUNDLE_ID" 2>/dev/null
xcrun simctl launch "$TARGET" "$BUNDLE_ID" >/dev/null

cat <<EOF

完成。定位已设为 ${LAT},${LON}。若界面还提示「没拿到真实位置」：
  1. 确认 设置 > 隐私与安全性 > 定位服务 里「步迷」是「使用期间」；
  2. 定位是启动时取的，改完坐标要重新启动 App（脚本已做）；
  3. 想看走动效果：scripts/sim-run.sh --walk
EOF
