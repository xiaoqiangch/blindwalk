#!/usr/bin/env bash
# 用本机 Xcode 构建 iOS + watchOS（模拟器）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apple"
xcodebuild \
  -project Walkaholic.xcodeproj \
  -scheme Walkaholic \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "${1:-/tmp/walkaholic-dd}" \
  CODE_SIGNING_ALLOWED=NO \
  build | tee /tmp/walkaholic-build.log | grep -E "error:|warning:|BUILD SUCCEEDED|BUILD FAILED"
