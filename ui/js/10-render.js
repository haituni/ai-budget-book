/* ==================================================================
   界面渲染：概览 / 账单 / 预算 / 洞察 / 设置
   ================================================================== */

/* ------------------------------------------------------------ 总览 */

function statusBadge(status) {
  const map = {
    ok: ['badge-ok', '正常'],
    near: ['badge-near', '接近上限'],
    over: ['badge-over', '已超预算'],
    unbudgeted: ['badge-none', '未设预算'],
    none: ['badge-none', '未设预算'],
  };
  const picked = map[status] || map.none;
  return `<span class="badge ${picked[0]}">${picked[1]}</span>`;
}

/* KPI 卡片上的小图标（内联 SVG，不引入任何外部资源） */
const KPI_ICONS = {
  budget: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10.5h18"/><circle cx="16.6" cy="14.8" r="1.2" fill="currentColor" stroke="none"/></svg>',
  spent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3h11v17.5l-2.75-1.7-2.75 1.7-2.75-1.7-2.75 1.7z"/><path d="M9.5 8.5h5M9.5 12h5"/></svg>',
  remain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6.6" rx="7" ry="3.1"/><path d="M5 6.6v4.9c0 1.7 3.13 3.1 7 3.1s7-1.4 7-3.1V6.6"/><path d="M5 11.5v4.9c0 1.7 3.13 3.1 7 3.1s7-1.4 7-3.1v-4.9"/></svg>',
  usage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16.5a8 8 0 1 1 16 0"/><path d="M12 16.5l4.2-5"/><path d="M4 20h16"/></svg>',
};

function renderKpis(ov) {
  const t = ov.totals;
  const usage = t.usage;
  const fillClass = usage === null ? '' : (usage > 1 ? 'over' : (usage >= ov.threshold ? 'near' : ''));
  const fillWidth = usage === null ? 0 : Math.min(usage, 1) * 100;

  $('kpiRow').innerHTML = `
    <div class="kpi accent">
      <div class="kpi-top"><span class="kpi-icon">${KPI_ICONS.budget}</span><span class="label">本月总预算</span></div>
      <div class="value">${money(t.budget)}</div>
      <div class="foot">共 ${ov.categories.length} 个分类</div>
    </div>
    <div class="kpi spend">
      <div class="kpi-top"><span class="kpi-icon">${KPI_ICONS.spent}</span><span class="label">本月实际总消费</span></div>
      <div class="value">${money(t.spent)}</div>
      <div class="foot">按分类累计的支出合计</div>
    </div>
    <div class="kpi ${t.remaining < 0 ? 'bad' : 'good'}">
      <div class="kpi-top"><span class="kpi-icon">${KPI_ICONS.remain}</span><span class="label">本月剩余预算</span></div>
      <div class="value">${money(t.remaining)}</div>
      <div class="foot">${t.remaining < 0 ? '已超出总预算' : '总预算 − 已消费'}</div>
    </div>
    <div class="kpi usage">
      <div class="kpi-top"><span class="kpi-icon">${KPI_ICONS.usage}</span><span class="label">预算使用率</span></div>
      <div class="value">${usage === null ? '—' : Math.round(usage * 100) + '%'}</div>
      <div class="usage-track"><div class="usage-fill ${fillClass}" style="width:${fillWidth}%"></div></div>
    </div>`;
}

/* 列表行里的操作按钮：线性小图标 + 原生提示，比一串彩色文字稳当得多 */
const ROW_ICONS = {
  edit: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.1 2.6 13.4 4.9 6.2 12.1l-3.2.8.8-3.2z"/><path d="M9.9 3.8l2.3 2.3"/></svg>',
  remove: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.4 4.6h9.2"/><path d="M6.5 4.6V3.5a.9.9 0 0 1 .9-.9h1.2a.9.9 0 0 1 .9.9v1.1"/><path d="M4.6 4.6l.5 8a1.1 1.1 0 0 0 1.1 1.05h3.6A1.1 1.1 0 0 0 10.9 12.6l.5-8"/><path d="M6.9 7.1v4.1M9.1 7.1v4.1"/></svg>',
};

/* 界面上的提示/图标：统一用线性符号，彩色 emoji 在桌面版里太跳 */
const UI_PATHS = {
  alert: '<circle cx="8" cy="8" r="6.1"/><path d="M8 4.9v3.7M8 11.1h.01"/>',
  warn: '<path d="M8 2.7 14.1 13H1.9z"/><path d="M8 6.6v3M8 11.5h.01"/>',
  info: '<circle cx="8" cy="8" r="6.1"/><path d="M8 7.3v4.1M8 4.9h.01"/>',
  folder: '<path d="M2.4 6.2a1.4 1.4 0 0 1 1.4-1.4h2.3l1.3 1.6h4.8a1.4 1.4 0 0 1 1.4 1.4v4.4a1.4 1.4 0 0 1-1.4 1.4H3.8a1.4 1.4 0 0 1-1.4-1.4z"/>',
  bars: '<path d="M3.2 13V8.6M6.6 13V5.4M10 13V9.8M13.4 13V3.6"/>',
  calendar: '<rect x="2.6" y="3.8" width="10.8" height="9.6" rx="1.7"/><path d="M2.6 6.7h10.8M5.7 2.4v2.4M10.3 2.4v2.4"/>',
  receipt: '<path d="M4.2 2.6h7.6v11l-1.9-1.4-1.9 1.4-1.9-1.4-1.9 1.4z"/><path d="M6.3 6h3.4M6.3 8.7h3.4"/>',
  sparkle: '<path d="M6.6 2.4 7.7 5.3l2.9 1.1-2.9 1.1-1.1 2.9-1.1-2.9L2.6 6.4l2.9-1.1z"/><path d="M12 9.4l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z"/>',
  compass: '<circle cx="8" cy="8" r="6.1"/><path d="M10.3 5.7 9 9 5.7 10.3 7 7z"/>',
  search: '<circle cx="7.2" cy="7.2" r="4.2"/><path d="M10.3 10.3 13.8 13.8"/>',
};

const uiIcon = (name) =>
  `<svg class="ui-icon" viewBox="0 0 16 16" aria-hidden="true">${UI_PATHS[name]}</svg>`;

function rowAction(act, id, kind, label) {
  const cls = kind === 'remove' ? 'row-action danger' : 'row-action';
  return `<button class="${cls}" data-act="${act}" data-id="${id}" title="${esc(label)}" aria-label="${esc(label)}">${ROW_ICONS[kind]}</button>`;
}

function disabledRowAction(label) {
  return `<button class="row-action danger" disabled title="${esc(label)}" aria-label="${esc(label)}">${ROW_ICONS.remove}</button>`;
}

function renderAlertBar(ov) {
  const bar = $('alertBar');
  const alerts = ov.alerts;
  const parts = [];

  if (alerts.over.length) {
    parts.push({ cls: 'danger', icon: uiIcon('alert'), html: `<b>已超预算：</b>${esc(alerts.over.join('、'))}` });
  }
  if (alerts.near.length) {
    parts.push({
      cls: 'warn',
      icon: uiIcon('warn'),
      html: `<b>接近上限：</b>${esc(alerts.near.join('、'))}（已达到本月预算的 ${Math.round(ov.threshold * 100)}% 以上）`,
    });
  }
  if (alerts.unbudgeted.length) {
    parts.push({
      cls: 'warn',
      icon: uiIcon('info'),
      html: `<b>未设预算却有支出：</b>${esc(alerts.unbudgeted.join('、'))}`,
    });
  }

  if (!parts.length) {
    bar.className = 'alert-bar hidden';
    bar.innerHTML = '';
    return;
  }

  const hasDanger = parts.some((p) => p.cls === 'danger');
  bar.className = `alert-bar ${hasDanger ? 'danger' : 'warn'}`;
  bar.innerHTML = parts
    .map((p) => `<div class="alert-line">
        <span class="icon">${p.icon}</span><span>${p.html}</span></div>`)
    .join('');
}

function categoryRowHtml(item) {
  const ratio = item.budget > 0
    ? Math.min(item.spent / item.budget, 1)
    : (item.spent > 0 ? 1 : 0);
  // 没设预算却有支出：进度条走红色，跟右边「超支」的红字保持一致
  const fillClass = (item.status === 'over' || item.status === 'unbudgeted')
    ? 'over'
    : (item.status === 'near' ? 'near' : '');
  const remainHtml = item.remaining < 0
    ? `<span class="over-text">超支 ${money(-item.remaining)}</span>`
    : `剩余 <span class="strong">${money(item.remaining)}</span>`;

  return `
    <div class="cat-row${item.id === state.selectedCategoryId ? ' selected' : ''}" data-id="${item.id}">
      <div class="cat-name">
        <span class="text">${esc(item.name)}</span>
        ${item.is_system ? '<span class="sys-tag">系统</span>' : ''}
      </div>
      <div class="cat-bar-wrap">
        <div class="cat-bar"><span class="${fillClass}" style="width:${(ratio * 100).toFixed(1)}%"></span></div>
        <div class="cat-meta">
          <span>已花 <span class="strong">${money(item.spent)}</span> / 预算 ${money(item.budget)}</span>
          <span>${remainHtml}</span>
        </div>
      </div>
      <div class="cat-actions">
        ${statusBadge(item.status)}
        <button class="link-btn" data-act="month-budget" data-id="${item.id}">本月预算</button>
      </div>
    </div>`;
}

function renderCategoryList(ov) {
  $('overviewTip').textContent = `统计月份：${monthLabel(ov.month)}`;
  const list = $('categoryList');
  if (!ov.categories.length) {
    list.innerHTML = `<div class="empty"><span class="big">${uiIcon('folder')}</span>还没有任何分类<br>到「预算」里新增一个吧</div>`;
    return;
  }
  list.innerHTML = ov.categories.map(categoryRowHtml).join('');
}

function renderSmartOverview() {
  const box = $('smartOverview');
  const data = state.intelligence;
  if (!data || !data.forecast) {
    box.className = 'smart-overview hidden';
    box.innerHTML = '';
    return;
  }

  const forecast = data.forecast;
  const isPast = state.month < isoMonth(new Date());
  const central = Number(forecast.central || 0);
  const low = Number(forecast.lower || central);
  const high = Number(forecast.upper || central);
  const gap = Number(forecast.budget_gap || 0);
  const risk = gap < 0;
  const confidence = { high: '高', medium: '中', low: '低' }[forecast.confidence] || '低';
  const anomalies = Array.isArray(data.anomalies) ? data.anomalies.slice(0, 4) : [];
  const alertRows = anomalies.length
    ? anomalies.map((item) => {
      const highRisk = item.severity === 'high';
      return `<div class="smart-alert ${highRisk ? 'high' : 'medium'}">
        <span class="smart-alert-level">${highRisk ? '高' : '中'}</span>
        <div class="smart-alert-body">
          <div>${esc(item.message)}${item.feedback === 'useful' ? '<span class="smart-useful">已标记有用</span>' : ''}</div>
          <div class="smart-alert-actions">
            <button class="link-btn" data-act="insight-useful" data-fingerprint="${esc(item.fingerprint)}">有用</button>
            <button class="link-btn" data-act="insight-dismiss" data-fingerprint="${esc(item.fingerprint)}">忽略此提醒</button>
          </div>
        </div>
      </div>`;
    }).join('')
    : '<div class="smart-empty">未发现明显的重复流水、异常单笔或频率突增。</div>';

  box.className = 'smart-overview';
  box.innerHTML = `
    <section class="smart-forecast ${risk ? 'risk' : 'safe'}">
      <div class="smart-title"><span>${uiIcon('compass')}${isPast ? '智能复盘' : '月底智能预测'}</span><small>截至 ${esc(data.as_of)}</small></div>
      <div class="smart-forecast-main">
        <strong>${money(central)}</strong>
        <span>${isPast ? '最终支出' : `预测区间 ${money(low)}～${money(high)}`}</span>
      </div>
      <div class="smart-forecast-meta">
        <span>置信度 ${confidence}</span>
        <span class="${risk ? 'over-text' : 'ok-text'}">${risk ? `预计超预算 ${money(-gap)}` : `预计结余 ${money(gap)}`}</span>
        <span>历史样本 ${Number(data.data_quality && data.data_quality.history_month_count || 0)} 个月</span>
      </div>
    </section>
    <section class="smart-alerts">
      <div class="smart-title"><span>${uiIcon('search')}智能提醒</span><small>${anomalies.length ? `优先展示 ${anomalies.length} 项` : '当前无高优先级问题'}</small></div>
      <div class="smart-alert-list">${alertRows}</div>
    </section>`;
}

/* -------------------------------------------------------------- 饼图 */

function arcPath(cx, cy, rO, rI, a0, a1) {
  const large = (a1 - a0) > Math.PI ? 1 : 0;
  const pt = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const p0 = pt(rO, a0);
  const p1 = pt(rO, a1);
  const p2 = pt(rI, a1);
  const p3 = pt(rI, a0);
  return `M ${p0[0]} ${p0[1]} A ${rO} ${rO} 0 ${large} 1 ${p1[0]} ${p1[1]} `
    + `L ${p2[0]} ${p2[1]} A ${rI} ${rI} 0 ${large} 0 ${p3[0]} ${p3[1]} Z`;
}

function renderPie(ov) {
  const wrap = $('pieWrap');
  const items = ov.pie.map((entry, index) => ({
    id: entry.id,
    name: entry.name,
    value: entry.value,
    color: PALETTE[index % PALETTE.length],
  }));
  const total = items.reduce((sum, item) => sum + item.value, 0);

  if (!items.length) {
    wrap.innerHTML = `<div class="empty"><span class="big">${uiIcon('bars')}</span>本月还没有消费记录<br>点「记一笔」开始记录吧</div>`;
    return;
  }

  const cx = 120;
  const cy = 120;
  const rO = 104;
  const rI = 62;
  let shapes;

  if (items.length === 1) {
    shapes = `<circle cx="${cx}" cy="${cy}" r="${(rO + rI) / 2}" fill="none"
        stroke="${items[0].color}" stroke-width="${rO - rI}"></circle>`;
  } else {
    let angle = -Math.PI / 2;
    shapes = items.map((item) => {
      const a0 = angle;
      angle += (item.value / total) * Math.PI * 2;
      return `<path d="${arcPath(cx, cy, rO, rI, a0, angle)}" fill="${item.color}"></path>`;
    }).join('');
  }

  const legend = items.map((item) => `
    <div class="legend-item">
      <span class="dot" style="background:${item.color}"></span>
      <span class="name" title="${esc(item.name)}">${esc(item.name)}</span>
      <span class="val">${(item.value / total * 100).toFixed(1)}%</span>
    </div>`).join('');

  wrap.innerHTML = `
    <svg class="pie-svg" viewBox="0 0 240 240">
      ${shapes}
      <text class="pie-center-value" x="120" y="116" text-anchor="middle">${money(total)}</text>
      <text class="pie-center-label" x="120" y="136" text-anchor="middle">本月总支出</text>
    </svg>
    <div class="legend">${legend}</div>`;
}

function renderOverview() {
  const ov = state.overview;
  if (!ov) return;
  renderKpis(ov);
  renderAlertBar(ov);
  renderSmartOverview();
  renderCategoryList(ov);
  renderPie(ov);
}

function renderRecentRecords() {
  const box = $('recentRecords');
  if (!box) return;
  const rows = state.recentRecords || [];
  if (!rows.length) {
    box.innerHTML = '<div class="empty" style="padding:24px 8px">这个月还没有流水<br>可以在上方用一句话开始记账</div>';
    return;
  }
  box.innerHTML = rows.map((row) => `
    <div class="recent-row${row.id === state.selectedExpenseId ? ' selected' : ''}" data-id="${row.id}">
      <div class="recent-main">
        <strong title="${esc(row.note || row.category_name)}">${esc(row.note || row.category_name || '未填写备注')}</strong>
        <span>${esc(row.spent_on)} · ${esc(row.category_name)}</span>
      </div>
      <div class="recent-side">
        <span class="recent-amount">${money(row.amount)}</span>
        ${rowAction('edit-expense', row.id, 'edit', '编辑')}
      </div>
    </div>`).join('');
}
/* ---------------------------------------------------------- 往月回顾 */

function renderHistory(data) {
  const box = $('historyList');
  const tip = $('historyTip');
  const months = data && data.months ? data.months : [];

  if (!months.length) {
    tip.textContent = '';
    box.innerHTML = '<div class="empty" style="padding:26px 12px">'
      + `<span class="big">${uiIcon('calendar')}</span>${monthLabel(state.month)} 之前还没有消费记录<br>`
      + '记录几个月之后，这里会自动汇总</div>';
    return;
  }

  tip.textContent = data.total_months > months.length
    ? `最近 ${months.length} / 共 ${data.total_months} 个月`
    : `${months.length} 个月`;

  const threshold = state.threshold || 0.8;
  const items = months.map((m) => {
    const usage = m.usage;
    const fill = usage === null ? '' : (usage > 1 ? 'over' : (usage >= threshold ? 'near' : ''));
    const width = usage === null ? 0 : Math.min(usage, 1) * 100;
    const result = m.remaining < 0
      ? `<span class="result over-text">超支 ${money(-m.remaining)}</span>`
      : `<span class="result ok-text">剩余 ${money(m.remaining)}</span>`;
    const pctText = usage === null ? '—' : `${Math.round(usage * 100)}%`;

    return `
      <div class="history-item">
        <div class="row-top">
          <span class="month">${monthLabel(m.month)}</span>
          ${result}
        </div>
        <div class="row-sub">
          <span>预算 ${money(m.budget)}</span>
          <span>支出 <span class="strong">${money(m.spent)}</span></span>
          <span>${pctText}</span>
        </div>
        <div class="cat-bar"><span class="${fill}" style="width:${width.toFixed(1)}%"></span></div>
      </div>`;
  }).join('');

  const t = data.totals;
  const totalResult = t.remaining < 0
    ? `<span class="result over-text">超支 ${money(-t.remaining)}</span>`
    : `<span class="result ok-text">剩余 ${money(t.remaining)}</span>`;

  box.innerHTML = `
    ${items}
    <div class="history-foot">
      <span class="muted-text">${months.length} 个月合计支出 <span class="strong">${money(t.spent)}</span></span>
      ${totalResult}
    </div>`;
}

/* -------------------------------------------------------------- 流水 */

function renderFilterSelects() {
  const scope = state.filter.scope;

  document.querySelectorAll('#scopeSeg .seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.scope === scope);
  });
  $('filterMonth').classList.toggle('hidden', scope !== 'month');
  $('filterDay').classList.toggle('hidden', scope !== 'day');

  const monthSelect = $('filterMonth');
  const months = Array.from(new Set([
    state.month,
    ...(state.info && state.info.months ? state.info.months : []),
    state.filter.month,
  ].filter(Boolean))).sort().reverse();

  monthSelect.innerHTML = '<option value="">全部月份</option>'
    + months.map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join('');
  monthSelect.value = state.filter.month || '';

  // 有记录的日期直接做成下拉选项（Chromium 不会给 date 输入框渲染 datalist 下拉）
  const daySelect = $('filterDay');
  if (state.days.length) {
    daySelect.innerHTML = state.days
      .map((d) => `<option value="${d.day}">${d.day} · ${d.count} 笔 · ${money(d.total)}</option>`)
      .join('');
  } else {
    daySelect.innerHTML = '<option value="">还没有任何记录</option>';
  }
  daySelect.value = state.filter.day || '';

  const catSelect = $('filterCategory');
  catSelect.innerHTML = '<option value="">全部分类</option>'
    + state.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  catSelect.value = state.filter.categoryId || '';
}

function renderRecords() {
  const box = $('recordsTable');
  const rows = state.records;
  const scope = state.filter.scope;

  if (!rows.length) {
    let where;
    if (scope === 'day') {
      where = state.filter.day ? `${state.filter.day} 这天` : '所选日期';
    } else if (scope === 'month') {
      where = state.filter.month ? monthLabel(state.filter.month) : '全部月份';
    } else {
      where = '全部记录';
    }
    // 「按日」的日期只从有记录的日期里选，所以选不到日期就说明一条记录都没有
    const tip = scope === 'day' && !state.filter.day
      ? '还没有任何消费记录，先记一笔吧'
      : '点右上角「记一笔」新增';
    box.innerHTML = `<div class="empty"><span class="big">${uiIcon('receipt')}</span>${where}还没有符合条件的记录<br>${tip}</div>`;
    return;
  }

  const total = rows.reduce((sum, r) => sum + Number(r.amount), 0);
  const body = rows.map((r) => `
    <tr class="${r.id === state.selectedExpenseId ? 'selected' : ''}" data-id="${r.id}">
      <td>${r.spent_on}</td>
      <td>${esc(r.category_name)}</td>
      <td class="num amount-strong">${money(r.amount)}</td>
      <td class="note" title="${esc(r.note)}">${r.note ? esc(r.note) : '<span class="muted-text">—</span>'}</td>
      <td class="ops">
        ${rowAction('edit-expense', r.id, 'edit', '编辑')}
        ${rowAction('del-expense', r.id, 'remove', '删除')}
      </td>
    </tr>`).join('');

  box.innerHTML = `
    <table class="grid">
      <thead>
        <tr>
          <th style="width:120px">日期</th>
          <th style="width:140px">分类</th>
          <th class="num" style="width:120px">金额</th>
          <th>备注</th>
          <th style="width:88px"></th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
      <tfoot>
        <tr>
          <td colspan="2">合计</td>
          <td class="num">${money(total)}</td>
          <td colspan="2" class="muted-text" style="font-weight:400">共 ${rows.length} 笔</td>
        </tr>
      </tfoot>
    </table>`;
}

/* -------------------------------------------------------------- 预算 */

function renderBudgetTable() {
  const box = $('budgetTable');
  const ov = state.overview;
  if (!state.categories.length) {
    box.innerHTML = '<div class="empty">还没有分类，点右上角「新增分类」开始</div>';
    return;
  }

  const rows = state.categories.map((cat) => {
    const detail = ov ? ov.categories.find((item) => item.id === cat.id) : null;
    const memory = (state.personalMemory || []).find((item) => item.category_id === cat.id);
    const monthBudget = detail ? detail.budget : cat.monthly_budget;
    const isOverride = detail ? detail.budget_is_override : false;
    const isArchived = detail ? detail.budget_source === 'auto' : false;
    const sysTag = cat.is_system ? '<span class="sys-tag" style="margin-left:6px">系统</span>' : '';
    const type = cat.spending_type || 'unknown';
    const typeText = { unknown: '未标记', essential: '必要支出', flexible: '可调整', occasional: '偶发支出' }[type] || '未标记';
    const typeTag = `<span class="profile-tag ${type}">${typeText}</span>`;
    const memoryText = memory && memory.transaction_count
      ? `月均 ${money(memory.monthly_average)} · 常见单笔 ${money(memory.typical_amount)}<br>活跃 ${memory.active_months}/${memory.observed_months} 个月${memory.recurring ? ' · 周期稳定' : ''}`
      : '尚无足够流水形成画像';
    let overrideTag = '';
    if (isArchived) {
      overrideTag = '<span class="override-tag archived" title="该月已结束并归档：预算固定为当月生效值，之后改默认预算不会影响它">已归档</span>';
    } else if (isOverride) {
      overrideTag = '<span class="override-tag" title="仅该月单独设置，不影响默认预算">本月单独</span>';
    }
    const delBtn = cat.is_system
      ? disabledRowAction('系统默认分类不可删除')
      : rowAction('del-category', cat.id, 'remove', '删除');

    return `
      <tr class="${cat.id === state.selectedCategoryId ? 'selected' : ''}" data-id="${cat.id}">
        <td><span class="amount-strong">${esc(cat.name)}</span>${sysTag}${typeTag}</td>
        <td class="num">${money(cat.monthly_budget)}</td>
        <td class="num">${money(monthBudget)}${overrideTag}</td>
        <td><span class="memory-summary">${memoryText}</span></td>
        <td class="ops">
          ${rowAction('edit-category', cat.id, 'edit', '编辑')}
          ${delBtn}
        </td>
      </tr>`;
  }).join('');

  box.innerHTML = `
    <table class="grid">
      <thead>
        <tr>
          <th>分类名称</th>
          <th class="num" style="width:150px">默认月度预算</th>
          <th class="num" style="width:180px">${monthLabel(state.month)} 预算</th>
          <th style="width:230px">个人消费画像</th>
          <th style="width:96px"></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/* ------------------------------------------------------------ AI 分析 */

const AI_MODE_TEXT = { current: '当月进行中', past: '往月复盘' };

// 展开查看的是哪一份历史报告（null = 全部收起）
let aiExpandedId = null;

/**
 * 极简 Markdown 渲染：只处理 AI 报告里会出现的几种写法。
 * 先整体转义再替换，所以报告里的 HTML 不会被当成标签执行。
 */
function mdToHtml(text) {
  const lines = esc(text || '').split(/\r?\n/);
  const out = [];
  let listType = null;

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  const inline = (s) => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      closeList();
      // 模型给的 ## 是小节标题，在页面里落成 h3 更合适
      const level = Math.min(m[1].length + 1, 4);
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
      continue;
    }
    if ((m = line.match(/^[-*·]\s+(.*)$/))) {
      if (listType !== 'ul') {
        closeList();
        out.push('<ul>');
        listType = 'ul';
      }
      out.push(`<li>${inline(m[1])}</li>`);
      continue;
    }
    if ((m = line.match(/^\d+[.、)]\s*(.*)$/))) {
      if (listType !== 'ol') {
        closeList();
        out.push('<ol>');
        listType = 'ol';
      }
      out.push(`<li>${inline(m[1])}</li>`);
      continue;
    }
    if (/^([-*_]\s*){3,}$/.test(line)) {
      closeList();
      out.push('<hr>');
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('');
}

/** 「设置」页里的 AI 配置摘要。 */
function renderAiConfigInfo() {
  const box = $('aiConfigInfo');
  if (!box) return;
  const cfg = state.ai;
  if (!cfg) {
    box.innerHTML = '<div class="info-row"><span class="k">当前状态</span>'
      + '<span class="v plain">读取中…</span></div>';
    return;
  }

  let stateText;
  if (cfg.key_error) stateText = '<span class="over-text">已保存的 Key 失效，需要重填</span>';
  else if (!cfg.enabled) stateText = '<span class="muted-text">已关闭</span>';
  else if (cfg.ready) stateText = '<span class="ok-text">已启用 · 可用</span>';
  else stateText = '<span class="near-text">已启用 · 还差 API Key</span>';

  const keyText = cfg.has_key
    ? `已保存${cfg.key_hint ? `（${esc(cfg.key_hint)}）` : ''}`
    : '<span class="muted-text">未填写</span>';

  box.innerHTML = `
    <div class="info-row"><span class="k">当前状态</span><span class="v plain">${stateText}</span></div>
    <div class="info-row"><span class="k">接口地址</span><span class="v">${esc(cfg.base_url || '')}</span></div>
    <div class="info-row"><span class="k">模型名</span><span class="v">${esc(cfg.model || '')}</span></div>
    <div class="info-row"><span class="k">API Key</span><span class="v plain">${keyText}</span></div>`;
}

function aiReportStatsHtml(stats) {
  if (!stats || stats.budget === undefined) return '';
  const remaining = Number(stats.remaining || 0);
  const remainText = remaining < 0
    ? `<span class="over-text">超支 ${money(-remaining)}</span>`
    : `<span class="ok-text">剩余 ${money(remaining)}</span>`;
  return `
    <span>预算 ${money(stats.budget)}</span>
    <span>支出 <b>${money(stats.spent)}</b></span>
    ${remainText}
    <span class="muted-text">${Number(stats.expense_count || 0)} 笔记录</span>`;
}

function aiVisualsHtml(stats) {
  const visuals = stats && stats.visuals;
  if (!visuals || !visuals.budget_path) return '';

  const budget = visuals.budget_path;
  const budgetValue = Number(budget.budget || 0);
  const spentValue = Number(budget.spent || 0);
  const projectedValue = Number(budget.projected || 0);
  const projectedLower = Number(budget.projected_lower || projectedValue);
  const projectedUpper = Number(budget.projected_upper || projectedValue);
  const usagePct = budgetValue > 0 ? (spentValue / budgetValue) * 100 : 0;
  const projectedPct = budgetValue > 0 ? (projectedValue / budgetValue) * 100 : 0;
  const fillWidth = Math.max(0, Math.min(usagePct, 100));
  const markerLeft = Math.max(0, Math.min(projectedPct, 100));
  const tone = usagePct > 100 ? 'over' : (usagePct >= 80 ? 'near' : 'ok');
  const confidence = budget.forecast_confidence || '—';
  const reasonText = (budget.forecast_reasons || []).join('、');

  const categories = Array.isArray(visuals.categories) ? visuals.categories : [];
  const maxSpent = Math.max(1, ...categories.map((item) => Number(item.spent || 0)));
  const categoryRows = categories.map((item) => {
    const spent = Number(item.spent || 0);
    const itemBudget = Number(item.budget || 0);
    const share = Math.round(Number(item.share || 0) * 100);
    const width = Math.max(2, Math.min((spent / maxSpent) * 100, 100));
    const itemUsage = item.usage === null || item.usage === undefined
      ? null : Number(item.usage) * 100;
    let itemTone = 'ok';
    let statusText = itemBudget <= 0 && spent > 0 ? '无预算' : '';
    if (itemBudget <= 0 && spent > 0) itemTone = 'over';
    else if (itemUsage > 100) { itemTone = 'over'; statusText = `超支 ${Math.round(itemUsage - 100)}%`; }
    else if (itemUsage >= 80) { itemTone = 'near'; statusText = `已用 ${Math.round(itemUsage)}%`; }
    return `
      <div class="ai-cat-row">
        <div class="ai-cat-head"><span>${esc(item.name)}</span><span>${money(spent)} · ${share}%</span></div>
        <div class="ai-cat-track"><span class="ai-cat-fill ${itemTone}" style="width:${width}%"></span></div>
        ${statusText ? `<span class="ai-cat-status ${itemTone}">${statusText}</span>` : ''}
      </div>`;
  }).join('');

  const analysis = stats.analysis || {};
  const okAgents = Array.isArray(analysis.agents)
    ? analysis.agents.filter((item) => item.status === 'ok').length : 0;
  const agentNote = analysis.mode === 'multi_agent'
    ? `<span class="ai-viz-meta">${okAgents}/3 专业角色完成 · ${Number(analysis.calls || 0)} 次调用</span>`
    : (analysis.mode === 'local_fallback'
      ? `<span class="ai-viz-meta">${Number(analysis.calls || 0) > 0
        ? `${Number(analysis.calls)} 次尝试后本地降级` : '本地规则生成 · 未联网'}</span>` : '');

  const anomalies = Array.isArray(visuals.anomalies) ? visuals.anomalies : [];
  const evidenceCard = anomalies.length ? `<section class="ai-viz-card ai-evidence-card">
    <div class="ai-viz-title">异常证据 <span class="ai-viz-meta">本地确定性计算</span></div>
    <div class="ai-evidence-list">${anomalies.slice(0, 4).map((item) => `
      <div class="ai-evidence-row ${item.severity === 'high' ? 'high' : 'medium'}">
        <span>${item.severity === 'high' ? '高' : '中'}</span><p>${esc(item.message)}</p>
      </div>`).join('')}</div>
  </section>` : '';

  const history = Array.isArray(visuals.history) ? visuals.history : [];
  let historyCard = '';
  if (history.length >= 2) {
    const maxHistory = Math.max(1, ...history.map((item) => Math.max(Number(item.spent || 0), Number(item.budget || 0))));
    const bars = history.map((item) => {
      const spentHeight = Math.max(3, Math.round(Number(item.spent || 0) / maxHistory * 72));
      const budgetHeight = Math.max(3, Math.round(Number(item.budget || 0) / maxHistory * 72));
      return `<div class="ai-history-item" title="${esc(item.month)}：支出 ${money(item.spent)} / 预算 ${money(item.budget)}">
        <div class="ai-history-bars"><span class="budget" style="height:${budgetHeight}px"></span><span class="spent" style="height:${spentHeight}px"></span></div>
        <span>${esc(item.month.slice(5))}月</span>
      </div>`;
    }).join('');
    historyCard = `<section class="ai-viz-card">
      <div class="ai-viz-title">历史预算与支出</div>
      <div class="ai-history-chart">${bars}</div>
      <div class="ai-viz-legend"><span><i class="budget"></i>预算</span><span><i class="spent"></i>支出</span></div>
    </section>`;
  }

  return `<div class="ai-visuals">
    <section class="ai-viz-card">
      <div class="ai-viz-title">预算路径 ${agentNote}</div>
      <div class="ai-budget-main"><strong>${usagePct.toFixed(1)}%</strong><span>已用 · 剩余 ${money(budget.remaining)}</span></div>
      <div class="ai-budget-track">
        <span class="ai-budget-fill ${tone}" style="width:${fillWidth}%"></span>
        ${projectedValue > 0 ? `<span class="ai-budget-marker" style="left:${markerLeft}%" title="分类级预测 ${money(projectedValue)}"></span>` : ''}
      </div>
      <div class="ai-budget-foot"><span>预算 ${money(budgetValue)}</span><span>预测 ${money(projectedValue)} · 可信度${esc(confidence)}</span></div>
      ${projectedValue > 0 ? `<div class="ai-viz-hint">预测区间 ${money(projectedLower)}～${money(projectedUpper)}；按分类的工作日、周末节奏与历史基线计算。</div>` : ''}
      ${reasonText ? `<div class="ai-viz-hint">低可信度原因：${esc(reasonText)}</div>` : ''}
    </section>
    <section class="ai-viz-card">
      <div class="ai-viz-title">支出结构 Top ${categories.length}</div>
      <div class="ai-cat-list">${categoryRows}</div>
    </section>
    ${evidenceCard}
    ${historyCard}
  </div>`;
}

function aiReportHeadHtml(report, options) {
  const compact = Boolean(options && options.compact);
  const stats = report.stats || {};
  const mode = AI_MODE_TEXT[report.scope] || '分析';

  if (compact) {
    const remaining = Number(stats.remaining || 0);
    const brief = remaining < 0 ? `超支 ${money(-remaining)}` : `剩余 ${money(remaining)}`;
    return `
      <span class="ai-mode-chip ${report.scope}">${mode}</span>
      <span class="ai-report-time">${esc(report.created_at)}</span>
      <span class="muted-text">${esc(report.model)}</span>
      <span class="ai-report-brief">支出 ${money(stats.spent)} · ${brief}</span>`;
  }
  return `
    <span class="ai-mode-chip ${report.scope}">${mode}</span>
    <span class="muted-text">生成于 ${esc(report.created_at)}</span>
    <span class="muted-text">模型 ${esc(report.model)}</span>`;
}

function renderAi() {
  const cfg = state.ai || {};
  const month = state.month;
  const currentMonth = isoMonth(new Date());
  const isFuture = month > currentMonth;

  // 月份下拉：本月 + 所有有记录的月份
  const select = $('aiMonthSelect');
  const months = Array.from(new Set([
    currentMonth,
    month,
    ...(state.info && state.info.months ? state.info.months : []),
  ].filter(Boolean))).sort().reverse();
  select.innerHTML = months
    .map((m) => `<option value="${m}">${monthLabel(m)}${m === currentMonth ? '（本月）' : ''}</option>`)
    .join('');
  select.value = month;

  // 顶部状态提示
  const status = $('aiStatus');
  status.className = 'ai-status';
  if (!cfg.enabled) {
    status.innerHTML = '<div class="ai-note">联网 AI 当前关闭；仍可生成完全离线的本地规则报告。'
      + '<button class="link-btn" data-act="go-manage">配置联网 AI</button></div>';
  } else if (cfg.key_error) {
    status.innerHTML = `<div class="ai-note warn">${esc(cfg.key_error)} 本次可自动改用本地规则报告。`
      + '<button class="link-btn" data-act="go-manage">去重新填写</button></div>';
  } else if (!cfg.has_key) {
    status.innerHTML = '<div class="ai-note">还没有填写 API Key；点击分析会使用本地预测、异常检测和证据规则生成报告。'
      + '<button class="link-btn" data-act="go-manage">配置联网 AI</button></div>';
  } else if (isFuture) {
    status.innerHTML = `<div class="ai-note">${esc(monthLabel(month))}还没到，没有数据可以分析。</div>`;
  } else {
    status.innerHTML = '<div class="ai-note">当前使用 '
      + `<b>${esc(cfg.model)}</b> 分析 ${esc(monthLabel(month))} 的数据。`
      + '每次分析由 3 个专业角色并行审阅、总编汇总，通常调用接口 4 次，异常修复时最多 5 次。</div>';
  }

  // 结果区：展示该月最新的一份报告
  const reports = state.aiReports || [];
  const latest = reports.length ? reports[0] : null;
  const result = $('aiResult');
  const btn = $('btnAiAnalyze');
  btn.disabled = isFuture;
  btn.title = cfg.ready ? '' : '当前将使用完全离线的本地规则报告';

  if (latest) {
    result.innerHTML = `
      <div class="ai-report-head">${aiReportHeadHtml(latest)}
        ${rowAction('del-report', latest.id, 'remove', '删除这份报告')}
      </div>
      <div class="ai-report-stats">${aiReportStatsHtml(latest.stats)}</div>
      ${aiVisualsHtml(latest.stats)}
      <div class="ai-md">${mdToHtml(latest.content)}</div>`;
  } else {
    result.innerHTML = `<div class="empty"><span class="big">${uiIcon('sparkle')}</span>`
      + `${monthLabel(month)}还没有复盘报告<br>`
      + `${isFuture ? '等这个月开始了再来' : (cfg.ready ? '点右上角「开始复盘」生成一份' : '点右上角「开始复盘」生成离线规则报告')}</div>`;
  }

  // 历史报告列表
  const tip = $('aiReportTip');
  tip.textContent = reports.length ? `${monthLabel(month)} · ${reports.length} 份` : '';
  const list = $('aiReportList');
  if (!reports.length) {
    list.innerHTML = '<div class="empty" style="padding:26px 12px">'
      + '这个月还没有历史报告。用顶部的月份切换可以看其它月份的报告。</div>';
    return;
  }
  list.innerHTML = reports.map((report) => {
    const expanded = aiExpandedId === report.id;
    return `
      <div class="ai-report-item${expanded ? ' expanded' : ''}${report.id === state.selectedReportId ? ' selected' : ''}" data-id="${report.id}">
        <div class="ai-report-item-head">
          ${aiReportHeadHtml(report, { compact: true })}
          <span class="ai-report-ops">
            <button class="link-btn" data-act="toggle-report" data-id="${report.id}">${expanded ? '收起' : '查看'}</button>
            ${rowAction('del-report', report.id, 'remove', '删除')}
          </span>
        </div>
        ${expanded ? `${aiVisualsHtml(report.stats)}<div class="ai-md">${mdToHtml(report.content)}</div>` : ''}
      </div>`;
  }).join('');
}

/* ------------------------------------------------------------ 数据页 */

function renderDataInfo() {
  if (!state.info) return;
  $('dataInfo').innerHTML = `
    <div class="info-row"><span class="k">数据库文件</span><span class="v">${esc(state.info.db_path)}</span></div>
    <div class="info-row"><span class="k">CSV 导出目录</span><span class="v">${esc(state.info.export_dir || '')}</span></div>
    <div class="info-row"><span class="k">预警阈值</span><span class="v">${Math.round(state.threshold * 100)}%</span></div>
    <div class="info-row"><span class="k">运行方式</span><span class="v">本地单进程 · AI 功能按需联网</span></div>`;
}

/* -------------------------------------------------------- 统一刷新 */

function renderAll() {
  renderFilterSelects();
  renderRecords();
  renderOverview();
  renderRecentRecords();
  renderHistory(state.history);
  renderBudgetTable();
  renderAiConfigInfo();
  renderAi();
  renderDataInfo();
}
