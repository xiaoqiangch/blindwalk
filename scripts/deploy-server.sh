#!/usr/bin/env bash
# 把步迷（Web PWA + 账号服务）部署到自己的服务器（xqlounge.top）
#
#   bash scripts/deploy-server.sh [user@host]
#
# 前置（服务器已具备）：nginx、Node ≥22、certbot
# 部署内容：
#   /opt/walkaholic/web      静态 PWA（含 mapkeys.json，运行时注入、不进 git）
#   /opt/walkaholic/account  账号服务（systemd，127.0.0.1:8803）
#   nginx:  / → 静态； /api/ → 账号服务（同源，Cookie SameSite=Lax 可用）
#   HTTPS:  certbot --nginx（首次自动申请证书）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

HOST="${1:-xqlounge.top}"
DOMAIN="${WA_DOMAIN:-xqlounge.top}"
REMOTE_DIR="/opt/walkaholic"
DATA_DIR="/var/lib/walkaholic"

echo "== 1) 生成 mapkeys.json（从后台数据库，不进 git）=="
MAPKEYS_TMP="$(mktemp)"
if [ -f admin/data/walkaholic.db ]; then
  /opt/homebrew/bin/node scripts/export-mapkeys.mjs admin/data/walkaholic.db > "$MAPKEYS_TMP"
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

echo "== 2.6) 同步后台（POI/Key 管理）=="
ssh "$HOST" "mkdir -p $REMOTE_DIR/admin $DATA_DIR/admin"
rsync -az --exclude 'data' --exclude 'node_modules' --exclude 'tests' --exclude '*.md' \
  admin/ "$HOST:$REMOTE_DIR/admin/"
ssh "$HOST" "chown -R root:root $REMOTE_DIR/admin && echo '   后台文件已同步'"
if [ -f admin/data/walkaholic.db ]; then
  # 复制策展 POI 与地图 Key（数据库本身不进 git，也不会进公网）
  scp -q admin/data/walkaholic.db "$HOST:$DATA_DIR/admin/walkaholic.db" && echo "   已同步后台数据库（含策展 POI / 地图 Key）"
fi

echo "== 3) 创建 systemd 服务（账号）=="
ssh "$HOST" "cat > /etc/systemd/system/walkaholic-account.service <<'UNIT'
[Unit]
Description=Bumia account service
After=network.target

[Service]
Type=simple
WorkingDirectory=$REMOTE_DIR/account
Environment=NODE_ENV=production
Environment=PORT=8803
Environment=HOST=127.0.0.1
Environment=WA_DATA_DIR=$DATA_DIR/account
Environment=WA_ALLOWED_ORIGINS=https://$DOMAIN,https://xiaoqiangch.github.io,http://127.0.0.1:*
Environment=WA_COOKIE_SECURE=1
Environment=WA_COOKIE_CROSS_SITE=1
Environment=WA_TRUST_PROXY=1
ExecStart=/usr/local/bin/node $REMOTE_DIR/account/server/index.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now walkaholic-account
sleep 1
systemctl is-active walkaholic-account"

echo "== 3.5) 创建 systemd 服务（后台）=="
ADMIN_PASS="$(/opt/homebrew/bin/node -e "console.log(require('crypto').randomBytes(9).toString('base64url'))")"
ssh "$HOST" "cat > /etc/systemd/system/walkaholic-admin.service <<'UNIT'
[Unit]
Description=Bumia admin backend
After=network.target

[Service]
Type=simple
WorkingDirectory=$REMOTE_DIR/admin
Environment=NODE_ENV=production
Environment=PORT=8802
Environment=HOST=127.0.0.1
Environment=WA_DATA_DIR=$DATA_DIR/admin
Environment=WA_ADMIN_PASSWORD=$ADMIN_PASS
ExecStart=/usr/local/bin/node $REMOTE_DIR/admin/server/index.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now walkaholic-admin
sleep 1
systemctl is-active walkaholic-admin"
printf '后台管理密码（请保存）：%s\n' "$ADMIN_PASS"

echo "== 4) 配置 nginx =="
ssh "$HOST" "cat > /etc/nginx/sites-available/walkaholic <<'NGINX'
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

    # 后台管理：页面保留 /admin 前缀（后台服务自己会剥），API 剥掉前缀转给 /api/
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
ln -sf /etc/nginx/sites-available/walkaholic /etc/nginx/sites-enabled/walkaholic
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx && echo 'nginx ok'"

# 补丁脚本：/check 自检页 + 备用端口 8443（幂等）
scp -q scripts/server/patch-nginx.mjs "$HOST:/opt/walkaholic/patch-nginx.mjs"
ssh "$HOST" "node /opt/walkaholic/patch-nginx.mjs && nginx -t && systemctl reload nginx"

echo "== 5) HTTPS（首次会申请证书）=="
ssh "$HOST" "certbot --nginx -d $DOMAIN --non-interactive --agree-tos --register-unsafely-without-email --redirect --keep-until-expiring 2>&1 | tail -4 || true"

echo "== 6) 验证 =="
sleep 2
curl -s -m 10 --noproxy '*' -o /dev/null -w "  首页        https=%{http_code}\n" "https://$DOMAIN/" || true
curl -s -m 10 --noproxy '*' -w "\n" "https://$DOMAIN/api/health" | head -2
echo
echo "✅ 部署完成：https://$DOMAIN/"
echo "   账号服务同源：https://$DOMAIN/api/health"
