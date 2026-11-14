/**
 * 步迷 Walkaholic · 兴趣点管理后台 — HTTP 服务入口
 *
 * 零依赖：node:http / node:fs / node:path / node:url
 * 启动：node admin/server/index.mjs（默认 http://127.0.0.1:8802/admin）
 * 接口契约：admin/docs/CONTRACT.md
 *
 * 路由：
 * - /api/*                    JSON API（§4）
 * - /admin, /admin/*          静态管理界面（admin/public）
 * - /                         302 → /admin/
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { PoiStore } from './store.mjs';
import {
  PoiError,
  STATUSES,
  CATEGORY_KEYS,
  buildExportDocument,
  nowMs
} from './poi.mjs';
import { fetchCandidates } from './ingest.mjs';
import {
  analyzePois,
  editPoi,
  llmStatus,
  normalizePoi,
  resolveConfig
} from './llm.mjs';
import { renderLoginPage, serveStatic } from './static.mjs';
import { MapKeysService } from './mapkeys.mjs';
import {
  AuthManager,
  SESSION_TTL_MS,
  clearSessionCookie,
  sessionCookie
} from './auth.mjs';

const __filename = fileURLToPath(import.meta.url);
const SERVER_DIR = path.dirname(__filename);
const ADMIN_DIR = path.dirname(SERVER_DIR);
const DEFAULT_DATA_DIR = path.join(ADMIN_DIR, 'data');
const DEFAULT_PUBLIC_DIR = path.join(ADMIN_DIR, 'public');
const DEFAULT_EXPORT_PATH = path.resolve(ADMIN_DIR, '..', 'prototype', 'web', 'pois.json');
const MAX_BODY_BYTES = 1024 * 1024;

// ============================================================
// 工具
// ============================================================

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function sendHtml(res, status, html) {
  const body = Buffer.from(html, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendJsonWithHeaders(res, status, payload, headers) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const merged = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  };
  const keys = Object.keys(headers || {});
  for (const key of keys) merged[key] = headers[key];
  res.writeHead(status, merged);
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function sendError(res, error) {
  if (error instanceof PoiError) {
    const payload = { error: error.message, code: error.code };
    if (error.details !== undefined) payload.details = error.details;
    sendJson(res, error.status, payload);
    return;
  }
  const message = error && error.message ? String(error.message) : '服务器内部错误';
  sendJson(res, 500, { error: message, code: 'INTERNAL' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new PoiError('请求体过大（上限 1MB）', 'BAD_REQUEST'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new PoiError('请求体必须是 JSON 对象', 'BAD_REQUEST'));
          return;
        }
        resolve(parsed);
      } catch (error) {
        reject(new PoiError('请求体不是合法 JSON', 'BAD_REQUEST'));
      }
    });
    req.on('error', (error) => reject(error));
  });
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PoiError(field + ' 必填', 'BAD_REQUEST');
  }
  return value.trim();
}

function requireNumber(value, field, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new PoiError(field + ' 必须是 ' + min + '…' + max + ' 的数字', 'BAD_REQUEST');
  }
  return number;
}

function parseListQuery(searchParams) {
  const query = {};
  const status = searchParams.get('status');
  if (status !== null && status !== '') {
    if (!STATUSES.includes(status)) throw new PoiError('status 不合法', 'BAD_REQUEST');
    query.status = status;
  }
  const category = searchParams.get('category');
  if (category !== null && category !== '') {
    if (!CATEGORY_KEYS.includes(category)) throw new PoiError('category 不合法', 'BAD_REQUEST');
    query.category = category;
  }
  const q = searchParams.get('q');
  if (q !== null) query.q = q;
  const hasPhoto = searchParams.get('hasPhoto');
  if (hasPhoto === '1' || hasPhoto === 'true') query.hasPhoto = true;
  else if (hasPhoto === '0' || hasPhoto === 'false') query.hasPhoto = false;
  const limit = searchParams.get('limit');
  if (limit !== null && limit !== '') query.limit = requireNumber(limit, 'limit', 1, 500);
  const offset = searchParams.get('offset');
  if (offset !== null && offset !== '') query.offset = requireNumber(offset, 'offset', 0, 1000000);
  return query;
}

/** 原子写文件：tmp + rename */
function writeJsonAtomic(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const text = JSON.stringify(payload, null, 2);
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, text, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function loadDotEnv(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index <= 0) continue;
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    // 没有 .env 是正常情况
  }
}

// ============================================================
// 服务器
// ============================================================

/**
 * 创建 HTTP 服务（测试可注入 store / ingest / 路径）。
 */
export function createServer(options = {}) {
  const dataDir = options.dataDir || process.env.WA_DATA_DIR || DEFAULT_DATA_DIR;
  const store = options.store || new PoiStore({ dataDir });
  const publicDir = options.publicDir || process.env.WA_PUBLIC_DIR || DEFAULT_PUBLIC_DIR;
  const exportPath = options.exportPath || process.env.WA_EXPORT_PATH || DEFAULT_EXPORT_PATH;
  const backupPath = path.join(dataDir, 'pois.export.json');
  const ingestCandidates = options.ingestCandidates || fetchCandidates;
  const fetchImpl = options.fetchImpl;
  const llmEnv = options.llmEnv || process.env;
  const auth = options.auth || new AuthManager({
    dataDir: dataDir,
    env: options.authEnv || process.env
  });
  auth.startPruneTimer();
  const mapKeys = options.mapKeys || new MapKeysService({
    db: store.db,
    env: options.mapKeysEnv || options.env || process.env,
    fetchImpl: options.mapKeyFetch,
    now: options.now
  });

  // ---------- 公开端点：地图 Key（无鉴权，但限制来源） ----------
  function sendPublicJson(req, res, status, payload) {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const origin = req.headers ? req.headers.origin : undefined;
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      Vary: 'Origin'
    };
    if (typeof origin === 'string' && origin.length > 0 && mapKeys.allowsOrigin(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
    }
    res.writeHead(status, headers);
    res.end(body);
  }

  function handlePublicMapKeys(req, res, method) {
    const origin = req.headers ? req.headers.origin : undefined;
    const hasOrigin = typeof origin === 'string' && origin.length > 0;
    if (hasOrigin && !mapKeys.allowsOrigin(origin)) {
      sendPublicJson(req, res, 403, { error: '来源不被允许', code: 'FORBIDDEN' });
      return;
    }
    if (method === 'OPTIONS') {
      const headers = {
        'Cache-Control': 'no-store',
        Vary: 'Origin',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Max-Age': '600'
      };
      if (hasOrigin) headers['Access-Control-Allow-Origin'] = origin;
      res.writeHead(204, headers);
      res.end();
      return;
    }
    if (method !== 'GET') {
      sendPublicJson(req, res, 405, { error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' });
      return;
    }
    sendPublicJson(req, res, 200, mapKeys.publicView());
  }

  async function handleApi(req, res, pathname, searchParams) {
    const method = req.method || 'GET';

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end();
      return;
    }

    // ---------- 状态 / 统计 ----------
    if (pathname === '/api/llm/status' && method === 'GET') {
      sendJson(res, 200, llmStatus(llmEnv));
      return;
    }
    if (pathname === '/api/stats' && method === 'GET') {
      sendJson(res, 200, store.stats());
      return;
    }

    // ---------- 列表 / 新建 ----------
    if (pathname === '/api/pois' && method === 'GET') {
      const query = parseListQuery(searchParams);
      sendJson(res, 200, store.list(query));
      return;
    }
    if (pathname === '/api/pois' && method === 'POST') {
      const body = await readBody(req);
      sendJson(res, 200, store.create(body));
      return;
    }

    // ---------- 单条 ----------
    const singleMatch = pathname.match(/^\/api\/pois\/([^/]+)$/);
    if (singleMatch) {
      const id = decodeURIComponent(singleMatch[1]);
      if (method === 'GET') {
        const poi = store.get(id);
        if (!poi) throw new PoiError('POI 不存在：' + id, 'NOT_FOUND', 404);
        sendJson(res, 200, poi);
        return;
      }
      if (method === 'PUT') {
        const body = await readBody(req);
        sendJson(res, 200, store.update(id, body));
        return;
      }
      if (method === 'DELETE') {
        store.remove(id);
        sendJson(res, 200, { ok: true });
        return;
      }
      throw new PoiError('不支持的请求方法：' + method, 'BAD_REQUEST');
    }

    // ---------- 抓取 ----------
    if (pathname === '/api/ingest' && method === 'POST') {
      const body = await readBody(req);
      const lat = requireNumber(body.lat, 'lat', -90, 90);
      const lon = requireNumber(body.lon, 'lon', -180, 180);
      const radius = body.radius === undefined ? 1200 : requireNumber(body.radius, 'radius', 100, 10000);
      const limit = body.limit === undefined ? 20 : requireNumber(body.limit, 'limit', 1, 50);
      const result = await ingestCandidates({ lat, lon, radius, limit, fetchImpl });
      const added = store.addCandidates(result.items || []);
      sendJson(res, 200, {
        added: added.added,
        skipped: added.skipped,
        items: added.items,
        source: result.source || 'wikipedia'
      });
      return;
    }

    // ---------- 大模型 ----------
    if (pathname === '/api/llm/normalize' && method === 'POST') {
      const body = await readBody(req);
      const id = requireString(body.id, 'id');
      const poi = store.get(id);
      if (!poi) throw new PoiError('POI 不存在：' + id, 'NOT_FOUND', 404);
      const result = await normalizePoi(poi, { env: llmEnv, fetchImpl });
      const updated = store.update(id, {
        why: result.poi.why,
        task: result.poi.task,
        hints: result.poi.hints,
        llm: result.poi.llm
      });
      const payload = { poi: updated, changed: result.changed, mode: result.mode };
      if (result.fallbackReason) payload.fallbackReason = result.fallbackReason;
      sendJson(res, 200, payload);
      return;
    }

    if (pathname === '/api/llm/edit' && method === 'POST') {
      const body = await readBody(req);
      const id = requireString(body.id, 'id');
      const instruction = requireString(body.instruction, 'instruction');
      const poi = store.get(id);
      if (!poi) throw new PoiError('POI 不存在：' + id, 'NOT_FOUND', 404);
      const result = await editPoi(poi, instruction, { env: llmEnv, fetchImpl });
      const updated = store.update(id, {
        why: result.poi.why,
        task: result.poi.task,
        hints: result.poi.hints,
        llm: result.poi.llm
      });
      sendJson(res, 200, { poi: updated, changed: result.changed, mode: result.mode });
      return;
    }

    if (pathname === '/api/llm/analyze' && method === 'POST') {
      const body = await readBody(req);
      if (!Array.isArray(body.ids) || body.ids.length === 0) {
        throw new PoiError('ids 必须是非空数组', 'BAD_REQUEST');
      }
      const pois = [];
      for (const rawId of body.ids) {
        const id = requireString(rawId, 'ids[]');
        const poi = store.get(id);
        if (!poi) throw new PoiError('POI 不存在：' + id, 'NOT_FOUND', 404);
        pois.push(poi);
      }
      const result = await analyzePois(pois, {
        env: llmEnv,
        fetchImpl,
        onApplied: (id, patch) => {
          store.update(id, { safety: patch.safety, llm: patch.llm });
        }
      });
      sendJson(res, 200, { items: result.items, mode: result.mode });
      return;
    }

    if (pathname === '/api/llm/analyze-all' && method === 'POST') {
      const body = await readBody(req);
      const status = body.status === undefined ? 'draft' : requireString(body.status, 'status');
      if (!STATUSES.includes(status)) throw new PoiError('status 不合法', 'BAD_REQUEST');
      const pois = store.all().filter((poi) => poi.status === status);
      const result = await analyzePois(pois, {
        env: llmEnv,
        fetchImpl,
        onApplied: (id, patch) => {
          store.update(id, { safety: patch.safety, llm: patch.llm });
        }
      });
      sendJson(res, 200, { analyzed: result.items.length, items: result.items, mode: result.mode });
      return;
    }

    // ---------- 导出 ----------
    if (pathname === '/api/export' && method === 'POST') {
      const document = buildExportDocument(store.approved(), nowMs());
      writeJsonAtomic(exportPath, document);
      writeJsonAtomic(backupPath, document);
      sendJson(res, 200, {
        ok: true,
        path: '../prototype/web/pois.json',
        count: document.count
      });
      return;
    }

    // ---------- 地图 Key（管理员） ----------
    if (pathname === '/api/mapkeys' && method === 'GET') {
      sendJson(res, 200, mapKeys.adminView());
      return;
    }
    if (pathname === '/api/mapkeys' && method === 'PUT') {
      const body = await readBody(req);
      sendJson(res, 200, mapKeys.updateKeys(body));
      return;
    }
    if (pathname === '/api/mapkeys/test' && method === 'POST') {
      const body = await readBody(req);
      const provider = requireString(body.provider, 'provider');
      const result = await mapKeys.testProvider(provider);
      sendJson(res, 200, result);
      return;
    }

    throw new PoiError('接口不存在：' + method + ' ' + pathname, 'NOT_FOUND', 404);
  }

  const server = http.createServer((req, res) => {
    const method = req.method || 'GET';
    let parsedUrl;
    try {
      parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
    } catch (error) {
      sendJson(res, 400, { error: 'URL 不合法', code: 'BAD_REQUEST' });
      return;
    }
    const pathname = parsedUrl.pathname;

    // ---------- 公开端点：地图 Key（无鉴权，来源白名单 + no-store） ----------
    if (pathname === '/api/public/mapkeys') {
      handlePublicMapKeys(req, res, method);
      return;
    }

    // ---------- 认证端点（无需登录） ----------
    if (pathname === '/api/auth/status' && method === 'GET') {
      sendJson(res, 200, auth.status(req));
      return;
    }
    if (pathname === '/api/auth/login' && method === 'POST') {
      readBody(req).then((body) => {
        const token = auth.login(body.password, req);
        sendJsonWithHeaders(res, 200, { ok: true }, {
          'Set-Cookie': sessionCookie(token, Math.floor(SESSION_TTL_MS / 1000))
        });
      }).catch((error) => sendError(res, error));
      return;
    }
    if (pathname === '/api/auth/logout' && method === 'POST') {
      auth.logout(req);
      sendJsonWithHeaders(res, 200, { ok: true }, {
        'Set-Cookie': clearSessionCookie()
      });
      return;
    }
    if (pathname.startsWith('/api/auth/')) {
      sendJson(res, 404, { error: '接口不存在', code: 'NOT_FOUND' });
      return;
    }

    // ---------- /api 必须登录 ----------
    if (pathname.startsWith('/api/') || pathname === '/api') {
      if (!auth.isAuthenticated(req)) {
        sendJson(res, 401, { error: '未登录或会话已过期', code: 'UNAUTHENTICATED' });
        return;
      }
      handleApi(req, res, pathname, parsedUrl.searchParams).catch((error) => sendError(res, error));
      return;
    }

    // ---------- 内置登录页 ----------
    if (pathname === '/admin/login' || pathname === '/admin/login/') {
      if (auth.isAuthenticated(req)) {
        redirect(res, '/admin/');
        return;
      }
      sendHtml(res, 200, renderLoginPage());
      return;
    }

    // ---------- 管理界面 ----------
    if (pathname === '/' || pathname === '/admin') {
      redirect(res, auth.isAuthenticated(req) ? '/admin/' : '/admin/login');
      return;
    }

    if (pathname.startsWith('/admin/')) {
      if (!auth.isAuthenticated(req)) {
        redirect(res, '/admin/login');
        return;
      }
      const relative = pathname.slice('/admin'.length) || '/';
      serveStatic(req, res, publicDir, relative);
      return;
    }

    // 未知路径统一 404（不返回 index.html，避免把 /admin/%2e%2e/x 之类解析成首页）
    if (method === 'GET' || method === 'HEAD') {
      res.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end('Not Found');
      return;
    }
    sendJson(res, 404, { error: '接口不存在', code: 'NOT_FOUND' });
  });

  server.store = store;
  server.auth = auth;
  server.mapKeys = mapKeys;
  server.paths = { dataDir, dbPath: store.dbPath, publicDir, exportPath, backupPath };
  server.on('close', () => {
    auth.stopPruneTimer();
    store.close();
  });
  return server;
}

// ============================================================
// 启动（仅直接运行时）
// ============================================================

export function startServer(options = {}) {
  const port = Number(options.port || process.env.PORT || 8802);
  const host = options.host || process.env.HOST || '127.0.0.1';
  const server = createServer(options);
  server.listen(port, host, () => {
    const status = llmStatus(process.env);
    console.log('步迷 Walkaholic · 兴趣点管理后台 v2（SQLite + 登录）');
    console.log('  管理界面  http://' + host + ':' + port + '/admin');
    console.log('  登录入口  http://' + host + ':' + port + '/admin/login');
    console.log('  数据目录  ' + server.paths.dataDir);
    console.log('  数据库    ' + server.paths.dbPath);
    console.log('  地图 Key  公开端点 /api/public/mapkeys（来源白名单 + no-store）');
    console.log('  导出路径  ' + server.paths.exportPath);
    if (server.store.migration && server.store.migration.migrated) {
      console.log('  迁移      v1 pois.json → SQLite：' + server.store.migration.count + ' 条');
    }
    const auth = server.auth;
    if (auth.passwordSource === 'generated') {
      console.log('  ' + auth.getExitWarning());
    } else if (auth.passwordSource === 'env') {
      console.log('  登录密码  来自环境变量 WA_ADMIN_PASSWORD');
    } else {
      console.log('  登录密码  来自 admin/data/admin.secret.json（未打印）');
    }
    console.log(
      '  AI 模式   ' + status.mode + '（' + (status.mode === 'offline'
        ? '未配置 WA_LLM_API_KEY，使用离线规则'
        : status.model + ' @ ' + status.baseUrl) + '）'
    );
  });
  server.on('error', (error) => {
    console.error('服务启动失败：' + error.message);
    process.exitCode = 1;
  });
  return server;
}

const isMain = process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  loadDotEnv(path.join(ADMIN_DIR, '.env'));
  startServer();
}
