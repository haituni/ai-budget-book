/* ==================================================================
   表单弹窗：记一笔 / 编辑流水 / 新增编辑分类 / 调整本月预算 / AI 设置
   ================================================================== */

function categoryOptionsHtml(selectedId) {
  const placeholder = selectedId ? '' : '<option value="">请选择分类</option>';
  return placeholder + state.categories.map((c) => {
    const selected = String(c.id) === String(selectedId) ? 'selected' : '';
    return `<option value="${c.id}" ${selected}>${esc(c.name)}</option>`;
  }).join('');
}

function defaultDateForCurrentMonth() {
  return state.month === isoMonth(new Date()) ? todayStr() : `${state.month}-01`;
}

async function openExpenseModal(expense) {
  const editing = Boolean(expense);
  if (!state.categories.length) {
    toast('请先在「预算」里新增至少一个分类', 'err');
    return;
  }

  const dateValue = editing ? expense.spent_on : defaultDateForCurrentMonth();
  const categoryValue = editing ? expense.category_id : '';
  const amountValue = editing ? Number(expense.amount).toFixed(2) : '';
  const noteValue = editing ? esc(expense.note || '') : '';

  await formModal({
    title: editing ? '修改消费记录' : '记一笔消费',
    confirmText: editing ? '保存修改' : '保存',
    bodyHtml: `
      <div class="field">
        <label>消费日期</label>
        <input type="date" id="fDate" value="${dateValue}">
      </div>
      <div class="field">
        <label>分类</label>
        <select id="fCategory">${categoryOptionsHtml(categoryValue)}</select>
      </div>
      <div class="field">
        <label>金额（元）</label>
        <input type="number" id="fAmount" step="0.01" min="0.01" placeholder="0.00" value="${amountValue}">
      </div>
      <div class="field">
        <label>备注（可选）</label>
        <input type="text" id="fNote" maxlength="100" placeholder="例如：食堂午饭" value="${noteValue}">
        <div id="fSuggestion" class="smart-suggestion hidden"></div>
      </div>`,
    validate: (mask) => {
      const spentOn = mask.querySelector('#fDate').value;
      const categoryId = mask.querySelector('#fCategory').value;
      const amountRaw = mask.querySelector('#fAmount').value;
      const note = mask.querySelector('#fNote').value;
      if (!spentOn) throw new Error('请选择消费日期');
      if (!categoryId) throw new Error('请选择消费分类');
      if (amountRaw === '' || Number.isNaN(Number(amountRaw))) throw new Error('请填写金额');
      if (Number(amountRaw) <= 0) throw new Error('金额必须大于 0');
      return {
        spent_on: spentOn,
        category_id: Number(categoryId),
        amount: Number(amountRaw),
        note: note,
        suggested_category_id: mask.dataset.suggestedCategoryId
          ? Number(mask.dataset.suggestedCategoryId) : null,
      };
    },
    onSubmit: async (payload) => {
      if (editing) {
        await call('update_expense', Object.assign({ id: expense.id }, payload));
      } else {
        await call('add_expense', payload);
      }
      await refreshAll();
      toast(editing ? '已保存修改' : '已记录一笔消费', 'ok');
    },
    onReady: (mask) => {
      const noteInput = mask.querySelector('#fNote');
      const amountInput = mask.querySelector('#fAmount');
      const categorySelect = mask.querySelector('#fCategory');
      const suggestionBox = mask.querySelector('#fSuggestion');
      let timer = null;
      let requestId = 0;

      const clearSuggestion = () => {
        delete mask.dataset.suggestedCategoryId;
        suggestionBox.className = 'smart-suggestion hidden';
        suggestionBox.innerHTML = '';
      };
      const loadSuggestion = async () => {
        const note = noteInput.value.trim();
        if (note.length < 2) {
          clearSuggestion();
          return;
        }
        const currentRequest = ++requestId;
        try {
          const result = await call('suggest_category', note, amountInput.value || null);
          if (!mask.isConnected || currentRequest !== requestId) return;
          const suggestion = result && result.suggestion;
          if (!suggestion) {
            clearSuggestion();
            return;
          }
          mask.dataset.suggestedCategoryId = String(suggestion.category_id);
          suggestionBox.className = 'smart-suggestion';
          suggestionBox.innerHTML = `<div class="smart-suggestion-row">
            <span>智能建议：<b>${esc(suggestion.category_name)}</b> · 置信度${esc(suggestion.confidence_text)}</span>
            <button type="button" class="link-btn" data-act="apply-suggestion">采用建议</button>
          </div><div class="reason">${esc(suggestion.reason)}</div>`;
        } catch (err) {
          clearSuggestion();
        }
      };
      const scheduleSuggestion = () => {
        clearSuggestion();
        clearTimeout(timer);
        timer = setTimeout(loadSuggestion, 280);
      };

      noteInput.addEventListener('input', scheduleSuggestion);
      amountInput.addEventListener('change', scheduleSuggestion);
      suggestionBox.addEventListener('click', (event) => {
        const button = event.target.closest('[data-act="apply-suggestion"]');
        if (!button || !mask.dataset.suggestedCategoryId) return;
        categorySelect.value = mask.dataset.suggestedCategoryId;
        button.textContent = '已采用';
        button.disabled = true;
      });
      if (noteInput.value.trim()) loadSuggestion();
    },
  });
}

async function openSmartExpenseModal(initialText = '') {
  if (!state.categories.length) {
    toast('请先在「预算」里新增至少一个分类', 'err');
    return;
  }
  return formModal({
    title: 'AI 记账 · 一次输入多笔',
    confirmText: '确认保存',
    bodyHtml: `
      <div class="field smart-entry-box">
        <label>用自然语言描述消费</label>
        <textarea id="smartExpenseText" maxlength="1000" placeholder="例如：今晚食堂 18，买书 46；昨天打车 22"></textarea>
        <span class="desc">内容会发送给你在设置中配置的大模型解析。结果会先列出来，确认日期、分类和金额后才保存。</span>
        <div class="smart-entry-tools">
          <button type="button" class="ghost-btn" id="btnParseExpenseText">交给大模型解析</button>
          <span class="smart-entry-warning" id="smartExpenseWarning"></span>
        </div>
      </div>
      <div class="smart-entry-list" id="smartExpenseRows"></div>`,
    validate: (mask) => {
      const rows = Array.from(mask.querySelectorAll('.smart-entry-row'));
      if (!rows.length) throw new Error('请先点击“解析内容”，并至少保留一笔记录');
      return {
        items: rows.map((row) => {
          const spentOn = row.querySelector('[data-field="date"]').value;
          const categoryId = row.querySelector('[data-field="category"]').value;
          const amount = Number(row.querySelector('[data-field="amount"]').value);
          const note = row.querySelector('[data-field="note"]').value.trim();
          if (!spentOn) throw new Error('每一笔都必须有消费日期');
          if (!categoryId) throw new Error('请为每一笔选择分类');
          if (!Number.isFinite(amount) || amount <= 0) throw new Error('每一笔金额都必须大于 0');
          return {
            spent_on: spentOn,
            category_id: Number(categoryId),
            amount,
            note,
            suggested_category_id: row.dataset.suggestedCategoryId
              ? Number(row.dataset.suggestedCategoryId) : null,
          };
        }),
      };
    },
    onSubmit: async (payload) => {
      const result = await call('add_expenses_batch', payload);
      await refreshAll();
      toast(`已记录 ${result.count} 笔消费`, 'ok');
    },
    onReady: (mask) => {
      const textInput = mask.querySelector('#smartExpenseText');
      const parseButton = mask.querySelector('#btnParseExpenseText');
      const rowsBox = mask.querySelector('#smartExpenseRows');
      const warningBox = mask.querySelector('#smartExpenseWarning');

      const parse = async () => {
        parseButton.disabled = true;
        parseButton.textContent = '大模型解析中…';
        warningBox.textContent = '';
        try {
          const result = await call('parse_expense_text', textInput.value, defaultDateForCurrentMonth());
          rowsBox.innerHTML = result.items.map((item, index) => `
            <div class="smart-entry-row" data-suggested-category-id="${item.suggested_category_id || ''}">
              <input type="date" data-field="date" value="${esc(item.spent_on)}" title="消费日期">
              <select data-field="category">${categoryOptionsHtml(item.category_id)}</select>
              <input type="number" data-field="amount" step="0.01" min="0.01" value="${Number(item.amount).toFixed(2)}" title="金额">
              <input type="text" data-field="note" maxlength="100" value="${esc(item.note)}" title="备注">
              <button type="button" class="link-btn danger" data-act="remove-smart-row">移除</button>
              <div class="smart-entry-reason">第 ${index + 1} 笔 · ${esc(item.reason)}${item.confidence ? ` · 分类置信度${esc(item.confidence)}` : ''}</div>
            </div>`).join('');
          // 账单列表在弹窗下半部分：手机/矮屏上先把它滚进可视区，
          // 否则会出现「点了解析却看不到生成的账单」
          const firstRow = rowsBox.querySelector('.smart-entry-row');
          if (firstRow) firstRow.scrollIntoView({ block: 'nearest' });
          warningBox.textContent = (result.warnings || []).join('；');
        } catch (err) {
          rowsBox.innerHTML = '';
          warningBox.textContent = err.message;
        } finally {
          parseButton.disabled = false;
          parseButton.textContent = '交给大模型重新解析';
        }
      };
      parseButton.onclick = parse;
      rowsBox.addEventListener('click', (event) => {
        const button = event.target.closest('[data-act="remove-smart-row"]');
        if (button) button.closest('.smart-entry-row').remove();
      });
      if (String(initialText || '').trim()) {
        textInput.value = String(initialText).trim();
        parse();
      }
    },
  });
}

async function openBudgetPlanModal() {
  const currentMonth = isoMonth(new Date());
  const baseMonth = state.month > currentMonth ? state.month : currentMonth;
  const targetMonth = shiftMonth(baseMonth, 1);
  const draft = await call('budget_draft', targetMonth, 6);
  const historyText = draft.history_months.length
    ? `参考 ${draft.history_months.join('、')}` : '暂无历史月份，沿用当前默认预算';

  await formModal({
    title: `预算草案 · ${monthLabel(targetMonth)}`,
    confirmText: '应用到该月',
    bodyHtml: `
      <div class="field"><span class="desc">${historyText}。所有金额均可编辑；确认后只写入
      <b>${monthLabel(targetMonth)}</b> 的月度预算，不修改默认预算，也不影响历史月份。</span></div>
      <div class="budget-draft-list">
        ${draft.items.map((item) => `
          <div class="budget-draft-row" data-category-id="${item.category_id}">
            <div><b>${esc(item.category_name)}</b><br><span class="profile-tag ${esc(item.spending_type)}">${esc(item.spending_type_text)}</span></div>
            <div class="muted-text">历史月均<br>${money(item.history_average)}</div>
            <input type="number" data-field="budget" min="0" step="0.01" value="${Number(item.proposed).toFixed(2)}">
            <div class="budget-draft-reason">${esc(item.reason)} · 置信度${esc(item.confidence)}</div>
          </div>`).join('')}
      </div>
      <div class="hint">当前默认预算合计 ${money(draft.totals.current_default)}；草案合计 ${money(draft.totals.proposed)}。</div>`,
    validate: (mask) => ({
      target_month: targetMonth,
      items: Array.from(mask.querySelectorAll('.budget-draft-row')).map((row) => {
        const amount = Number(row.querySelector('[data-field="budget"]').value);
        if (!Number.isFinite(amount) || amount < 0) throw new Error('预算金额不能为负数');
        return { category_id: Number(row.dataset.categoryId), amount };
      }),
    }),
    onSubmit: async (payload) => {
      const result = await call('apply_budget_draft', payload);
      await refreshAll();
      toast(`已为 ${monthLabel(result.target_month)} 应用 ${result.applied_count} 个分类预算`, 'ok', 5000);
    },
  });
}

async function openCategoryModal(category) {
  const editing = Boolean(category);
  const isSystem = Boolean(category && category.is_system);
  const nameValue = editing ? esc(category.name) : '';
  const budgetValue = editing ? Number(category.monthly_budget).toFixed(2) : '';
  const spendingTypeValue = editing ? (category.spending_type || 'unknown') : 'unknown';
  const nameDisabled = isSystem ? 'disabled' : '';
  const systemNote = isSystem
    ? `<span class="desc">系统默认分类名称固定为「${esc(category.name)}」，不可改名或删除。
       删除其它分类时，其历史流水会自动转入这里。</span>`
    : '';

  await formModal({
    title: editing ? '编辑分类' : '新增分类',
    confirmText: editing ? '保存修改' : '创建',
    bodyHtml: `
      <div class="field">
        <label>分类名称</label>
        <input type="text" id="cName" maxlength="20" placeholder="例如：伙食费" value="${nameValue}" ${nameDisabled}>
        ${systemNote}
      </div>
      <div class="field">
        <label>默认月度预算（元）</label>
        <input type="number" id="cBudget" step="0.01" min="0" placeholder="0.00" value="${budgetValue}">
        <span class="desc">每月自动沿用这个金额。某个月要单独调整时，到「概览」点该分类的「本月预算」。</span>
      </div>
      <div class="field">
        <label>消费属性</label>
        <select id="cSpendingType">
          <option value="unknown" ${spendingTypeValue === 'unknown' ? 'selected' : ''}>未标记</option>
          <option value="essential" ${spendingTypeValue === 'essential' ? 'selected' : ''}>必要支出</option>
          <option value="flexible" ${spendingTypeValue === 'flexible' ? 'selected' : ''}>可调整</option>
          <option value="occasional" ${spendingTypeValue === 'occasional' ? 'selected' : ''}>偶发支出</option>
        </select>
        <span class="desc">由你定义消费性质，系统不会根据分类名称擅自判断是否“必要”。</span>
      </div>`,
    validate: (mask) => {
      const name = mask.querySelector('#cName').value.trim();
      const budgetRaw = mask.querySelector('#cBudget').value;
      if (!isSystem && !name) throw new Error('分类名称不能为空');
      if (budgetRaw === '' || Number.isNaN(Number(budgetRaw))) {
        throw new Error('请填写默认月度预算（没有预算可填 0）');
      }
      if (Number(budgetRaw) < 0) throw new Error('预算不能为负数');
      return {
        name: isSystem ? category.name : name,
        budget: Number(budgetRaw),
        spending_type: mask.querySelector('#cSpendingType').value,
      };
    },
    onSubmit: async (payload) => {
      if (editing) {
        await call('update_category', Object.assign({ id: category.id }, payload));
      } else {
        await call('add_category', payload);
      }
      await refreshAll();
      toast(editing ? '分类已更新' : '分类已创建', 'ok');
    },
  });
}

async function openMonthBudgetModal(categoryId) {
  const detail = state.overview
    ? state.overview.categories.find((item) => item.id === categoryId)
    : null;
  const cat = state.categories.find((c) => c.id === categoryId);
  if (!detail || !cat) return;
  const archived = detail.budget_source === 'auto';

  await formModal({
    title: `调整本月预算 · ${detail.name}`,
    confirmText: '保存',
    bodyHtml: `
      <div class="field">
        <span class="desc">只调整 <b>${monthLabel(state.month)}</b> 这一个月，不会改动默认月度预算。
        ${archived ? '这个月已经结束并归档，当前显示的就是当月生效的预算。' : ''}</span>
      </div>
      <div class="field">
        <label>${monthLabel(state.month)} 的预算（元）</label>
        <input type="number" id="mBudget" step="0.01" min="0" value="${Number(detail.budget).toFixed(2)}">
      </div>
      <div class="field">
        <label style="display:flex;gap:8px;align-items:center;font-weight:500">
          <input type="checkbox" id="mUseDefault" ${detail.budget_is_override ? '' : 'checked'}>
          ${archived ? '改用当前默认预算' : '沿用默认预算'}（${money(cat.monthly_budget)}）
        </label>
        <span class="desc">${archived
          ? '勾选后，该月会重新跟随分类的当前默认预算（已归档的历史数字会跟着变）。'
          : '勾选后，该月不再使用单独设置，直接跟随默认预算。'}</span>
      </div>`,
    validate: (mask) => {
      const useDefault = mask.querySelector('#mUseDefault').checked;
      if (useDefault) return { amount: null };
      const raw = mask.querySelector('#mBudget').value;
      if (raw === '' || Number.isNaN(Number(raw))) throw new Error('请填写本月预算');
      if (Number(raw) < 0) throw new Error('预算不能为负数');
      return { amount: Number(raw) };
    },
    onSubmit: async (payload) => {
      await call('set_month_budget', {
        category_id: categoryId,
        month: state.month,
        amount: payload.amount,
      });
      await refreshAll();
      toast('本月预算已更新', 'ok');
    },
  });
}

async function deleteCategoryFlow(category) {
  const confirmed = await confirmModal({
    title: '删除分类',
    danger: true,
    confirmText: '确认删除',
    messageHtml: `确定要删除分类 <b>${esc(category.name)}</b> 吗？<br><br>
      该分类下的<b>历史消费记录不会被删除</b>，会自动归入系统默认分类「其他」，保证统计数据不丢失。`,
  });
  if (!confirmed) return;
  try {
    const result = await call('delete_category', category.id);
    await refreshAll();
    toast(
      result.moved_count > 0
        ? `已删除「${result.deleted}」，${result.moved_count} 笔流水已转入「${result.moved_to}」`
        : `已删除「${result.deleted}」`,
      'ok',
    );
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function deleteExpenseFlow(row) {
  const noteLine = row.note
    ? `<br><span class="muted-text">${esc(row.note)}</span>`
    : '';
  const confirmed = await confirmModal({
    title: '删除消费记录',
    danger: true,
    confirmText: '确认删除',
    messageHtml: `确定删除这条记录吗？<br><br>
      ${esc(row.spent_on)} · ${esc(row.category_name)} · <b>${money(row.amount)}</b>${noteLine}`,
  });
  if (!confirmed) return;
  try {
    await call('delete_expense', row.id);
    await refreshAll();
    toast('已删除该条记录', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ------------------------------------------------------------ AI 设置 */

async function openAiConfigModal() {
  const cfg = state.ai || {};
  const keyPlaceholder = cfg.has_key ? '已保存，留空表示不修改' : '粘贴你的 API Key';
  const keyDesc = cfg.has_key
    ? `已保存${cfg.key_hint ? ` ${esc(cfg.key_hint)}` : ''}，留空即保持不变。`
    : '只保存在本机：用 Windows 系统自带的加密写入数据库，明文不落盘。';

  // 表单里的值既用来「测试连接」，也用来「保存」，抽出来共用
  const readFields = (mask) => ({
    base_url: mask.querySelector('#aBase').value.trim(),
    model: mask.querySelector('#aModel').value.trim(),
    api_key: mask.querySelector('#aKey').value.trim(),
    enabled: mask.querySelector('#aEnabled').checked,
    clear_api_key: mask.dataset.clearKey === '1',
  });

  await formModal({
    title: 'AI 服务设置',
    confirmText: '保存',
    bodyHtml: `
      <div class="field">
        <label>接口地址（base_url）</label>
        <input type="text" id="aBase" placeholder="${esc(cfg.default_base_url || 'https://api.deepseek.com/v1')}"
               value="${esc(cfg.base_url || '')}">
        <span class="desc">OpenAI 兼容接口，通常以 <b>/v1</b> 结尾；程序会自动补上 <b>/chat/completions</b>。</span>
      </div>
      <div class="field">
        <label>模型名</label>
        <input type="text" id="aModel" placeholder="${esc(cfg.default_model || 'deepseek-chat')}"
               value="${esc(cfg.model || '')}">
        <span class="desc">例如 deepseek-chat、moonshot-v1-8k、qwen-plus、gpt-4o-mini。</span>
      </div>
      <div class="field">
        <label style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <span>API Key</span>
          ${cfg.has_key ? '<button type="button" class="link-btn danger" id="aClearKey">清除</button>' : ''}
        </label>
        <input type="password" id="aKey" autocomplete="off" spellcheck="false" placeholder="${esc(keyPlaceholder)}">
        <span class="desc">${keyDesc}</span>
      </div>
      <div class="field">
        <label style="display:flex;gap:8px;align-items:center;font-weight:500">
          <input type="checkbox" id="aEnabled" ${cfg.enabled ? 'checked' : ''}>
          启用联网 AI
        </label>
        <span class="desc">关掉后，AI 记账和 AI 月度复盘都不会发送联网请求。</span>
      </div>
      <div class="ai-test-row">
        <button class="ghost-btn" type="button" id="aTest">测试连接</button>
        <span class="ai-test-result" id="aTestResult"></span>
      </div>
      <div class="field">
        <span class="desc warning-text">
          提醒：AI 记账会发送输入文本和分类名称；AI 月度复盘会发送所选月份的预算和流水（含备注）；
          本程序其余功能仍然完全离线。
        </span>
      </div>`,
    onReady: (mask) => {
      const testBtn = mask.querySelector('#aTest');
      const out = mask.querySelector('#aTestResult');
      const clearBtn = mask.querySelector('#aClearKey');
      const keyInput = mask.querySelector('#aKey');

      const setOut = (text, kind) => {
        out.className = `ai-test-result${kind ? ' ' + kind : ''}`;
        out.textContent = text;
      };

      if (clearBtn) {
        clearBtn.onclick = () => {
          const marked = mask.dataset.clearKey === '1';
          mask.dataset.clearKey = marked ? '0' : '1';
          keyInput.value = '';
          keyInput.disabled = !marked;
          clearBtn.textContent = marked ? '清除' : '取消清除';
          setOut(marked ? '' : '保存后会清空已保存的 API Key');
        };
      }

      testBtn.onclick = async () => {
        const payload = readFields(mask);
        if (!payload.base_url) {
          setOut('请先填写接口地址', 'err');
          return;
        }
        if (!payload.model) {
          setOut('请先填写模型名', 'err');
          return;
        }
        testBtn.disabled = true;
        testBtn.textContent = '测试中…';
        setOut('正在请求接口，通常几秒到十几秒…');
        try {
          const res = await call('test_ai_config', payload);
          setOut(`连接成功：${res.model} 回复「${res.reply}」`, 'ok');
        } catch (err) {
          setOut(err.message, 'err');
        } finally {
          testBtn.disabled = false;
          testBtn.textContent = '测试连接';
        }
      };
    },
    validate: (mask) => {
      const payload = readFields(mask);
      if (!payload.base_url) throw new Error('请填写接口地址');
      if (!/^https?:\/\//i.test(payload.base_url)) {
        throw new Error('接口地址要以 http:// 或 https:// 开头');
      }
      if (!payload.model) throw new Error('请填写模型名');
      return payload;
    },
    onSubmit: async (payload) => {
      await call('save_ai_config', payload);
      await refreshAll();
      toast('AI 设置已保存', 'ok');
    },
  });
}

async function deleteAiReportFlow(report) {
  const confirmed = await confirmModal({
    title: '删除复盘报告',
    danger: true,
    confirmText: '确认删除',
    messageHtml: `确定删除 <b>${esc(monthLabel(report.month))}</b> 的这份复盘报告吗？<br><br>
      <span class="muted-text">生成于 ${esc(report.created_at)} · 模型 ${esc(report.model)}</span><br>
      删除后无法恢复（只删报告，不影响你的记账数据）。`,
  });
  if (!confirmed) return;
  try {
    await call('delete_ai_report', report.id);
    if (aiExpandedId === report.id) aiExpandedId = null;
    await refreshAiReports();
    renderAi();
    toast('已删除该报告', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ==================================================================
   选中行与右键菜单

   macOS 的列表基本都是这一套：单击选中（↑↓ 换行、回车打开编辑、双击直接编辑）、
   右键弹出上下文菜单。这里把三种列表（流水 / 分类 / 复盘报告）共用的部分抽出来。
   ================================================================== */

/** 选中某一行：只切类名，不重排 DOM，避免滚动位置跳掉。 */
function selectRow(container, id, property) {
  state[property] = id;
  document.querySelectorAll(`${container} .selected`)
    .forEach((el) => el.classList.remove('selected'));
  const row = document.querySelector(`${container} [data-id="${id}"]`);
  if (row) row.classList.add('selected');
  return row;
}

function expenseMenuItems(row) {
  return [
    { label: '编辑…', run: () => openExpenseModal(row) },
    {
      label: '复制备注',
      disabled: !String(row.note || '').trim(),
      run: () => copyText(row.note, '已复制备注'),
    },
    { separator: true },
    { label: '删除…', danger: true, run: () => deleteExpenseFlow(row) },
  ];
}

function categoryMenuItems(item) {
  const cat = state.categories.find((c) => c.id === item.id);
  const items = [{ label: '调整本月预算…', run: () => openMonthBudgetModal(item.id) }];
  if (!cat) return items;
  items.push({ label: '编辑分类…', run: () => openCategoryModal(cat) });
  items.push({ separator: true });
  items.push(cat.is_system
    ? { label: '系统分类不可删除', disabled: true }
    : { label: '删除分类…', danger: true, run: () => deleteCategoryFlow(cat) });
  return items;
}

function budgetMenuItems(cat) {
  return [
    { label: '编辑分类…', run: () => openCategoryModal(cat) },
    { label: '调整本月预算…', disabled: true },
    { separator: true },
    cat.is_system
      ? { label: '系统分类不可删除', disabled: true }
      : { label: '删除分类…', danger: true, run: () => deleteCategoryFlow(cat) },
  ];
}

function reportMenuItems(report) {
  const expanded = aiExpandedId === report.id;
  return [
    {
      label: expanded ? '收起' : '查看',
      run: () => {
        aiExpandedId = expanded ? null : report.id;
        renderAi();
      },
    },
    {
      label: '复制报告正文',
      disabled: !String(report.content || '').trim(),
      run: () => copyText(report.content, '已复制报告正文'),
    },
    { separator: true },
    { label: '删除…', danger: true, run: () => deleteAiReportFlow(report) },
  ];
}
