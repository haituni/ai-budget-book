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
    const btn = e.target.closest('[data-act="month-budget"]');
    if (btn) openMonthBudgetModal(Number(btn.dataset.id));
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
    if (!btn || btn.disabled) return;
    const cat = state.categories.find((c) => c.id === Number(btn.dataset.id));
    if (!cat) return;
    if (btn.dataset.act === 'edit-category') {
      openCategoryModal(cat);
    } else if (btn.dataset.act === 'del-category') {
      deleteCategoryFlow(cat);
    }
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

  $('recordsTable').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const row = state.records.find((r) => r.id === Number(btn.dataset.id));
    if (!row) return;
    if (btn.dataset.act === 'edit-expense') {
      openExpenseModal(row);
    } else if (btn.dataset.act === 'del-expense') {
      deleteExpenseFlow(row);
    }
  });

  $('recentRecords').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const row = state.recentRecords.find((item) => item.id === Number(btn.dataset.id));
    if (row && btn.dataset.act === 'edit-expense') openExpenseModal(row);
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      openSmartExpenseModal();
    }
  });
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

  try {
    const info = await call('bootstrap');
    state.info = info;
    state.threshold = Number(info.threshold) || 0.8;

    $('monthInput').value = state.month;
    $('thresholdRange').value = Math.round(state.threshold * 100);
    $('thresholdLabel').textContent = `${Math.round(state.threshold * 100)}%`;

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
