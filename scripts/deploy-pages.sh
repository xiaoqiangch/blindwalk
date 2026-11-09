#!/usr/bin/env bash
# 部署盲走 Web PWA 到 GitHub Pages（公网可访问，iPhone 出门也能用）。
#
# 产物：把 prototype/web 发布成 Pages 的网站根目录。
# 访问地址：https://<user>.github.io/blindwalk/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REPO="${BW_REPO:-xiaoqiangch/blindwalk}"
BRANCH="gh-pages"

echo "== 1) 检查工作区 =="
if [ -n "$(git status --porcelain prototype/web)" ]; then
  echo "⚠️  prototype/web 有未提交改动，先提交再部署。"
  git -c user.email=lead@blindwalk.local -c user.name="BlindWalk Lead" \
    commit -am "chore: snapshot prototype/web for deploy" || true
fi

echo "== 2) 用 subtree 推送 prototype/web 到 $BRANCH =="
# 用 git subtree split 把 prototype/web 摘成独立分支，避免整仓（含 iOS 源码）暴露在 Pages 上
SPLIT=$(git subtree split --prefix=prototype/web HEAD)
git push --force "git@github.com:${REPO}.git" "$SPLIT:refs/heads/${BRANCH}"
echo "   pushed $SPLIT -> $BRANCH"

echo "== 3) 开启 GitHub Pages（若未开）=="
gh api -X POST "repos/${REPO}/pages" \
  -f "source[branch]=${BRANCH}" -f "source[path]=/" 2>/dev/null \
  || gh api -X PUT "repos/${REPO}/pages" \
       -f "source[branch]=${BRANCH}" -f "source[path]=/" 2>/dev/null \
  || echo "   (Pages 可能已启用，继续)"

echo "== 4) 等 Pages 构建 =="
OWNER="${REPO%%/*}"
for i in $(seq 1 40); do
  STATUS=$(gh api "repos/${REPO}/pages" --jq '.status' 2>/dev/null || echo "unknown")
  URL=$(gh api "repos/${REPO}/pages" --jq '.html_url' 2>/dev/null || echo "")
  echo "   [$i] status=$STATUS url=$URL"
  if [ "$STATUS" = "built" ] && [ -n "$URL" ]; then break; fi
  sleep 6
done

echo
echo "✅ 部署地址：https://${OWNER}.github.io/blindwalk/"
echo "   手机用 Safari 打开 → 分享 → 添加到主屏幕"
