/* 衣衣歪歪 · 兴趣点管理后台（零依赖）
 *
 * 三栏：左筛选 / 中列表 / 右编辑。
 * 契约：admin/docs/CONTRACT.md（API 与字段唯一来源，不臆造接口）。
 *
 * 开发自检：index.html?mock=1 / ?mock=empty / ?mock=llm（见 mock.js，仅开发用）
 */
(function () {
  'use strict';

  const UI = window.BWUI;
  const API = window.BWAPI;
  const $ = function (selector, root) { return (root || document).querySelector(selector); };
  const $$ = function (selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); };

  const PAGE_LIMIT = 100;

  const state = {
    llm: { mode: 'offline', ready: false, model: '', baseUrl: '', error: '' },
    stats: null,
    filters: { status: 'all', category: '', q: '', photo: 'all' },
    list: { items: [], total: 0, loading: false, error: '', loadingMore: false },
    selection: new Set(),
    current: null,
    draft: null,
    dirty: false,
    booted: false,
    statsError: '',
    mock: !!window.__BW_MOCK__,
    mapkeys: { loading: false, data: null, error: '', testResults: {} }
  };

  const els = {
    topActions: document.getElementById('top-actions'),
    llmBadge: document.getElementById('llm-badge'),
    filters: document.getElementById('filters'),
    listpane: document.getElementById('listpane'),
    editorpane: document.getElementById('editorpane'),
    mapkeysPanel: document.getElementById('mapkeys-panel'),
    mapkeysBody: document.getElementById('mapkeys-body')
  };

  let drawerScrim = null;

  // ============================================================
  // 小工具
  // ============================================================

  function deepCopy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function num(value, fallback) {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? fallback : parsed;
  }

  function isSmallScreen() {
    return window.matchMedia('(max-width: 1180px)').matches;
  }

  function ensureDrawer() {
    if (drawerScrim) return;
    drawerScrim = document.createElement('div');
    drawerScrim.className = 'drawer-scrim';
    drawerScrim.setAttribute('aria-hidden', 'true');
    drawerScrim.addEventListener('click', function () {
      closeEditor();
    });
    document.body.appendChild(drawerScrim);
  }

  function setEditorOpen(open) {
    if (isSmallScreen()) {
      ensureDrawer();
      els.editorpane.classList.toggle('is-open', open);
      drawerScrim.classList.toggle('is-open', open);
    } else {
      els.editorpane.classList.remove('is-open');
      if (drawerScrim) drawerScrim.classList.remove('is-open');
    }
  }

  function errorText(error) {
    if (!error) return '未知错误';
    const code = error.code && error.code !== 'HTTP_500' ? '（' + error.code + '）' : '';
    return (error.message || String(error)) + code;
  }

  function toastError(prefix, error) {
    UI.toast(prefix + '：' + errorText(error), 'error', 5200);
  }

  function withBusy(button, busyText, task) {
    if (!button) {
      return task();
    }
    UI.setBusy(button, true, busyText);
    return Promise.resolve()
      .then(task)
      .finally(function () { UI.setBusy(button, false); });
  }

  // ============================================================
  // 顶部操作条
  // ============================================================

  function renderTopActions() {
    const offline = state.llm.mode !== 'llm' || !state.llm.ready;
    const editReason = offline
      ? '离线规则模式：需要配置 BW_LLM_API_KEY 才能用指令改写'
      : '让大模型按指令改写当前兴趣点';
    const ruleHint = offline ? '离线规则模式：结果由规则生成，不是模型输出' : '调用大模型';

    els.topActions.innerHTML =
      '<button type="button" class="btn btn--primary" data-action="ingest" aria-label="抓取附近的兴趣点">' +
        UI.icon('capture') + '<span>抓取附近</span></button>' +
      '<span class="toolbar-sep" aria-hidden="true"></span>' +
      '<button type="button" class="btn" data-action="normalize" title="' + UI.escapeHtml(ruleHint) + '" aria-label="用 AI 整理当前兴趣点">' +
        UI.icon('sparkles') + '<span>AI 整理</span></button>' +
      '<button type="button" class="btn' + (offline ? ' is-disabled' : '') + '" data-action="ai-edit" ' +
        'title="' + UI.escapeHtml(editReason) + '" aria-label="用 AI 按指令编辑" ' +
        (offline ? 'aria-disabled="true"' : '') + '>' +
        UI.icon('pen') + '<span>AI 编辑</span></button>' +
      '<button type="button" class="btn" data-action="ai-analyze" title="' + UI.escapeHtml(ruleHint) + '" aria-label="用 AI 分析当前兴趣点">' +
        UI.icon('chart') + '<span>AI 分析</span></button>' +
      '<button type="button" class="btn" data-action="ai-batch" title="' + UI.escapeHtml(ruleHint) + '" aria-label="批量分析当前筛选状态下的兴趣点">' +
        UI.icon('layers') + '<span>AI 批量分析</span></button>' +
      '<span class="toolbar-sep" aria-hidden="true"></span>' +
      '<button type="button" class="btn" data-action="mapkeys" aria-label="管理地图 Key">' +
        UI.icon('lockKey') + '<span>地图 Key</span></button>' +
      '<button type="button" class="btn" data-action="export" aria-label="导出已通过的兴趣点到 App">' +
        UI.icon('upload') + '<span>导出到 App</span></button>';
  }

  function renderLlmBadge() {
    const llm = state.llm;
    els.llmBadge.classList.remove('is-ready', 'is-offline');
    if (llm.error) {
      els.llmBadge.classList.add('is-offline');
      els.llmBadge.title = '读取 /api/llm/status 失败：' + llm.error;
      els.llmBadge.querySelector('.llm-badge__text').textContent = '大模型状态未知（服务未就绪）';
      return;
    }
    if (llm.mode === 'llm' && llm.ready) {
      els.llmBadge.classList.add('is-ready');
      els.llmBadge.title = (llm.baseUrl || '') + (llm.model ? ' · ' + llm.model : '');
      els.llmBadge.querySelector('.llm-badge__text').textContent = '大模型已就绪 · ' + (llm.model || 'deepseek-chat');
    } else {
      els.llmBadge.classList.add('is-offline');
      els.llmBadge.title = '没有配置 BW_LLM_API_KEY：AI 整理 / 分析走离线规则，AI 编辑不可用';
      els.llmBadge.querySelector('.llm-badge__text').textContent = '离线规则模式（未配置大模型）';
    }
  }

  // ============================================================
  // 左栏 · 筛选
  // ============================================================

  function statusCounts() {
    const stats = state.stats;
    const counts = { all: 0, draft: 0, review: 0, approved: 0, rejected: 0 };
    if (stats && stats.byStatus) {
      counts.draft = stats.byStatus.draft || 0;
      counts.review = stats.byStatus.review || 0;
      counts.approved = stats.byStatus.approved || 0;
      counts.rejected = stats.byStatus.rejected || 0;
      counts.all = stats.total || 0;
    }
    return counts;
  }

  function renderFilters() {
    const counts = statusCounts();
    const statuses = [
      { id: 'all', label: '全部', dot: 'dot--all' },
      { id: 'draft', label: '草稿', dot: 'dot--draft' },
      { id: 'review', label: '待审', dot: 'dot--review' },
      { id: 'approved', label: '已通过', dot: 'dot--approved' },
      { id: 'rejected', label: '已拒绝', dot: 'dot--rejected' }
    ];

    let statusHtml = '';
    statuses.forEach(function (item) {
      const active = state.filters.status === item.id;
      statusHtml +=
        '<button type="button" class="status-item' + (active ? ' is-active' : '') + '" ' +
          'data-filter-status="' + item.id + '" aria-pressed="' + active + '">' +
          '<span class="status-item__dot ' + item.dot + '" aria-hidden="true"></span>' +
          '<span class="status-item__label">' + item.label + '</span>' +
          '<span class="status-item__count">' + (item.id === 'all' ? counts.all : counts[item.id]) + '</span>' +
        '</button>';
    });

    const categoryOptions = ['<option value="">全部类别</option>'].concat(
      UI.CATEGORIES.map(function (category) {
        const selected = state.filters.category === category.id ? ' selected' : '';
        return '<option value="' + category.id + '"' + selected + '>' + category.emoji + ' ' + UI.escapeHtml(category.label) + '</option>';
      })
    ).join('');

    const photoButtons = [
      { id: 'all', label: '全部' },
      { id: 'with', label: '有图' },
      { id: 'without', label: '无图' }
    ].map(function (item) {
      const active = state.filters.photo === item.id;
      return '<button type="button" class="seg__btn' + (active ? ' is-active' : '') + '" ' +
        'data-photo="' + item.id + '" aria-pressed="' + active + '">' + item.label + '</button>';
    }).join('');

    const withPhoto = state.stats ? state.stats.withPhoto : 0;
    const total = state.stats ? state.stats.total : 0;
    const statLine = state.stats
      ? '有图 ' + withPhoto + ' · 无图 ' + Math.max(0, total - withPhoto) + ' · 线索齐全 ' + (state.stats.withHints || 0)
      : (state.statsError ? '统计读取失败：' + UI.escapeHtml(state.statsError) : '统计加载中…');

    els.filters.innerHTML =
      '<div class="pane__head">' +
        '<span class="pane__title">筛选</span>' +
        '<button type="button" class="btn btn--icon btn--ghost" data-action="refresh" aria-label="刷新数据">' + UI.icon('refresh', 15) + '</button>' +
      '</div>' +
      '<div class="pane__scroll">' +
        '<div class="filter-group">' +
          '<div class="micro-label"><span>状态</span><span>' + (state.stats ? state.stats.total : '—') + '</span></div>' +
          '<div class="status-list">' + statusHtml + '</div>' +
        '</div>' +
        '<div class="filter-group">' +
          '<div class="micro-label"><span>类别</span></div>' +
          '<select class="select" id="filter-category" aria-label="按类别筛选">' + categoryOptions + '</select>' +
        '</div>' +
        '<div class="filter-group">' +
          '<div class="micro-label"><span>关键词</span></div>' +
          '<div class="search-wrap">' + UI.icon('search', 13) +
            '<input class="input" id="filter-q" type="search" placeholder="名称 / 简介 / 标签" ' +
              'autocomplete="off" value="' + UI.escapeHtml(state.filters.q) + '" aria-label="关键词搜索">' +
          '</div>' +
        '</div>' +
        '<div class="filter-group">' +
          '<div class="micro-label"><span>图片</span></div>' +
          '<div class="seg" role="group" aria-label="按有无图片筛选">' + photoButtons + '</div>' +
        '</div>' +
        '<div class="filter-group">' +
          '<div class="micro-label"><span>数据</span></div>' +
          '<div style="font-size:11px;color:var(--ink-3);line-height:1.65">' +
            statLine + '<br>' +
            '抓取来源：中文维基百科 / OpenStreetMap' +
            (state.mock ? '<br><span style="color:var(--amber-deep);font-weight:600">Mock 模式（?mock=1，非真实数据）</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="filter-foot">' +
        '<code>admin/data/blindwalk.db</code><br>' +
        '上次刷新 ' + UI.formatTime(Date.now()) +
      '</div>';

    const refreshButton = $('[data-action="refresh"]', els.filters);
    if (refreshButton) refreshButton.addEventListener('click', function () { refreshAll(true); });

    $$('[data-filter-status]', els.filters).forEach(function (button) {
      button.addEventListener('click', function () {
        applyFilter({ status: button.getAttribute('data-filter-status') });
      });
    });

    const categorySelect = $('#filter-category', els.filters);
    if (categorySelect) {
      categorySelect.addEventListener('change', function () {
        applyFilter({ category: categorySelect.value });
      });
    }

    const search = $('#filter-q', els.filters);
    if (search) {
      const onSearch = UI.debounce(function () {
        applyFilter({ q: search.value.trim() }, true);
      }, 300);
      search.addEventListener('input', onSearch);
    }

    $$('[data-photo]', els.filters).forEach(function (button) {
      button.addEventListener('click', function () {
        applyFilter({ photo: button.getAttribute('data-photo') });
      });
    });
  }

  function applyFilter(patch, fromSearch) {
    guardDirty().then(function (ok) {
      if (!ok) {
        renderFilters();
        return;
      }
      Object.keys(patch).forEach(function (key) { state.filters[key] = patch[key]; });
      state.selection.clear();
      state.list.items = [];
      state.list.total = 0;
      renderFilters();
      fetchList();
      if (!fromSearch) {
        const search = $('#filter-q', els.filters);
        if (search && search.value !== state.filters.q) search.value = state.filters.q;
      }
    });
  }

  // ============================================================
  // 中栏 · 列表
  // ============================================================

  function visibleItems() {
    const items = state.list.items;
    if (state.filters.photo === 'with') return items.filter(function (poi) { return !!poi.photoUrl; });
    if (state.filters.photo === 'without') return items.filter(function (poi) { return !poi.photoUrl; });
    return items;
  }

  function renderList() {
    const list = state.list;
    const items = visibleItems();
    const selectedCount = state.selection.size;

    let rowsHtml = '';
    if (list.loading) {
      for (let i = 0; i < 6; i += 1) {
        rowsHtml += '<div class="skeleton-row">' +
          '<span class="skeleton" style="width:15px;height:15px"></span>' +
          '<span class="skeleton skeleton--thumb"></span>' +
          '<span><span class="skeleton skeleton--line" style="display:block;width:72%"></span>' +
          '<span class="skeleton skeleton--line skeleton--short" style="display:block"></span></span>' +
        '</div>';
      }
    } else if (list.error) {
      rowsHtml = '<div class="empty">' + UI.artEmptyList() +
        '<div class="empty__title">列表读取失败</div>' +
        '<div class="empty__sub">' + UI.escapeHtml(list.error) + '</div>' +
        '<button type="button" class="btn" data-action="reload">重新加载</button></div>';
    } else if (items.length === 0) {
      const filtered = state.list.items.length > 0;
      rowsHtml = '<div class="empty">' + UI.artEmptyList() +
        '<div class="empty__title">' + (filtered ? '没有符合筛选条件的兴趣点' : '还没有兴趣点') + '</div>' +
        '<div class="empty__sub">' + (filtered
          ? '换个状态或类别试试；清空关键词也能看到全部。'
          : '点右上角『抓取附近』从公开数据生成一批草稿。') + '</div>' +
        (filtered
          ? '<button type="button" class="btn" data-action="reset-filters">清空筛选</button>'
          : '<button type="button" class="btn btn--primary" data-action="ingest">' + UI.icon('capture') + '抓取附近</button>') +
        '</div>';
    } else {
      items.forEach(function (poi) {
        const category = UI.categoryMeta(poi.category);
        const emoji = poi.emoji || category.emoji;
        const thumb = poi.photoUrl
          ? '<span class="thumb"><img src="' + UI.escapeHtml(poi.photoUrl) + '" alt="" loading="lazy" ' +
            'onerror="this.parentNode.innerHTML=\'' + UI.escapeHtml(emoji) + '\'"></span>'
          : '<span class="thumb" aria-hidden="true">' + UI.escapeHtml(emoji) + '</span>';
        const checked = state.selection.has(poi.id);
        const current = state.current && state.current.id === poi.id;
        const tags = (poi.tags || []).slice(0, 2).map(function (tag) {
          return '<span class="tag">' + UI.escapeHtml(tag) + '</span>';
        }).join('');
        rowsHtml +=
          '<div class="poi-row' + (current ? ' is-current' : '') + (checked ? ' is-checked' : '') + '" ' +
            'data-poi-id="' + UI.escapeHtml(poi.id) + '" role="button" tabindex="0" ' +
            'aria-label="' + UI.escapeHtml(poi.name) + '，' + UI.STATUS_META[poi.status].label + '">' +
            '<input type="checkbox" class="checkbox row-checkbox" data-row-check="' + UI.escapeHtml(poi.id) + '" ' +
              (checked ? 'checked ' : '') + 'aria-label="选择 ' + UI.escapeHtml(poi.name) + '">' +
            thumb +
            '<div class="poi-row__main">' +
              '<div class="poi-row__name">' + UI.escapeHtml(poi.name) + '</div>' +
              '<div class="poi-row__meta">' +
                '<span>' + UI.escapeHtml(category.label) + '</span>' +
                '<span class="dot-sep" aria-hidden="true"></span>' +
                '<span>' + UI.escapeHtml(UI.AREA_META[poi.area] ? UI.AREA_META[poi.area].label : poi.area) + '</span>' +
                '<span class="dot-sep" aria-hidden="true"></span>' +
                UI.rarityBadge(poi.rarity) +
                tags +
              '</div>' +
            '</div>' +
            '<div class="poi-row__side">' +
              UI.statusBadge(poi.status) +
              '<span class="poi-row__time">' + UI.timeAgo(poi.updatedAt) + '</span>' +
            '</div>' +
          '</div>';
      });
    }

    const loaded = state.list.items.length;
    const total = state.list.total;
    const photoFiltered = items.length !== loaded;

    els.listpane.innerHTML =
      '<div class="pane__head">' +
        '<span class="pane__title">兴趣点</span>' +
        '<span class="pane__count">' + (state.list.loading ? '读取中…' : (total + ' 条')) + '</span>' +
        '<span class="list-head__spacer"></span>' +
        '<button type="button" class="btn btn--icon btn--ghost" data-action="reload" aria-label="刷新列表">' + UI.icon('refresh', 15) + '</button>' +
      '</div>' +
      '<div class="selection-bar">' +
        '<label class="checkbox-wrap" style="display:inline-flex;align-items:center;gap:6px">' +
          '<input type="checkbox" class="checkbox" id="select-all" ' + (items.length > 0 && selectedCount === items.length ? 'checked ' : '') +
            (items.length === 0 ? 'disabled ' : '') + 'aria-label="全选当前列表">' +
          '<span style="font-size:11px;color:var(--ink-3)">全选</span>' +
        '</label>' +
        (selectedCount > 0
          ? '<span class="selection-bar__label">已选 <b>' + selectedCount + '</b> 条</span>' +
            '<span class="selection-bar__spacer"></span>' +
            '<button type="button" class="btn btn--sm" data-action="batch-approved" aria-label="批量通过">' + UI.icon('check', 13) + '通过</button>' +
            '<button type="button" class="btn btn--sm" data-action="batch-rejected" aria-label="批量拒绝">拒绝</button>' +
            '<button type="button" class="btn btn--sm btn--danger" data-action="batch-delete" aria-label="批量删除">' + UI.icon('trash', 13) + '删除</button>' +
            '<button type="button" class="btn btn--sm btn--ghost" data-action="clear-selection" aria-label="取消选择">取消</button>'
          : '<span class="selection-bar__spacer"></span>' +
            '<span style="font-size:11px;color:var(--ink-3)">勾选可批量通过 / 拒绝 / 删除</span>') +
      '</div>' +
      '<div class="pane__scroll">' + rowsHtml + '</div>' +
      (items.length > 0 && loaded < total
        ? '<div class="load-more"><button type="button" class="btn btn--sm" data-action="load-more" ' +
          (state.list.loadingMore ? 'disabled' : '') + '>' +
          (state.list.loadingMore ? '<span class="spinner"></span>加载中…' : '加载更多（已显示 ' + loaded + ' / ' + total + '）') +
          '</button></div>'
        : '') +
      '<div class="list-foot">' +
        '<span>' + (photoFiltered ? '图片筛选后 ' + items.length + ' 条 · ' : '') +
          '已加载 ' + loaded + ' / 共 ' + total + ' 条</span>' +
        '<span>' + (state.filters.status === 'all' ? '全部状态' : UI.STATUS_META[state.filters.status].label) +
          ' · ' + UI.formatTime(Date.now()) + '</span>' +
      '</div>';

    bindListEvents();
  }

  function bindListEvents() {
    $$('.poi-row', els.listpane).forEach(function (row) {
      const id = row.getAttribute('data-poi-id');
      row.addEventListener('click', function (event) {
        if (event.target && event.target.getAttribute && event.target.getAttribute('data-row-check')) return;
        selectPoi(id);
      });
      row.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectPoi(id);
        }
      });
    });

    $$('[data-row-check]', els.listpane).forEach(function (box) {
      box.addEventListener('click', function (event) { event.stopPropagation(); });
      box.addEventListener('change', function () {
        const id = box.getAttribute('data-row-check');
        if (box.checked) state.selection.add(id);
        else state.selection.delete(id);
        renderList();
      });
    });

    const selectAll = $('#select-all', els.listpane);
    if (selectAll) {
      selectAll.addEventListener('change', function () {
        const items = visibleItems();
        if (selectAll.checked) items.forEach(function (poi) { state.selection.add(poi.id); });
        else items.forEach(function (poi) { state.selection.delete(poi.id); });
        renderList();
      });
    }

    $$('[data-action]', els.listpane).forEach(function (button) {
      const action = button.getAttribute('data-action');
      button.addEventListener('click', function (event) {
        event.stopPropagation();
        if (action === 'reload') refreshAll(true);
        else if (action === 'ingest') openIngestModal();
        else if (action === 'reset-filters') {
          state.filters = { status: 'all', category: '', q: '', photo: 'all' };
          renderFilters();
          fetchList();
        } else if (action === 'clear-selection') {
          state.selection.clear();
          renderList();
        } else if (action === 'batch-approved') batchSetStatus('approved', button);
        else if (action === 'batch-rejected') batchSetStatus('rejected', button);
        else if (action === 'batch-delete') batchDelete(button);
        else if (action === 'load-more') loadMore(button);
      });
    });
  }

  // ============================================================
  // 右栏 · 编辑
  // ============================================================

  function hintLeak(text, name) {
    if (!text || !name) return false;
    const value = String(text).replace(/\s+/g, '');
    const place = String(name).replace(/\s+/g, '');
    if (place.length === 0) return false;
    if (place.length < 2) return value.indexOf(place) >= 0;
    if (value.indexOf(place) >= 0) return true;
    return value.indexOf(place.slice(0, 2)) >= 0;
  }

  function hintLeaks(draft) {
    return [0, 1, 2].map(function (index) {
      return hintLeak(draft.hints[index], draft.name);
    });
  }

  function validateDraft(draft) {
    const errors = { name: '', coords: '', summary: '', photo: '', hints: [false, false, false] };
    if (!draft.name || !draft.name.trim()) errors.name = '名称不能为空';
    if (!isFinite(num(draft.lat, NaN)) || !isFinite(num(draft.lon, NaN))) errors.coords = '经纬度必须是数字';
    if ((draft.summary || '').length > 120) errors.summary = '简介不能超过 120 字';
    if (draft.photoUrl && !draft.photoCredit) errors.photo = '有图片 URL 时必须填署名';
    errors.hints = hintLeaks(draft);
    const leak = errors.hints[0] || errors.hints[1] || errors.hints[2];
    const ok = !errors.name && !errors.coords && !errors.summary && !errors.photo && !leak;
    return { ok: ok, errors: errors, leak: leak };
  }

  function crowdedLabel(crowded) {
    if (crowded === 'low') return '低';
    if (crowded === 'high') return '高';
    return '中';
  }

  function choicesHtml(field, options, value, className) {
    return '<div class="choice-row" role="group">' + options.map(function (option) {
      const active = option.id === value;
      return '<button type="button" class="choice' + (active ? ' is-active' : '') + (className ? ' ' + className : '') + '" ' +
        'data-choice-field="' + field + '" data-choice-value="' + option.id + '" ' +
        'aria-pressed="' + active + '">' +
        (option.dot ? '<span class="choice__dot" style="background:' + option.dot + '" aria-hidden="true"></span>' : '') +
        UI.escapeHtml(option.label) + '</button>';
    }).join('') + '</div>';
  }

  function renderEditorEmpty() {
    const stats = state.stats;
    const total = stats ? stats.total : 0;
    const approved = stats && stats.byStatus ? (stats.byStatus.approved || 0) : 0;
    const withPhoto = stats ? stats.withPhoto || 0 : 0;
    els.editorpane.innerHTML =
      '<div class="editor-head">' +
        '<span class="pane__title">编辑</span>' +
        '<span class="editor-head__spacer"></span>' +
        '<span class="editor-head__id">未选中</span>' +
      '</div>' +
      '<div class="editor-empty">' + UI.artEmptyEditor() +
        '<div class="editor-empty__title">从中间选一条兴趣点开始编辑</div>' +
        '<div class="editor-empty__sub">也可以点右上角「抓取附近」，从公开数据生成一批草稿。</div>' +
        '<div class="editor-empty__stats">' +
          '<div class="mini-stat"><b>' + total + '</b><span>兴趣点</span></div>' +
          '<div class="mini-stat"><b>' + approved + '</b><span>已通过</span></div>' +
          '<div class="mini-stat"><b>' + withPhoto + '</b><span>有图</span></div>' +
        '</div>' +
      '</div>';
    setEditorOpen(false);
  }

  function renderEditor() {
    if (!state.current || !state.draft) {
      renderEditorEmpty();
      return;
    }
    const poi = state.current;
    const draft = state.draft;
    const category = UI.categoryMeta(draft.category);
    const leaks = hintLeaks(draft);
    const leak = leaks[0] || leaks[1] || leaks[2];

    const rarityOptions = UI.RARITY_ORDER.map(function (id) {
      return { id: id, label: UI.RARITY_META[id].label };
    });
    const areaOptions = UI.AREA_ORDER.map(function (id) {
      return { id: id, label: UI.AREA_META[id].label };
    });
    const statusOptions = UI.STATUS_ORDER.map(function (id) {
      return { id: id, label: UI.STATUS_META[id].label };
    });

    const photoPreview = draft.photoUrl
      ? '<img src="' + UI.escapeHtml(draft.photoUrl) + '" alt="图片预览" ' +
        'onerror="this.parentNode.innerHTML=\'加载失败\'">'
      : UI.icon('image', 24);

    const safety = draft.safety || { score: 3, walkable: true, crowded: 'medium', notes: '' };
    const scoreDots = [1, 2, 3, 4, 5].map(function (index) {
      return '<span class="score-dot' + (index <= (safety.score || 0) ? ' is-on' : '') + '"></span>';
    }).join('');
    const llm = poi.llm || { normalizedAt: 0, analyzedAt: 0, model: '', mode: 'offline' };

    const hintItems = [0, 1, 2].map(function (index) {
      return '<div class="hint-item' + (leaks[index] ? ' is-leaking' : '') + '" data-hint-item="' + index + '">' +
        '<div class="hint-item__head">' +
          '<span>线索 ' + (index + 1) + '</span>' +
          '<span class="hint-item__warn" role="alert">' + UI.icon('alert', 11) + '含地名</span>' +
        '</div>' +
        '<textarea class="input input--hint' + (leaks[index] ? ' is-invalid' : '') + '" data-field="hint" data-index="' + index + '" ' +
          'placeholder="第 ' + (index + 1) + ' 条线索（不含地名）" aria-label="第 ' + (index + 1) + ' 条线索">' +
          UI.escapeHtml(draft.hints[index] || '') + '</textarea>' +
      '</div>';
    }).join('');

    els.editorpane.innerHTML =
      '<div class="editor-head">' +
        UI.statusBadge(draft.status) +
        '<span class="editor-head__title">' + UI.escapeHtml(draft.name || '未命名地点') + '</span>' +
        '<span class="editor-head__spacer"></span>' +
        '<span class="dirty-dot" data-dirty-flag style="display:none">未保存</span>' +
        '<span class="editor-head__id">' + UI.escapeHtml(poi.id) + '</span>' +
        '<button type="button" class="btn btn--icon btn--ghost" data-action="close-editor" aria-label="关闭编辑面板">' + UI.icon('close', 15) + '</button>' +
      '</div>' +
      '<div class="editor-body" role="form" aria-label="兴趣点编辑表单">' +

        '<div class="editor-section">' +
          '<div class="editor-section__title">基本信息<span class="line"></span></div>' +
          '<div class="field">' +
            '<label class="field__label" for="f-name">名称<span class="req">*</span></label>' +
            '<input class="input input--lg" id="f-name" data-field="name" type="text" ' +
              'value="' + UI.escapeHtml(draft.name) + '" placeholder="展示名（去掉了括号消歧义）">' +
          '</div>' +
          '<div class="field-row" style="grid-template-columns:1fr 52px;margin-top:9px">' +
            '<div class="field">' +
              '<label class="field__label" for="f-category">类别</label>' +
              '<select class="select" id="f-category" data-field="category">' +
                UI.CATEGORIES.map(function (categoryItem) {
                  return '<option value="' + categoryItem.id + '"' +
                    (draft.category === categoryItem.id ? ' selected' : '') + '>' +
                    categoryItem.emoji + ' ' + UI.escapeHtml(categoryItem.label) + '</option>';
                }).join('') +
              '</select>' +
            '</div>' +
            '<div class="field">' +
              '<label class="field__label" for="f-emoji">emoji</label>' +
              '<input class="input input--emoji" id="f-emoji" data-field="emoji" type="text" ' +
                'value="' + UI.escapeHtml(draft.emoji || category.emoji) + '" maxlength="6" aria-label="emoji">' +
            '</div>' +
          '</div>' +
          '<div class="field" style="margin-top:9px">' +
            '<span class="field__label">稀有度</span>' +
            choicesHtml('rarity', rarityOptions, draft.rarity) +
          '</div>' +
          '<div class="field" style="margin-top:9px">' +
            '<span class="field__label">区域</span>' +
            choicesHtml('area', areaOptions, draft.area) +
          '</div>' +
        '</div>' +

        '<div class="editor-section">' +
          '<div class="editor-section__title">坐标与地址<span class="line"></span></div>' +
          '<div class="field-row">' +
            '<div class="field">' +
              '<label class="field__label" for="f-lat">纬度<span class="req">*</span></label>' +
              '<input class="input input--mono" id="f-lat" data-field="lat" data-type="number" inputmode="decimal" ' +
                'value="' + UI.escapeHtml(num(draft.lat, '')) + '" placeholder="31.2304">' +
            '</div>' +
            '<div class="field">' +
              '<label class="field__label" for="f-lon">经度<span class="req">*</span></label>' +
              '<input class="input input--mono" id="f-lon" data-field="lon" data-type="number" inputmode="decimal" ' +
                'value="' + UI.escapeHtml(num(draft.lon, '')) + '" placeholder="121.4737">' +
            '</div>' +
          '</div>' +
          '<div class="field" style="margin-top:9px">' +
            '<label class="field__label" for="f-address">地址<span class="field__hint">可为空</span></label>' +
            '<input class="input" id="f-address" data-field="address" type="text" ' +
              'value="' + UI.escapeHtml(draft.address || '') + '" placeholder="黄浦区 · 延安东路">' +
          '</div>' +
        '</div>' +

        '<div class="editor-section">' +
          '<div class="editor-section__title">图片<span class="line"></span></div>' +
          '<div class="photo-box">' +
            '<div class="photo-preview" data-photo-preview>' + photoPreview + '</div>' +
            '<div style="min-width:0">' +
              '<div class="field">' +
                '<label class="field__label" for="f-photo">图片 URL</label>' +
                '<input class="input input--mono" id="f-photo" data-field="photoUrl" type="url" ' +
                  'value="' + UI.escapeHtml(draft.photoUrl || '') + '" placeholder="https://…（必须能直接加载）">' +
              '</div>' +
              '<div class="field">' +
                '<label class="field__label" for="f-credit">图片署名' +
                  (draft.photoUrl ? '<span class="req">*</span>' : '<span class="field__hint">有图时必填</span>') + '</label>' +
                '<input class="input" id="f-credit" data-field="photoCredit" type="text" ' +
                  'value="' + UI.escapeHtml(draft.photoCredit || '') + '" placeholder="Wikimedia Commons">' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="editor-section">' +
          '<div class="editor-section__title">文案<span class="line"></span></div>' +
          '<div class="field">' +
            '<label class="field__label" for="f-summary">简介' +
              '<span class="field__counter" data-summary-counter>' + (draft.summary || '').length + '/120</span></label>' +
            '<textarea class="input" id="f-summary" data-field="summary" maxlength="120" ' +
              'placeholder="一句话介绍 · 不超过 120 字">' + UI.escapeHtml(draft.summary || '') + '</textarea>' +
          '</div>' +
          '<div class="field">' +
            '<label class="field__label" for="f-why">为什么是这里<span class="field__hint">揭晓卡文案</span></label>' +
            '<textarea class="input input--tall" id="f-why" data-field="why" ' +
              'placeholder="你选了「放空」…">' + UI.escapeHtml(draft.why || '') + '</textarea>' +
          '</div>' +
          '<div class="field">' +
            '<label class="field__label" for="f-task">小任务<span class="field__hint">1 分钟能做完</span></label>' +
            '<input class="input" id="f-task" data-field="task" type="text" ' +
              'value="' + UI.escapeHtml(draft.task || '') + '" placeholder="找一张演出海报，记住第一个字。">' +
          '</div>' +
        '</div>' +

        '<div class="editor-section">' +
          '<div class="editor-section__title">线索（保密）<span class="line"></span></div>' +
          '<div class="hint-list">' + hintItems + '</div>' +
          '<div class="hint-note">' + UI.icon('lock', 12) +
            '<span>三条线索在 App 里按距离逐条解锁，<b>不能出现目的地名称</b>（含名称前 2 字）。</span></div>' +
          '<div class="secret-banner' + (leak ? ' is-visible' : '') + '" data-secret-banner role="alert">' +
            UI.icon('alert', 13) + '<span>线索里出现了地名，先改掉才能保存。</span></div>' +
        '</div>' +

        '<div class="editor-section">' +
          '<div class="editor-section__title">标签与安全<span class="line"></span></div>' +
          '<div class="field">' +
            '<label class="field__label" for="f-tags">标签<span class="field__hint">逗号分隔</span></label>' +
            '<input class="input" id="f-tags" data-field="tags" type="text" ' +
              'value="' + UI.escapeHtml((draft.tags || []).join(', ')) + '" placeholder="历史建筑, 音乐">' +
          '</div>' +
          '<div class="field" style="margin-top:9px">' +
            '<span class="field__label">安全分析<span class="field__hint">大模型 / 规则产出，只读</span></span>' +
            '<div class="safety-card">' +
              '<div class="safety-row"><span class="safety-row__label">安全分</span>' +
                '<span class="safety-row__value"><span class="score-dots" aria-label="安全分 ' + (safety.score || 0) + ' / 5">' + scoreDots + '</span></span></div>' +
              '<div class="safety-row"><span class="safety-row__label">可步行</span>' +
                '<span class="safety-row__value">' + (safety.walkable ? '适合步行' : '不太适合') + '</span></div>' +
              '<div class="safety-row"><span class="safety-row__label">人流</span>' +
                '<span class="safety-row__value">' + crowdedLabel(safety.crowded) + '</span></div>' +
              '<div class="safety-row"><span class="safety-row__label">备注</span>' +
                '<span class="safety-row__value">' + UI.escapeHtml(safety.notes || '—') + '</span></div>' +
            '</div>' +
            '<div class="llm-meta">' +
              '<span>整理 ' + (llm.normalizedAt ? UI.timeAgo(llm.normalizedAt) : '未做') + '</span>' +
              '<span>分析 ' + (llm.analyzedAt ? UI.timeAgo(llm.analyzedAt) : '未做') + '</span>' +
              '<span>模型 ' + UI.escapeHtml(llm.model || '—') + '</span>' +
              (llm.mode === 'llm'
                ? '<span class="llm-chip is-llm">模型输出</span>'
                : '<span class="llm-chip is-offline">离线规则</span>') +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="editor-section">' +
          '<div class="editor-section__title">状态<span class="line"></span></div>' +
          choicesHtml('status', statusOptions, draft.status) +
        '</div>' +

      '</div>' +
      '<div class="editor-foot">' +
        '<span class="editor-foot__hint"><kbd>⌘</kbd><kbd>S</kbd> 保存 · 改动只在点保存后生效</span>' +
        '<button type="button" class="btn btn--sm btn--danger" data-action="delete" aria-label="删除这条兴趣点">' +
          UI.icon('trash', 13) + '删除</button>' +
        '<button type="button" class="btn btn--sm" data-action="reset" aria-label="放弃修改">重置</button>' +
        '<button type="button" class="btn btn--primary btn--sm" data-action="save" aria-label="保存修改">保存</button>' +
      '</div>';

    bindEditorEvents();
    updateSummaryCounter();
    refreshValidationUI();
  }

  // ============================================================
  // 编辑事件
  // ============================================================

  function bindEditorEvents() {
    const body = $('.editor-body', els.editorpane);
    if (body) {
      body.addEventListener('input', onEditorInput);
      body.addEventListener('change', onEditorChange);
    }

    const saveButton = $('[data-action="save"]', els.editorpane);
    if (saveButton) saveButton.addEventListener('click', function () { saveCurrent(saveButton); });

    const resetButton = $('[data-action="reset"]', els.editorpane);
    if (resetButton) {
      resetButton.addEventListener('click', function () {
        if (!state.current) return;
        state.draft = deepCopy(state.current);
        state.dirty = false;
        renderEditor();
        UI.toast('已放弃修改', 'info', 2200);
      });
    }

    const deleteButton = $('[data-action="delete"]', els.editorpane);
    if (deleteButton) deleteButton.addEventListener('click', function () { deleteCurrent(deleteButton); });

    const closeButton = $('[data-action="close-editor"]', els.editorpane);
    if (closeButton) {
      closeButton.addEventListener('click', function () {
        closeEditor();
      });
    }

    $$('[data-choice-field]', els.editorpane).forEach(function (button) {
      button.addEventListener('click', function () {
        const field = button.getAttribute('data-choice-field');
        const value = button.getAttribute('data-choice-value');
        if (!state.draft) return;
        state.draft[field] = value;
        $$('[data-choice-field="' + field + '"]', els.editorpane).forEach(function (item) {
          const active = item === button;
          item.classList.toggle('is-active', active);
          item.setAttribute('aria-pressed', String(active));
        });
        markDirty();
        refreshValidationUI();
      });
    });
  }

  function onEditorInput(event) {
    const target = event.target;
    if (!target || !target.getAttribute) return;
    const field = target.getAttribute('data-field');
    if (!field || !state.draft) return;

    if (field === 'hint') {
      const index = parseInt(target.getAttribute('data-index'), 10);
      state.draft.hints[index] = target.value;
    } else if (field === 'tags') {
      state.draft.tags = target.value.split(/[,，]/).map(function (item) { return item.trim(); }).filter(Boolean);
    } else if (field === 'lat' || field === 'lon') {
      state.draft[field] = target.value;
    } else {
      state.draft[field] = target.value;
    }

    if (field === 'summary') updateSummaryCounter();
    if (field === 'photoUrl') updatePhotoPreview();
    if (field === 'name' || field === 'hint') refreshValidationUI();
    markDirty();
  }

  function onEditorChange(event) {
    const target = event.target;
    if (!target || !target.getAttribute) return;
    if (target.getAttribute('data-field') === 'category') {
      if (!state.draft) return;
      state.draft.category = target.value;
      const category = UI.categoryMeta(target.value);
      const emojiInput = $('#f-emoji', els.editorpane);
      if (emojiInput && (!state.draft.emoji || state.draft.emoji === category.emoji)) {
        state.draft.emoji = category.emoji;
        emojiInput.value = category.emoji;
      }
      if (!state.draft.rarity) state.draft.rarity = category.rarity;
      markDirty();
    }
  }

  function updateSummaryCounter() {
    const counter = $('[data-summary-counter]', els.editorpane);
    if (!counter || !state.draft) return;
    const length = (state.draft.summary || '').length;
    counter.textContent = length + '/120';
    counter.classList.toggle('is-over', length > 120);
  }

  function updatePhotoPreview() {
    const preview = $('[data-photo-preview]', els.editorpane);
    if (!preview || !state.draft) return;
    if (state.draft.photoUrl) {
      preview.innerHTML = '<img src="' + UI.escapeHtml(state.draft.photoUrl) + '" alt="图片预览" ' +
        'onerror="this.parentNode.innerHTML=\'加载失败\'">';
    } else {
      preview.innerHTML = UI.icon('image', 24);
    }
  }

  function markDirty() {
    state.dirty = true;
    const flag = $('[data-dirty-flag]', els.editorpane);
    if (flag) flag.style.display = 'inline-flex';
    const save = $('[data-action="save"]', els.editorpane);
    if (save) save.setAttribute('data-dirty', 'true');
  }

  function refreshValidationUI() {
    if (!state.draft) return;
    const result = validateDraft(state.draft);
    const save = $('[data-action="save"]', els.editorpane);

    [0, 1, 2].forEach(function (index) {
      const item = $('[data-hint-item="' + index + '"]', els.editorpane);
      if (!item) return;
      const input = $('textarea[data-index="' + index + '"]', item);
      item.classList.toggle('is-leaking', result.errors.hints[index]);
      if (input) input.classList.toggle('is-invalid', result.errors.hints[index]);
    });

    const banner = $('[data-secret-banner]', els.editorpane);
    if (banner) banner.classList.toggle('is-visible', result.leak);

    const nameInput = $('#f-name', els.editorpane);
    if (nameInput) nameInput.classList.toggle('is-invalid', !!result.errors.name);
    const latInput = $('#f-lat', els.editorpane);
    if (latInput) latInput.classList.toggle('is-invalid', !!result.errors.coords);
    const photoCredit = $('#f-credit', els.editorpane);
    if (photoCredit) photoCredit.classList.toggle('is-invalid', !!result.errors.photo);

    if (save) {
      save.disabled = !result.ok;
      if (!result.ok) {
        let reason = '还有字段没填好';
        if (result.leak) reason = '线索里出现了地名，先改掉';
        else if (result.errors.name) reason = result.errors.name;
        else if (result.errors.coords) reason = result.errors.coords;
        else if (result.errors.photo) reason = result.errors.photo;
        else if (result.errors.summary) reason = result.errors.summary;
        save.title = reason;
      } else {
        save.removeAttribute('title');
      }
    }
    return result;
  }

  // ============================================================
  // 列表 / 编辑数据流
  // ============================================================

  async function refreshAll(showToast) {
    const button = $('[data-action="refresh"]', els.filters);
    if (button) UI.setBusy(button, true, '');
    try {
      await Promise.all([fetchLlm(), fetchStats(), fetchList()]);
      if (showToast) UI.toast('已刷新', 'success', 1800);
    } finally {
      if (button) UI.setBusy(button, false);
    }
  }

  async function fetchLlm() {
    try {
      const llm = await API.llmStatus();
      state.llm = {
        mode: llm && llm.mode ? llm.mode : 'offline',
        ready: !!(llm && llm.ready),
        model: llm && llm.model ? llm.model : '',
        baseUrl: llm && llm.baseUrl ? llm.baseUrl : '',
        error: ''
      };
    } catch (error) {
      state.llm = { mode: 'offline', ready: false, model: '', baseUrl: '', error: errorText(error) };
    }
    renderLlmBadge();
    renderTopActions();
    bindTopActions();
  }

  async function fetchStats() {
    try {
      state.stats = await API.stats();
    } catch (error) {
      state.stats = null;
      state.statsError = errorText(error);
    }
    renderFilters();
    if (!state.current) renderEditorEmpty();
  }

  async function fetchList(options) {
    const opts = options || {};
    if (!opts.append) {
      state.list.loading = true;
      state.list.error = '';
    } else {
      state.list.loadingMore = true;
    }
    renderList();
    try {
      const result = await API.list({
        status: state.filters.status,
        category: state.filters.category,
        q: state.filters.q,
        limit: PAGE_LIMIT,
        offset: opts.append ? state.list.items.length : 0
      });
      if (opts.append) {
        state.list.items = state.list.items.concat(result.items || []);
      } else {
        state.list.items = result.items || [];
        state.selection.clear();
      }
      state.list.total = result.total || 0;
      state.list.loading = false;
      state.list.loadingMore = false;
      state.list.error = '';
    } catch (error) {
      state.list.loading = false;
      state.list.loadingMore = false;
      state.list.error = errorText(error);
      UI.toast((opts.append ? '加载更多失败：' : '列表读取失败：') + errorText(error), 'error', 4600);
    }
    renderList();
  }

  async function loadMore(button) {
    if (state.list.loadingMore) return;
    await withBusy(button, '加载中…', function () {
      return fetchList({ append: true });
    });
  }

  function guardDirty() {
    if (!state.dirty) return Promise.resolve(true);
    return UI.confirmDialog({
      title: '有未保存的修改',
      subtitle: '换一个兴趣点或切换筛选会丢掉刚才的编辑。',
      message: '要放弃这些修改吗？',
      confirmText: '放弃修改',
      cancelText: '继续编辑',
      danger: true
    });
  }

  async function selectPoi(id) {
    if (state.current && state.current.id === id) {
      if (isSmallScreen()) setEditorOpen(true);
      return;
    }
    const ok = await guardDirty();
    if (!ok) {
      renderList();
      return;
    }
    let poi;
    try {
      poi = await API.poi(id);
    } catch (error) {
      toastError('读取兴趣点失败', error);
      return;
    }
    state.current = poi;
    state.draft = deepCopy(poi);
    state.dirty = false;
    state.selection.delete(id);
    renderList();
    renderEditor();
    setEditorOpen(true);
    if (state.current && state.current.id) {
      // 选中后重新拉一次列表，保证勾选状态一致
    }
  }

  function closeEditor() {
    if (isSmallScreen()) {
      setEditorOpen(false);
      return;
    }
    guardDirty().then(function (ok) {
      if (!ok) return;
      state.current = null;
      state.draft = null;
      state.dirty = false;
      renderEditor();
    });
  }

  function buildPayload() {
    const draft = state.draft;
    return {
      name: (draft.name || '').trim(),
      lat: num(draft.lat, 0),
      lon: num(draft.lon, 0),
      category: draft.category,
      emoji: draft.emoji || UI.categoryMeta(draft.category).emoji,
      rarity: draft.rarity,
      area: draft.area,
      address: draft.address && draft.address.trim() ? draft.address.trim() : null,
      photoUrl: draft.photoUrl && draft.photoUrl.trim() ? draft.photoUrl.trim() : null,
      photoCredit: draft.photoCredit && draft.photoCredit.trim() ? draft.photoCredit.trim() : null,
      summary: draft.summary || '',
      why: draft.why || '',
      task: draft.task || '',
      hints: [draft.hints[0] || '', draft.hints[1] || '', draft.hints[2] || ''],
      tags: draft.tags || [],
      status: draft.status
    };
  }

  async function saveCurrent(button) {
    if (!state.current || !state.draft) return;
    const result = refreshValidationUI();
    if (!result.ok) {
      let message = '还没保存：';
      if (result.leak) message += '线索里出现了地名';
      else if (result.errors.name) message += result.errors.name;
      else if (result.errors.coords) message += result.errors.coords;
      else if (result.errors.photo) message += result.errors.photo;
      else if (result.errors.summary) message += result.errors.summary;
      UI.toast(message, 'error', 4200);
      return;
    }
    await withBusy(button, '保存中…', async function () {
      try {
        const updated = await API.update(state.current.id, buildPayload());
        applyServerPoi(updated);
        fetchStats();
        UI.toast('已保存 · ' + updated.name, 'success', 2400);
      } catch (error) {
        toastError('保存失败', error);
      }
    });
  }

  async function deleteCurrent(button) {
    if (!state.current) return;
    const poi = state.current;
    const ok = await UI.confirmDialog({
      title: '删除兴趣点',
      subtitle: poi.name,
      message: '删除后不可恢复。如果只是暂时不要，可以把状态改为「已拒绝」。',
      confirmText: '删除',
      cancelText: '取消',
      danger: true
    });
    if (!ok) return;
    await withBusy(button, '删除中…', async function () {
      try {
        await API.remove(poi.id);
        state.current = null;
        state.draft = null;
        state.dirty = false;
        renderEditor();
        state.selection.delete(poi.id);
        renderList();
        fetchStats();
        UI.toast('已删除 · ' + poi.name, 'success', 2400);
      } catch (error) {
        toastError('删除失败', error);
      }
    });
  }

  async function batchSetStatus(status, button) {
    const ids = Array.from(state.selection);
    if (ids.length === 0) {
      UI.toast('先勾选要处理的条目', 'info');
      return;
    }
    const label = UI.STATUS_META[status].label;
    const ok = await UI.confirmDialog({
      title: '批量改为「' + label + '」',
      message: '将对选中的 ' + ids.length + ' 条兴趣点逐条更新状态。',
      confirmText: '确认',
      cancelText: '取消'
    });
    if (!ok) return;
    await withBusy(button, '处理中…', async function () {
      let success = 0;
      let failed = 0;
      for (let i = 0; i < ids.length; i += 1) {
        try {
          await API.update(ids[i], { status: status });
          success += 1;
        } catch (error) {
          failed += 1;
        }
      }
      if (state.current && state.selection.has(state.current.id)) {
        const refreshed = await safeFetchPoi(state.current.id);
        if (refreshed) {
          state.current = refreshed;
          state.draft = deepCopy(refreshed);
          renderEditor();
        }
      }
      state.selection.clear();
      await fetchList();
      fetchStats();
      UI.toast(label + ' ' + success + ' 条' + (failed ? '，失败 ' + failed + ' 条' : ''), failed ? 'info' : 'success', 3200);
    });
  }

  async function batchDelete(button) {
    const ids = Array.from(state.selection);
    if (ids.length === 0) {
      UI.toast('先勾选要删除的条目', 'info');
      return;
    }
    const ok = await UI.confirmDialog({
      title: '批量删除',
      message: '将删除选中的 ' + ids.length + ' 条兴趣点，删除后不可恢复。',
      confirmText: '删除 ' + ids.length + ' 条',
      cancelText: '取消',
      danger: true
    });
    if (!ok) return;
    await withBusy(button, '删除中…', async function () {
      let success = 0;
      let failed = 0;
      for (let i = 0; i < ids.length; i += 1) {
        try {
          await API.remove(ids[i]);
          success += 1;
        } catch (error) {
          failed += 1;
        }
      }
      if (state.current && ids.indexOf(state.current.id) >= 0) {
        state.current = null;
        state.draft = null;
        renderEditor();
      }
      state.selection.clear();
      await fetchList();
      fetchStats();
      UI.toast('已删除 ' + success + ' 条' + (failed ? '，失败 ' + failed + ' 条' : ''), failed ? 'info' : 'success', 3200);
    });
  }

  async function safeFetchPoi(id) {
    try {
      return await API.poi(id);
    } catch (error) {
      return null;
    }
  }

  /** 操作成功后以服务端返回的 POI 为准更新列表与编辑面板（不做乐观更新） */
  function applyServerPoi(poi) {
    if (!poi) return;
    for (let i = 0; i < state.list.items.length; i += 1) {
      if (state.list.items[i].id === poi.id) {
        state.list.items[i] = poi;
        break;
      }
    }
    if (state.current && state.current.id === poi.id) {
      state.current = poi;
      state.draft = deepCopy(poi);
      state.dirty = false;
      renderEditor();
    }
    renderList();
  }

  // ============================================================
  // 顶部动作
  // ============================================================

  function bindTopActions() {
    $$('[data-action]', els.topActions).forEach(function (button) {
      button.addEventListener('click', function () {
        const action = button.getAttribute('data-action');
        if (action === 'ingest') openIngestModal();
        else if (action === 'normalize') runNormalize(button);
        else if (action === 'ai-edit') openAiEditModal();
        else if (action === 'ai-analyze') runAnalyze(button);
        else if (action === 'ai-batch') runBatchAnalyze(button);
        else if (action === 'mapkeys') openMapKeysPanel();
        else if (action === 'export') runExport(button);
      });
    });
  }

  // ============================================================
  // 地图 Key（后台统一配置，公开端点自动下发）
  // ============================================================

  const MAPKEY_PROVIDERS = [
    { id: 'amap', label: '高德 Web 服务 Key', help: 'Web 服务 Key（restapi.amap.com，注意不是 JS API Key）' },
    { id: 'baidu', label: '百度地图服务端 AK', help: '服务端 AK（api.map.baidu.com）' }
  ];

  function mapKeyMeta(id) {
    for (let i = 0; i < MAPKEY_PROVIDERS.length; i += 1) {
      if (MAPKEY_PROVIDERS[i].id === id) return MAPKEY_PROVIDERS[i];
    }
    return { id: id, label: id, help: '' };
  }

  function openMapKeysPanel() {
    if (!els.mapkeysPanel) return;
    els.mapkeysPanel.hidden = false;
    loadMapKeys();
  }

  function closeMapKeysPanel() {
    if (!els.mapkeysPanel) return;
    els.mapkeysPanel.hidden = true;
  }

  async function loadMapKeys() {
    state.mapkeys.loading = true;
    state.mapkeys.error = '';
    renderMapKeys();
    try {
      state.mapkeys.data = await API.mapKeys();
    } catch (error) {
      state.mapkeys.error = errorText(error);
    } finally {
      state.mapkeys.loading = false;
      renderMapKeys();
    }
  }

  function showMapKeyResult(providerId, result) {
    const target = document.getElementById('mapkey-result-' + providerId);
    if (!target) return;
    if (!result) {
      target.className = 'mapkeys__result';
      target.textContent = '';
      return;
    }
    if (result.ok) {
      target.className = 'mapkeys__result is-ok';
      target.textContent = '连接成功 · 返回 ' + result.count + ' 条结果';
    } else {
      target.className = 'mapkeys__result is-err';
      target.textContent = '测试失败：' + (result.error || '未知错误');
    }
  }

  function mapKeyRowHtml(provider) {
    const data = state.mapkeys.data;
    const entry = data && data.keys ? data.keys[provider.id] : null;
    const configured = !!(entry && entry.configured);
    const hint = configured ? entry.hint : '';
    const statusHtml = configured
      ? '<span class="mapkeys__status is-on">● 已配置 · <code>' + UI.escapeHtml(hint) + '</code></span>'
      : '<span class="mapkeys__status">○ 未配置</span>';
    const placeholder = configured
      ? '已配置 · ' + hint + '（留空表示不修改）'
      : '输入 ' + provider.label + ' 后保存';
    const testButton =
      '<button type="button" class="btn btn--sm" data-mapkeys-test="' + provider.id + '"' +
        (configured ? '' : ' title="先保存 Key 再测试"') + '>测试连接</button>';
    const clearButton = configured
      ? '<button type="button" class="btn btn--sm btn--danger" data-mapkeys-clear="' + provider.id + '">清除</button>'
      : '';
    return '<div class="mapkeys__row" data-provider="' + provider.id + '">' +
      '<div class="mapkeys__rowhead">' +
        '<div>' +
          '<label class="field__label" for="mapkey-input-' + provider.id + '">' + UI.escapeHtml(provider.label) + '</label>' +
          '<p class="mapkeys__help">' + UI.escapeHtml(provider.help) + '</p>' +
        '</div>' +
        statusHtml +
      '</div>' +
      '<div class="mapkeys__controls">' +
        '<input class="input" id="mapkey-input-' + provider.id + '" type="password" ' +
          'autocomplete="new-password" spellcheck="false" ' +
          'placeholder="' + UI.escapeHtml(placeholder) + '" ' +
          'aria-label="' + UI.escapeHtml(provider.label) + '">' +
        testButton +
        clearButton +
      '</div>' +
      '<p class="mapkeys__result" id="mapkey-result-' + provider.id + '"></p>' +
    '</div>';
  }

  function renderMapKeys() {
    if (!els.mapkeysBody) return;
    const data = state.mapkeys.data;
    const rows = MAPKEY_PROVIDERS.map(mapKeyRowHtml).join('');
    const loading = state.mapkeys.loading ? '<p class="mapkeys__loading">正在读取服务器上的地图 Key…</p>' : '';
    const error = state.mapkeys.error
      ? '<p class="mapkeys__err">读取失败：' + UI.escapeHtml(state.mapkeys.error) + '</p>'
      : '';
    const publicUrl = data && data.publicUrl ? data.publicUrl : '/api/public/mapkeys';
    const versionText = data && data.version ? ' · 版本 ' + UI.escapeHtml(data.version) : '';
    els.mapkeysBody.innerHTML =
      '<div class="mapkeys__note">' + UI.icon('alert', 14) +
        '<span>Key 只存服务器数据库，客户端通过 <code>/api/public/mapkeys</code> 自动获取；' +
        '<strong>注意 Web 服务 Key 在前端必然可见</strong>，请用独立限额 Key 并定期轮换。</span>' +
      '</div>' +
      loading + error +
      '<div class="mapkeys__rows">' + rows + '</div>' +
      '<footer class="mapkeys__foot">' +
        '<span class="mapkeys__public">公开地址 <code>' + UI.escapeHtml(publicUrl) + '</code>' + versionText + '</span>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="btn btn--primary" data-mapkeys-save>保存</button>' +
      '</footer>';
    MAPKEY_PROVIDERS.forEach(function (provider) {
      showMapKeyResult(provider.id, state.mapkeys.testResults[provider.id]);
    });
  }

  async function saveMapKeys(button) {
    const keys = {};
    MAPKEY_PROVIDERS.forEach(function (provider) {
      const input = document.getElementById('mapkey-input-' + provider.id);
      if (!input) return;
      const value = input.value.trim();
      if (value) keys[provider.id] = value;
    });
    if (Object.keys(keys).length === 0) {
      UI.toast('输入新 Key 后再保存（留空表示不修改）', 'info', 3200);
      return;
    }
    await withBusy(button, '保存中…', async function () {
      try {
        state.mapkeys.data = await API.putMapKeys(keys);
        state.mapkeys.testResults = {};
        renderMapKeys();
        UI.toast('地图 Key 已保存', 'success', 2400);
      } catch (error) {
        toastError('保存地图 Key 失败', error);
      }
    });
  }

  async function clearMapKey(providerId, button) {
    const provider = mapKeyMeta(providerId);
    const ok = await UI.confirmDialog({
      title: '清除地图 Key',
      subtitle: provider.label,
      message: '清除后公开端点不再下发这个 Key，客户端对应的地图能力会不可用。',
      confirmText: '清除',
      cancelText: '取消',
      danger: true
    });
    if (!ok) return;
    await withBusy(button, '清除中…', async function () {
      try {
        const body = {};
        body[providerId] = '';
        state.mapkeys.data = await API.putMapKeys(body);
        state.mapkeys.testResults[providerId] = null;
        renderMapKeys();
        UI.toast('已清除 ' + provider.label, 'success', 2400);
      } catch (error) {
        toastError('清除地图 Key 失败', error);
      }
    });
  }

  async function testMapKey(providerId, button) {
    await withBusy(button, '测试中…', async function () {
      try {
        const result = await API.testMapKey(providerId);
        state.mapkeys.testResults[providerId] = result;
        showMapKeyResult(providerId, result);
        if (result.ok) {
          UI.toast('连接成功 · 返回 ' + result.count + ' 条结果', 'success', 3200);
        } else {
          UI.toast('测试失败：' + (result.error || '未知错误'), 'error', 4200);
        }
      } catch (error) {
        toastError('测试地图 Key 失败', error);
      }
    });
  }

  function bindMapKeysPanel() {
    if (!els.mapkeysPanel) return;
    els.mapkeysPanel.addEventListener('click', function (event) {
      if (event.target.closest('[data-mapkeys-close]')) {
        closeMapKeysPanel();
        return;
      }
      const saveButton = event.target.closest('[data-mapkeys-save]');
      if (saveButton) {
        saveMapKeys(saveButton);
        return;
      }
      const testButton = event.target.closest('[data-mapkeys-test]');
      if (testButton) {
        testMapKey(testButton.getAttribute('data-mapkeys-test'), testButton);
        return;
      }
      const clearButton = event.target.closest('[data-mapkeys-clear]');
      if (clearButton) {
        clearMapKey(clearButton.getAttribute('data-mapkeys-clear'), clearButton);
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !els.mapkeysPanel.hidden) closeMapKeysPanel();
    });
  }

  function targetIds() {
    if (state.selection.size > 0) return Array.from(state.selection);
    if (state.current) return [state.current.id];
    return [];
  }

  // ---------- 抓取附近 ----------
  function openIngestModal() {
    const handle = UI.openModal({
      title: '抓取附近',
      subtitle: '从中文维基百科 / OpenStreetMap 拉一批公开数据，落成草稿。',
      bodyHTML:
        '<div class="field-row">' +
          '<div class="field"><label class="field__label" for="ing-lat">纬度</label>' +
            '<input class="input input--mono" id="ing-lat" type="text" inputmode="decimal" value="31.2304" aria-label="抓取中心纬度"></div>' +
          '<div class="field"><label class="field__label" for="ing-lon">经度</label>' +
            '<input class="input input--mono" id="ing-lon" type="text" inputmode="decimal" value="121.4737" aria-label="抓取中心经度"></div>' +
        '</div>' +
        '<div class="field-row" style="margin-top:9px">' +
          '<div class="field"><label class="field__label" for="ing-radius">半径（米）</label>' +
            '<input class="input" id="ing-radius" type="number" min="100" max="5000" value="1200" aria-label="抓取半径"></div>' +
          '<div class="field"><label class="field__label" for="ing-limit">最多抓取</label>' +
            '<input class="input" id="ing-limit" type="number" min="1" max="50" value="20" aria-label="最多抓取条数"></div>' +
        '</div>' +
        '<div class="modal__note">' + UI.icon('info', 13) +
          '<span>去重规则：同名或距离 &lt; 30m 的已存在兴趣点会跳过；新点状态为「草稿」。</span></div>',
      footerHTML:
        '<div class="spacer"></div>' +
        '<button type="button" class="btn" data-act="cancel">取消</button>' +
        '<button type="button" class="btn btn--primary" data-act="ingest">开始抓取</button>'
    });

    handle.foot.querySelector('[data-act="cancel"]').addEventListener('click', function () { handle.close(); });
    const submit = handle.foot.querySelector('[data-act="ingest"]');
    submit.addEventListener('click', function () {
      const lat = num($('#ing-lat', handle.body).value, 31.2304);
      const lon = num($('#ing-lon', handle.body).value, 121.4737);
      const radius = num($('#ing-radius', handle.body).value, 1200);
      const limit = num($('#ing-limit', handle.body).value, 20);
      withBusy(submit, '抓取中…', async function () {
        try {
          const result = await API.ingest({ lat: lat, lon: lon, radius: radius, limit: limit });
          handle.close();
          UI.toast('新增 ' + (result.added || 0) + ' 条，跳过 ' + (result.skipped || 0) + ' 条', 'success', 3600);
          state.filters.status = 'draft';
          renderFilters();
          fetchList();
          fetchStats();
        } catch (error) {
          toastError('抓取失败', error);
        }
      });
    });
  }

  // ---------- AI 整理 ----------
  async function runNormalize(button) {
    const ids = targetIds();
    if (ids.length === 0) {
      UI.toast('先选一条（或勾选多条）再整理', 'info');
      return;
    }
    const offline = state.llm.mode !== 'llm' || !state.llm.ready;
    await withBusy(button, '整理中…', async function () {
      let success = 0;
      let failed = 0;
      let lastPoi = null;
      let responseMode = '';
      for (let i = 0; i < ids.length; i += 1) {
        try {
          const result = await API.normalize(ids[i]);
          success += 1;
          if (result && result.poi) lastPoi = result.poi;
          if (result && result.mode) responseMode = result.mode;
        } catch (error) {
          failed += 1;
        }
      }
      if (lastPoi) applyServerPoi(lastPoi);
      fetchStats();
      const usedOffline = responseMode ? responseMode === 'offline' : offline;
      const modeLabel = usedOffline ? '离线规则' : '模型输出';
      UI.toast('已整理 ' + success + ' 条' + (failed ? '，失败 ' + failed + ' 条' : '') + ' · ' + modeLabel,
        failed ? 'info' : 'success', 3600);
    });
  }

  // ---------- AI 编辑 ----------
  function openAiEditModal() {
    const offline = state.llm.mode !== 'llm' || !state.llm.ready;
    if (offline) {
      UI.toast('AI 编辑不可用：没有配置 BW_LLM_API_KEY，当前为离线规则模式', 'error', 5200);
      return;
    }
    if (!state.current) {
      UI.toast('先在列表里选一条兴趣点', 'info');
      return;
    }
    const handle = UI.openModal({
      title: 'AI 编辑',
      subtitle: '模型：' + (state.llm.model || 'deepseek-chat') + ' · 会改写 why / task / hints',
      bodyHTML:
        '<div class="field">' +
          '<label class="field__label" for="ai-instruction">改写指令</label>' +
          '<textarea class="input input--tall" id="ai-instruction" placeholder="例如：把线索写得更口语一点，别出现地名；why 收短到两行。"></textarea>' +
          '<div class="field__hint" style="margin-top:5px">会覆盖当前条目的 why / task / hints，保存前的改动请先保存。</div>' +
        '</div>',
      footerHTML:
        '<button type="button" class="btn" data-act="cancel">取消</button>' +
        '<div class="spacer"></div>' +
        '<button type="button" class="btn btn--primary" data-act="run">' + UI.icon('sparkles', 13) + '让模型改写</button>'
    });
    handle.foot.querySelector('[data-act="cancel"]').addEventListener('click', function () { handle.close(); });
    const runButton = handle.foot.querySelector('[data-act="run"]');
    runButton.addEventListener('click', function () {
      const instruction = $('#ai-instruction', handle.body).value.trim();
      if (!instruction) {
        UI.toast('写一句改写指令', 'error', 2600);
        $('#ai-instruction', handle.body).focus();
        return;
      }
      withBusy(runButton, '改写中…', async function () {
        try {
          const result = await API.llmEdit(state.current.id, instruction);
          handle.close();
          if (result && result.poi) applyServerPoi(result.poi);
          fetchStats();
          UI.toast('已改写（' + ((result && result.changed) || []).join('、') + '）· 模型输出', 'success', 3800);
        } catch (error) {
          if (error.code === 'LLM_UNAVAILABLE') {
            toastError('模型不可用', error);
          } else {
            toastError('改写失败', error);
          }
        }
      });
    });
  }

  // ---------- AI 分析 ----------
  function safeText(value) {
    return value == null ? '' : String(value);
  }

  function verdictBadge(verdict) {
    const map = { good: '适合', risky: '有风险', reject: '不建议' };
    const cls = verdict === 'good' ? 'good' : (verdict === 'reject' ? 'reject' : 'risky');
    return '<span class="verdict verdict--' + cls + '">' + (map[verdict] || '待定') + '</span>';
  }

  function poiDisplayName(id) {
    if (state.current && state.current.id === id) return state.current.name;
    for (let i = 0; i < state.list.items.length; i += 1) {
      if (state.list.items[i].id === id) return state.list.items[i].name;
    }
    return '';
  }

  function analyzeResultsHTML(items) {
    if (!items || items.length === 0) {
      return '<div class="empty" style="padding:20px"><div class="empty__title">没有可分析的结果</div>' +
        '<div class="empty__sub">检查筛选条件，或先抓取一批草稿。</div></div>';
    }
    return items.map(function (item) {
      const safety = item.safety || {};
      return '<div class="analyze-item">' +
        '<div class="analyze-item__head">' +
          verdictBadge(item.verdict) +
          '<span class="analyze-item__name">' + UI.escapeHtml(safeText(item.name || poiDisplayName(item.id) || item.id)) + '</span>' +
        '</div>' +
        '<div class="analyze-item__suggestion">' + UI.escapeHtml(safeText(item.suggestion)) + '</div>' +
        '<div class="analyze-item__safety">安全分 ' + (safety.score || '—') + ' / 5 · ' +
          (safety.walkable ? '可步行' : '不建议步行') + ' · 人流 ' + crowdedLabel(safety.crowded) + '</div>' +
      '</div>';
    }).join('');
  }

  function runAnalyze(button) {
    const ids = targetIds();
    if (ids.length === 0) {
      UI.toast('先选一条（或勾选多条）再分析', 'info');
      return;
    }
    const offline = state.llm.mode !== 'llm' || !state.llm.ready;
    const handle = UI.openModal({
      title: 'AI 分析',
      subtitle: '评估「适不适合做盲盒目的地」：可达性 / 安全 / 独特性 / 保密性',
      wide: true,
      bodyHTML: '<div class="loading"><span class="spinner"></span>正在分析 ' + ids.length + ' 条…</div>',
      footerHTML: '<div class="spacer"></div><button type="button" class="btn" data-act="close">关闭</button>'
    });
    handle.foot.querySelector('[data-act="close"]').addEventListener('click', function () { handle.close(); });

    withBusy(button, '分析中…', async function () {
      try {
        const result = await API.analyze(ids);
        const items = (result && result.items) || [];
        const usedOffline = result && result.mode ? result.mode === 'offline' : offline;
        handle.body.innerHTML =
          (usedOffline
            ? '<div class="modal__note" style="margin-top:0;margin-bottom:12px">' + UI.icon('info', 13) +
              '<span>离线规则模式：以下是规则打分，不是模型输出。配置 BW_LLM_API_KEY 后可调用真实模型。</span></div>'
            : '') +
          analyzeResultsHTML(items);
        if (state.current) {
          const refreshed = await safeFetchPoi(state.current.id);
          if (refreshed) applyServerPoi(refreshed);
        }
        fetchStats();
        UI.toast('已分析 ' + items.length + ' 条 · ' + (usedOffline ? '离线规则' : '模型输出'), 'success', 3200);
      } catch (error) {
        handle.body.innerHTML = '<div class="modal__note" style="margin-top:0">' + UI.icon('alert', 13) +
          '<span>' + UI.escapeHtml('分析失败：' + errorText(error)) + '</span></div>';
        toastError('分析失败', error);
      }
    });
  }

  async function runBatchAnalyze(button) {
    const status = state.filters.status === 'all' ? 'draft' : state.filters.status;
    const offline = state.llm.mode !== 'llm' || !state.llm.ready;
    await withBusy(button, '批量分析中…', async function () {
      try {
        const result = await API.analyzeAll(status);
        const usedOffline = result && result.mode ? result.mode === 'offline' : offline;
        renderList();
        fetchStats();
        const items = (result && result.items) || [];
        const handle = UI.openModal({
          title: 'AI 批量分析',
          subtitle: '状态：' + UI.STATUS_META[status].label + ' · 共 ' + (result.analyzed || items.length) + ' 条',
          wide: true,
          bodyHTML:
            (usedOffline
              ? '<div class="modal__note" style="margin-top:0;margin-bottom:12px">' + UI.icon('info', 13) +
                '<span>离线规则模式：以下是规则打分，不是模型输出。</span></div>'
              : '') +
            analyzeResultsHTML(items),
          footerHTML: '<div class="spacer"></div><button type="button" class="btn" data-act="close">关闭</button>'
        });
        handle.foot.querySelector('[data-act="close"]').addEventListener('click', function () { handle.close(); });
        const refreshed = state.current ? await safeFetchPoi(state.current.id) : null;
        if (refreshed) applyServerPoi(refreshed);
        UI.toast('已分析 ' + (result.analyzed || 0) + ' 条 · ' + (usedOffline ? '离线规则' : '模型输出'), 'success', 3200);
      } catch (error) {
        toastError('批量分析失败', error);
      }
    });
  }

  // ---------- 导出 ----------
  async function runExport(button) {
    await withBusy(button, '导出中…', async function () {
      try {
        const result = await API.exportPois();
        UI.toast('已导出 ' + (result.count || 0) + ' 条到 ' + (result.path || 'prototype/web/pois.json'), 'success', 4200);
      } catch (error) {
        toastError('导出失败', error);
      }
    });
  }

  // ============================================================
  // 启动
  // ============================================================

  function bindGlobalKeys() {
    document.addEventListener('keydown', function (event) {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && (event.key === 's' || event.key === 'S')) {
        if (document.querySelector('.modal')) return;
        event.preventDefault();
        const saveButton = $('[data-action="save"]', els.editorpane);
        if (state.current && saveButton && !saveButton.disabled) {
          saveCurrent(saveButton);
        } else if (state.current) {
          UI.toast('还有字段没填好，先检查一下', 'error', 2600);
        }
        return;
      }
    });

    window.addEventListener('resize', function () {
      if (!isSmallScreen()) setEditorOpen(!!state.current);
      else setEditorOpen(els.editorpane.classList.contains('is-open'));
    });
  }

  async function applyDevParams() {
    const params = new URLSearchParams(window.location.search);
    const select = params.get('select');
    if (select) {
      await selectPoi(select);
    }
    const modal = params.get('modal');
    if (!modal) return;
    setTimeout(function () {
      if (modal === 'ingest') openIngestModal();
      else if (modal === 'ai-edit') openAiEditModal();
      else if (modal === 'analyze') runAnalyze(null);
    }, 250);
  }

  /** 提前确认登录态：v2 服务端才有 /api/auth/status；老版本 404 时按已登录处理 */
  async function ensureAuthenticated() {
    try {
      const status = await BWAPI.request('GET', '/api/auth/status');
      if (status && status.authenticated === false) {
        const next = encodeURIComponent(location.pathname + location.search);
        location.replace('/admin/login?next=' + next);
        return false;
      }
      return true;
    } catch (error) {
      // 404/网络错误：老服务端或暂时不可用，交给后续请求去报错
      return true;
    }
  }

  async function boot() {
    if (!(await ensureAuthenticated())) return;
    renderTopActions();
    bindTopActions();
    bindMapKeysPanel();
    renderLlmBadge();
    renderFilters();
    renderList();
    renderEditor();

    await Promise.all([fetchLlm(), fetchStats(), fetchList()]);

    bindGlobalKeys();
    state.booted = true;
    window.__BW_READY__ = true;

    if (isSmallScreen()) setEditorOpen(false);
    await applyDevParams();
  }

  boot().catch(function (error) {
    console.error(error);
    UI.toast('界面初始化失败：' + (error && error.message ? error.message : String(error)), 'error', 6000);
  });
})();
