#!/usr/bin/env bash
# 把步谜（Web PWA + 账号服务）部署到自己的服务器（xqlounge.top）
#
#   bash scripts/deploy-server.sh [user@host]
#
# 前置（服务器已具备）：nginx、Node ≥22、certbot
# 部署内容：
#   /opt/blindwalk/web      静态 PWA（含 mapkeys.json，运行时注入、不进 git）
#   /opt/blindwalk/account  账号服务（systemd，127.0.0.1:8803）
#   nginx:  / → 静态； /api/ → 账号服务（同源，Cookie SameSite=Lax 可用）
#   HTTPS:  certbot --nginx（首次自动申请证书）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

HOST="${1:-xqlounge.top}"
DOMAIN="${BW_DOMAIN:-xqlounge.top}"
REMOTE_DIR="/opt/blindwalk"
DATA_DIR="/var/lib/blindwalk"

echo "== 1) 生成 mapkeys.json（从后台数据库，不进 git）=="
MAPKEYS_TMP="$(mktemp)"
if [ -f admin/data/blindwalk.db ]; then
  /opt/homebrew/bin/node scripts/export-mapkeys.mjs admin/data/blindwalk.db > "$MAPKEYS_TMP"
  echo "   已从后台数据库导出 Key"
else
  echo '{"keys":{"amap":"","baidu":""},"version":"0"}' > "$MAPKEYS_TMP"
  echo "   ⚠️ 无后台数据库，本次不带地图 Key（免费源仍可用）"
fi

echo "== 2) 同步文件到 $HOST:$REMOTE_DIR =="
ssh "$HOST" "mkdir -p $REMOTE_DIR/web $REMOTE_DIR/account $DATA_DIR/account"
rsync -az --delete --exclude 'tests' --exclude 'mapkeys.json' --exclude '*.md' \
  prototype/web/ "$HOST:$REMOTE_DIR/web/"
rsync -az --delete --exclude 'data' --exclude 'tests' --exclude 'node_modules' --exclude '*.md' \
  account/ "$HOST:$REMOTE_DIR/account/"
scp -q "$MAPKEYS_TMP" "$HOST:$REMOTE_DIR/web/mapkeys.json"
rm -f "$MAPKEYS_TMP"

echo "== 2.5) 修正权限（macOS rsync 会带 600，nginx 读不了）=="
ssh "$HOST" "chown -R www-data:www-data $REMOTE_DIR/web && chmod -R a+rX $REMOTE_DIR/web && echo '   权限已修正'"

echo "== 3) 创建 systemd 服务（账号）=="
ssh "$HOST" "cat > /etc/systemd/system/blindwalk-account.service <<'UNIT'
[Unit]
Description=Bumia account service
After=network.target

[Service]
Type=simple
WorkingDirectory=$REMOTE_DIR/account
Environment=NODE_ENV=production
Environment=PORT=8803
Environment=HOST=127.0.0.1
Environment=BW_DATA_DIR=$DATA_DIR/account
Environment=BW_ALLOWED_ORIGINS=https://$DOMAIN,https://xiaoqiangch.github.io,http://127.0.0.1:*
ExecStart=/usr/local/bin/node $REMOTE_DIR/account/server/index.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now blindwalk-account
sleep 1
systemctl is-active blindwalk-account"

echo "== 4) 配置 nginx =="
ssh "$HOST" "cat > /etc/nginx/sites-available/blindwalk <<'NGINX'
server {
    listen 80;
    server_name $DOMAIN;

    root $REMOTE_DIR/web;
    index index.html;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    # 账号服务（同源，Cookie 不需要 SameSite=None）
    location /api/ {
        proxy_pass http://127.0.0.1:8803;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Cookie \$http_cookie;
        add_header Cache-Control \"no-store\" always;
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
ln -sf /etc/nginx/sites-available/blindwalk /etc/nginx/sites-enabled/blindwalk
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx && echo 'nginx ok'"

echo "== 5) HTTPS（首次会申请证书）=="
ssh "$HOST" "certbot --nginx -d $DOMAIN --non-interactive --agree-tos --register-unsafely-without-email --redirect --keep-until-expiring 2>&1 | tail -4 || true"

echo "== 6) 验证 =="
sleep 2
curl -s -m 10 -o /dev/null -w "  首页        https=%{http_code}\n" "https://$DOMAIN/" || true
curl -s -m 10 -w "\n" "https://$DOMAIN/api/health" | head -2
echo
echo "✅ 部署完成：https://$DOMAIN/"
echo "   账号服务同源：https://$DOMAIN/api/health"
