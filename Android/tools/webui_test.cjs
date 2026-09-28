/* 用系统自带 Edge 在「手机视口」上跑一遍安卓版界面：
   1. 按 MainActivity.buildHtml() 的方式把资源拼成单个 HTML（含安卓桥 + 手机样式）
   2. 注入一个假的 window.AndroidBridge，异步回调，行为和原生层一致
   3. 逐个页面截图，并检查是否有 JS 报错、横向溢出、桥接是否真的被调用

   运行：node Android/tools/webui_test.cjs
*/

const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, 'webui-test', 'node_modules', 'playwright-core'));

const androidRoot = path.resolve(__dirname, '..');
const uiDir = path.join(androidRoot, 'app', 'src', 'main', 'assets', 'ui');
const androidAssets = path.join(androidRoot, 'app', 'src', 'main', 'assets', 'android');
// 截图放在 Android/screenshots，不会被 dist 清理掉
const outDir = path.join(androidRoot, 'screenshots');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const read = (file) => fs.readFileSync(file, 'utf8');

function buildHtml(mockBridge) {
  const html = read(path.join(uiDir, 'index.html'));
  const css = read(path.join(uiDir, 'styles.css')) + '\n\n' + read(path.join(androidAssets, 'mobile.css'));
  const js =
    // 真实运行时 AndroidBridge 由 WebView 在页面脚本之前注入，
    // 这里用同一顺序把假桥放在最前面。
    mockBridge +
    '\n\n' +
    read(path.join(androidAssets, 'bridge.js')) +
    '\n\n' +
    ['00-util.js', '10-render.js', '20-forms.js', '30-boot.js']
      .map((name) => read(path.join(uiDir, 'js', name)))
      .join('\n\n') +
    '\n\n' +
    // 和 MainActivity 保持一致：手机端增强脚本放在最后
    read(path.join(androidAssets, 'mobile.js'));
  return html.replace('/*__STYLES__*/', css).replace('/*__APP_JS__*/', js);
}

// ------------------------------------------------------------- 假数据
const categories = [
  { id: 1, name: '伙食费', monthly_budget: 1200, spending_type: 'essential', is_system: 0, sort_order: 10 },
  { id: 2, name: '通勤', monthly_budget: 500, spending_type: 'essential', is_system: 0, sort_order: 20 },
  { id: 3, name: '学习用品', monthly_budget: 600, spending_type: 'occasional', is_system: 0, sort_order: 30 },
  { id: 4, name: '社交', monthly_budget: 450, spending_type: 'flexible', is_system: 0, sort_order: 40 },
  { id: 5, name: '其他', monthly_budget: 250, spending_type: 'unknown', is_system: 1, sort_order: 999 },
];

const overviewCategories = [
  { id: 1, name: '伙食费', spending_type: 'essential', is_system: 0, default_budget: 1200, budget: 1200, budget_is_override: false, budget_source: null, spent: 760, remaining: 440, usage: 0.6333, status: 'ok' },
  { id: 2, name: '通勤', spending_type: 'essential', is_system: 0, default_budget: 500, budget: 500, budget_is_override: false, budget_source: null, spent: 318, remaining: 182, usage: 0.636, status: 'ok' },
  { id: 3, name: '学习用品', spending_type: 'occasional', is_system: 0, default_budget: 600, budget: 600, budget_is_override: false, budget_source: null, spent: 286, remaining: 314, usage: 0.4767, status: 'ok' },
  { id: 4, name: '社交', spending_type: 'flexible', is_system: 0, default_budget: 450, budget: 450, budget_is_override: true, budget_source: 'user', spent: 402, remaining: 48, usage: 0.8933, status: 'near' },
  { id: 5, name: '其他', spending_type: 'unknown', is_system: 1, default_budget: 250, budget: 250, budget_is_override: false, budget_source: null, spent: 94, remaining: 156, usage: 0.376, status: 'ok' },
];

const expenses = [
  { id: 11, spent_on: '2026-09-28', category_id: 1, category_name: '伙食费', amount: 18, note: '食堂午饭' },
  { id: 10, spent_on: '2026-09-27', category_id: 2, category_name: '通勤', amount: 22, note: '晚间打车' },
  { id: 9, spent_on: '2026-09-26', category_id: 3, category_name: '学习用品', amount: 86, note: '论文打印与装订' },
  { id: 8, spent_on: '2026-09-24', category_id: 4, category_name: '社交', amount: 128, note: '同学聚餐' },
  { id: 7, spent_on: '2026-09-22', category_id: 1, category_name: '伙食费', amount: 36, note: '超市采购' },
  { id: 6, spent_on: '2026-09-20', category_id: 5, category_name: '其他', amount: 15, note: '日用品' },
];

const payloads = {
  bootstrap: { threshold: 0.8, months: ['2026-09', '2026-08', '2026-07'], db_path: 'dataset/budget.db', export_dir: 'dataset/exports' },
  app_info: { base_dir: '/data/user/0/com.cost.ledger/files', db_path: '/data/user/0/com.cost.ledger/files/dataset/budget.db', export_dir: '/data/user/0/com.cost.ledger/files/dataset/exports' },
  list_categories: categories,
  category_memories: [],
  suggest_category: { category_id: 1, category_name: '伙食费', confidence: 0.82, source: 'memory' },
  threshold: 0.8,
  set_threshold: 0.8,
  list_days: [{ day: '2026-09-28', count: 1, total: 18 }, { day: '2026-09-27', count: 1, total: 22 }],
  list_expenses: expenses,
  overview: {
    month: '2026-09',
    threshold: 0.8,
    categories: overviewCategories,
    totals: { budget: 3000, spent: 1860, remaining: 1140, usage: 0.62 },
    pie: [{ id: 1, name: '伙食费', value: 760 }, { id: 2, name: '通勤', value: 318 }, { id: 3, name: '学习用品', value: 286 }, { id: 4, name: '社交', value: 402 }, { id: 5, name: '其他', value: 94 }],
    alerts: { over: [], near: ['社交'], unbudgeted: [] },
  },
  intelligence: {
    as_of: '2026-09-28',
    forecast: { central: 2070, lower: 1980, upper: 2220, budget_gap: 930, confidence: 'medium', method: '分类级预测' },
    anomalies: [{ severity: 'medium', message: '社交支出已达到预算的 89%', fingerprint: 'demo-1', feedback: '' }],
  },
  history: {
    months: [
      { month: '2026-08', budget: 3000, spent: 2240, remaining: 760, usage: 0.7467 },
      { month: '2026-07', budget: 3000, spent: 2670, remaining: 330, usage: 0.89 },
      { month: '2026-06', budget: 2800, spent: 2530, remaining: 270, usage: 0.9036 },
    ],
    total_months: 3,
    totals: { budget: 8800, spent: 7440, remaining: 1360 },
  },
  backtest_intelligence: { samples: [], mean_abs_error: null },
  ai_config: { base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', enabled: true, has_key: true, key_hint: '尾号 1234', key_error: '', ready: true, default_base_url: 'https://api.deepseek.com/v1', default_model: 'deepseek-chat' },
  list_ai_reports: [],
  export_csv: { path: 'dataset/exports/export_2026-09.csv', cancelled: false },
  open_data_folder: '/data/user/0/com.cost.ledger/files/dataset',
  parse_expense_text: {
    items: [
      { spent_on: '2026-09-28', category_id: 1, amount: 3, note: '原始人', reason: '描述不明确，暂归其他', confidence: '低', suggested_category_id: 5 },
      { spent_on: '2026-09-28', category_id: 1, amount: 5, note: '启动', reason: '描述不明确，暂归其他', confidence: '低', suggested_category_id: 5 },
      { spent_on: '2026-09-28', category_id: 1, amount: 18, note: '食堂午饭', reason: '餐饮关键词命中', confidence: '高', suggested_category_id: 1 },
      { spent_on: '2026-09-27', category_id: 2, amount: 22, note: '打车', reason: '交通关键词命中', confidence: '高', suggested_category_id: 2 },
      { spent_on: '2026-09-26', category_id: 3, amount: 46, note: '买书', reason: '学习用品关键词命中', confidence: '中', suggested_category_id: 3 },
      { spent_on: '2026-09-24', category_id: 4, amount: 128, note: '同学聚餐', reason: '社交关键词命中', confidence: '中', suggested_category_id: 4 },
    ],
    warnings: ['「原始人」和「启动」具体为何种消费不明确，已暂归入其他分类。'],
  },
  add_expenses_batch: { ids: [1, 2, 3, 4, 5, 6], count: 6 },
};

const mockScript = `
  window.__bridgeLog = [];
  window.AndroidBridge = {
    request: function (id, method, argsJson) {
      window.__bridgeLog.push({ kind: 'request', method: method, args: JSON.parse(argsJson || '[]') });
      var payloads = ${JSON.stringify(payloads)};
      var data = Object.prototype.hasOwnProperty.call(payloads, method) ? payloads[method] : null;
      // 异步回调，和原生层 evaluateJavascript 的行为保持一致
      setTimeout(function () {
        window.__ledgerBridgeResolve(id, JSON.stringify({ ok: true, data: data }));
      }, 4);
    },
    saveToDownloads: function (sourcePath, displayName) {
      window.__bridgeLog.push({ kind: 'saveToDownloads', args: [sourcePath, displayName] });
      var name = displayName || sourcePath.split(/[\\\\/]/).pop();
      return '下载/' + name;
    },
    exportDatabase: function () {
      window.__bridgeLog.push({ kind: 'exportDatabase', args: [] });
    },
    toast: function (message) {
      window.__bridgeLog.push({ kind: 'toast', args: [message] });
    }
  };
`;

// ------------------------------------------- 弹窗在窄屏 / 矮屏下的适配检查
// 之前的问题：.modal 没有高度约束，内容一超高就既不滚动也被裁掉，
// 底部按钮还会盖住备注/AI 解析结果。这里把「按钮可见 + 能滚到最后一项」变成断言。

async function modalProbe(page, selector) {
  return page.evaluate((sel) => {
    const mask = document.querySelector(sel);
    if (!mask) return { found: false };
    const round = (value) => Math.round(value);
    const rect = (el) => {
      const box = el.getBoundingClientRect();
      return { top: round(box.top), bottom: round(box.bottom), height: round(box.height) };
    };
    const modal = mask.querySelector('.modal');
    const body = mask.querySelector('.modal-body');
    const foot = mask.querySelector('.modal-foot');
    const list = mask.querySelector('.smart-entry-list');
    const primary = foot ? foot.querySelector('.primary-btn') : null;
    const viewportHeight = window.innerHeight;
    const footRect = foot ? rect(foot) : null;
    const primaryRect = primary ? rect(primary) : null;
    return {
      found: true,
      viewport: { w: window.innerWidth, h: viewportHeight },
      modal: rect(modal),
      scrollable: body.scrollHeight > body.clientHeight + 1,
      listScrollable: list ? list.scrollHeight > list.clientHeight + 1 : null,
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
      scrollTop: body.scrollTop,
      footerInsideViewport: footRect ? footRect.top >= 0 && footRect.bottom <= viewportHeight + 1 : false,
      saveButtonVisible: primaryRect
        ? primaryRect.top >= 0 && primaryRect.bottom <= viewportHeight + 1 && primaryRect.height >= 24
        : false,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, selector);
}

async function scrollModalBodyToBottom(page, selector) {
  await page.evaluate((sel) => {
    const body = document.querySelector(sel + ' .modal-body');
    if (body) body.scrollTop = body.scrollHeight;
  }, selector);
  await page.waitForTimeout(250);
}

async function lastEditableVisible(page, selector) {
  return page.evaluate((sel) => {
    const mask = document.querySelector(sel);
    const nodes = mask ? mask.querySelectorAll('.modal-body input, .modal-body select, .modal-body textarea') : [];
    if (!nodes.length) return { count: 0, visible: false };
    const box = nodes[nodes.length - 1].getBoundingClientRect();
    return {
      count: nodes.length,
      visible: box.top >= 0 && box.bottom <= window.innerHeight + 1,
      bottom: Math.round(box.bottom),
      viewportHeight: window.innerHeight,
    };
  }, selector);
}

async function lastSmartRowVisible(page, selector) {
  return page.evaluate((sel) => {
    const rows = document.querySelectorAll(sel + ' .smart-entry-row');
    if (!rows.length) return { count: 0, visible: false };
    const box = rows[rows.length - 1].getBoundingClientRect();
    return {
      count: rows.length,
      visible: box.top >= 0 && box.bottom <= window.innerHeight + 1,
      bottom: Math.round(box.bottom),
      viewportHeight: window.innerHeight,
    };
  }, selector);
}

async function closeModal(page) {
  const cancel = await page.$('.modal-mask .modal-foot .ghost-btn');
  if (cancel) await cancel.click();
  await page.waitForTimeout(250);
}

async function checkModals(page, outDir) {
  const failures = [];
  const shots = [];
  const results = {};
  const cases = [
    // android: true 表示这是安卓上的窄屏/矮屏场景，弹窗必须是「单层滚动」
    { name: 'desktop', width: 1240, height: 840, android: false },
    { name: 'emu-landscape', width: 853, height: 480, android: true },
    { name: 'phone', width: 390, height: 844, android: true },
  ];

  for (const item of cases) {
    await page.setViewportSize({ width: item.width, height: item.height });
    await page.click('[data-view="overview"]');
    await page.waitForTimeout(300);
    const current = {};

    // ---- 手动记账弹窗 ----
    // 手机端桌面那两个按钮收进了右上角「＋」的操作表里
    const addButton = await page.$('.mobile-add');
    if (addButton) {
      await addButton.click();
      await page.waitForSelector('.action-mask [data-act="manual"]');
      await page.click('.action-mask [data-act="manual"]');
    } else {
      await page.click('#btnQuickManualExpense');
    }
    await page.waitForSelector('.modal-mask .modal-foot');
    await page.waitForTimeout(250);
    current.manualOpen = await modalProbe(page, '.modal-mask');
    const manualShot = path.join(outDir, `modal-manual-${item.name}.png`);
    await page.screenshot({ path: manualShot });
    shots.push(manualShot);

    await scrollModalBodyToBottom(page, '.modal-mask');
    current.manualAfterScroll = await lastEditableVisible(page, '.modal-mask');
    const manualBottomShot = path.join(outDir, `modal-manual-${item.name}-bottom.png`);
    await page.screenshot({ path: manualBottomShot });
    shots.push(manualBottomShot);

    if (!current.manualOpen.footerInsideViewport || !current.manualOpen.saveButtonVisible) {
      failures.push(`${item.name}: 手动记账弹窗的「保存」不在可视区内`);
    }
    if (current.manualOpen.scrollable && !current.manualAfterScroll.visible) {
      failures.push(`${item.name}: 手动记账弹窗滚到底仍看不到备注输入框`);
    }
    if (current.manualOpen.horizontalOverflow > 0) {
      failures.push(`${item.name}: 手动记账弹窗横向溢出 ${current.manualOpen.horizontalOverflow}px`);
    }
    await closeModal(page);

    // ---- AI 记账弹窗 ----
    await page.fill('#homeSmartText', '原始人三块，启动五块，食堂午饭 18，打车 22，买书 46，聚餐 128');
    await page.click('#btnHomeSmartExpense');
    try {
      await page.waitForSelector('.modal-mask .smart-entry-row', { timeout: 5000 });
    } catch (error) {
      await page.click('#btnParseExpenseText');
      await page.waitForSelector('.modal-mask .smart-entry-row', { timeout: 5000 });
    }
    await page.waitForTimeout(350);
    current.aiRows = await lastSmartRowVisible(page, '.modal-mask');
    current.aiOpen = await modalProbe(page, '.modal-mask');
    const aiShot = path.join(outDir, `modal-ai-${item.name}.png`);
    await page.screenshot({ path: aiShot });
    shots.push(aiShot);

    await scrollModalBodyToBottom(page, '.modal-mask');
    current.aiAfterScroll = await lastSmartRowVisible(page, '.modal-mask');
    const aiBottomShot = path.join(outDir, `modal-ai-${item.name}-bottom.png`);
    await page.screenshot({ path: aiBottomShot });
    shots.push(aiBottomShot);

    if (current.aiRows.count !== 6) {
      failures.push(`${item.name}: AI 记账解析出的账单行数不是 6（实际 ${current.aiRows.count}）`);
    }
    if (!current.aiOpen.footerInsideViewport || !current.aiOpen.saveButtonVisible) {
      failures.push(`${item.name}: AI 记账弹窗的「确认保存」不在可视区内`);
    }
    if (item.android) {
      // 安卓上只允许弹窗正文一层滚动：结果列表不能再套一层内部滚动条
      if (!current.aiOpen.scrollable) {
        failures.push(`${item.name}: AI 记账弹窗正文不可滚动（安卓上应由弹窗统一滚动）`);
      }
      if (current.aiOpen.listScrollable) {
        failures.push(`${item.name}: AI 记账结果列表仍存在内层滚动条`);
      }
      if (!current.aiAfterScroll.visible) {
        failures.push(`${item.name}: AI 记账弹窗滚到底仍看不到最后一笔`);
      }
    } else {
      // 桌面沿用「列表内部滚动」的原设计，只要能滚到最后一笔即可
      await page.evaluate((sel) => {
        const list = document.querySelector(sel + ' .smart-entry-list');
        if (list) list.scrollTop = list.scrollHeight;
      }, '.modal-mask');
      await page.waitForTimeout(250);
      current.aiAfterListScroll = await lastSmartRowVisible(page, '.modal-mask');
      if (!current.aiAfterListScroll.visible) {
        failures.push(`${item.name}: AI 记账结果滚到底仍看不到最后一笔`);
      }
    }
    await closeModal(page);

    results[item.name] = current;
  }

  return { cases: results, shots, failures };
}

(async function () {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.UI_BROWSER_PATH || EDGE,
  });
  // 安卓手机常见尺寸：390x844（iPhone 14 / 多数中端安卓接近）
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error.message || error)));
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.setContent(buildHtml(mockScript), { waitUntil: 'load' });
  try {
    await page.waitForFunction(() => document.querySelectorAll('#kpiRow .kpi').length === 4, null, { timeout: 15000 });
  } catch (error) {
    const diag = await page.evaluate(() => ({
      hasAndroidBridge: typeof window.AndroidBridge,
      hasPywebview: typeof window.pywebview,
      hasApi: !!(window.pywebview && window.pywebview.api),
      bridgeLog: (window.__bridgeLog || []).map((item) => item.method || item.kind),
      kpiRowHtml: (document.getElementById('kpiRow') || {}).innerHTML,
      toast: Array.from(document.querySelectorAll('.toast')).map((el) => el.textContent),
      readyState: document.readyState,
    }));
    console.error('渲染超时，诊断信息：');
    console.error(JSON.stringify(diag, null, 2));
    console.error('pageErrors: ' + JSON.stringify(pageErrors));
    console.error('consoleErrors: ' + JSON.stringify(consoleErrors));
    throw error;
  }

  const shots = [];
  async function shoot(view, file) {
    await page.click(`[data-view="${view}"]`);
    await page.waitForTimeout(400);
    const target = path.join(outDir, file);
    await page.screenshot({ path: target, fullPage: true });
    shots.push(target);
  }

  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'phone-overview.png'), fullPage: true });
  shots.push(path.join(outDir, 'phone-overview.png'));
  await shoot('records', 'phone-records.png');
  await shoot('manage', 'phone-budget.png');
  await shoot('ai', 'phone-insights.png');
  await shoot('data', 'phone-settings.png');

  // 设置页里点一次「导出全部」+「打开数据目录」，验证安卓桥的导出链路
  await page.click('#btnExportAll');
  await page.waitForTimeout(500);
  await page.click('#btnOpenFolder');
  await page.waitForTimeout(500);

  const audit = await page.evaluate(() => {
    const log = window.__bridgeLog || [];
    const body = document.body;
    return {
      navTabs: document.querySelectorAll('.side-nav .tab').length,
      kpis: document.querySelectorAll('#kpiRow .kpi').length,
      missingViews: ['overview', 'records', 'manage', 'ai', 'data'].filter((v) => !document.getElementById('view-' + v)),
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sidebarPosition: getComputedStyle(document.querySelector('.sidebar')).position,
      methods: log.filter((item) => item.kind === 'request').map((item) => item.method),
      savedToDownloads: log.filter((item) => item.kind === 'saveToDownloads').map((item) => item.args),
      exportedDatabase: log.filter((item) => item.kind === 'exportDatabase').length,
      bodyClass: body.className,
      toastText: (document.querySelector('.toast') || {}).textContent || '',
      navRect: document.querySelector('.side-nav').getBoundingClientRect().toJSON(),
      tabs: Array.from(document.querySelectorAll('.side-nav .tab')).map((tab) => ({
        text: tab.textContent.trim(),
        display: getComputedStyle(tab).display,
        flex: getComputedStyle(tab).flex,
        rect: tab.getBoundingClientRect().toJSON(),
      })),
    };
  });
  audit.pageErrors = pageErrors;
  audit.consoleErrors = consoleErrors;

  const modalReport = await checkModals(page, outDir);

  console.log(JSON.stringify({ screenshots: shots, audit, modals: modalReport }, null, 2));
  await browser.close();
  if (modalReport.failures.length > 0) {
    console.error('\n弹窗适配存在 ' + modalReport.failures.length + ' 个问题');
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
