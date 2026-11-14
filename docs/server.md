# 部署到自己的服务器（xqlounge.top）

> 完整版应用（Web PWA + 账号服务 + 后台管理）已部署在 **https://xqlounge.top/**。
> 与 GitHub Pages 的区别：这里是**同源**部署，所以账号 Cookie（SameSite=Lax）能正常工作，
> 不需要跨域、不需要 SameSite=None。

## 架构

```
https://xqlounge.top
├── /                    Web PWA（静态，/opt/walkaholic/web）
├── /api/*   ──proxy──→  账号服务 (127.0.0.1:8803, systemd: walkaholic-account)
│                         数据：/var/lib/walkaholic/account/walkaholic-users.db
└── /admin/* ──proxy──→  后台管理 (127.0.0.1:8802, systemd: walkaholic-admin)
                          数据：/var/lib/walkaholic/admin/walkaholic.db
```

- nginx 配置：`/etc/nginx/sites-available/walkaholic`
- HTTPS：Let's Encrypt（certbot 自动续期，`certbot.timer`）
- 反向代理会剥掉 `/admin` 前缀，后台前端 API 自动加 `/admin` 前缀（`admin/public/components/api.js`）
- 地图 Key：`/opt/walkaholic/web/mapkeys.json`（部署时从后台数据库生成，**不提交进仓库**）

## 部署 / 更新

```bash
bash scripts/deploy-server.sh xqlounge.top
```

脚本做的事：

1. 从本机后台数据库导出 `mapkeys.json`（代码里不硬编码 Key）
2. rsync `prototype/web` → `/opt/walkaholic/web`，`account/` → `/opt/walkaholic/account`，`admin/` → `/opt/walkaholic/admin`
3. 修正权限（`www-data` 可读，macOS 的 600 权限会让 nginx 403）
4. 创建/重启 systemd 服务（账号 8803、后台 8802）
5. 写 nginx 站点配置（静态 + `/api/` + `/admin/`）
6. certbot 申请/续用证书
7. curl 验证

## 运维

```bash
systemctl status walkaholic-account walkaholic-admin nginx
systemctl restart walkaholic-account
journalctl -u walkaholic-account -n 50
certbot renew --dry-run
```

## 备份（建议）

```bash
ssh xqlounge.top "sqlite3 /var/lib/walkaholic/account/walkaholic-users.db '.backup /var/backups/walkaholic-users.db'"
```

或者每日定时：

```bash
ssh xqlounge.top 'cat > /etc/cron.daily/backup-walkaholic <<\'SH\'
#!/bin/sh
mkdir -p /var/backups/walkaholic
cp /var/lib/walkaholic/account/walkaholic-users.db /var/backups/walkaholic/users-$(date +%F).db
cp /var/lib/walkaholic/admin/walkaholic.db /var/backups/walkaholic/admin-$(date +%F).db
find /var/backups/walkaholic -name "*.db" -mtime +14 -delete
SH
chmod +x /etc/cron.daily/backup-walkaholic'
```

## 与 GitHub Pages 的关系

| 地址 | 账号 | 地图 Key | 数据源 | 用途 |
|---|---|---|---|---|
| https://xqlounge.top/ | ✅ 同源可用 | ✅ | ✅ | **主入口（完整版）** |
| https://xiaoqiangch.github.io/walkaholic/ | ❌ 跨站 Cookie 被浏览器拦 | ✅ | ✅ | 静态浏览 / 备用 |

Safari 默认阻止第三方 Cookie，所以 GitHub Pages + 自有域名的组合无法可靠登录；
需要账号就用主入口。

## iOS / HarmonyOS

两端账号默认地址已改为 `https://xqlounge.top`，无需手动配置即可注册/登录/同步。
同时地图 Key 仍从 `https://xiaoqiangch.github.io/walkaholic/mapkeys.json` 或后台端点获取。

## 密码

- 后台管理：部署脚本每次会生成一个随机密码并打印（只显示一次）。
  想固定密码：在服务器 `/etc/systemd/system/walkaholic-admin.service` 里改 `WA_ADMIN_PASSWORD`，然后 `systemctl daemon-reload && systemctl restart walkaholic-admin`。
- 账号：普通用户自助注册，密码 PBKDF2/Scrypt 加盐哈希存储。
