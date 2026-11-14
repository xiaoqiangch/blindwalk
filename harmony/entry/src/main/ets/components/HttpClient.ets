/**
 * 盲走 BlindWalk · HarmonyOS ArkUI — @ohos.net.http 的 HttpClient 实现
 *
 * core/ 是纯 TypeScript（不 import 任何 @ohos.*），网络能力由这里注入，
 * 这样逻辑层能在 Node 里跑单测、平台 API 变更也只影响这一个文件。
 *
 * 产品要点：
 * - 鸿蒙是原生 App，**没有 CORS 限制**，高德/百度直接 GET JSON（Web 版用 JSONP）
 * - 超时由这里统一控制（每个请求的 timeoutMs）
 * - 响应头原样交给上层（账号服务要用 set-cookie 手动管 Cookie）
 *
 * ⚠️ 待 DevEco 验证：http.createHttp() / request() 的 API 12 签名、
 *    HttpResponse.result 的类型（string | Object | ArrayBuffer）。
 */

import { http } from '@kit.NetworkKit';
import { util } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';
import { HttpClient, HttpRequest, HttpResponse } from '../core/http';

export class HarmonyHttpClient implements HttpClient {
  /** 单例复用：鸿蒙建议一个模块一个 http 对象，用完 destroy */
  private client: http.HttpRequest | undefined = undefined;

  private ensureClient(): http.HttpRequest {
    if (this.client === undefined) {
      this.client = http.createHttp();
    }
    return this.client;
  }

  async request(request: HttpRequest): Promise<HttpResponse> {
    const client: http.HttpRequest = this.ensureClient();

    const method: http.RequestMethod = toRequestMethod(request.method);
    const emptyHeader: Record<string, string> = {};
    const headerMap: Record<string, string> =
      request.headers === undefined ? emptyHeader : request.headers;
    const options: http.HttpRequestOptions = {
      method: method,
      expectDataType: http.HttpDataType.STRING,
      connectTimeout: request.timeoutMs,
      readTimeout: request.timeoutMs,
      header: headerMap
    };
    if (request.body !== undefined && request.body.length > 0) {
      options.extraData = request.body;
    }

    try {
      const result: http.HttpResponse = await client.request(request.url, options);
      const body: string = typeof result.result === 'string'
        ? result.result
        : String(result.result);

      const headers: Record<string, string> = {};
      const rawHeaders: Record<string, Object> | undefined =
        result.header as Record<string, Object> | undefined;
      if (rawHeaders !== undefined) {
        const keys: string[] = Object.keys(rawHeaders);
        for (let i = 0; i < keys.length; i += 1) {
          // 鸿蒙的 header 键名大小写不统一，统一转小写方便上层查找（set-cookie）
          headers[keys[i].toLowerCase()] = String(rawHeaders[keys[i]]);
        }
      }

      const normalized: HttpResponse = {
        status: result.responseCode,
        body: body,
        headers: headers
      };
      return normalized;
    } catch (err) {
      const error = err as BusinessError;
      // 网络层失败统一抛错（上层 catch 后记入失败面板）
      throw new Error('网络请求失败：' + String(error.code) + ' ' + String(error.message));
    }
  }

  /** 页面销毁时回收（可选；不调用也能工作） */
  destroy(): void {
    if (this.client !== undefined) {
      this.client.destroy();
      this.client = undefined;
    }
  }
}

function toRequestMethod(method: string): http.RequestMethod {
  if (method === 'POST') return http.RequestMethod.POST;
  if (method === 'PUT') return http.RequestMethod.PUT;
  if (method === 'DELETE') return http.RequestMethod.DELETE;
  return http.RequestMethod.GET;
}

/**
 * 读 rawfile 里的 mapkeys.json（部署时注入；读不到返回 undefined）。
 *
 * 必须用 TextDecoder 解码：`getRawFileContent` 给的是 UTF-8 **字节**，
 * 用 `String.fromCharCode` 逐字节转会把任何非 ASCII 字符（中文 version 字段、
 * 注释等）解成乱码，进而让 JSON.parse 失败。
 */
export async function readBundledMapKeys(): Promise<string | undefined> {
  try {
    const context = getContext();
    const data: Uint8Array = await context.resourceManager.getRawFileContent('mapkeys.json');
    if (data === undefined || data.length === 0) return undefined;
    const decoder: util.TextDecoder = util.TextDecoder.create('utf-8');
    return decoder.decodeToString(data);
  } catch (err) {
    // 包内没有 mapkeys.json 是正常情况（未注入 Key 的构建）
    return undefined;
  }
}