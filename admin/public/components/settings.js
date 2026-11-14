/* 步迷 · 兴趣点后台 — 服务端设置面板（AI 模型 / 微信登录）
 *
 * 为什么单独一个文件：admin.js 已经 2000 多行，把「设置」这类独立面板拆出来更好维护。
 * 约定：
 *   - 依赖 window.WAUI / window.WAAPI（与 admin.js 一致）
 *   - 自己挂 data-action="settings" 按钮的点击（admin.js 里调用 WASettings.open）
 *   - 所有敏感值只显示掩码；留空 = 不修改；显式点「清除」才清空
 */
(function () {
  'use strict';

  const UI = window.WAUI;
  const API = window.WAAPI;

  const state = {
    open: false,
    tab: 'ai',
    ai: { loading: false, data: null, error: '', testResult: null, busy: false },
    wx: { loading: false, data: null, error: '', busy: false },
    draft: {}
  };

  let panel = null;
  let body = null;

  // ============================================================
  // 小工具
  // ============================================================

  function errorText(error) {
    if (!error) return '未知错误';
    const code = error.code && error.code !== 'HTTP_500' ? '（' + error.code + '）' : '';
    return (error.message || String(error)) + code;
  }

  function field(id, label, value, options) {
    const opts = options || {};
    const placeholder = opts.placeholder || '';
    const help = opts.help ? '<p class="mapkeys__help">' + UI.escapeHtml(opts.help) + '</p>' : '';
    const type = opts.secret ? 'password' : 'text';
    const readonly = opts.readonly ? ' readonly' : '';
    return '<div class="mapkeys__row" data-field="' + id + '">' +
      '<div class="mapkeys__rowhead">' +
        '<div>' +
          '<label class="field__label" for="setting-' + id + '">' + UI.escapeHtml(label) + '</label>' +
          help +
        '</div>' +
        (opts.badge || '') +
      '</div>' +
      '<div class="mapkeys__controls">' +
        '<input class="input" id="setting-' + id + '" data-key="' + id + '" type="' + type + '"' +
          ' autocomplete="new-password" spellcheck="false"' +
          ' placeholder="' + UI.escapeHtml(placeholder) + '"' + readonly +
          ' value="' + UI.escapeHtml(readonly ? String(value || '') : '') + '">' +
      '</div>' +
      '<p class="mapkeys__result" id="setting-result-' + id + '"></p>' +
    '</div>';
  }

  function configuredBadge(configured, hint) {
    return configured
      ? '<span class="mapkeys__status is-on">● 已配置' +
        (hint ? ' · <code>' + UI.escapeHtml(hint) + '</code>' : '') + '</span>'
      : '<span class="mapkeys__status">○ 未配置</span>';
  }

  // ============================================================
  // 渲染
  // ============================================================

  function renderTabs() {
    const tabs = [
      { id: 'ai', label: 'AI 模型' },
      { id: 'wx', label: '微信登录' }
    ].map(function (tab) {
      return '<button type="button" class="surprise__tab' + (state.tab === tab.id ? ' is-on' : '') +
        '" data-settings-tab="' + tab.id + '">' + UI.escapeHtml(tab.label) + '</button>';
    }).join('');
    return '<div class="surprise__toolbar"><div class="surprise__tabs">' + tabs + '</div></div>';
  }

  function renderAi() {
    const data = state.ai.data;
    if (state.ai.loading && !data) return '<p class="mapkeys__loading">正在读取 AI 设置…</p>';
    if (state.ai.error) {
      return '<p class="mapkeys__err">读取失败：' + UI.escapeHtml(state.ai.error) + '</p>';
    }
    if (!data) return '';

    const apiKey = data.settings['llm.apiKey'] || {};
    const baseUrl = data.settings['llm.baseUrl'] || {};
    const model = data.settings['llm.model'] || {};
    const mode = data.llmEnabled
      ? '<span class="mapkeys__status is-on">● 已启用 · 来源 ' + UI.escapeHtml(data.source) + '</span>'
      : '<span class="mapkeys__status">○ 离线规则模式</span>';

    const test = state.ai.testResult;
    let testHtml = '';
    if (test) {
      testHtml = '<p class="mapkeys__result ' + (test.ok ? 'is-ok' : 'is-err') + '">' +
        (test.ok
          ? '连接成功 · ' + UI.escapeHtml(test.model || '')
          : '测试失败：' + UI.escapeHtml(test.error || '')) +
        '</p>';
    }

    return '' +
      '<div class="mapkeys__note">' + UI.icon('alert', 14) +
        '<span>AI 只用于给兴趣点写文案、做保密检查与安全评估；' +
        '<strong>没配 Key 时全部走离线规则</strong>，不会假装是模型输出。</span>' +
      '</div>' +
      field('llm.apiKey', 'API Key', '', {
        secret: true,
        badge: configuredBadge(apiKey.configured, apiKey.value),
        placeholder: apiKey.configured
          ? '已配置 ' + apiKey.value + '（留空表示不修改）'
          : 'sk-…（DeepSeek / 火山 / 百炼 任意 OpenAI 兼容 Key）',
        help: '只存服务器数据库；页面只显示掩码。'
      }) +
      field('llm.baseUrl', 'Base URL', baseUrl.value || 'https://api.deepseek.com/v1', {
        readonly: true,
        help: '当前生效的接口地址（来自数据库或环境变量）。'
      }) +
      field('llm.model', '模型', '', {
        badge: model.value ? '<span class="mapkeys__status is-on">' + UI.escapeHtml(model.value) + '</span>' : '',
        placeholder: 'deepseek-chat',
        help: '留空表示不修改。'
      }) +
      '<footer class="mapkeys__foot">' +
        '<button type="button" class="btn btn--sm" data-settings-test="ai"' +
          (data.llmEnabled ? '' : ' disabled title="先保存 Key 再测试"') + '>测试连接</button>' +
        '<span class="spacer"></span>' +
        mode +
        '<button type="button" class="btn btn--primary" data-settings-save="ai">保存</button>' +
      '</footer>' + testHtml;
  }

  function renderWx() {
    const data = state.wx.data;
    if (state.wx.loading && !data) return '<p class="mapkeys__loading">正在读取微信设置…</p>';
    if (state.wx.error) {
      return '<p class="mapkeys__err">读取失败：' + UI.escapeHtml(state.wx.error) + '</p>' +
        '<p class="mapkeys__help">「账号库不可用」通常意味着账号服务的数据库还没建好，先重启一次账号服务。</p>';
    }
    if (!data) return '';

    const appid = data.settings['wechat.appid'] || {};
    const secret = data.settings['wechat.secret'] || {};
    const link = data.settings['wechat.universalLink'] || {};
    const status = data.wechatEnabled
      ? '<span class="mapkeys__status is-on">● 已启用</span>'
      : '<span class="mapkeys__status">○ 未启用' +
        (data.missing.length ? ' · 缺 ' + UI.escapeHtml(data.missing.join(' / ')) : '') + '</span>';

    return '' +
      '<div class="mapkeys__note">' + UI.icon('alert', 14) +
        '<span>在 <strong>微信开放平台</strong> 创建应用后，把 AppID / AppSecret 填在这里。' +
        'AppSecret <strong>绝不写入客户端</strong>，只存在服务端；保存后「微信一键登录」立即可用。</span>' +
      '</div>' +
      field('wechat.appid', 'AppID', '', {
        badge: configuredBadge(appid.configured, appid.value),
        placeholder: appid.configured
          ? '已配置 ' + appid.value + '（留空表示不修改）'
          : 'wx…（开放平台 → 应用详情）',
        help: '移动应用的 AppID；Bundle ID 必须是 com.walkaholic.app。'
      }) +
      field('wechat.secret', 'AppSecret', '', {
        secret: true,
        badge: configuredBadge(secret.configured, secret.value),
        placeholder: secret.configured
          ? '已配置 ' + secret.value + '（留空表示不修改）'
          : '开放平台 → 应用详情 → AppSecret',
        help: '只存服务端数据库，页面只显示掩码，任何接口都不会回发明文。'
      }) +
      field('wechat.universalLink', 'Universal Link（可选）', '', {
        badge: link.configured ? '<span class="mapkeys__status is-on">' + UI.escapeHtml(link.value) + '</span>' : '',
        placeholder: 'https://xqlounge.top/app/（接 WeChatOpenSDK 时需要）',
        help: '用网页授权（qrconnect）时可以不填。'
      }) +
      '<footer class="mapkeys__foot">' +
        '<span class="mapkeys__public">' + UI.escapeHtml(data.dbPath || '') + '</span>' +
        '<span class="spacer"></span>' +
        status +
        '<button type="button" class="btn btn--primary" data-settings-save="wx">保存</button>' +
      '</footer>';
  }

  function render() {
    if (!body) return;
    body.innerHTML = renderTabs() + (state.tab === 'ai' ? renderAi() : renderWx());
  }

  // ============================================================
  // 数据
  // ============================================================

  async function loadAi() {
    state.ai.loading = true;
    state.ai.error = '';
    render();
    try {
      state.ai.data = await API.llmSettings();
    } catch (error) {
      state.ai.error = errorText(error);
    } finally {
      state.ai.loading = false;
      render();
    }
  }

  async function loadWx() {
    state.wx.loading = true;
    state.wx.error = '';
    render();
    try {
      state.wx.data = await API.accountSettings();
    } catch (error) {
      state.wx.error = errorText(error);
    } finally {
      state.wx.loading = false;
      render();
    }
  }

  function collectInputs() {
    const patch = {};
    const inputs = body.querySelectorAll('input[data-key]');
    Array.prototype.forEach.call(inputs, function (input) {
      const key = input.getAttribute('data-key');
      if (input.readOnly) return;
      const value = input.value.trim();
      if (value.length > 0) patch[key] = value;
    });
    return patch;
  }

  async function save(which, button) {
    const patch = collectInputs();
    if (Object.keys(patch).length === 0) {
      UI.toast('输入新值后再保存（留空表示不修改）', 'info', 3200);
      return;
    }
    UI.setBusy(button, true, '保存中…');
    try {
      if (which === 'ai') {
        state.ai.data = await API.putLlmSettings(patch);
        state.ai.testResult = null;
        UI.toast('AI 设置已保存', 'success', 2400);
      } else {
        state.wx.data = await API.putAccountSettings(patch);
        UI.toast('微信设置已保存', 'success', 2400);
      }
      render();
    } catch (error) {
      UI.toast('保存失败：' + errorText(error), 'error', 5200);
    } finally {
      UI.setBusy(button, false);
    }
  }

  async function testConnection(button) {
    UI.setBusy(button, true, '测试中…');
    try {
      state.ai.testResult = await API.testLlm();
      if (state.ai.testResult.ok) {
        UI.toast('连接成功 · ' + (state.ai.testResult.model || ''), 'success', 3200);
      } else {
        UI.toast('测试失败：' + (state.ai.testResult.error || ''), 'error', 5200);
      }
      render();
    } catch (error) {
      UI.toast('测试失败：' + errorText(error), 'error', 5200);
    } finally {
      UI.setBusy(button, false);
    }
  }

  // ============================================================
  // 交互
  // ============================================================

  function open(tab) {
    if (!panel) return;
    state.open = true;
    if (tab) state.tab = tab;
    panel.hidden = false;
    render();
    if (state.tab === 'ai') loadAi();
    else loadWx();
  }

  function close() {
    if (!panel) return;
    state.open = false;
    panel.hidden = true;
  }

  function bind() {
    panel = document.getElementById('settings-panel');
    body = document.getElementById('settings-body');
    if (!panel || !body) return;

    panel.addEventListener('click', function (event) {
      if (event.target.closest('[data-settings-close]')) {
        close();
        return;
      }
      const tab = event.target.closest('[data-settings-tab]');
      if (tab) {
        state.tab = tab.getAttribute('data-settings-tab');
        render();
        if (state.tab === 'ai' && !state.ai.data) loadAi();
        if (state.tab === 'wx' && !state.wx.data) loadWx();
        return;
      }
      const saveButton = event.target.closest('[data-settings-save]');
      if (saveButton) {
        save(saveButton.getAttribute('data-settings-save'), saveButton);
        return;
      }
      const testButton = event.target.closest('[data-settings-test]');
      if (testButton) {
        testConnection(testButton);
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && state.open) close();
    });
  }

  window.WASettings = { open: open, close: close, bind: bind };
})();
