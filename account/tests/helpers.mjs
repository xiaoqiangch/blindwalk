/** 账号服务测试辅助：临时数据目录 + 随机端口 HTTP 服务 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createServer } from '../server/index.mjs';

export const TEST_ORIGIN = 'http://127.0.0.1:8799';

export async function startTestServer(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-account-'));
  const dataDir = options.dataDir || path.join(root, 'data');
  const server = createServer({
    dataDir: dataDir,
    env: options.env || {},
    now: options.now,
    rateLimiter: options.rateLimiter
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  return {
    server,
    dataDir,
    root,
    base,
    async close(closeOptions = {}) {
      if (server.listening) {
        await new Promise((resolve) => server.close(resolve));
      }
      if (closeOptions.cleanup !== false) {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  };
}

export async function request(base, method, pathname, body, headers = {}) {
  const init = { method: method, headers: Object.assign({}, headers) };
  if (body !== undefined) {
    if (typeof body === 'string') {
      init.headers['content-type'] = 'application/json';
      init.body = body;
    } else {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }
  const response = await fetch(base + pathname, Object.assign(init, { redirect: 'manual' }));
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (error) {
    json = null;
  }
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [];
  return {
    status: response.status,
    json: json,
    text: text,
    headers: response.headers,
    setCookies: setCookies
  };
}

export function cookieFrom(result) {
  if (!result.setCookies || result.setCookies.length === 0) return '';
  return result.setCookies[0].split(';')[0];
}

export async function register(base, username = 'testuser', password = 'secret123', headers = {}) {
  const result = await request(base, 'POST', '/api/auth/register', { username, password }, headers);
  return { result: result, cookie: cookieFrom(result) };
}

export function withCookie(cookie) {
  return cookie ? { Cookie: cookie } : {};
}
