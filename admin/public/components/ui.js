/* 步迷 · 兴趣点后台 — 共享 UI 工具（零依赖）
 * 提供：转义 / 图标 / 设计 token 映射 / toast / 弹层 / 二次确认 / 忙碌态 / 空状态插画
 * 暴露在 window.WAUI，供 admin.js 使用。
 */
(function () {
  'use strict';

  // ---------- 图标（内联 SVG，line style，1.6 stroke） ----------
  const ICONS = {
    search: '<circle cx="11" cy="11" r="6.4"/><path d="M16 16l4.4 4.4"/>',
    capture: '<path d="M12 4v10"/><path d="M8 10l4 4 4-4"/><path d="M4 17v2.2c0 .5.4.8.8.8h14.4c.4 0 .8-.3.8-.8V17"/>',
    sparkles: '<path d="M12 4l1.5 4.3L18 10l-4.5 1.7L12 16l-1.5-4.3L6 10l4.5-1.7L12 4z"/><path d="M18.4 15.2l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9z"/>',
    pen: '<path d="M4.6 19.4l.8-3.5L16.2 5.1a1.8 1.8 0 0 1 2.6 0l1.1 1.1a1.8 1.8 0 0 1 0 2.6L9.1 19.6l-3.5.8z"/><path d="M14.8 6.6l3.6 3.6"/>',
    chart: '<path d="M4.6 19.4h14.8"/><rect x="6.4" y="11" width="2.8" height="5.6" rx="1"/><rect x="11.2" y="6.8" width="2.8" height="9.8" rx="1"/><rect x="16" y="9.2" width="2.8" height="7.4" rx="1"/>',
    layers: '<path d="M12 4.2l8.2 4.1L12 12.4 3.8 8.3 12 4.2z"/><path d="M4.4 12.2L12 16l7.6-3.8"/><path d="M4.4 16.1L12 19.9l7.6-3.8"/>',
    upload: '<path d="M12 19V9"/><path d="M8 12.4L12 8.4l4 4"/><path d="M4 19.4h16"/>',
    check: '<path d="M5 12.6l4.4 4.4L19 7.4"/>',
    close: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
    trash: '<path d="M5 7.2h14"/><path d="M9.4 7.2V5.4c0-.6.5-1 1-1h3.2c.5 0 1 .4 1 1v1.8"/><path d="M7.4 7.2l.8 11.1c0 .7.6 1.3 1.3 1.3h5c.7 0 1.3-.6 1.3-1.3l.8-11.1"/>',
    alert: '<path d="M12 4.8l8.2 14.4H3.8L12 4.8z"/><path d="M12 10v4"/><path d="M12 16.4h.01" stroke-width="2.4"/>',
    lock: '<rect x="5.4" y="10.4" width="13.2" height="8.8" rx="2.2"/><path d="M8.6 10.4V8a3.4 3.4 0 0 1 6.8 0v2.4"/>',
    image: '<rect x="4.4" y="5.4" width="15.2" height="13.2" rx="2.4"/><circle cx="9.6" cy="10" r="1.5"/><path d="M4.8 16.4l4.2-4.2 3.4 3.4 2.8-2.8 4.2 4.4"/>',
    pin: '<path d="M12 21s6.2-5.4 6.2-10.4A6.2 6.2 0 0 0 5.8 10.6C5.8 15.6 12 21 12 21z"/><circle cx="12" cy="10.4" r="2.3"/>',
    info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5"/><path d="M12 7.8h.01" stroke-width="2.4"/>',
    refresh: '<path d="M19.4 12a7.4 7.4 0 1 1-2.2-5.2"/><path d="M19.6 5.2v4.2h-4.2"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.6V12l2.8 1.8"/>',
    lockKey: '<circle cx="8.2" cy="12" r="2.6"/><path d="M10.8 12h8.4"/><path d="M16.4 12v2.4"/><path d="M19.2 12v2"/>',
    tag: '<path d="M4.8 12.2V5.4c0-.4.3-.7.7-.7h6.8l6.9 6.9c.3.3.3.7 0 1l-6 6c-.3.3-.7.3-1 0l-7.4-7.4z"/><circle cx="9" cy="8.6" r="1.2"/>',
    imageOff: '<rect x="4.4" y="5.4" width="15.2" height="13.2" rx="2.4"/><path d="M5 19L19 5"/>'
  };

  function icon(name, size) {
    const body = ICONS[name] || '';
    const px = size || 16;
    return '<svg class="icon" width="' + px + '" height="' + px + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      body + '</svg>';
  }

  // ---------- 契约中的枚举（admin/docs/CONTRACT.md §2–§3） ----------
  const CATEGORIES = [
    { id: 'cafe', label: '咖啡窗口', emoji: '☕️', rarity: 'common' },
    { id: 'bookstore', label: '书店', emoji: '📚', rarity: 'rare' },
    { id: 'library', label: '图书馆', emoji: '📖', rarity: 'rare' },
    { id: 'park', label: '公园', emoji: '🌳', rarity: 'common' },
    { id: 'bench', label: '长椅', emoji: '🪑', rarity: 'common' },
    { id: 'bridge', label: '桥', emoji: '🌉', rarity: 'rare' },
    { id: 'art', label: '涂鸦墙', emoji: '🎨', rarity: 'epic' },
    { id: 'river', label: '河岸', emoji: '🌊', rarity: 'epic' },
    { id: 'convenience', label: '便利店', emoji: '🥫', rarity: 'common' },
    { id: 'viewpoint', label: '观景点', emoji: '🔭', rarity: 'epic' },
    { id: 'garden', label: '花园', emoji: '🌷', rarity: 'rare' },
    { id: 'plaza', label: '广场', emoji: '⛲️', rarity: 'common' },
    { id: 'museum', label: '博物馆', emoji: '🏛️', rarity: 'rare' },
    { id: 'historic', label: '老房子', emoji: '🏮', rarity: 'rare' },
    { id: 'venue', label: '演出场所', emoji: '🎻', rarity: 'epic' },
    { id: 'temple', label: '寺庙教堂', emoji: '⛩️', rarity: 'rare' },
    { id: 'market', label: '市集', emoji: '🛒', rarity: 'common' }
  ];
  const CATEGORY_MAP = {};
  CATEGORIES.forEach(function (c) { CATEGORY_MAP[c.id] = c; });

  const STATUS_META = {
    draft: { label: '草稿', order: 1 },
    review: { label: '待审', order: 2 },
    approved: { label: '已通过', order: 3 },
    rejected: { label: '已拒绝', order: 4 }
  };
  const STATUS_ORDER = ['draft', 'review', 'approved', 'rejected'];

  const RARITY_META = {
    common: { label: '常见' },
    rare: { label: '稀有' },
    epic: { label: '史诗' },
    hidden: { label: '隐藏' }
  };
  const RARITY_ORDER = ['common', 'rare', 'epic', 'hidden'];

  const AREA_META = {
    near: { label: '附近' },
    river: { label: '河岸' },
    oldtown: { label: '老城区' }
  };
  const AREA_ORDER = ['near', 'river', 'oldtown'];

  // ---------- 基础工具 ----------
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function debounce(fn, delay) {
    let timer = null;
    return function () {
      const args = arguments;
      const ctx = this;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, delay);
    };
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function formatTime(ms) {
    if (!ms) return '—';
    const d = new Date(ms);
    return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function timeAgo(ms) {
    if (!ms) return '—';
    const diff = Date.now() - ms;
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 3600 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400 * 1000) return Math.floor(diff / 3600000) + ' 小时前';
    const days = Math.floor(diff / 86400000);
    if (days === 1) return '昨天 ' + formatTime(ms).slice(6);
    if (days < 7) return days + ' 天前';
    return formatTime(ms);
  }

  function categoryMeta(id) {
    return CATEGORY_MAP[id] || { id: id || 'unknown', label: id || '未分类', emoji: '📍', rarity: 'common' };
  }

  function statusBadge(status) {
    const meta = STATUS_META[status] || STATUS_META.draft;
    return '<span class="badge badge--' + escapeHtml(status || 'draft') + '">' +
      '<span class="badge__dot" aria-hidden="true"></span>' + escapeHtml(meta.label) + '</span>';
  }

  function rarityBadge(rarity) {
    const meta = RARITY_META[rarity] || RARITY_META.common;
    return '<span class="rarity rarity--' + escapeHtml(rarity || 'common') + '">' +
      '<span class="rarity__dot" aria-hidden="true"></span>' + escapeHtml(meta.label) + '</span>';
  }

  // ---------- Toast ----------
  function toast(message, type, timeout) {
    const root = document.getElementById('toasts');
    if (!root) return;
    const kind = type || 'info';
    const el = document.createElement('div');
    el.className = 'toast toast--' + kind;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    const iconName = kind === 'success' ? 'check' : (kind === 'error' ? 'alert' : 'info');
    el.innerHTML = '<span class="toast__icon">' + icon(iconName, 15) + '</span><div class="toast__text"></div>';
    el.querySelector('.toast__text').textContent = String(message == null ? '' : message);
    root.appendChild(el);
    while (root.children.length > 4) root.removeChild(root.firstElementChild);
    setTimeout(function () {
      el.classList.add('is-leaving');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
    }, timeout || 3800);
  }

  // ---------- 弹层 ----------
  let currentModal = null;

  function openModal(options) {
    const opts = options || {};
    closeModal(true);
    const root = document.getElementById('modal-root');
    root.innerHTML = '';

    const scrim = document.createElement('div');
    scrim.className = 'modal-scrim';
    scrim.setAttribute('aria-hidden', 'true');

    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';

    const modal = document.createElement('div');
    modal.className = 'modal' + (opts.wide ? ' modal--wide' : '');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', opts.title || '弹层');

    modal.innerHTML =
      '<div class="modal__head">' +
        '<div style="min-width:0">' +
          '<div class="modal__title">' + escapeHtml(opts.title || '') + '</div>' +
          (opts.subtitle ? '<div class="modal__sub">' + escapeHtml(opts.subtitle) + '</div>' : '') +
        '</div>' +
        '<div class="modal__spacer"></div>' +
        '<button type="button" class="btn btn--icon" data-modal-close aria-label="关闭弹层">' + icon('close', 15) + '</button>' +
      '</div>' +
      '<div class="modal__body"></div>' +
      '<div class="modal__foot"></div>';

    root.appendChild(scrim);
    root.appendChild(wrap);
    wrap.appendChild(modal);

    const body = modal.querySelector('.modal__body');
    const foot = modal.querySelector('.modal__foot');
    body.innerHTML = opts.bodyHTML || '';
    foot.innerHTML = opts.footerHTML || '';

    const handle = {
      modal: modal,
      body: body,
      foot: foot,
      onClose: null,
      closed: false,
      close: function (silent) {
        if (handle.closed) return;
        handle.closed = true;
        scrim.style.opacity = '0';
        modal.classList.remove('is-open');
        setTimeout(function () {
          if (root.querySelector('.modal-scrim') === scrim) root.innerHTML = '';
        }, 200);
        if (currentModal === handle) currentModal = null;
        if (!silent && typeof handle.onClose === 'function') handle.onClose();
      }
    };

    scrim.addEventListener('click', function () { handle.close(); });
    modal.querySelector('[data-modal-close]').addEventListener('click', function () { handle.close(); });

    currentModal = handle;
    requestAnimationFrame(function () {
      scrim.style.opacity = '1';
      modal.classList.add('is-open');
      const first = modal.querySelector('input, textarea, select, button.btn--primary, [tabindex="0"]');
      if (first) first.focus();
    });
    return handle;
  }

  function closeModal(silent) {
    if (currentModal) currentModal.close(silent === true);
  }

  function confirmDialog(options) {
    const opts = options || {};
    return new Promise(function (resolve) {
      let settled = false;
      const handle = openModal({
        title: opts.title || '确认操作',
        subtitle: opts.subtitle || '',
        bodyHTML: '<div style="font-size:12.5px;line-height:1.65;color:var(--ink-2)">' +
          escapeHtml(opts.message || '') + '</div>',
        footerHTML:
          '<button type="button" class="btn" data-act="cancel">' + escapeHtml(opts.cancelText || '取消') + '</button>' +
          '<div class="spacer"></div>' +
          '<button type="button" class="btn ' + (opts.danger ? 'btn--danger' : 'btn--primary') + '" data-act="ok">' +
          escapeHtml(opts.confirmText || '确定') + '</button>'
      });
      function done(value) {
        if (settled) return;
        settled = true;
        handle.close(true);
        resolve(value);
      }
      handle.foot.querySelector('[data-act="cancel"]').addEventListener('click', function () { done(false); });
      handle.foot.querySelector('[data-act="ok"]').addEventListener('click', function () { done(true); });
      handle.onClose = function () { done(false); };
    });
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && currentModal) {
      event.preventDefault();
      currentModal.close();
    }
  });

  // ---------- 按钮忙碌态 ----------
  function setBusy(button, busy, busyText) {
    if (!button) return;
    if (busy) {
      if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.innerHTML = '<span class="spinner"></span><span>' + escapeHtml(busyText || '处理中…') + '</span>';
    } else {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      if (button.dataset.originalHtml) {
        button.innerHTML = button.dataset.originalHtml;
        delete button.dataset.originalHtml;
      }
    }
  }

  // ---------- 空状态插画 ----------
  function artEmptyList() {
    return '<svg class="empty__art" width="86" height="66" viewBox="0 0 86 66" fill="none" aria-hidden="true">' +
      '<rect x="9" y="14" width="68" height="44" rx="9" stroke="currentColor" stroke-width="1.4" stroke-dasharray="4 5"/>' +
      '<path d="M24 38h38" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
      '<path d="M24 46h24" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
      '<circle cx="30" cy="27" r="3.4" stroke="#E89B4C" stroke-width="1.6"/>' +
      '<path d="M36 27h20" stroke="#E89B4C" stroke-width="1.6" stroke-linecap="round"/>' +
      '<circle cx="70" cy="14" r="7" fill="#FFFBF3" stroke="#E89B4C" stroke-width="1.5"/>' +
      '<path d="M67.6 11.6c.4-1.2 1.5-1.9 2.8-1.9 1.5 0 2.6 1 2.6 2.3 0 1.1-.7 1.7-1.7 2.1-.6.2-.8.5-.8 1.1" stroke="#C97B2E" stroke-width="1.4" stroke-linecap="round"/>' +
      '</svg>';
  }

  function artEmptyEditor() {
    return '<svg class="editor-empty__art" width="92" height="74" viewBox="0 0 92 74" fill="none" aria-hidden="true">' +
      '<path d="M17 54c8-16 20-24 33-24 11 0 20 5 26 15" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="4 5"/>' +
      '<rect x="24" y="24" width="44" height="34" rx="7" fill="#FFFBF3" stroke="currentColor" stroke-width="1.4"/>' +
      '<path d="M33 34h26M33 41h18M33 48h22" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
      '<circle cx="66" cy="20" r="8" fill="#FBF4E9" stroke="#E89B4C" stroke-width="1.5"/>' +
      '<path d="M66 21.8s3-3 3-5a3 3 0 0 0-6 0c0 2 3 5 3 5z" fill="#E89B4C"/>' +
      '</svg>';
  }

  window.WAUI = {
    icon: icon,
    escapeHtml: escapeHtml,
    debounce: debounce,
    formatTime: formatTime,
    timeAgo: timeAgo,
    categoryMeta: categoryMeta,
    statusBadge: statusBadge,
    rarityBadge: rarityBadge,
    toast: toast,
    openModal: openModal,
    closeModal: closeModal,
    confirmDialog: confirmDialog,
    setBusy: setBusy,
    artEmptyList: artEmptyList,
    artEmptyEditor: artEmptyEditor,
    CATEGORIES: CATEGORIES,
    CATEGORY_MAP: CATEGORY_MAP,
    STATUS_META: STATUS_META,
    STATUS_ORDER: STATUS_ORDER,
    RARITY_META: RARITY_META,
    RARITY_ORDER: RARITY_ORDER,
    AREA_META: AREA_META,
    AREA_ORDER: AREA_ORDER
  };
})();
