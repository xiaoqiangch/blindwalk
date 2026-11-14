/**
 * 步迷 Walkaholic · 账号服务 — 微信登录
 *
 * 走微信开放平台 OAuth2（「移动应用」用 snsapi_userinfo，令牌交换接口与网站应用一致）：
 *   1. 客户端拿 appid 唤起微信授权（App 内用 WXApi，或 ASWebAuthenticationSession 打开授权页）
 *   2. 用户同意后带回 code
 *   3. 服务端用 code 换 access_token + openid（本模块）
 *   4. 用 openid 拿昵称 / 头像（失败不影响登录）
 *   5. 按 openid 找本地用户：有就登录，没有就建一个
 *
 * 安全约束：
 * - AppSecret 只存在服务端环境变量，绝不下发客户端
 * - 未配置时不假装可用：enabled=false，登录接口返回 503 并说清缺什么
 */

const DEFAULT_TOKEN_URL = 'https://api.weixin.qq.com/sns/oauth2/access_token';
const DEFAULT_USERINFO_URL = 'https://api.weixin.qq.com/sns/userinfo';

/** 环境变量读法：WA_ / BW_ 两个前缀都认，WA_ 优先 */
function envAny(env, name) {
  const primary = env['WA_' + name];
  if (primary !== undefined && String(primary).trim() !== '') return String(primary).trim();
  const legacy = env['BW_' + name];
  if (legacy !== undefined && String(legacy).trim() !== '') return String(legacy).trim();
  return '';
}

export class WeChatError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'WeChatError';
    this.code = code;
    this.status = status;
  }
}

/**
 * 微信登录配置。
 * 需要的三个环境变量：WECHAT_APPID / WECHAT_SECRET；回调地址在 App 纯 code 模式可省。
 */
export function resolveConfig(env = process.env) {
  const appid = envAny(env, 'WECHAT_APPID');
  const secret = envAny(env, 'WECHAT_SECRET');
  const missing = [];
  if (!appid) missing.push('WA_WECHAT_APPID');
  if (!secret) missing.push('WA_WECHAT_SECRET');
  return {
    enabled: missing.length === 0,
    appid,
    secret,
    universalLink: envAny(env, 'WECHAT_UNIVERSAL_LINK'),
    missing,
    tokenUrl: envAny(env, 'WECHAT_TOKEN_URL') || DEFAULT_TOKEN_URL,
    userInfoUrl: envAny(env, 'WECHAT_USERINFO_URL') || DEFAULT_USERINFO_URL
  };
}

/**
 * 给客户端的公开视图（绝不包含 secret）。
 * 既可以传 env（会自己解析），也可以直接传已解析好的 config。
 */
export function publicConfig(source = process.env) {
  const config = (source && typeof source.enabled === 'boolean') ? source : resolveConfig(source);
  return {
    enabled: config.enabled,
    appid: config.appid || null,
    universalLink: config.universalLink || null,
    missing: config.missing
  };
}

/**
 * 用 code 换 openid。
 * 微信的返回是 `{access_token, openid, unionid?, expires_in, ...}`，
 * 失败时是 `{errcode, errmsg}`（HTTP 仍是 200，必须看 errcode）。
 */
export async function exchangeCode(config, code, fetchImpl = fetch) {
  if (!config.enabled) {
    throw new WeChatError('服务端还没配置微信登录', 'WECHAT_NOT_CONFIGURED', 503);
  }
  if (typeof code !== 'string' || code.trim().length === 0) {
    throw new WeChatError('缺少 code', 'BAD_REQUEST', 400);
  }
  const url = new URL(config.tokenUrl);
  url.searchParams.set('appid', config.appid);
  url.searchParams.set('secret', config.secret);
  url.searchParams.set('code', code.trim());
  url.searchParams.set('grant_type', 'authorization_code');

  let payload;
  try {
    const response = await fetchImpl(url, { method: 'GET' });
    payload = await response.json();
  } catch (error) {
    throw new WeChatError('连不上微信服务器', 'WECHAT_UNREACHABLE', 502);
  }
  if (!payload || payload.errcode) {
    const message = payload && payload.errmsg ? payload.errmsg : '微信返回异常';
    // invalid code / expired：让客户端重新授权，不要提示「服务器错误」
    const code400 = payload && (payload.errcode === 40029 || payload.errcode === 40163);
    throw new WeChatError(
      code400 ? '授权已失效，请重新授权' : '微信登录失败：' + message,
      code400 ? 'WECHAT_CODE_INVALID' : 'WECHAT_FAILED',
      code400 ? 400 : 502
    );
  }
  if (!payload.openid) {
    throw new WeChatError('微信没有返回 openid', 'WECHAT_FAILED', 502);
  }
  return {
    openid: String(payload.openid),
    unionid: payload.unionid ? String(payload.unionid) : null,
    accessToken: payload.access_token ? String(payload.access_token) : null
  };
}

/** 拉昵称 / 头像（可选，失败返回空对象，不阻塞登录） */
export async function fetchProfile(config, auth, fetchImpl = fetch) {
  if (!auth.accessToken || !auth.openid) return {};
  try {
    const url = new URL(config.userInfoUrl);
    url.searchParams.set('access_token', auth.accessToken);
    url.searchParams.set('openid', auth.openid);
    url.searchParams.set('lang', 'zh_CN');
    const response = await fetchImpl(url, { method: 'GET' });
    const payload = await response.json();
    if (!payload || payload.errcode) return {};
    return {
      nickname: payload.nickname ? String(payload.nickname).slice(0, 24) : null,
      avatar: payload.headimgurl ? String(payload.headimgurl) : null
    };
  } catch (error) {
    return {};
  }
}

