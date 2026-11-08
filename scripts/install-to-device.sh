#!/usr/bin/env bash
# 把盲走安装到已连接的 iPhone 真机。
#
# 前提（一次性）：
#   1. Xcode → Settings → Accounts 登录 Apple ID（免费个人账号即可，7 天有效）
#   2. iPhone 用「数据线」连接（不是充电线），解锁并点「信任」
#   3. 可选：export DEVELOPMENT_TEAM=XXXXXXXXXX（不设则用 Xcode 里选的默认 Team）
#
# 用法：
#   scripts/install-to-device.sh            # 自动检测唯一真机
#   scripts/install-to-device.sh <UDID>     # 指定设备
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apple"

echo "== 1) 检测已连接的真机（不含模拟器）=="
DEVICES_JSON=$(xcrun devicectl list devices --json-output /tmp/bw-devices.json >/dev/null 2>&1; cat /tmp/bw-devices.json 2>/dev/null)
python3 - <<'PY'
import json, sys
try:
    d = json.load(open('/tmp/bw-devices.json'))
except Exception:
    print("（无法读取设备列表）"); sys.exit(0)
rows = []
for dev in d.get('result', {}).get('devices', []):
    if str(dev.get('reality', '')).lower().startswith('physical'):
        props = dev.get('properties', {})
        rows.append((dev.get('name'), dev.get('identifier')))
if not rows:
    print("❌ 没有检测到物理 iPhone。请检查：数据线（非充电线）、解锁、点『信任』。")
else:
    for name, ident in rows:
        print(f"✅ 真机: {name}  {ident}")
PY

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  TARGET=$(python3 - <<'PY'
import json
d = json.load(open('/tmp/bw-devices.json'))
for dev in d.get('result', {}).get('devices', []):
    if str(dev.get('reality','')).lower().startswith('physical'):
        print(dev.get('identifier')); break
PY
)
fi
if [ -z "$TARGET" ]; then echo "没有可用真机，退出。"; exit 1; fi

echo "== 2) 构建（自动签名 + 自动更新描述文件）=="
TEAM_ARGS=()
if [ -n "${DEVELOPMENT_TEAM:-}" ]; then
  TEAM_ARGS=(DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM")
fi
xcodebuild \
  -project BlindWalk.xcodeproj \
  -scheme BlindWalk \
  -destination "id=$TARGET" \
  -derivedDataPath /tmp/blindwalk-dd-device \
  -allowProvisioningUpdates \
  "${TEAM_ARGS[@]}" \
  build 2>&1 | tee /tmp/blindwalk-device-build.log | grep -E "error:|warning: .*signing|BUILD SUCCEEDED|BUILD FAILED"

APP=/tmp/blindwalk-dd-device/Build/Products/Debug-iphoneos/BlindWalk.app
if [ ! -d "$APP" ]; then
  echo "❌ 构建产物不存在：$APP"
  echo "   若是签名错误，请先在 Xcode 里打开工程 → Signing & Capabilities → 选择 Team 后重试。"
  exit 1
fi

echo "== 3) 安装到 $TARGET =="
xcrun devicectl device install app --device "$TARGET" "$APP"
echo "== 4) 启动 =="
xcrun devicectl device process launch --device "$TARGET" com.blindwalk.app || true
echo "完成。手机上打开『盲走』即可；首次需在 设置→通用→VPN与设备管理 里信任开发者证书。"
