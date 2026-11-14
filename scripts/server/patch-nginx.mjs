#!/usr/bin/env node
// 在服务器上把 nginx 配置补齐（幂等）：
// 1) 443 的 server 里加 listen 8443 ssl（备用端口）
// 2) 80 的 server 里加 /check（手机自检页，HTTP 直接可开，不跳转）
// 用法（服务器上）：node /opt/walkaholic/scripts/patch-nginx.mjs
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

const CONF = '/etc/nginx/sites-available/walkaholic';
if (!existsSync(CONF)) {
  console.error('找不到 nginx 配置:', CONF);
  process.exit(1);
}
let s = readFileSync(CONF, 'utf8');
copyFileSync(CONF, '/tmp/walkaholic.nginx.bak');
let changed = [];

// 1) 备用端口 8443
if (!/listen 8443/.test(s)) {
  s = s.replace(/(\n\s*listen 443 ssl;)/, '$1\n    listen 8443 ssl; # 备用端口：运营商拦截 443 时使用');
  if (/listen 8443/.test(s)) changed.push('8443');
}

// 2) 80 端口的 /check
if (!/location \^~ \/\.well-known\/acme-challenge\//.test(s) || !/location = \/check/.test(s)) {
  const checkBlock = `    # ACME 续期验证：必须在 301 之前放行，否则 certbot renew 会失败
    location ^~ /.well-known/acme-challenge/ {
        root /opt/walkaholic/web;
        default_type "text/plain";
    }

    # 手机自检页：HTTP 也可打开（诊断 HTTPS 为何失败）
    location = /check {
        root /opt/walkaholic/web;
        try_files /check.html =404;
        add_header Cache-Control "no-store" always;
    }

`;
  // 找到 listen 80; 的 server 块，在它的 location / 前插入
  s = s.replace(/(server \{[^}]*listen 80;[^}]*?)(\n\s*location \/)/, (m, head, tail) => head + '\n' + checkBlock + tail);
  if (/location = \/check/.test(s)) changed.push('/check');
}

// 3) 确保 80 端口对 / 做 HTTPS 跳转（certbot 有时会写成 404）
s = s.replace(/listen 80;(\s*)\n(\s*)server_name xqlounge\.top;(\s*)\n(\s*)return 404; # managed by Certbot/,
  'listen 80;$1\n$2server_name xqlounge.top;$3\n$4location / { return 301 https://$host$request_uri; }');

writeFileSync(CONF, s);
console.log(changed.length ? '已更新: ' + changed.join(', ') : '无需变更');
