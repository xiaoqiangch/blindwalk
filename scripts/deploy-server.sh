#!/usr/bin/env bash
# 把步迷（Web PWA + 账号服务 + POI 后台）部署到自己的服务器
#
#   bash scripts/deploy-server.sh [user@host]
#
# 前置（服务器已具备）：nginx、Node ≥22、certbot
#
# 目录 / 服务名 / 环境变量前缀都**与线上实际部署保持一致**。
# 线上是早期「步谜 / Bumia」时代部署的，改名的风险大于收益：
# 数据目录、systemd 单元名、nginx 站点名、SQLite 文件名都已经是这套。
#
#   /opt/blindwalk/web        静态 PWA（含 mapkeys.json，运行时注入、不进 git）
#   /opt/blindwalk/account    账号服务（systemd blindwalk-account，127.0.0.1:8803）
#   /opt/blindwalk/admin      POI / 地图 Key / 用户惊喜后台（blindwalk-admin，8802）
#   /var/lib/blindwalk/{account,admin}   数据（SQLite，不进 git）
#
# 环境变量前缀用 BW_（线上单元文件已经是这个）。代码里 WA_ / BW_ 两个前缀都认，
# WA_ 优先，因此新代码可以照常写 WA_。
#
# 可用覆盖：
#   WA_DOMAIN=example.com            域名
#   WA_REMOTE_DIR=/opt/blindwalk     远端根目录
#   WA_DATA_DIR=/var/lib/blindwalk   远端数据目录
#   WA_ADMIN_PASSWORD=xxx            固定后台密码（不传 = 沿用服务器上已有的）
#   WA_LLM_API_KEY=sk-xxx            顺带配置后台大模型
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

HOST="${1:-xqlounge.top}"
DOMAIN="${WA_DOMAIN:-xqlounge.top}"
REMOTE_DIR="${WA_REMOTE_DIR:-/opt/blindwalk}"
DATA_DIR="${WA_DATA_DIR:-/var/lib/blindwalk}"
ADMIN_SERVICE="blindwalk-admin"
ACCOUNT_SERVICE="blindwalk-account"
SITE_NAME="blindwalk"

NODE_BIN="$(command -v node || true)"
REMOTE_NODE="/usr/local/bin/node"

echo "== 0) 目标 $HOST · 域名 $DOMAIN · $REMOTE_DIR =="
ssh "$HOST" "test -d $REMOTE_DIR" || {
  echo "❌ 远端目录不存在：$REMOTE_DIR"
  echo "   首次部署请先把 account/ admin/ prototype/web/ 传上去，或显式指定 WA_REMOTE_DIR。"
  exit 1
}

# ------------------------------------------------------------
# 1) 地图 Key（本地后台库 → 远端静态文件；不进 git）
# ------------------------------------------------------------
echo "== 1) 生成 mapkeys.json =="
MAPKEYS_HAS_LOCAL=0
if [ -f admin/data/walkaholic.db ]; then
  if [ -z "$NODE_BIN" ]; then
    echo "   ⚠️ 本机没有 node，跳过后台库导出"
  else
    node scripts/export-mapkeys.mjs admin/data/walkaholic.db > /tmp/wa-mapkeys.json 2>/dev/null \
      && MAPKEYS_HAS_LOCAL=1 && echo "   已从后台数据库导出 Key"
  fi
fi
if [ "$MAPKEYS_HAS_LOCAL" = "0" ]; then
  echo "   ⚠️ 没有本地后台库，保留服务器上已有的 mapkeys.json（不覆盖）"
fi

# ------------------------------------------------------------
# 2) 同步代码
# ------------------------------------------------------------
echo "== 2) 同步 Web / account / admin =="
rsync -az --exclude 'mapkeys.json' --exclude 'screenshots' \
  prototype/web/ "$HOST:$REMOTE_DIR/web/"
if [ "$MAPKEYS_HAS_LOCAL" = "1" ]; then
  scp -q /tmp/wa-mapkeys.json "$HOST:$REMOTE_DIR/web/mapkeys.json"
  rm -f /tmp/wa-mapkeys.json
fi

rsync -az --exclude 'data' --exclude 'tests' --exclude 'node_modules' \
  account/ "$HOST:$REMOTE_DIR/account/"
rsync -az --exclude 'data' --exclude 'tests' --exclude 'node_modules' \
  admin/ "$HOST:$REMOTE_DIR/admin/"

# macOS rsync 会带 600，nginx 读不了；admin 保持 root-only
ssh "$HOST" "chown -R www-data:www-data $REMOTE_DIR/web && chmod -R a+rX $REMOTE_DIR/web"
ssh "$HOST" "chown -R root:root $REMOTE_DIR/account $REMOTE_DIR/admin && chmod -R go-rwx $REMOTE_DIR/admin/server"
echo "   代码已同步"

# ------------------------------------------------------------
# 3) 数据目录 + 后台密码
# ------------------------------------------------------------
echo "== 3) 数据目录 / 后台密码 =="
ssh "$HOST" "mkdir -p $DATA_DIR/account $DATA_DIR/admin"

# 密码：命令行给了就用；否则沿用服务器上已有的；都没有才生成
if [ -n "${WA_ADMIN_PASSWORD:-}" ]; then
  ADMIN_PASS="$WA_ADMIN_PASSWORD"
  PASS_NOTE="由 WA_ADMIN_PASSWORD 指定"
else
  ADMIN_PASS="$(ssh "$HOST" "grep -h '^Environment=BW_ADMIN_PASSWORD=' /etc/systemd/system/$ADMIN_SERVICE.service 2>/dev/null | head -1 | cut -d= -f3-" || true)"
  if [ -n "$ADMIN_PASS" ]; then
    PASS_NOTE="沿用服务器上已有的密码"
  else
    ADMIN_PASS="$("$NODE_BIN" -e "console.log(require('crypto').randomBytes(9).toString('base64url'))")"
    PASS_NOTE="新生成的随机密码（只显示这一次）"
  fi
fi
echo "   后台密码：$PASS_NOTE"

# ------------------------------------------------------------
# 4) systemd（幂等：已存在就只更新 WorkingDirectory / 密码等关键项）
# ------------------------------------------------------------
echo "== 4) systemd 单元 =="
write_unit() {
  local service="$1" desc="$2" port="$3" dir="$4" data="$5" extra="$6"
  ssh "$HOST" "cat > /etc/systemd/system/$service.service <<'UNIT'
[Unit]
Description=$desc
After=network.target

[Service]
Type=simple
WorkingDirectory=$REMOTE_DIR/$dir
Environment=NODE_ENV=production
Environment=PORT=$port
Environment=HOST=127.0.0.1
Environment=BW_DATA_DIR=$DATA_DIR/$data
$extra
ExecStart=$REMOTE_NODE $REMOTE_DIR/$dir/server/index.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now $service >/dev/null
systemctl restart $service
sleep 1
systemctl is-active $service"
}

ACCOUNT_EXTRA="Environment=BW_ALLOWED_ORIGINS=https://$DOMAIN,https://xiaoqiangch.github.io,http://127.0.0.1:*
Environment=BW_COOKIE_SECURE=1
Environment=BW_COOKIE_CROSS_SITE=1
Environment=BW_TRUST_PROXY=1"

ADMIN_EXTRA="Environment=BW_ADMIN_PASSWORD=$ADMIN_PASS
Environment=BW_EXPORT_PATH=$REMOTE_DIR/web/pois.json
Environment=BW_ACCOUNT_DB=$DATA_DIR/account/blindwalk-users.db"
if [ -n "${WA_LLM_API_KEY:-}" ]; then
  ADMIN_EXTRA="$ADMIN_EXTRA
Environment=BW_LLM_API_KEY=$WA_LLM_API_KEY"
fi

echo "   account: $(write_unit "$ACCOUNT_SERVICE" 'Walkaholic account service' 8803 'account' 'account' "$ACCOUNT_EXTRA")"
echo "   admin:   $(write_unit "$ADMIN_SERVICE" 'Walkaholic admin backend' 8802 'admin' 'admin' "$ADMIN_EXTRA")"

# ------------------------------------------------------------
# 5) nginx
# ------------------------------------------------------------
echo "== 5) nginx 站点 =="
ssh "$HOST" "cat > /etc/nginx/sites-available/$SITE_NAME <<'NGINX'
server {
    listen 80;
    server_name $DOMAIN;

    root $REMOTE_DIR/web;
    index index.html;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    # 账号服务（同源，Cookie 不需要 SameSite=None）
    location ^~ /api/ {
        proxy_pass http://127.0.0.1:8803;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Cookie \$http_cookie;
        add_header Cache-Control \"no-store\" always;
    }

    # 后台：页面保留 /admin 前缀（服务自己会剥），API 剥前缀转给 /api/
    location ^~ /admin/api/ {
        proxy_pass http://127.0.0.1:8802/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ^~ /admin/ {
        proxy_pass http://127.0.0.1:8802;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Service Worker / 入口页不缓存，避免更新不生效
    location = /sw.js { add_header Cache-Control \"no-store\" always; }
    location = /index.html { add_header Cache-Control \"no-store\" always; }
    location = /mapkeys.json { add_header Cache-Control \"no-store\" always; }

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location ~* \\.(js|css|png|webp|svg|woff2)\$ {
        expires 7d;
        add_header Cache-Control \"public, max-age=604800\";
    }
}
NGINX
ln -sf /etc/nginx/sites-available/$SITE_NAME /etc/nginx/sites-enabled/$SITE_NAME
nginx -t && systemctl reload nginx && echo '   nginx ok'"

# 补丁脚本：/check 自检页 + 备用端口 8443（幂等）
if [ -f scripts/server/patch-nginx.mjs ]; then
  scp -q scripts/server/patch-nginx.mjs "$HOST:$REMOTE_DIR/patch-nginx.mjs"
  ssh "$HOST" "cd $REMOTE_DIR && node patch-nginx.mjs && nginx -t && systemctl reload nginx" || \
    echo "   ⚠️ patch-nginx 失败（不影响主流程）"
fi

# ------------------------------------------------------------
# 6) HTTPS（已签发过就直接续期检查）
# ------------------------------------------------------------
echo "== 6) HTTPS =="
ssh "$HOST" "certbot --nginx -d $DOMAIN --non-interactive --agree-tos --register-unsafely-without-email --redirect --keep-until-expiring 2>&1 | tail -3 || true"

# ------------------------------------------------------------
# 7) 验证
# ------------------------------------------------------------
echo "== 7) 验证 =="
sleep 2
curl -s -m 10 -o /dev/null -w "   首页          %{http_code}\n" "https://$DOMAIN/" || true
curl -s -m 10 -o /dev/null -w "   账号 /api/health  %{http_code}\n" "https://$DOMAIN/api/health" || true
curl -s -m 10 -o /dev/null -w "   后台 /admin/      %{http_code}\n" "https://$DOMAIN/admin/" || true
echo
echo "✅ 部署完成"
echo "   Web      https://$DOMAIN/"
echo "   后台     https://$DOMAIN/admin/"
echo "   账号     https://$DOMAIN/api/health"
echo "   后台密码 $PASS_NOTE"
echo
echo "   用户惊喜审核：后台顶部「用户惊喜」按钮"
echo "   数据目录     $DATA_DIR/{account,admin}"
