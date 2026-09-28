"""P3 助手：大模型自然语言记账、本地账本问答与预算草案。"""

from __future__ import annotations

import calendar
import math
from collections import defaultdict
from datetime import datetime
from statistics import median

from . import ai, intelligence, memory, repo, service
from .db import connect, now_str, parse_month


def _shift_month(month: str, delta: int) -> str:
    clean = parse_month(month)
    year, mon = int(clean[:4]), int(clean[5:7])
    index = year * 12 + mon - 1 + delta
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def parse_expense_text(text: str, default_date: str) -> dict:
    """让已配置的大模型把自然语言解析成可编辑的待确认流水。"""
    return ai.parse_expense_text(text, default_date)



def answer_ledger(question: str, month: str) -> dict:
    return ai.answer_ledger(question, month)
def _proposed_budget(spending_type: str, totals: list[float], current_budget: float) -> tuple[float, str]:
    if not totals or not any(totals):
        return round(current_budget, 2), "历史样本不足，暂时沿用当前默认预算"
    average = sum(totals) / len(totals)
    middle = float(median(totals))
    active = [value for value in totals if value > 0]
    active_average = sum(active) / len(active) if active else 0.0
    if spending_type == "essential":
        base = max(average, middle, active_average * 0.95)
        proposed = max(current_budget, base * 1.05)
        reason = "必要支出按历史稳定水平加 5% 缓冲，且不低于当前预算"
    elif spending_type == "flexible":
        proposed = (average + middle) / 2
        reason = "可调整支出采用历史月均与中位数的中间值"
    elif spending_type == "occasional":
        proposed = average * 1.10
        reason = "偶发支出按含零月份的历史月均加 10% 缓冲"
    else:
        proposed = (average + middle) / 2
        reason = "未标记分类采用历史月均与中位数的中间值"
    if proposed <= 0:
        return 0.0, reason
    # 110 * 1.1 可能得到 110.00000000000001，先消掉浮点尾差再向上取整。
    rounded = math.ceil((proposed - 1e-9) / 10) * 10
    return round(rounded, 2), reason


def budget_draft(target_month: str, history_limit: int = 6) -> dict:
    target = parse_month(target_month)
    current_month = datetime.now().strftime("%Y-%m")
    if target < current_month:
        raise ValueError("预算草案只能用于当前或未来月份")
    history_limit = max(1, min(int(history_limit), 12))
    categories = repo.list_categories()
    all_rows = repo.list_expenses()
    months = sorted({str(row["month"]) for row in all_rows if str(row["month"]) < target}, reverse=True)[:history_limit]
    items = []
    for category in categories:
        cid = int(category["id"])
        month_totals = [
            round(sum(float(row["amount"]) for row in all_rows if int(row["category_id"]) == cid and str(row["month"]) == month), 2)
            for month in months
        ]
        amount, reason = _proposed_budget(
            category.get("spending_type") or "unknown",
            month_totals,
            float(category["monthly_budget"]),
        )
        active_months = sum(1 for value in month_totals if value > 0)
        confidence = "高" if len(months) >= 4 and active_months >= 3 else "中" if len(months) >= 2 else "低"
        items.append({
            "category_id": cid,
            "category_name": category["name"],
            "spending_type": category.get("spending_type") or "unknown",
            "spending_type_text": memory.SPENDING_TYPE_TEXT.get(category.get("spending_type") or "unknown", "未标记"),
            "current_default": round(float(category["monthly_budget"]), 2),
            "proposed": amount,
            "history_average": round(sum(month_totals) / len(month_totals), 2) if month_totals else 0.0,
            "active_months": active_months,
            "sample_months": len(months),
            "confidence": confidence,
            "reason": reason,
        })
    return {
        "target_month": target,
        "history_months": months,
        "items": items,
        "totals": {
            "current_default": round(sum(float(item["current_default"]) for item in items), 2),
            "proposed": round(sum(float(item["proposed"]) for item in items), 2),
        },
    }


def apply_budget_draft(target_month: str, items: list[dict]) -> dict:
    target = parse_month(target_month)
    current_month = datetime.now().strftime("%Y-%m")
    if target < current_month:
        raise ValueError("不能把预算草案应用到已经过去的月份")
    if not items:
        raise ValueError("预算草案没有可应用的分类")
    cleaned = []
    for item in items:
        cid = int(item.get("category_id"))
        amount = repo._clean_amount(item.get("amount"))
        cleaned.append((cid, amount))
    with connect() as con:
        valid = {int(row["id"]) for row in con.execute("SELECT id FROM categories").fetchall()}
        if any(cid not in valid for cid, _ in cleaned):
            raise ValueError("预算草案中包含已删除的分类，请重新生成")
        stamp = now_str()
        for cid, amount in cleaned:
            con.execute(
                "INSERT INTO budget_overrides(category_id, month, amount, source, created_at) "
                "VALUES (?, ?, ?, 'user', ?) ON CONFLICT(category_id, month) "
                "DO UPDATE SET amount = excluded.amount, source = 'user', created_at = excluded.created_at",
                (cid, target, amount, stamp),
            )
    return {"target_month": target, "applied_count": len(cleaned), "total": round(sum(amount for _, amount in cleaned), 2)}
