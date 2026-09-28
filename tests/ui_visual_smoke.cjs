const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const ui = path.join(root, 'ui');
const jsFiles = ['00-util.js', '10-render.js', '20-forms.js', '30-boot.js'];
const css = fs.readFileSync(path.join(ui, 'styles.css'), 'utf8');
const appJs = jsFiles.map(function (name) { return fs.readFileSync(path.join(ui, 'js', name), 'utf8'); }).join('\n\n');
const categories = [
  { id: 1, name: '伙食费', monthly_budget: 1200, spending_type: 'essential', is_system: 0, sort_order: 10 },
  { id: 2, name: '通勤', monthly_budget: 500, spending_type: 'essential', is_system: 0, sort_order: 20 },
  { id: 3, name: '学习用品', monthly_budget: 600, spending_type: 'occasional', is_system: 0, sort_order: 30 },
  { id: 4, name: '社交', monthly_budget: 450, spending_type: 'flexible', is_system: 0, sort_order: 40 },
  { id: 5, name: '其他', monthly_budget: 250, spending_type: 'unknown', is_system: 1, sort_order: 999 }
];
const overviewCategories = [
  { id: 1, name: '伙食费', spending_type: 'essential', is_system: 0, default_budget: 1200, budget: 1200, budget_is_override: false, budget_source: null, spent: 760, remaining: 440, usage: .6333, status: 'ok' },
  { id: 2, name: '通勤', spending_type: 'essential', is_system: 0, default_budget: 500, budget: 500, budget_is_override: false, budget_source: null, spent: 318, remaining: 182, usage: .636, status: 'ok' },
  { id: 3, name: '学习用品', spending_type: 'occasional', is_system: 0, default_budget: 600, budget: 600, budget_is_override: false, budget_source: null, spent: 286, remaining: 314, usage: .4767, status: 'ok' },
  { id: 4, name: '社交', spending_type: 'flexible', is_system: 0, default_budget: 450, budget: 450, budget_is_override: true, budget_source: 'user', spent: 402, remaining: 48, usage: .8933, status: 'near' },
  { id: 5, name: '其他', spending_type: 'unknown', is_system: 1, default_budget: 250, budget: 250, budget_is_override: false, budget_source: null, spent: 94, remaining: 156, usage: .376, status: 'ok' }
];
const expenses = [
  { id: 11, spent_on: '2026-09-28', category_id: 1, category_name: '伙食费', amount: 18, note: '食堂午饭' },
  { id: 10, spent_on: '2026-09-27', category_id: 2, category_name: '通勤', amount: 22, note: '晚间打车' },
  { id: 9, spent_on: '2026-09-26', category_id: 3, category_name: '学习用品', amount: 86, note: '论文打印与装订' },
  { id: 8, spent_on: '2026-09-24', category_id: 4, category_name: '社交', amount: 128, note: '同学聚餐' },
  { id: 7, spent_on: '2026-09-22', category_id: 1, category_name: '伙食费', amount: 36, note: '超市采购' },
  { id: 6, spent_on: '2026-09-20', category_id: 5, category_name: '其他', amount: 15, note: '日用品' }
];
const overview = {
  month: '2026-09', threshold: .8, categories: overviewCategories,
  totals: { budget: 3000, spent: 1860, remaining: 1140, usage: .62 },
  pie: overviewCategories.filter(function (x) { return x.spent > 0; }).map(function (x) { return { id: x.id, name: x.name, value: x.spent }; }),
  alerts: { over: [], near: ['社交'], unbudgeted: [] }
};
const history = { months: [
  { month: '2026-08', budget: 3000, spent: 2240, remaining: 760, usage: .7467 },
  { month: '2026-07', budget: 3000, spent: 2670, remaining: 330, usage: .89 },
  { month: '2026-06', budget: 2800, spent: 2530, remaining: 270, usage: .9036 }
], total_months: 3, totals: { budget: 8800, spent: 7440, remaining: 1360 } };
const intelligence = { as_of: '2026-09-28', forecast: { central: 2070, lower: 1980, upper: 2220, budget_gap: 930, confidence: 'medium', method: '分类级预测' }, anomalies: [ { severity: 'medium', message: '社交支出已达到预算的 89%', fingerprint: 'demo-1', feedback: '' } ] };
const aiConfig = { base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', enabled: true, has_key: true, key_hint: '尾号 1234', key_error: '', ready: true };
const payloads = {
  bootstrap: { threshold: .8, months: ['2026-09','2026-08','2026-07'], db_path: 'dataset/budget.db', export_dir: 'dataset/exports' },
  list_categories: categories,
  category_memories: [],
  list_days: [{ day: '2026-09-28', count: 1, total: 18 }],
  overview: overview,
  intelligence: intelligence,
  history: history,
  list_expenses: expenses,
  ai_config: aiConfig,
  list_ai_reports: []
};
const mockCode = "window.pywebview={api:new Proxy({}, {get:function(_,name){return async function(){return {ok:true,data:(payloads[name]===undefined?null:payloads[name])};};}})};";
let html = fs.readFileSync(path.join(ui, 'index.html'), 'utf8');
html = html.replace('/*__STYLES__*/', css).replace('/*__APP_JS__*/', 'const payloads=' + JSON.stringify(payloads) + ';' + mockCode + appJs);
const outDir = process.env.UI_SHOT_DIR || root;
(async function () {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.UI_BROWSER_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1240, height: 840 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', function (error) { pageErrors.push(error.message); });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction(function () { return document.querySelectorAll('#kpiRow .kpi').length === 4; });
  const overviewPath = path.join(outDir, 'ui-redesign-overview.png');
  await page.screenshot({ path: overviewPath, fullPage: true });
  await page.click('[data-view="records"]');
  await page.waitForTimeout(350);
  const recordsPath = path.join(outDir, 'ui-redesign-records.png');
  await page.screenshot({ path: recordsPath, fullPage: true });
  await page.click('[data-view="manage"]');
  await page.waitForTimeout(350);
  const budgetPath = path.join(outDir, 'ui-redesign-budget.png');
  await page.screenshot({ path: budgetPath, fullPage: true });
  await page.click('[data-view="ai"]');
  await page.waitForTimeout(350);
  const insightPath = path.join(outDir, 'ui-redesign-insights.png');
  await page.screenshot({ path: insightPath, fullPage: true });
  await page.click('[data-view="data"]');
  await page.waitForTimeout(350);
  const settingsPath = path.join(outDir, 'ui-redesign-settings.png');
  await page.screenshot({ path: settingsPath, fullPage: true });
  await page.setViewportSize({ width: 860, height: 720 });
  await page.click('[data-view="overview"]');
  await page.waitForTimeout(350);
  const narrowPath = path.join(outDir, 'ui-redesign-narrow.png');
  await page.screenshot({ path: narrowPath, fullPage: true });
  const audit = await page.evaluate(function () {
    return {
      title: document.getElementById('viewTitle').textContent,
      navCount: document.querySelectorAll('.side-nav .tab').length,
      missingViews: ['overview','records','manage','ai','data'].filter(function (name) { return !document.getElementById('view-' + name); }),
      bodyOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      mainOverflow: document.getElementById('main').scrollWidth > document.getElementById('main').clientWidth
    };
  });
  audit.pageErrors = pageErrors;
  console.log(JSON.stringify({ overviewPath: overviewPath, recordsPath: recordsPath, budgetPath: budgetPath, insightPath: insightPath, settingsPath: settingsPath, narrowPath: narrowPath, audit: audit }));
  await browser.close();
})().catch(function (error) { console.error(error); process.exit(1); });
