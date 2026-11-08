#!/usr/bin/env bash
# 用本机 Xcode 构建 iOS + watchOS（模拟器）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apple"
xcodebuild \
  -project BlindWalk.xcodeproj \
  -scheme BlindWalk \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "${1:-/tmp/blindwalk-dd}" \
  CODE_SIGNING_ALLOWED=NO \
  build | tee /tmp/blindwalk-build.log | grep -E "error:|warning:|BUILD SUCCEEDED|BUILD FAILED"
