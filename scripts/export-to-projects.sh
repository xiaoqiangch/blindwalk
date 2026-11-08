#!/usr/bin/env bash
# 把项目同步到用户的 ~/Projects（实际为 /Volumes/XQProjects/projects）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$HOME/Projects/BlindWalk}"
mkdir -p "$DEST"
rsync -a --delete \
  --exclude '.chrome-headless' \
  --exclude '.DS_Store' \
  "$ROOT/" "$DEST/"
echo "synced -> $DEST"
du -sh "$DEST"
