#!/usr/bin/env bash
# 校验 Swift 源码：Shared/Core 完整类型检查（macOS SDK 可编译 Foundation-only 内核），全部文件语法检查。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPLE="$ROOT/apple"
fail=0

echo "== 1) Shared/Core + Shared/Design typecheck (macOS SDK) =="
if xcrun --sdk macosx swiftc -typecheck "$APPLE"/Shared/Design/Theme.swift "$APPLE"/Shared/Core/*.swift; then
  echo "OK: shared core typechecks"
else
  echo "FAIL: shared core typecheck"
  fail=1
fi

echo "== 2) swiftc -parse all sources =="
while IFS= read -r -d '' file; do
  if ! out=$(swiftc -parse "$file" 2>&1); then
    echo "FAIL: $file"
    echo "$out" | head -8
    fail=1
  fi
done < <(find "$APPLE" -name '*.swift' -print0)

if [[ $fail -eq 0 ]]; then
  echo "ALL SWIFT FILES OK"
else
  echo "SWIFT CHECK FAILED"
fi
exit $fail
