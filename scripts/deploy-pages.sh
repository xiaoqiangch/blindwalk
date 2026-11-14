#!/usr/bin/env bash
# 部署步迷 Web PWA 到 GitHub Pages（公网可访问，iPhone 出门也能用）。
#
# 产物：把 prototype/web 发布成 Pages 的网站根目录。
# 访问地址：https://<user>.github.io/walkaholic/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REPO="${WA_REPO:-xiaoqiangch/walkaholic}"
BRANCH="gh-pages"

echo "== 1) 检查工作区 =="
if [ -n "$(git status --porcelain prototype/web)" ]; then
  echo "⚠️  prototype/web 有未提交改动，先提交再部署。"
  git -c user.email=lead@walkaholic.local -c user.name="Walkaholic Lead" \
    commit -am "chore: snapshot prototype/web for deploy" || true
fi

echo "== 2) 用 subtree 生成网站快照 =="
# 用 git subtree split 把 prototype/web 摘成独立分支，避免整仓（含 iOS 源码）暴露在 Pages 上
SPLIT=$(git subtree split --prefix=prototype/web HEAD)
echo "   split=$SPLIT"

echo "== 2.5) 注入后台下发的地图 Key（只进 gh-pages 快照，不进主仓）=="
WT="/tmp/wa-pages-wt-$$"
MAPKEYS_JSON=""
if [ -f admin/data/walkaholic.db ]; then
  MAPKEYS_JSON="$(/opt/homebrew/bin/node scripts/export-mapkeys.mjs admin/data/walkaholic.db 2>/dev/null || true)"
fi
if [ -n "$MAPKEYS_JSON" ]; then
  git worktree add -f --detach "$WT" "$SPLIT" >/dev/null 2>&1
  printf '%s\n' "$MAPKEYS_JSON" > "$WT/mapkeys.json"
  ( cd "$WT" && git add -A mapkeys.json && \
    git -c user.email=deploy@walkaholic.local -c user.name="Walkaholic Deploy" \
      commit -qm "chore(pages): 注入后台下发的地图 Key" >/dev/null 2>&1 ) || true
  PUSH_REF=$(cd "$WT" && git rev-parse HEAD)
  git worktree remove --force "$WT" >/dev/null 2>&1 || true
  echo "   已注入 mapkeys.json（来源：admin/data/walkaholic.db）"
else
  PUSH_REF="$SPLIT"
  echo "   ⚠️  没有读到后台 Key，本次仅部署免费源版本"
fi

echo "== 3) 推送 $BRANCH =="
git push --force "git@github.com:${REPO}.git" "${PUSH_REF}:refs/heads/${BRANCH}"
echo "   pushed $PUSH_REF -> $BRANCH"

echo "== 4) 开启 GitHub Pages（若未开）=="
gh api -X POST "repos/${REPO}/pages" \
  -f "source[branch]=${BRANCH}" -f "source[path]=/" 2>/dev/null \
  || gh api -X PUT "repos/${REPO}/pages" \
       -f "source[branch]=${BRANCH}" -f "source[path]=/" 2>/dev/null \
  || echo "   (Pages 可能已启用，继续)"

echo "== 5) 等 Pages 构建 =="
OWNER="${REPO%%/*}"
for i in $(seq 1 40); do
  STATUS=$(gh api "repos/${REPO}/pages" --jq '.status' 2>/dev/null || echo "unknown")
  URL=$(gh api "repos/${REPO}/pages" --jq '.html_url' 2>/dev/null || echo "")
  echo "   [$i] status=$STATUS url=$URL"
  if [ "$STATUS" = "built" ] && [ -n "$URL" ]; then break; fi
  sleep 6
done

echo
echo "✅ 部署地址：https://${OWNER}.github.io/walkaholic/"
echo "   手机用 Safari 打开 → 分享 → 添加到主屏幕"
