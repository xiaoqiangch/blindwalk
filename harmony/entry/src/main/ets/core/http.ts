/**
 * 盲走 BlindWalk · HarmonyOS 逻辑层 — HTTP 抽象
 *
 * 为什么需要它：`core/` 全部是纯 TypeScript（不 import 任何 `@ohos.*`），
 * 才能在 Node 里跑单测。真实网络请求由 UI 层注入：
 *
 *   - HarmonyOS：`components/HttpClient.ets` 用 `@ohos.net.http` 实现
 *   - Node 测试：`tests/` 里的 FakeHttp 直接返回 fixture
 *
 * 与 Web 版的关键差异：鸿蒙是原生 App，**没有 CORS 限制**，
 * 所以高德 / 百度直接 GET JSON 即可，不需要 Web 版的 JSONP 那套 script 注入。
 */

/** HTTP 请求方法（账号服务用到 PUT / DELETE） */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface HttpRequest {
  url: string;
  method: HttpMethod;
  /** 请求头（POST 表单 / JSON 用） */
  headers?: Record<string, string>;
  /** 请求体（只在 POST 用） */
  body?: string;
  /** 超时（毫秒） */
  timeoutMs: number;
}

export interface HttpResponse {
  /** HTTP 状态码；网络层失败为 0 */
  status: number;
  /** 响应文本；解析 JSON 由调用方负责 */
  body: string;
  /**
   * 响应头（键名统一小写）。
   * 账号服务用 Set-Cookie 下发会话，而鸿蒙 http 不会自动持久化 Cookie，
   * 所以必须把响应头交给调用方，由 core/account.ts 手动保管。
   */
  headers?: Record<string, string>;
}

/** UI 注入的 HTTP 客户端 */
export interface HttpClient {
  request(request: HttpRequest): Promise<HttpResponse>;
}

/** 数据源 ID */
export type ProviderId = 'amap' | 'baidu' | 'osm' | 'wiki';

/** 地图 Key（由后台下发，不写死、不让用户填） */
export interface MapKeys {
  amap: string;
  baidu: string;
}

/** 空 Key（只用 OSM + 维基） */
export function emptyKeys(): MapKeys {
  const keys: MapKeys = { amap: '', baidu: '' };
  return keys;
}

export const PROVIDER_LABELS: Record<string, string> = {
  amap: '高德地图',
  baidu: '百度地图',
  osm: 'OpenStreetMap',
  wiki: '中文维基百科'
};

/** 单个数据源的成功/失败回报（失败面板会逐条显示） */
export interface SourceReport {
  id: string;
  label: string;
  ok: boolean;
  count: number;
  error: string;
}

/** 把异常整理成一句人话（失败面板要展示） */
export function errorText(error: unknown): string {
  if (error === undefined || error === null) return '未知错误';
  if (typeof error === 'string') return error;
  if (typeof error === 'object') {
    const record: Record<string, unknown> = error as Record<string, unknown>;
    const message: unknown = record['message'];
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return '未知错误';
}

/** 带超时的请求包装：超时由实现方（HttpClient）负责，这里只做错误归一 */
export async function requestText(
  client: HttpClient,
  request: HttpRequest
): Promise<string> {
  const response: HttpResponse = await client.request(request);
  if (response.status < 200 || response.status >= 300) {
    throw new Error('HTTP ' + String(response.status));
  }
  return response.body;
}

/** 安全的 JSON 解析：失败抛带语境的错误 */
export function parseJson(text: string): Record<string, unknown> {
  let value: unknown = undefined;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error('返回内容不是 JSON');
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error('返回内容不是 JSON 对象');
  }
  return value as Record<string, unknown>;
}