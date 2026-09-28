/* ==================================================================
   基础工具、全局状态、提示与弹窗
   ================================================================== */

'use strict';

const PALETTE = [
  '#4f8cff', '#22c1a4', '#f5a524', '#ef5f6b', '#8b6cf0',
  '#2fa8e0', '#7dc242', '#e2688a', '#f07c3e', '#5f7d95',
  '#b4a02a', '#c05fd0', '#3fb6b0', '#d4772f', '#7a8cff',
];

const $ = (id) => document.getElementById(id);

const isoMonth = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const todayStr = () => {
  const d = new Date();
  return `${isoMonth(d)}-${String(d.getDate()).padStart(2, '0')}`;
};

const shiftMonth = (month, delta) => {
  const [y, m] = month.split('-').map(Number);
  return isoMonth(new Date(y, m - 1 + delta, 1));
};

const monthLabel = (month) => {
  const [y, m] = month.split('-');
  return `${y} 年 ${Number(m)} 月`;
};

const money = (n) => '¥' + Number(n || 0).toFixed(2);

const esc = (text) =>
  String(text === null || text === undefined ? '' : text).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

/* ---------------------------------------------------------- 全局状态 */

const state = {
  month: isoMonth(new Date()),
  view: 'overview',
  overview: null,
  intelligence: null,
  history: null,
  categories: [],
  personalMemory: [],
  records: [],
  recentRecords: [],
  info: null,
  days: [],
  threshold: 0.8,
  ai: null,          // AI 接口配置（不含明文 Key）
  aiReports: [],     // 当前所选月份的历史报告
  // scope: all = 全部 / month = 按月 / day = 按日
  filter: { scope: 'month', month: isoMonth(new Date()), day: '', categoryId: '' },
};

let bridgeStarted = false;
let api = null;

/* -------------------------------------------------------- 与后台通信 */

async function call(method, ...args) {
  if (!api) throw new Error('界面与本地后台的桥接尚未就绪');
  const res = await api[method](...args);
  if (res && res.ok === false) throw new Error(res.error || '操作失败');
  return res ? res.data : null;
}

/* ------------------------------------------------------------ 提示条 */

function toast(message, type = 'info', timeout = 2800) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('toastRoot').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 240);
  }, timeout);
}

/* -------------------------------------------------------------- 弹窗 */

function closeMask(mask) {
  mask.remove();
  if (!document.querySelector('.modal-mask')) {
    document.body.classList.remove('modal-open');
  }
}

/**
 * 带表单的弹窗。
 * validate(mask) 取值并校验，抛错即在弹窗内显示错误；
 * onSubmit(payload) 抛错同样显示在弹窗里，成功则关闭。
 */
function formModal(options) {
  const { title, bodyHtml, confirmText = '保存', validate, onSubmit, onReady } = options;
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal">
        <div class="modal-head">${esc(title)}</div>
        <div class="modal-body">
          ${bodyHtml}
          <div class="form-error"></div>
        </div>
        <div class="modal-foot">
          <button class="ghost-btn" data-act="cancel">取消</button>
          <button class="primary-btn" data-act="ok">${esc(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    document.body.classList.add('modal-open');
    // 允许调用方在弹窗渲染后自己绑一些额外按钮（例如「测试连接」）
    if (typeof onReady === 'function') onReady(mask);

    const errBox = mask.querySelector('.form-error');
    const okBtn = mask.querySelector('[data-act="ok"]');

    // Esc 取消；在输入框里按回车直接保存（多行文本框除外）
    const onKey = (e) => {
      if (e.key === 'Escape') {
        finish(null);
        return;
      }
      if (e.key !== 'Enter' || e.shiftKey) return;
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'TEXTAREA' || tag === 'BUTTON') return; // 交给原生行为
      e.preventDefault();
      okBtn.click();
    };
    const finish = (value) => {
      document.removeEventListener('keydown', onKey);
      closeMask(mask);
      resolve(value);
    };
    document.addEventListener('keydown', onKey);
    mask.addEventListener('mousedown', (e) => { if (e.target === mask) finish(null); });
    mask.querySelector('[data-act="cancel"]').onclick = () => finish(null);

    okBtn.onclick = async () => {
      errBox.classList.remove('show');
      let payload;
      try {
        payload = validate(mask);
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.add('show');
        return;
      }
      okBtn.disabled = true;
      okBtn.textContent = '处理中…';
      try {
        await onSubmit(payload);
        finish(payload);
      } catch (err) {
        errBox.textContent = err.message || String(err);
        errBox.classList.add('show');
        okBtn.disabled = false;
        okBtn.textContent = confirmText;
      }
    };

    const first = mask.querySelector('input, select, textarea');
    if (first) {
      first.focus();
      if (first.select && first.type !== 'checkbox') first.select();
    }
  });
}

/** 二次确认弹窗，返回 Promise<boolean>。 */
function confirmModal(options) {
  const { title, messageHtml, confirmText = '确定', danger = false } = options;
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal">
        <div class="modal-head">${esc(title)}</div>
        <div class="modal-body"><div class="modal-message">${messageHtml}</div></div>
        <div class="modal-foot">
          <button class="ghost-btn" data-act="cancel">取消</button>
          <button class="primary-btn" data-act="ok"${danger ? ' style="background:var(--over)"' : ''}>${esc(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    document.body.classList.add('modal-open');

    const onKey = (e) => {
      if (e.key === 'Escape') {
        finish(false);
        return;
      }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      finish(true);
    };
    const finish = (value) => {
      document.removeEventListener('keydown', onKey);
      closeMask(mask);
      resolve(value);
    };
    document.addEventListener('keydown', onKey);
    mask.addEventListener('mousedown', (e) => { if (e.target === mask) finish(false); });
    mask.querySelector('[data-act="cancel"]').onclick = () => finish(false);
    mask.querySelector('[data-act="ok"]').onclick = () => finish(true);
  });
}

/* ---------------------------------------------------------- 数据加载 */

async function refreshCategories() {
  state.categories = await call('list_categories');
  // 分类被删除后，筛选框里可能还留着已经不存在的分类，这里顺手清掉
  if (
    state.filter.categoryId
    && !state.categories.some((c) => String(c.id) === String(state.filter.categoryId))
  ) {
    state.filter.categoryId = '';
  }
}

async function refreshCategoryMemories() {
  state.personalMemory = await call('category_memories');
}

async function refreshOverview() {
  state.overview = await call('overview', state.month);
}

async function refreshIntelligence() {
  if (state.month > isoMonth(new Date())) {
    state.intelligence = null;
    return;
  }
  state.intelligence = await call('intelligence', state.month);
}

async function refreshRecords() {
  const scope = state.filter.scope;
  const month = scope === 'month' ? (state.filter.month || null) : null;
  const day = scope === 'day' ? (state.filter.day || null) : null;
  // 「按日」但还没选日期时，不返回任何记录，避免看起来像"没筛选"
  if (scope === 'day' && !day) {
    state.records = [];
    return;
  }
  state.records = await call(
    'list_expenses',
    month,
    state.filter.categoryId || null,
    day,
  );
}

async function refreshRecentRecords() {
  const rows = await call('list_expenses', state.month, null, null);
  state.recentRecords = (rows || []).slice(0, 6);
}
async function refreshDays() {
  state.days = await call('list_days');
  // 日期下拉里只列"有记录"的日期，当前选中的日期不在列表里时回退，
  // 优先留在当前所看的月份内。
  const inMonth = state.days.filter((d) => d.day.slice(0, 7) === state.month);
  const pool = inMonth.length ? inMonth : state.days;
  if (!pool.some((d) => d.day === state.filter.day)) {
    state.filter.day = pool.length ? pool[0].day : '';
  }
}

async function refreshHistory() {
  state.history = await call('history', state.month, 6);
}

async function refreshAiConfig() {
  state.ai = await call('ai_config');
}

async function refreshAiReports() {
  state.aiReports = await call('list_ai_reports', state.month, 20);
}

async function refreshAll() {
  // 先拿分类，再按分类状态取流水，避免用到已删除的分类去筛选
  await refreshCategories();
  // 日期列表要先于流水，因为「按日」的选中日期会在这里被纠正
  await refreshDays();
  await Promise.all([
    refreshOverview(),
    refreshIntelligence(),
    refreshCategoryMemories(),
    refreshHistory(),
    refreshRecords(),
    refreshRecentRecords(),
    refreshAiConfig(),
    refreshAiReports(),
  ]);
  renderAll();
}
