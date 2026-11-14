/**
 * 步迷 Walkaholic · HarmonyOS 逻辑层 — 账号服务（cookie 会话）
 *
 * 接口契约：account/docs/API.md（三端一致，parity.md §4）
 *   POST /api/auth/register | /api/auth/login | /api/auth/logout
 *   GET  /api/auth/me
 *   PUT  /api/me/profile
 *   DELETE /api/me
 *
 * 与 Web 的最大差异：**鸿蒙的 @ohos.net.http 不会自动保存/回传 Cookie**，
 * 所以这里手动管理 `wa_uid`：
 *   - 从响应头 `set-cookie` 里抠出 `wa_uid=...`
 *   - 存进 KeyValueStore（重启后仍保持登录）
 *   - 每次请求手动拼 `Cookie: wa_uid=...`
 *
 * 未登录也能用（本地单机），登录只是多一个「同步到账号 / 从账号恢复」。
 */

import { KeyValueStore } from './contract';
import { HttpClient, HttpMethod, errorText } from './http';

/** 账号服务默认地址（本地开发；设置里可改） */
export const ACCOUNT_BASE_DEFAULT: string = 'https://xqlounge.top';

/** 账号配置 / 会话的存储键 */
export const ACCOUNT_CONFIG_KEY: string = 'walkaholic.account.v1';
export const ACCOUNT_SESSION_KEY: string = 'walkaholic.account.session.v1';
/** 匿名设备标识（惊喜上传/回执用它区分作者；不含任何个人信息） */
export const DEVICE_ID_KEY: string = 'walkaholic.deviceId.v1';

/** 整包同步上限：服务端 256KB，客户端留一点余量 */
export const PROFILE_MAX_BYTES: number = 240 * 1024;

/** 账号用户 */
export interface AccountUser {
  id: string;
  username: string;
  createdAt: number;
}

/** 本地保存的账号配置 */
export interface AccountConfig {
  baseUrl: string;
  /** 已登录用户；undefined = 未登录 */
  user?: AccountUser;
  /** 手动保管的 Cookie 值（wa_uid=xxx） */
  cookie?: string;
}

/** 「从账号恢复」返回的整包数据 */
export interface SyncedPayload {
  app?: string;
  version?: number;
  savedAt?: number;
  profile?: Record<string, unknown>;
  surprises?: unknown[];
  settings?: Record<string, unknown>;
}

/** 账号操作结果（UI 据此 toast） */
export interface AccountResult<T> {
  ok: boolean;
  /** ok=false 时的人类可读原因 */
  error?: string;
  /** ok=false 时的机器码（BAD_CREDENTIALS / UNAUTHENTICATED …） */
  code?: string;
  value?: T;
}

function okResult<T>(value: T): AccountResult<T> {
  const result: AccountResult<T> = { ok: true, value: value };
  return result;
}

function failResult<T>(message: string, code?: string): AccountResult<T> {
  const result: AccountResult<T> = { ok: false, error: message };
  if (code !== undefined) result.code = code;
  return result;
}

// ============================================================
// 本地配置读写
// ============================================================

/** 读账号配置（坏数据回退默认） */
export function readAccountConfig(kv: KeyValueStore): AccountConfig {
  const raw: string | undefined = kv.getString(ACCOUNT_CONFIG_KEY);
  const fallback: AccountConfig = { baseUrl: ACCOUNT_BASE_DEFAULT };
  if (raw === undefined) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    const record: Record<string, unknown> = parsed as Record<string, unknown>;
    const config: AccountConfig = { baseUrl: ACCOUNT_BASE_DEFAULT };
    const baseUrl: unknown = record['baseUrl'];
    if (typeof baseUrl === 'string' && baseUrl.length > 0) config.baseUrl = baseUrl;
    const cookie: unknown = record['cookie'];
    if (typeof cookie === 'string' && cookie.length > 0) config.cookie = cookie;
    const user: unknown = record['user'];
    if (typeof user === 'object' && user !== null) {
      const userRecord: Record<string, unknown> = user as Record<string, unknown>;
      const id: unknown = userRecord['id'];
      const username: unknown = userRecord['username'];
      const createdAt: unknown = userRecord['createdAt'];
      if (typeof username === 'string' && username.length > 0) {
        const accountUser: AccountUser = {
          id: typeof id === 'string' ? id : '',
          username: username,
          createdAt: typeof createdAt === 'number' ? createdAt : 0
        };
        config.user = accountUser;
      }
    }
    return config;
  } catch (error) {
    return fallback;
  }
}

/** 写账号配置 */
export function writeAccountConfig(kv: KeyValueStore, config: AccountConfig): void {
  try {
    kv.putString(ACCOUNT_CONFIG_KEY, JSON.stringify(config));
  } catch (error) {
    // 忽略
  }
}

/** 是否已登录 */
export function isLoggedIn(config: AccountConfig): boolean {
  return config.user !== undefined;
}

/**
 * 匿名设备标识（随机串，存本机；不含任何个人信息）。
 * 未登录埋惊喜 / 拉回执时用它区分作者 —— 与 iOS `SurpriseService.deviceID` 同义。
 *
 * 用 `config` 里携带的 kv 不方便，所以单独接一个 KeyValueStore。
 */
export function readDeviceID(kv: KeyValueStore): string {
  const existing: string | undefined = kv.getString(DEVICE_ID_KEY);
  if (existing !== undefined && existing.length > 0) return existing;
  const fresh: string = randomDeviceID();
  try {
    kv.putString(DEVICE_ID_KEY, fresh);
  } catch (error) {
    // 写不进去也能用（本次会话内一致）
  }
  return fresh;
}

/** 生成一个 32 位十六进制随机串（不依赖 crypto，够用作设备区分） */
function randomDeviceID(): string {
  const digits: string = '0123456789abcdef';
  let text: string = '';
  for (let i = 0; i < 32; i += 1) {
    const index: number = Math.floor(Math.random() * 16);
    text += digits.charAt(index);
  }
  return text;
}

/** 服务地址是否可以访问（HTTPS 页面不能调 http —— 鸿蒙无此限制，仅提示用） */
export function normalizeBaseUrl(value: string): string {
  const trimmed: string = value.trim();
  if (trimmed.length === 0) return ACCOUNT_BASE_DEFAULT;
  return trimmed.replace(/\/+$/, '');
}

// ============================================================
// Cookie：从 set-cookie 响应头里抠
// ============================================================

/** 从 set-cookie 头里提取 wa_uid=<token>；没有返回空串 */
export function extractCookie(headers: Record<string, string> | undefined): string {
  if (headers === undefined) return '';
  const keys: string[] = Object.keys(headers);
  for (let i = 0; i < keys.length; i += 1) {
    const name: string = keys[i].toLowerCase();
    if (name !== 'set-cookie' && name !== 'set-cookie2') continue;
    const value: string = headers[keys[i]];
    // 一个响应头里可能出现多条 Cookie（用逗号分隔，例如代理合并），
    // 也可能只有一条（分号分隔属性），所以两种分隔符都要拆
    const cookies: string[] = value.split(',');
    for (let c = 0; c < cookies.length; c += 1) {
      const pieces: string[] = cookies[c].split(';');
      for (let j = 0; j < pieces.length; j += 1) {
        const pair: string = pieces[j].trim();
        if (pair.indexOf('wa_uid=') !== 0) continue;
        const token: string = pair.substring('wa_uid='.length).trim();
        if (token.length > 0) return 'wa_uid=' + token;
      }
    }
  }
  return '';
}

// ============================================================
// 请求
// ============================================================

interface ApiOutcome {
  status: number;
  json: Record<string, unknown>;
  headers: Record<string, string>;
}

/** 调一次账号 API；非 2xx 也返回 json（服务端错误体里有 code） */
async function callApi(
  client: HttpClient,
  baseUrl: string,
  path: string,
  method: HttpMethod,
  cookie: string,
  body: Record<string, unknown> | undefined
): Promise<ApiOutcome> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8'
  };
  if (cookie.length > 0) headers['Cookie'] = cookie;

  let text: string = '';
  try {
    const response = await client.request({
      url: normalizeBaseUrl(baseUrl) + path,
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      timeoutMs: 8000
    });
    text = response.body;
    let json: Record<string, unknown> = {};
    if (text.length > 0) {
      try {
        const parsed: unknown = JSON.parse(text);
        if (typeof parsed === 'object' && parsed !== null) {
          json = parsed as Record<string, unknown>;
        }
      } catch (error) {
        json = {};
      }
    }
    const outcome: ApiOutcome = {
      status: response.status,
      json: json,
      headers: response.headers === undefined ? {} : response.headers
    };
    return outcome;
  } catch (error) {
    throw new Error('连不上账号服务（检查地址 / 服务是否启动）：' + errorText(error));
  }
}

function errorCodeOf(json: Record<string, unknown>): string {
  const code: unknown = json['code'];
  return typeof code === 'string' ? code : '';
}

function errorMessageOf(json: Record<string, unknown>, fallback: string): string {
  const message: unknown = json['error'];
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}

function userOf(json: Record<string, unknown>): AccountUser | undefined {
  const value: unknown = json['user'];
  if (typeof value !== 'object' || value === null) return undefined;
  const record: Record<string, unknown> = value as Record<string, unknown>;
  const username: unknown = record['username'];
  if (typeof username !== 'string' || username.length === 0) return undefined;
  const id: unknown = record['id'];
  const createdAt: unknown = record['createdAt'];
  const user: AccountUser = {
    id: typeof id === 'string' ? id : '',
    username: username,
    createdAt: typeof createdAt === 'number' ? createdAt : 0
  };
  return user;
}

/** 把 API 错误码翻译成人话（与 Web 版 accountErrText 一致） */
export function accountErrorText(code: string, fallback: string): string {
  if (code === 'BAD_CREDENTIALS') return '用户名或密码不对';
  if (code === 'USERNAME_TAKEN') return '这个用户名已被注册';
  if (code === 'BAD_REQUEST') return '用户名 3–24 字符，密码至少 6 位';
  if (code === 'TOO_MANY_ATTEMPTS') return '尝试次数太多，10 分钟后再试';
  if (code === 'UNAUTHENTICATED') return '登录已过期，请重新登录';
  return fallback;
}

/** 登录 / 注册共用：成功后把 Cookie 与用户写进配置 */
async function authRequest(
  client: HttpClient,
  kv: KeyValueStore,
  baseUrl: string,
  path: string,
  username: string,
  password: string
): Promise<AccountResult<AccountUser>> {
  const name: string = username.trim();
  if (name.length < 3 || name.length > 24) {
    return failResult<AccountUser>('用户名 3–24 字符', 'BAD_REQUEST');
  }
  if (password.length < 6) {
    return failResult<AccountUser>('密码至少 6 位', 'BAD_REQUEST');
  }
  const body: Record<string, unknown> = { username: name, password: password };
  let outcome: ApiOutcome;
  try {
    outcome = await callApi(client, baseUrl, path, 'POST', '', body);
  } catch (error) {
    return failResult<AccountUser>(errorText(error));
  }
  if (outcome.status < 200 || outcome.status >= 300) {
    const code: string = errorCodeOf(outcome.json);
    const message: string = accountErrorText(code, errorMessageOf(outcome.json, '操作失败'));
    return failResult<AccountUser>(message, code);
  }
  const user: AccountUser | undefined = userOf(outcome.json);
  if (user === undefined) {
    return failResult<AccountUser>('服务没有返回账号信息');
  }
  const cookie: string = extractCookie(outcome.headers);
  const config: AccountConfig = {
    baseUrl: normalizeBaseUrl(baseUrl),
    user: user
  };
  if (cookie.length > 0) config.cookie = cookie;
  writeAccountConfig(kv, config);
  return okResult(user);
}

/** 注册并登录 */
export async function register(
  client: HttpClient,
  kv: KeyValueStore,
  baseUrl: string,
  username: string,
  password: string
): Promise<AccountResult<AccountUser>> {
  return authRequest(client, kv, baseUrl, '/api/auth/register', username, password);
}

/** 登录 */
export async function login(
  client: HttpClient,
  kv: KeyValueStore,
  baseUrl: string,
  username: string,
  password: string
): Promise<AccountResult<AccountUser>> {
  return authRequest(client, kv, baseUrl, '/api/auth/login', username, password);
}

/** 退出（清 Cookie 与用户） */
export async function logout(
  client: HttpClient,
  kv: KeyValueStore,
  config: AccountConfig
): Promise<AccountResult<boolean>> {
  const cookie: string = config.cookie === undefined ? '' : config.cookie;
  try {
    await callApi(client, config.baseUrl, '/api/auth/logout', 'POST', cookie, undefined);
  } catch (error) {
    // 网络失败也要清本地（用户点了退出就该退出）
  }
  const next: AccountConfig = { baseUrl: config.baseUrl };
  writeAccountConfig(kv, next);
  return okResult(true);
}

/** 取当前账号信息（用于「检查登录是否还有效」） */
export async function me(
  client: HttpClient,
  kv: KeyValueStore,
  config: AccountConfig
): Promise<AccountResult<SyncedPayload>> {
  if (config.cookie === undefined || config.cookie.length === 0) {
    return failResult<SyncedPayload>('还没登录', 'UNAUTHENTICATED');
  }
  let outcome: ApiOutcome;
  try {
    outcome = await callApi(client, config.baseUrl, '/api/auth/me', 'GET', config.cookie, undefined);
  } catch (error) {
    return failResult<SyncedPayload>(errorText(error));
  }
  if (outcome.status === 401) {
    // 会话过期：清本地登录态
    const next: AccountConfig = { baseUrl: config.baseUrl };
    writeAccountConfig(kv, next);
    return failResult<SyncedPayload>('登录已过期，请重新登录', 'UNAUTHENTICATED');
  }
  if (outcome.status < 200 || outcome.status >= 300) {
    return failResult<SyncedPayload>(
      accountErrorText(errorCodeOf(outcome.json), errorMessageOf(outcome.json, '获取账号信息失败')),
      errorCodeOf(outcome.json)
    );
  }

  const user: AccountUser | undefined = userOf(outcome.json);
  if (user !== undefined) {
    const updated: AccountConfig = {
      baseUrl: config.baseUrl,
      user: user
    };
    if (config.cookie !== undefined) updated.cookie = config.cookie;
    writeAccountConfig(kv, updated);
  }

  const profileValue: unknown = outcome.json['profile'];
  const payload: SyncedPayload = {};
  if (typeof profileValue === 'object' && profileValue !== null) {
    const profileRecord: Record<string, unknown> = profileValue as Record<string, unknown>;
    payload.profile = profileRecord;
    const surprises: unknown = profileRecord['surprises'];
    if (Array.isArray(surprises)) payload.surprises = surprises;
    const settings: unknown = profileRecord['settings'];
    if (typeof settings === 'object' && settings !== null) {
      payload.settings = settings as Record<string, unknown>;
    }
    const savedAt: unknown = profileRecord['savedAt'];
    if (typeof savedAt === 'number') payload.savedAt = savedAt;
  }
  return okResult(payload);
}

/** 同步到账号（整包覆盖云端） */
export async function pushProfile(
  client: HttpClient,
  config: AccountConfig,
  payload: Record<string, unknown>
): Promise<AccountResult<number>> {
  if (config.cookie === undefined || config.cookie.length === 0) {
    return failResult<number>('还没登录', 'UNAUTHENTICATED');
  }
  const body: Record<string, unknown> = { profile: payload };
  const bytes: number = JSON.stringify(body).length;
  if (bytes > PROFILE_MAX_BYTES) {
    return failResult<number>('数据太大了（' + String(Math.round(bytes / 1024)) + ' KB，上限 240 KB）', 'BAD_REQUEST');
  }
  let outcome: ApiOutcome;
  try {
    outcome = await callApi(client, config.baseUrl, '/api/me/profile', 'PUT', config.cookie, body);
  } catch (error) {
    return failResult<number>(errorText(error));
  }
  if (outcome.status < 200 || outcome.status >= 300) {
    const code: string = errorCodeOf(outcome.json);
    return failResult<number>(
      accountErrorText(code, errorMessageOf(outcome.json, '同步失败')),
      code
    );
  }
  const savedAt: unknown = outcome.json['savedAt'];
  return okResult<number>(typeof savedAt === 'number' ? savedAt : Date.now());
}

/** 删除账号（需要密码二次确认） */
export async function deleteAccount(
  client: HttpClient,
  kv: KeyValueStore,
  config: AccountConfig,
  password: string
): Promise<AccountResult<boolean>> {
  if (config.cookie === undefined || config.cookie.length === 0) {
    return failResult<boolean>('还没登录', 'UNAUTHENTICATED');
  }
  if (password.length === 0) {
    return failResult<boolean>('要输入密码才能删号', 'BAD_REQUEST');
  }
  const body: Record<string, unknown> = { password: password };
  let outcome: ApiOutcome;
  try {
    outcome = await callApi(client, config.baseUrl, '/api/me', 'DELETE', config.cookie, body);
  } catch (error) {
    return failResult<boolean>(errorText(error));
  }
  if (outcome.status < 200 || outcome.status >= 300) {
    const code: string = errorCodeOf(outcome.json);
    return failResult<boolean>(
      accountErrorText(code, errorMessageOf(outcome.json, '删除失败')),
      code
    );
  }
  const next: AccountConfig = { baseUrl: config.baseUrl };
  writeAccountConfig(kv, next);
  return okResult(true);
}

/** 健康检查（设置页「测试连接」用） */
export async function health(
  client: HttpClient,
  baseUrl: string
): Promise<AccountResult<Record<string, unknown>>> {
  let outcome: ApiOutcome;
  try {
    outcome = await callApi(client, baseUrl, '/api/health', 'GET', '', undefined);
  } catch (error) {
    return failResult<Record<string, unknown>>(errorText(error));
  }
  if (outcome.status < 200 || outcome.status >= 300) {
    return failResult<Record<string, unknown>>('服务返回 HTTP ' + String(outcome.status));
  }
  return okResult<Record<string, unknown>>(outcome.json);
}

/** 账号状态文案（设置页入口右侧小字） */
export function accountStatusText(config: AccountConfig): string {
  if (config.user === undefined) return '未登录';
  return config.user.username;
}

// ============================================================
// 登录方式可用性（account/docs/API.md §3.5）
// ============================================================

/** 某一种登录方式的服务端可用性 */
export interface ProviderAvailability {
  enabled: boolean;
  /** 缺哪些服务端环境变量（未配置时用于如实说明） */
  missing: string[];
  /** 微信 AppID（服务端下发，不含 secret） */
  appid: string;
  /** Apple clientId */
  clientId: string;
}

/** 全部登录方式 */
export interface ProvidersAvailability {
  password: ProviderAvailability;
  apple: ProviderAvailability;
  sms: ProviderAvailability;
  wechat: ProviderAvailability;
}

function emptyAvailability(): ProviderAvailability {
  const item: ProviderAvailability = { enabled: false, missing: [], appid: '', clientId: '' };
  return item;
}

function readAvailability(value: unknown): ProviderAvailability {
  const item: ProviderAvailability = emptyAvailability();
  if (typeof value !== 'object' || value === null) return item;
  const record: Record<string, unknown> = value as Record<string, unknown>;
  item.enabled = record['enabled'] === true;
  const missing: unknown = record['missing'];
  if (Array.isArray(missing)) {
    for (let i = 0; i < missing.length; i += 1) {
      if (typeof missing[i] === 'string') item.missing.push(missing[i] as string);
    }
  }
  if (typeof record['appid'] === 'string') item.appid = record['appid'] as string;
  if (typeof record['clientId'] === 'string') item.clientId = record['clientId'] as string;
  return item;
}

/**
 * 问一次服务端「哪些登录方式可用」。
 * 客户端据此决定按钮显示 / 如实说明缺什么，**绝不下发任何 secret**。
 */
export async function fetchProviders(
  client: HttpClient,
  baseUrl: string
): Promise<ProvidersAvailability> {
  const result: ProvidersAvailability = {
    password: emptyAvailability(),
    apple: emptyAvailability(),
    sms: emptyAvailability(),
    wechat: emptyAvailability()
  };
  result.password.enabled = true;
  let outcome: ApiOutcome;
  try {
    outcome = await callApi(client, baseUrl, '/api/auth/providers', 'GET', '', undefined);
  } catch (error) {
    return result;
  }
  if (outcome.status < 200 || outcome.status >= 300) return result;
  const providers: unknown = outcome.json['providers'];
  if (typeof providers !== 'object' || providers === null) return result;
  const record: Record<string, unknown> = providers as Record<string, unknown>;
  result.password = readAvailability(record['password']);
  result.apple = readAvailability(record['apple']);
  result.sms = readAvailability(record['sms']);
  result.wechat = readAvailability(record['wechat']);
  return result;
}

// ============================================================
// 短信验证码登录（account/docs/API.md §3.4）
// ============================================================

/** 发码结果 */
export interface SmsSendResult {
  ok: boolean;
  /** 验证码有效期（秒） */
  ttlSeconds: number;
  /** 服务端是否处于开发模式（不发真短信，验证码打到日志） */
  devMode: boolean;
  error?: string;
}

/** 手机号格式（11 位，1 开头） */
export function isValidPhone(phone: string): boolean {
  return /^1\d{10}$/.test(phone.trim());
}

/** 6 位数字验证码 */
export function isValidSmsCode(code: string): boolean {
  return /^\d{6}$/.test(code.trim());
}

/** 发一条验证码（限流由服务端判定，客户端不做本地拦截） */
export async function sendSmsCode(
  client: HttpClient,
  baseUrl: string,
  phone: string
): Promise<SmsSendResult> {
  if (!isValidPhone(phone)) {
    const invalid: SmsSendResult = { ok: false, ttlSeconds: 0, devMode: false, error: '手机号格式不对' };
    return invalid;
  }
  let outcome: ApiOutcome;
  try {
    outcome = await callApi(client, baseUrl, '/api/auth/sms/send', 'POST', '', { phone: phone.trim() });
  } catch (error) {
    const failed: SmsSendResult = { ok: false, ttlSeconds: 0, devMode: false, error: errorText(error) };
    return failed;
  }
  if (outcome.status < 200 || outcome.status >= 300) {
    const failed: SmsSendResult = {
      ok: false, ttlSeconds: 0, devMode: false,
      error: errorMessageOf(outcome.json, '发送失败（' + String(outcome.status) + '）')
    };
    return failed;
  }
  const ttl: unknown = outcome.json['ttlSeconds'];
  const devMode: unknown = outcome.json['devMode'];
  const ok: SmsSendResult = {
    ok: true,
    ttlSeconds: typeof ttl === 'number' ? ttl : 300,
    devMode: devMode === true
  };
  return ok;
}

/** 短信验证码登录错误码 → 人话 */
export function smsErrorText(code: string, fallback: string): string {
  if (code === 'SMS_NOT_CONFIGURED') return '服务端还没配置短信服务';
  if (code === 'SMS_TOO_MANY_SENDS') return '发送太频繁，10 分钟后再试';
  if (code === 'SMS_NO_CODE') return '还没发过验证码，先点「获取验证码」';
  if (code === 'SMS_EXPIRED') return '验证码已过期，重新获取';
  if (code === 'SMS_WRONG_CODE') return '验证码不对，再输一次';
  if (code === 'SMS_TOO_MANY_ATTEMPTS') return '试错次数太多，重新获取验证码';
  if (code === 'BAD_PHONE') return '手机号格式不对';
  return fallback;
}

/** 用手机号 + 验证码登录（没有账号时服务端自动建号） */
export async function loginWithSms(
  client: HttpClient,
  kv: KeyValueStore,
  baseUrl: string,
  phone: string,
  code: string
): Promise<AccountResult<AccountUser>> {
  if (!isValidPhone(phone)) {
    return failResult<AccountUser>('手机号格式不对', 'BAD_PHONE');
  }
  if (!isValidSmsCode(code)) {
    return failResult<AccountUser>('验证码是 6 位数字', 'BAD_CODE');
  }
  const body: Record<string, unknown> = { phone: phone.trim(), code: code.trim() };
  let outcome: ApiOutcome;
  try {
    outcome = await callApi(client, baseUrl, '/api/auth/sms/verify', 'POST', '', body);
  } catch (error) {
    return failResult<AccountUser>(errorText(error));
  }
  if (outcome.status < 200 || outcome.status >= 300) {
    const codeText: string = errorCodeOf(outcome.json);
    return failResult<AccountUser>(
      smsErrorText(codeText, errorMessageOf(outcome.json, '登录失败')),
      codeText
    );
  }
  const user: AccountUser | undefined = userOf(outcome.json);
  if (user === undefined) {
    return failResult<AccountUser>('服务没有返回账号信息');
  }
  const config: AccountConfig = {
    baseUrl: normalizeBaseUrl(baseUrl),
    user: user
  };
  const cookie: string = extractCookie(outcome.headers);
  if (cookie.length > 0) config.cookie = cookie;
  writeAccountConfig(kv, config);
  return okResult(user);
}