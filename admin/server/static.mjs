/**
 * 盲走 BlindWalk · 兴趣点管理后台 — 静态文件服务
 *
 * 把 admin/public 挂在 /admin 下。零依赖（node:fs / node:path），防目录穿越。
 */

import fs from 'node:fs';
import path from 'node:path';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

export function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * 把 URL 路径解析成磁盘路径；不合法（穿越 / 空字节）返回 null。
 * @param {string} publicDir
 * @param {string} urlPath 已去掉 /admin 前缀的路径，例如 "/" 或 "/app.js"
 */
export function resolveStaticPath(publicDir, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath || '/');
  } catch (error) {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const relative = decoded.replace(/^\/+/, '');
  const segments = relative.split('/').filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === '..' || segment === '.')) return null;

  const root = path.resolve(publicDir);
  let target = path.resolve(root, ...segments);
  if (target !== root && !target.startsWith(root + path.sep)) return null;

  if (segments.length === 0 || decoded.endsWith('/')) {
    target = path.join(target, 'index.html');
  }
  return target;
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8', method = 'GET') {
  const body = Buffer.from(String(text), 'utf8');
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
}

/**
 * 处理静态请求。返回 true 表示已处理（即使 404），false 表示交给别的路由。
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} publicDir
 * @param {string} urlPath 已剥离 /admin 的路径
 */
export function serveStatic(req, res, publicDir, urlPath) {
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    sendText(res, 405, 'Method Not Allowed', 'text/plain; charset=utf-8', method);
    return true;
  }

  if (!fs.existsSync(publicDir)) {
    sendText(
      res,
      404,
      '管理界面还没构建：admin/public 目录不存在。\n（前端同事写完后刷新即可）',
      'text/plain; charset=utf-8',
      method
    );
    return true;
  }

  const filePath = resolveStaticPath(publicDir, urlPath);
  if (!filePath) {
    sendText(res, 400, 'Bad Request', 'text/plain; charset=utf-8', method);
    return true;
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    stat = null;
  }
  if (!stat || !stat.isFile()) {
    sendText(res, 404, 'Not Found', 'text/plain; charset=utf-8', method);
    return true;
  }

  const headers = {
    'Content-Type': contentTypeFor(filePath),
    'Content-Length': stat.size,
    'Cache-Control': filePath.endsWith('.html') ? 'no-store' : 'public, max-age=60'
  };
  res.writeHead(200, headers);
  if (method === 'HEAD') {
    res.end();
    return true;
  }
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) sendText(res, 500, 'Internal Server Error');
    else res.destroy();
  });
  stream.pipe(res);
  return true;
}


/**
 * 服务端内置的极简登录页（契约 §3.1：不依赖前端打包）。
 * 零外部资源：内联 CSS/JS；提交后调 /api/auth/login。
 */
export function renderLoginPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>登录 · 盲走兴趣点管理后台</title>
<style>
  :root {
    --ink: #171410;
    --ink-2: #6B6357;
    --cream: #F5EEE2;
    --paper: #FFFBF3;
    --line: #E8DECC;
    --amber: #E89B4C;
    --amber-deep: #C97B2E;
    --ember: #D25C3A;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--cream);
    color: var(--ink);
    font: 15px/1.5 -apple-system, "SF Pro Display", "PingFang SC", "Noto Sans SC", sans-serif;
  }
  .noise {
    position: fixed; inset: 0; pointer-events: none; opacity: .05; mix-blend-mode: multiply;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.92' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  .card {
    position: relative;
    width: min(360px, calc(100vw - 40px));
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 28px 24px 22px;
    box-shadow: 0 18px 44px rgba(23, 20, 16, .12);
  }
  .brand { font-size: 11px; letter-spacing: .14em; color: var(--ink-2); text-transform: uppercase; }
  h1 { font-size: 23px; line-height: 1.3; margin: 8px 0 6px; letter-spacing: -.01em; }
  .sub { margin: 0 0 20px; color: var(--ink-2); font-size: 13px; }
  label { display: block; font-size: 11px; letter-spacing: .08em; color: var(--ink-2); margin-bottom: 7px; }
  input[type="password"] {
    width: 100%; height: 46px; padding: 0 14px;
    border: 1px solid var(--line); border-radius: 12px;
    background: var(--paper); color: var(--ink); font: inherit; font-size: 15px;
    outline: none;
  }
  input[type="password"]:focus { border-color: var(--amber); box-shadow: 0 0 0 3px rgba(232, 155, 76, .18); }
  button {
    width: 100%; height: 46px; margin-top: 14px; border: 0; border-radius: 999px;
    background: var(--amber); color: var(--ink); font: inherit; font-size: 15px; font-weight: 650;
    cursor: pointer;
  }
  button:hover { background: #EDA85F; }
  button:active { background: var(--amber-deep); color: #FFF8EC; }
  button[disabled] { opacity: .55; cursor: default; }
  .error { min-height: 20px; margin: 10px 0 0; font-size: 12.5px; color: var(--ember); }
  .foot { margin: 16px 0 0; font-size: 10.5px; color: var(--ink-2); opacity: .8; }
</style>
</head>
<body>
<div class="noise"></div>
<main class="card">
  <div class="brand">BlindWalk · Admin</div>
  <h1>盲走 · 兴趣点管理后台</h1>
  <p class="sub">后台默认需要登录。密码来自 BW_ADMIN_PASSWORD，或首次启动时生成在 admin/data/admin.secret.json。</p>
  <form id="form" autocomplete="current-password">
    <label for="password">管理密码</label>
    <input id="password" name="password" type="password" placeholder="输入管理密码" autofocus>
    <button id="submit" type="submit">登录</button>
    <p class="error" id="error" role="alert"></p>
  </form>
  <p class="foot">盲走 BlindWalk · 原型后台 · 会话 12 小时</p>
</main>
<script>
  (function () {
    var form = document.getElementById('form');
    var input = document.getElementById('password');
    var button = document.getElementById('submit');
    var error = document.getElementById('error');
    function show(message) { error.textContent = message || ''; }
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var password = input.value;
      if (!password) { show('请输入密码'); return; }
      show('');
      button.disabled = true;
      fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password })
      }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (payload) {
          if (response.ok) {
            window.location.replace('/admin/');
            return;
          }
          var code = payload && payload.code;
          if (code === 'TOO_MANY_ATTEMPTS') show('尝试次数过多，请 10 分钟后再试');
          else if (code === 'BAD_PASSWORD') show('密码错误');
          else show((payload && payload.error) || ('登录失败（HTTP ' + response.status + '）'));
          button.disabled = false;
        });
      }).catch(function () {
        show('网络请求失败，请稍后重试');
        button.disabled = false;
      });
    });
  })();
</script>
</body>
</html>`;
}
