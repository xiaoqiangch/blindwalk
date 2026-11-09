/* 盲走 · 兴趣点后台 — API 调用层（零依赖）
 * 严格按 admin/docs/CONTRACT.md §4 的端点与错误结构实现。
 * 暴露在 window.BWAPI。
 */
(function () {
  'use strict';

  async function request(method, path, body) {
    const init = { method: method, headers: {} };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json; charset=utf-8';
      init.body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetch(path, init);
    } catch (error) {
      const err = new Error('网络请求失败：' + (error && error.message ? error.message : String(error)));
      err.code = 'NETWORK';
      throw err;
    }

    let payload = null;
    const contentType = response.headers.get('Content-Type') || '';
    if (contentType.indexOf('application/json') >= 0) {
      try { payload = await response.json(); } catch (_) { payload = null; }
    } else {
      try { payload = await response.text(); } catch (_) { payload = null; }
    }

    // 会话失效统一跳登录页（服务端 v2 提供 /admin/login）
    if (response.status === 401) {
      const isAuthCall = path.indexOf('/api/auth/') === 0;
      if (!isAuthCall && !window.__BW_LOGIN_REDIRECT__) {
        window.__BW_LOGIN_REDIRECT__ = true;
        const next = encodeURIComponent(location.pathname + location.search);
        location.replace('/admin/login?next=' + next);
      }
    }

    if (!response.ok) {
      const message = payload && payload.error ? payload.error : ('请求失败（HTTP ' + response.status + '）');
      const err = new Error(message);
      err.code = payload && payload.code ? payload.code : 'HTTP_' + response.status;
      err.status = response.status;
      throw err;
    }
    return payload;
  }

  function buildQuery(params) {
    const parts = [];
    Object.keys(params).forEach(function (key) {
      const value = params[key];
      if (value === undefined || value === null || value === '') return;
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  window.BWAPI = {
    request: request,

    // 4.1 列表与查询（只使用契约声明的参数）
    list: function (params) {
      const query = buildQuery({
        status: params.status === 'all' ? '' : params.status,
        q: params.q,
        category: params.category,
        limit: params.limit || 100,
        offset: params.offset || 0
      });
      return request('GET', '/api/pois' + query);
    },

    // 4.2 单条
    poi: function (id) { return request('GET', '/api/pois/' + encodeURIComponent(id)); },
    create: function (partial) { return request('POST', '/api/pois', partial); },
    update: function (id, partial) { return request('PUT', '/api/pois/' + encodeURIComponent(id), partial); },
    remove: function (id) { return request('DELETE', '/api/pois/' + encodeURIComponent(id)); },

    // 4.3 抓取
    ingest: function (payload) { return request('POST', '/api/ingest', payload); },

    // 4.4 大模型
    normalize: function (id) { return request('POST', '/api/llm/normalize', { id: id }); },
    llmEdit: function (id, instruction) {
      return request('POST', '/api/llm/edit', { id: id, instruction: instruction });
    },
    analyze: function (ids) { return request('POST', '/api/llm/analyze', { ids: ids }); },
    analyzeAll: function (status) { return request('POST', '/api/llm/analyze-all', { status: status }); },

    // 4.5 状态
    llmStatus: function () { return request('GET', '/api/llm/status'); },

    // 4.6 导出
    exportPois: function () { return request('POST', '/api/export'); },

    // 4.7 统计
    stats: function () { return request('GET', '/api/stats'); }
  };
})();
