/* ==================================================================
   手机端交互增强层（只在 APK 内注入，桌面版不加载这个文件）

   负责那些纯 CSS 做不到的部分：
   1. 底部标签栏换成线性图标
   2. 右上角圆形「＋」→ iOS 操作表（AI 记账 / 手动记账）
   3. 弹窗顶部抓手条
   4. 账单列表：没有备注时用分类名当标题
   5. 向下滚动时收起大标题
   6. 点按的轻震动反馈（走原生桥）
   ================================================================== */

(function () {
  'use strict';

  const PHONE = '(max-width: 900px)';
  const isPhone = () => window.matchMedia(PHONE).matches;

  const ICONS = {
    overview: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />',
    records: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />',
    manage: '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H17a2 2 0 0 1 2 2v.5" />'
      + '<rect x="3" y="8.5" width="18" height="10" rx="2.5" /><path d="M15.5 13.5h2" />',
    ai: '<path d="M12 3.5l1.7 4.4 4.4 1.7-4.4 1.7L12 15.7l-1.7-4.4L5.9 9.6l4.4-1.7z" />'
      + '<path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />',
    data: '<path d="M5 7h14M5 12h14M5 17h14" /><circle cx="9" cy="7" r="2" fill="currentColor" stroke="none" />'
      + '<circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />'
      + '<circle cx="8" cy="17" r="2" fill="currentColor" stroke="none" />',
  };

  function haptic(ms) {
    try {
      const bridge = window.AndroidBridge;
      if (bridge && typeof bridge.vibrate === 'function') bridge.vibrate(ms || 8);
    } catch (err) {
      /* 震动不可用就忽略 */
    }
  }

  // ---------------------------------------------------- 1. 标签栏图标
  function paintTabIcons() {
    document.querySelectorAll('.side-nav .tab').forEach((tab) => {
      const mark = tab.querySelector('.nav-mark');
      if (!mark) return;
      const key = tab.getAttribute('data-view');
      const path = ICONS[key];
      if (!path || mark.dataset.icon === key) return;
      mark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        + 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';
      mark.dataset.icon = key;
    });
  }

  // ------------------------------------------------- 2. 右上角「＋」菜单
  function closeActionSheet() {
    const mask = document.querySelector('.action-mask');
    if (mask) mask.remove();
  }

  function openActionSheet() {
    closeActionSheet();
    const mask = document.createElement('div');
    mask.className = 'action-mask';
    mask.innerHTML = `
      <div class="action-sheet" role="dialog">
        <div class="action-sheet-title">记一笔消费</div>
        <button class="action-sheet-btn strong" data-act="smart">AI 记账 · 一句话记多笔</button>
        <button class="action-sheet-btn" data-act="manual">手动填写</button>
        <button class="action-sheet-cancel" data-act="cancel">取消</button>
      </div>`;
    mask.addEventListener('click', (event) => {
      const act = event.target.closest('[data-act]');
      if (!act) {
        if (event.target === mask) closeActionSheet();
        return;
      }
      const kind = act.dataset.act;
      closeActionSheet();
      haptic(10);
      if (kind === 'cancel') return;
      const target = kind === 'smart'
        ? document.getElementById('btnQuickSmartExpense')
        : document.getElementById('btnQuickManualExpense');
      if (target) target.click();
    });
    document.body.appendChild(mask);
    haptic(10);
  }

  function paintAddButton() {
    const header = document.querySelector('.workspace-header');
    if (!header || header.querySelector('.mobile-add')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mobile-add';
    button.setAttribute('aria-label', '记一笔');
    button.textContent = '＋';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      openActionSheet();
    });
    header.appendChild(button);
  }

  // --------------------------------------------------- 3. 抽屉抓手条
  function paintGrabbers() {
    document.querySelectorAll('.modal-mask .modal').forEach((modal) => {
      if (modal.querySelector('.modal-grabber')) return;
      const head = modal.querySelector('.modal-head');
      if (!head) return;
      const bar = document.createElement('div');
      bar.className = 'modal-grabber';
      head.insertBefore(bar, head.firstChild);
    });
  }

  // ------------------------------------- 4. 没有备注时用分类名当标题
  function markRowsWithoutNote() {
    const box = document.getElementById('recordsTable');
    if (!box) return;
    box.querySelectorAll('tbody tr').forEach((row) => {
      const note = row.querySelector('td:nth-child(4)');
      const text = note ? note.textContent.trim() : '';
      row.classList.toggle('no-note', text === '' || text === '—' || text === '-');
    });
  }

  // -------------------------------------------- 5. 滚动时收起大标题
  function watchScroll() {
    const main = document.getElementById('main');
    const header = document.querySelector('.workspace-header');
    if (!main || !header) return;
    const apply = () => header.classList.toggle('is-scrolled', main.scrollTop > 10);
    if (!main.dataset.scrollBound) {
      main.addEventListener('scroll', apply, { passive: true });
      main.dataset.scrollBound = '1';
    }
    apply();
  }

  function decorate() {
    if (!isPhone()) return;
    paintTabIcons();
    paintAddButton();
    paintGrabbers();
    markRowsWithoutNote();
    watchScroll();
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      decorate();
    });
  }

  function start() {
    decorate();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    // 切换标签时补一次触感，并让大标题回到顶部状态
    document.addEventListener('click', (event) => {
      const tab = event.target.closest('.side-nav .tab');
      if (tab) haptic(8);
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
