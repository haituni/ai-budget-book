/* ==================================================================
   事件绑定与启动
   ================================================================== */

const VIEW_META = {
  overview: ['概览', '掌握本月预算、支出和需要关注的变化'],
  records: ['账单', '记录、筛选和修正每一笔消费'],
  manage: ['预算', '管理分类额度、下月建议和预警规则'],
  ai: ['洞察', '查询账本、查看预测并生成月度复盘'],
  data: ['设置', '管理 AI 服务、本地数据和备份导出'],
};

// 侧边栏顺序，用于 ⌘1 ~ ⌘5 快速跳转
const VIEW_ORDER = Object.keys(VIEW_META);

function setMonth(month) {
  state.month = month;
  syncFilterToMonth(month);
  $('monthInput').value = month;
  refreshAll().catch((err) => toast(err.message, 'err'));
}

/** 顶部月份变化时，让流水页的筛选跟着走，保持"看的是哪个月"一致。 */
function syncFilterToMonth(month) {
  state.filter.month = month;
  if (state.filter.scope === 'day') {
    const inMonth = state.days.filter((d) => d.day.slice(0, 7) === month);
    state.filter.day = inMonth.length ? inMonth[0].day : `${month}-01`;
  }
}

/** 切到「按日」时，如果还没选日期，默认落在最近有记录的那天。 */
function defaultDay(month) {
  const inMonth = state.days.filter((d) => d.day.slice(0, 7) === month);
  if (inMonth.length) return inMonth[0].day;
  return month === isoMonth(new Date()) ? todayStr() : `${month}-01`;
}

function switchView(view) {
  state.view = view;
  document.querySelectorAll('.tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach((el) => {
    el.classList.toggle('active', el.id === `view-${view}`);
  });
  const pageMeta = VIEW_META[view] || VIEW_META.overview;
  $('viewTitle').textContent = pageMeta[0];
  $('viewSubtitle').textContent = pageMeta[1];
}

/* ==================================================================
   窗口外壳：macOS 风格的自绘标题栏

   桌面版是无边框窗口，红黄绿按钮、边缘拖拽改大小、失焦变灰这些
   系统行为都要自己补。安卓/浏览器里没有桌面窗口，window_shell 会
   告诉前端 chrome=false，这时候整套外壳都不启用，布局自动退回。
   ================================================================== */

const chromeState = {
  active: false,
  zoomed: false,
  minWidth: 860,
  minHeight: 600,
  resizing: false,
};

function setRangeProgress(range) {
  if (!range) return;
  const min = Number(range.min || 0);
  const max = Number(range.max || 100);
  const value = Number(range.value || 0);
  const ratio = max > min ? (value - min) / (max - min) : 0;
  range.style.setProperty('--range-progress', `${Math.round(ratio * 100)}%`);
}

function setZoomed(zoomed) {
  chromeState.zoomed = Boolean(zoomed);
  document.body.classList.toggle('chrome-zoomed', chromeState.zoomed);
  const btn = $('winZoom');
  if (btn) btn.title = chromeState.zoomed ? '还原' : '缩放';
}

function toggleSidebar() {
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  const btn = $('btnSidebarToggle');
  if (btn) btn.setAttribute('aria-pressed', collapsed ? 'false' : 'true');
}

/** 拖窗口边缘改大小：指针位移交给后台换算成新尺寸。 */
function bindResizeHandles() {
  const layer = $('resizeLayer');
  if (!layer) return;

  layer.addEventListener('pointerdown', async (event) => {
    if (!chromeState.active || chromeState.zoomed || event.button !== 0) return;
    const handle = event.target.closest('.rz');
    if (!handle || !handle.dataset.edge) return;
    event.preventDefault();

    const startX = event.screenX;
    const startY = event.screenY;
    let pending = null;
    let scheduled = false;

    try {
      await call('window_resize_start', handle.dataset.edge);
    } catch (err) {
      return; // 后台不支持就算了，别影响正常使用
    }

    chromeState.resizing = true;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch (err) {
      /* 捕获失败也能继续，只是指针移出窗口后会丢事件 */
    }

    const flush = async () => {
      scheduled = false;
      if (!pending) return;
      const delta = pending;
      pending = null;
      try {
        await call('window_resize_to', delta.dx, delta.dy);
      } catch (err) {
        /* 单帧失败忽略，下一帧会带着最新位移再来 */
      }
    };

    const onMove = (moveEvent) => {
      pending = { dx: moveEvent.screenX - startX, dy: moveEvent.screenY - startY };
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(flush);
      }
    };

    const onUp = async () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      pending = null;
      chromeState.resizing = false;
      try {
        await call('window_resize_end');
      } catch (err) {
        /* 结束失败无影响 */
      }
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });
}

async function initWindowChrome() {
  let shell = null;
  try {
    shell = await call('window_shell');
  } catch (err) {
    return; // 安卓 / 浏览器：没有桌面窗口，保持原生外观
  }
  if (!shell || !shell.chrome) return;

  chromeState.active = true;
  chromeState.minWidth = Number(shell.min_width) || chromeState.minWidth;
  chromeState.minHeight = Number(shell.min_height) || chromeState.minHeight;
  document.body.classList.add('has-chrome');
  setZoomed(shell.zoomed);

  window.addEventListener('blur', () => document.body.classList.add('window-blurred'));
  window.addEventListener('focus', () => document.body.classList.remove('window-blurred'));
  if (!document.hasFocus()) document.body.classList.add('window-blurred');

  $('winClose').onclick = () => { call('window_close').catch(() => {}); };
  $('winMinimize').onclick = () => { call('window_minimize').catch(() => {}); };
  $('winZoom').onclick = async () => {
    try {
      const res = await call('window_zoom');
      setZoomed(res && res.zoomed);
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  // 双击工具栏 = 缩放（macOS 默认行为）
  $('titlebar').addEventListener('dblclick', (event) => {
    if (event.target.closest('button')) return;
    $('winZoom').click();
  });

  $('btnSidebarToggle').onclick = toggleSidebar;
  bindResizeHandles();

  // ⌃⌘S（Windows 上是 Ctrl+Alt+S）：和 Finder 一样收起 / 展开边栏
  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || !event.altKey) return;
    if (String(event.key).toLowerCase() !== 's') return;
    event.preventDefault();
    toggleSidebar();
  });
}

/** 让大模型分析当前所选月份，并把结果存进历史报告。 */
async function runAiAnalyze() {
  const btn = $('btnAiAnalyze');
  const month = state.month;
  const originalText = btn.textContent;

  btn.disabled = true;
  btn.textContent = '分析中…';
  const online = Boolean(state.ai && state.ai.ready);
  $('aiResult').innerHTML = `<div class="ai-loading"><span class="spinner"></span>
    ${online
      ? `数据审计、预算分析和行动规划正在并行审阅 ${esc(monthLabel(month))}，总编将汇总报告…`
      : `正在本地计算 ${esc(monthLabel(month))} 的预测区间、异常证据和行动额度…`}
  </div>`;
  // 先让浏览器把上面的提示画出来，再去等待这次调用
  await new Promise((resolve) => setTimeout(resolve, 80));

  try {
    const report = await call('analyze_month', month);
    aiExpandedId = null;
    await refreshAiReports();
    const local = report && report.stats && report.stats.analysis
      && report.stats.analysis.mode === 'local_fallback';
    toast(local ? '本地规则报告已生成并保存' : '分析完成，已存进历史报告', 'ok');
  } catch (err) {
    toast(err.message, 'err', 9000);
  } finally {
    btn.textContent = originalText;
    renderAi();
  }
}

async function runLedgerQuestion() {
  const input = $('ledgerQuestion');
  const button = $('btnAskLedger');
  const answerBox = $('ledgerAnswer');
  const question = input.value.trim();
  if (!question) {
    toast('请输入想问账本的问题', 'err');
    return;
  }
  button.disabled = true;
  button.textContent = '思考中…';
  try {
    const result = await call('ask_ledger', question, state.month);
    const evidence = (result.evidence || []).map((item) => `<div>• ${esc(item)}</div>`).join('');
    answerBox.className = 'ledger-answer';
    answerBox.innerHTML = `<div><b>${esc(monthLabel(result.month))}</b> · ${esc(result.answer)}</div>
      ${evidence ? `<div class="ledger-evidence">${evidence}</div>` : ''}`;
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    button.disabled = false;
    button.textContent = '问大模型';
  }
}

function bindEvents() {
  $('monthInput').addEventListener('change', (e) => {
    if (e.target.value) setMonth(e.target.value);
  });

  $('prevMonth').onclick = () => setMonth(shiftMonth(state.month, -1));
  $('nextMonth').onclick = () => setMonth(shiftMonth(state.month, 1));
  $('thisMonth').onclick = () => setMonth(isoMonth(new Date()));

  $('tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) switchView(tab.dataset.view);
  });

  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-go-view]');
    if (target) switchView(target.dataset.goView);
  });

  $('categoryList').addEventListener('click', (e) => {
    const row = e.target.closest('.cat-row[data-id]');
    const btn = e.target.closest('[data-act="month-budget"]');
    if (btn) {
      openMonthBudgetModal(Number(btn.dataset.id));
      return;
    }
    if (row) selectRow('#categoryList', Number(row.dataset.id), 'selectedCategoryId');
  });

  $('categoryList').addEventListener('dblclick', (e) => {
    const row = e.target.closest('.cat-row[data-id]');
    if (!row || e.target.closest('button')) return;
    openMonthBudgetModal(Number(row.dataset.id));
  });

  $('categoryList').addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.cat-row[data-id]');
    if (!row) return;
    e.preventDefault();
    selectRow('#categoryList', Number(row.dataset.id), 'selectedCategoryId');
    showContextMenu(e, categoryMenuItems({ id: Number(row.dataset.id) }));
  });

  $('smartOverview').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act="insight-useful"], [data-act="insight-dismiss"]');
    if (!btn || !btn.dataset.fingerprint) return;
    const decision = btn.dataset.act === 'insight-useful' ? 'useful' : 'dismissed';
    btn.disabled = true;
    try {
      await call('feedback_insight', {
        fingerprint: btn.dataset.fingerprint,
        decision,
      });
      await refreshIntelligence();
      renderOverview();
      toast(decision === 'useful' ? '已记录：这条提醒有用' : '已忽略这条提醒', 'ok');
    } catch (err) {
      btn.disabled = false;
      toast(err.message, 'err');
    }
  });

  $('budgetTable').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) {
      const row = e.target.closest('tr[data-id]');
      if (row) selectRow('#budgetTable', Number(row.dataset.id), 'selectedCategoryId');
      return;
    }
    if (btn.disabled) return;
    const cat = state.categories.find((c) => c.id === Number(btn.dataset.id));
    if (!cat) return;
    if (btn.dataset.act === 'edit-category') openCategoryModal(cat);
    else if (btn.dataset.act === 'del-category') deleteCategoryFlow(cat);
  });

  $('budgetTable').addEventListener('dblclick', (e) => {
    const row = e.target.closest('tr[data-id]');
    if (!row || e.target.closest('button')) return;
    const cat = state.categories.find((c) => c.id === Number(row.dataset.id));
    if (cat) openCategoryModal(cat);
  });

  $('budgetTable').addEventListener('contextmenu', (e) => {
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    const cat = state.categories.find((c) => c.id === Number(row.dataset.id));
    if (!cat) return;
    e.preventDefault();
    selectRow('#budgetTable', cat.id, 'selectedCategoryId');
    showContextMenu(e, budgetMenuItems(cat));
  });

  $('btnAddCategory').onclick = () => openCategoryModal(null);
  $('btnAddExpense').onclick = () => openExpenseModal(null);
  $('btnSmartExpense').onclick = () => openSmartExpenseModal();
  $('btnQuickManualExpense').onclick = () => openExpenseModal(null);
  $('btnQuickSmartExpense').onclick = () => openSmartExpenseModal();
  $('btnHomeSmartExpense').onclick = async () => {
    const input = $('homeSmartText');
    const textValue = input.value.trim();
    if (!textValue) {
      toast('先写下要记录的消费', 'err');
      input.focus();
      return;
    }
    const saved = await openSmartExpenseModal(textValue);
    if (saved) input.value = '';
  };
  $('homeSmartText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      $('btnHomeSmartExpense').click();
    }
  });
  $('btnBudgetPlan').onclick = async () => {
    const btn = $('btnBudgetPlan');
    btn.disabled = true;
    try {
      await openBudgetPlanModal();
    } catch (err) {
      toast(err.message, 'err', 6000);
    } finally {
      btn.disabled = false;
    }
  };

  // -------------------------------------------------------------- AI 分析
  $('btnAiConfig').onclick = () => openAiConfigModal();
  $('btnAiAnalyze').onclick = () => runAiAnalyze();
  $('btnAskLedger').onclick = () => runLedgerQuestion();
  $('ledgerQuestion').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runLedgerQuestion();
    }
  });

  $('aiMonthSelect').addEventListener('change', (e) => {
    if (e.target.value) setMonth(e.target.value);
  });

  $('aiStatus').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="go-manage"]')) switchView('data');
  });

  const onAiReportClick = (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const report = (state.aiReports || []).find((item) => item.id === id);
    if (!report) return;
    if (btn.dataset.act === 'toggle-report') {
      aiExpandedId = aiExpandedId === id ? null : id;
      renderAi();
    } else if (btn.dataset.act === 'del-report') {
      deleteAiReportFlow(report);
    }
  };
  $('aiResult').addEventListener('click', onAiReportClick);
  $('aiReportList').addEventListener('click', onAiReportClick);
  $('aiReportList').addEventListener('contextmenu', (e) => {
    const item = e.target.closest('.ai-report-item[data-id]');
    if (!item) return;
    const report = (state.aiReports || []).find((r) => r.id === Number(item.dataset.id));
    if (!report) return;
    e.preventDefault();
    selectRow('#aiReportList', report.id, 'selectedReportId');
    showContextMenu(e, reportMenuItems(report));
  });

  $('recordsTable').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) {
      const tr = e.target.closest('tr[data-id]');
      if (tr) selectRow('#recordsTable', Number(tr.dataset.id), 'selectedExpenseId');
      return;
    }
    const row = state.records.find((r) => r.id === Number(btn.dataset.id));
    if (!row) return;
    if (btn.dataset.act === 'edit-expense') openExpenseModal(row);
    else if (btn.dataset.act === 'del-expense') deleteExpenseFlow(row);
  });

  $('recordsTable').addEventListener('dblclick', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr || e.target.closest('button')) return;
    const row = state.records.find((r) => r.id === Number(tr.dataset.id));
    if (row) openExpenseModal(row);
  });

  $('recordsTable').addEventListener('contextmenu', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const row = state.records.find((r) => r.id === Number(tr.dataset.id));
    if (!row) return;
    e.preventDefault();
    selectRow('#recordsTable', row.id, 'selectedExpenseId');
    showContextMenu(e, expenseMenuItems(row));
  });

  $('recentRecords').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) {
      const el = e.target.closest('.recent-row[data-id]');
      if (el) selectRow('#recentRecords', Number(el.dataset.id), 'selectedExpenseId');
      return;
    }
    const row = state.recentRecords.find((item) => item.id === Number(btn.dataset.id));
    if (row && btn.dataset.act === 'edit-expense') openExpenseModal(row);
  });

  $('recentRecords').addEventListener('dblclick', (e) => {
    const el = e.target.closest('.recent-row[data-id]');
    if (!el || e.target.closest('button')) return;
    const row = state.recentRecords.find((item) => item.id === Number(el.dataset.id));
    if (row) openExpenseModal(row);
  });

  $('recentRecords').addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.recent-row[data-id]');
    if (!el) return;
    const row = state.recentRecords.find((item) => item.id === Number(el.dataset.id));
    if (!row) return;
    e.preventDefault();
    selectRow('#recentRecords', row.id, 'selectedExpenseId');
    showContextMenu(e, expenseMenuItems(row));
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      openSmartExpenseModal();
    }
  });

  // ⌘1~⌘5 切页、⌘, 打开设置、⌘W / ⌘M 关窗最小化：都是 macOS 的固定约定
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = String(e.key);
    if (key >= '1' && key <= '5') {
      e.preventDefault();
      switchView(VIEW_ORDER[Number(key) - 1]);
      return;
    }
    if (key === ',') {
      e.preventDefault();
      switchView('data');
      return;
    }
    const lower = key.toLowerCase();
    if (lower === 'w') {
      e.preventDefault();
      call('window_close').catch(() => {});
    } else if (lower === 'm') {
      e.preventDefault();
      call('window_minimize').catch(() => {});
    }
  });

  // 账单页：↑↓ 换行、回车打开编辑（配合单击选中）
  document.addEventListener('keydown', (e) => {
    if (state.view !== 'records') return;
    if (document.querySelector('.modal-mask') || contextMenu) return;
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
    const rows = Array.from(document.querySelectorAll('#recordsTable tbody tr[data-id]'));
    if (!rows.length) return;

    if (e.key === 'Enter') {
      const picked = state.records.find((r) => r.id === Number(state.selectedExpenseId));
      if (!picked) return;
      e.preventDefault();
      openExpenseModal(picked);
      return;
    }

    e.preventDefault();
    const current = rows.findIndex((el) => Number(el.dataset.id) === Number(state.selectedExpenseId));
    const next = e.key === 'ArrowDown'
      ? Math.min((current < 0 ? -1 : current) + 1, rows.length - 1)
      : Math.max((current < 0 ? rows.length : current) - 1, 0);
    const target = rows[next];
    if (!target) return;
    selectRow('#recordsTable', Number(target.dataset.id), 'selectedExpenseId');
    target.scrollIntoView({ block: 'nearest' });
  });

  // 内容从页头下面滚过去时，页头下方浮出一道阴影
  const mainEl = $('main');
  const headerEl = document.querySelector('.workspace-header');
  if (mainEl && headerEl) {
    const syncHeaderShadow = () => headerEl.classList.toggle('is-scrolled', mainEl.scrollTop > 2);
    mainEl.addEventListener('scroll', syncHeaderShadow, { passive: true });
    syncHeaderShadow();
  }
  $('filterMonth').addEventListener('change', (e) => {
    state.filter.month = e.target.value;
    refreshRecords()
      .then(renderRecords)
      .catch((err) => toast(err.message, 'err'));
  });

  $('scopeSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn || btn.dataset.scope === state.filter.scope) return;
    state.filter.scope = btn.dataset.scope;
    if (state.filter.scope === 'month' && !state.filter.month) {
      state.filter.month = state.month;
    }
    if (state.filter.scope === 'day' && !state.filter.day) {
      state.filter.day = defaultDay(state.month);
    }
    refreshAll().catch((err) => toast(err.message, 'err'));
  });

  $('filterDay').addEventListener('change', (e) => {
    state.filter.day = e.target.value;
    refreshRecords()
      .then(renderRecords)
      .catch((err) => toast(err.message, 'err'));
  });

  $('filterCategory').addEventListener('change', (e) => {
    state.filter.categoryId = e.target.value;
    refreshRecords()
      .then(renderRecords)
      .catch((err) => toast(err.message, 'err'));
  });

  const range = $('thresholdRange');
  range.addEventListener('input', () => {
    $('thresholdLabel').textContent = `${range.value}%`;
    setRangeProgress(range);
  });
  range.addEventListener('change', async () => {
    try {
      await call('set_threshold', Number(range.value));
      await refreshAll();
      toast(`预警阈值已设为 ${range.value}%`, 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  $('btnOpenFolder').onclick = async () => {
    try {
      await call('open_data_folder');
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  $('btnExportAll').onclick = async () => {
    try {
      const result = await call('export_csv', null, null);
      if (result && !result.cancelled) toast(`已导出：${result.path}`, 'ok', 6000);
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  $('btnExportCurrent').onclick = async () => {
    const scope = state.filter.scope;
    try {
      const result = await call(
        'export_csv',
        scope === 'month' ? (state.filter.month || null) : null,
        state.filter.categoryId || null,
        scope === 'day' ? (state.filter.day || null) : null,
      );
      if (result && !result.cancelled) toast(`已导出：${result.path}`, 'ok', 6000);
    } catch (err) {
      toast(err.message, 'err');
    }
  };
}

async function boot() {
  if (bridgeStarted) return;
  bridgeStarted = true;
  api = window.pywebview.api;
  bindEvents();
  // 自绘标题栏（桌面版才有；安卓 / 浏览器里会安静地跳过）
  initWindowChrome().catch(() => {});

  try {
    const info = await call('bootstrap');
    state.info = info;
    state.threshold = Number(info.threshold) || 0.8;

    $('monthInput').value = state.month;
    $('thresholdRange').value = Math.round(state.threshold * 100);
    $('thresholdLabel').textContent = `${Math.round(state.threshold * 100)}%`;
    setRangeProgress($('thresholdRange'));

    await refreshAll();
  } catch (err) {
    toast(`初始化失败：${err.message}`, 'err', 8000);
  }
}

function waitForBridge() {
  if (window.pywebview && window.pywebview.api) {
    boot();
    return;
  }
  window.addEventListener('pywebviewready', boot);
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    if (window.pywebview && window.pywebview.api) {
      clearInterval(timer);
      boot();
    } else if (tries > 100) {
      clearInterval(timer);
      toast('无法连接到本地后台，请重启程序', 'err', 10000);
    }
  }, 100);
}

waitForBridge();
