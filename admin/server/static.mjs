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
