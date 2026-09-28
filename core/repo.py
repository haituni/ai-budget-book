"""数据访问层：分类、月度预算覆盖、消费流水的增删改查。"""

from __future__ import annotations

import sqlite3

from .db import (
    DEFAULT_CATEGORY_NAME,
    connect,
    freeze_past_months,
    frozen_months,
    now_str,
    parse_date,
    parse_month,
)
from .memory import clean_spending_type

MAX_AMOUNT = 100_000_000.0


def _clean_amount(value, *, allow_zero: bool = True) -> float:
    try:
        amount = round(float(value), 2)
    except (TypeError, ValueError) as exc:
        raise ValueError("金额必须是数字") from exc
    if amount < 0 or (amount == 0 and not allow_zero):
        raise ValueError("金额必须大于 0" if not allow_zero else "金额不能为负数")
    if amount > MAX_AMOUNT:
        raise ValueError("金额数值过大，请检查是否填错")
    return amount


def _clean_name(value: str) -> str:
    name = (value or "").strip()
    if not name:
        raise ValueError("分类名称不能为空")
    if len(name) > 20:
        raise ValueError("分类名称最长 20 个字")
    return name


def _to_dict(row: sqlite3.Row) -> dict:
    return {key: row[key] for key in row.keys()}


# --------------------------------------------------------------------------- 分类


def list_categories() -> list[dict]:
    with connect() as con:
        rows = con.execute(
            "SELECT id, name, monthly_budget, spending_type, is_system, sort_order "
            "FROM categories ORDER BY sort_order, id"
        ).fetchall()
    return [_to_dict(row) for row in rows]


def get_category(category_id: int) -> dict | None:
    with connect() as con:
        row = con.execute(
            "SELECT id, name, monthly_budget, spending_type, is_system, sort_order "
            "FROM categories WHERE id = ?",
            (int(category_id),),
        ).fetchone()
    return _to_dict(row) if row else None


def default_category_id(con: sqlite3.Connection) -> int:
    row = con.execute(
        "SELECT id FROM categories WHERE is_system = 1 ORDER BY id LIMIT 1"
    ).fetchone()
    if row is None:
        raise RuntimeError(f"系统默认分类「{DEFAULT_CATEGORY_NAME}」丢失，请检查数据库")
    return int(row["id"])


def add_category(name: str, monthly_budget, spending_type="unknown") -> int:
    clean_name = _clean_name(name)
    budget = _clean_amount(monthly_budget)
    clean_type = clean_spending_type(spending_type)
    with connect() as con:
        # 先把已经过去的月份归档，新分类不会追溯到那些月份
        freeze_past_months(con)
        exists = con.execute(
            "SELECT 1 FROM categories WHERE name = ?", (clean_name,)
        ).fetchone()
        if exists:
            raise ValueError(f"已经有一个叫「{clean_name}」的分类了")
        order_row = con.execute(
            "SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories WHERE is_system = 0"
        ).fetchone()
        sort_order = int(order_row["m"]) + 10
        cur = con.execute(
            "INSERT INTO categories"
            "(name, monthly_budget, spending_type, is_system, sort_order, created_at) "
            "VALUES (?, ?, ?, 0, ?, ?)",
            (clean_name, budget, clean_type, sort_order, now_str()),
        )
        new_id = int(cur.lastrowid)
        # 这个分类在已归档的月份里并不存在，补一条 0 预算占位，
        # 以后给它设默认预算也不会反改那些月份的历史数字
        stamp = now_str()
        for month in frozen_months(con):
            con.execute(
                "INSERT OR IGNORE INTO budget_overrides"
                "(category_id, month, amount, source, created_at) "
                "VALUES (?, ?, 0, 'auto', ?)",
                (new_id, month, stamp),
            )
        return new_id


def update_category(category_id: int, name: str, monthly_budget, spending_type="unknown") -> None:
    budget = _clean_amount(monthly_budget)
    clean_type = clean_spending_type(spending_type) if spending_type not in (None, "") else None
    with connect() as con:
        # 改默认预算前先归档，避免顺手改写往月的历史数字
        freeze_past_months(con)
        row = con.execute(
            "SELECT id, is_system, spending_type FROM categories WHERE id = ?", (int(category_id),)
        ).fetchone()
        if row is None:
            raise ValueError("要修改的分类不存在")
        if clean_type is None:
            clean_type = clean_spending_type(row["spending_type"])

        if int(row["is_system"]) == 1:
            # 系统默认分类只允许改预算，名称固定
            con.execute(
                "UPDATE categories SET monthly_budget = ?, spending_type = ? WHERE id = ?",
                (budget, clean_type, int(category_id)),
            )
            return

        clean_name = _clean_name(name)
        duplicated = con.execute(
            "SELECT 1 FROM categories WHERE name = ? AND id <> ?",
            (clean_name, int(category_id)),
        ).fetchone()
        if duplicated:
            raise ValueError(f"已经有一个叫「{clean_name}」的分类了")
        con.execute(
            "UPDATE categories SET name = ?, monthly_budget = ?, spending_type = ? WHERE id = ?",
            (clean_name, budget, clean_type, int(category_id)),
        )


def delete_category(category_id: int) -> dict:
    """删除分类，并把该分类下的历史流水全部转入系统默认分类「其他」。"""
    with connect() as con:
        freeze_past_months(con)
        row = con.execute(
            "SELECT id, name, is_system FROM categories WHERE id = ?",
            (int(category_id),),
        ).fetchone()
        if row is None:
            raise ValueError("要删除的分类不存在")
        if int(row["is_system"]) == 1:
            raise ValueError(
                f"「{DEFAULT_CATEGORY_NAME}」是系统默认分类，不能删除"
            )

        target_id = default_category_id(con)
        # 已归档月份里，该分类的预算并入「其他」，那些月份的预算总额保持不变
        _carry_archived_budget(con, int(category_id), target_id)
        moved = con.execute(
            "SELECT COUNT(*) AS c FROM expenses WHERE category_id = ?",
            (int(category_id),),
        ).fetchone()["c"]
        con.execute(
            "UPDATE expenses SET category_id = ?, updated_at = ? WHERE category_id = ?",
            (target_id, now_str(), int(category_id)),
        )
        # budget_overrides 由外键 ON DELETE CASCADE 自动清理
        con.execute("DELETE FROM categories WHERE id = ?", (int(category_id),))
        return {
            "deleted": row["name"],
            "moved_count": int(moved),
            "moved_to": DEFAULT_CATEGORY_NAME,
        }


# ------------------------------------------------------------------ 月度预算覆盖


def _carry_archived_budget(con: sqlite3.Connection, from_id: int, to_id: int) -> None:
    """把 from_id 在归档月份里的预算并入 to_id，保证那些月份的历史数字不变。"""
    stamp = now_str()
    for month in frozen_months(con):
        row = con.execute(
            "SELECT amount FROM budget_overrides WHERE category_id = ? AND month = ?",
            (from_id, month),
        ).fetchone()
        if row is None or float(row["amount"]) == 0:
            continue
        base = con.execute(
            "SELECT amount FROM budget_overrides WHERE category_id = ? AND month = ?",
            (to_id, month),
        ).fetchone()
        if base is not None:
            base_amount = float(base["amount"])
        else:
            # 理论上归档时会给每个分类都写一行，这里只是兜底
            fallback = con.execute(
                "SELECT monthly_budget FROM categories WHERE id = ?", (to_id,)
            ).fetchone()
            base_amount = float(fallback["monthly_budget"]) if fallback else 0.0
        con.execute(
            "INSERT INTO budget_overrides(category_id, month, amount, source, created_at) "
            "VALUES (?, ?, ?, 'auto', ?) "
            "ON CONFLICT(category_id, month) "
            "DO UPDATE SET amount = excluded.amount, source = 'auto'",
            (to_id, month, base_amount + float(row["amount"]), stamp),
        )


def override_detail_map(con: sqlite3.Connection, month: str) -> dict[int, dict]:
    """某月各分类的独立预算：{category_id: {"amount": ..., "source": ...}}。

    source = "user" 是用户手动为该月设置的；"auto" 是月份结束后自动归档的快照。
    """
    rows = con.execute(
        "SELECT category_id, amount, source FROM budget_overrides WHERE month = ?",
        (parse_month(month),),
    ).fetchall()
    return {
        int(r["category_id"]): {"amount": float(r["amount"]), "source": r["source"]}
        for r in rows
    }


def set_month_budget(category_id: int, month: str, amount) -> None:
    """给某个分类在某个具体月份设置单独的预算覆盖。"""
    clean_month = parse_month(month)
    value = _clean_amount(amount)
    with connect() as con:
        exists = con.execute(
            "SELECT 1 FROM categories WHERE id = ?", (int(category_id),)
        ).fetchone()
        if not exists:
            raise ValueError("分类不存在")
        con.execute(
            "INSERT INTO budget_overrides(category_id, month, amount, source, created_at) "
            "VALUES (?, ?, ?, 'user', ?) "
            "ON CONFLICT(category_id, month) "
            "DO UPDATE SET amount = excluded.amount, source = 'user'",
            (int(category_id), clean_month, value, now_str()),
        )


def clear_month_budget(category_id: int, month: str) -> None:
    """取消某月的单独覆盖，改回沿用分类的默认月度预算。"""
    with connect() as con:
        con.execute(
            "DELETE FROM budget_overrides WHERE category_id = ? AND month = ?",
            (int(category_id), parse_month(month)),
        )


# --------------------------------------------------------------------------- 流水


def _clean_note(value) -> str:
    note = (value or "").strip()
    if len(note) > 100:
        raise ValueError("备注最长 100 个字")
    return note


def _check_category(con: sqlite3.Connection, category_id) -> int:
    cid = int(category_id)
    row = con.execute("SELECT 1 FROM categories WHERE id = ?", (cid,)).fetchone()
    if row is None:
        raise ValueError("所选分类不存在")
    return cid


def add_expense(category_id, spent_on: str, amount, note: str = "") -> int:
    date_str = parse_date(spent_on)
    value = _clean_amount(amount, allow_zero=False)
    clean_note = _clean_note(note)
    stamp = now_str()
    with connect() as con:
        cid = _check_category(con, category_id)
        cur = con.execute(
            "INSERT INTO expenses(category_id, month, spent_on, amount, note, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (cid, date_str[:7], date_str, value, clean_note, stamp, stamp),
        )
        # 补录往月的流水时，顺手把那个月归档，之后改默认预算不会反改它
        freeze_past_months(con)
        return int(cur.lastrowid)


def add_expenses_batch(items: list[dict]) -> list[int]:
    """一次事务写入多笔自然语言解析结果，任一笔非法则全部不写。"""
    if not items:
        raise ValueError("没有可保存的消费记录")
    cleaned = []
    for item in items:
        date_str = parse_date(item.get("spent_on"))
        value = _clean_amount(item.get("amount"), allow_zero=False)
        note = _clean_note(item.get("note", ""))
        cleaned.append((int(item.get("category_id")), date_str, value, note))
    stamp = now_str()
    ids = []
    with connect() as con:
        valid = {int(row["id"]) for row in con.execute("SELECT id FROM categories").fetchall()}
        if any(cid not in valid for cid, _, _, _ in cleaned):
            raise ValueError("批量记录中包含不存在的分类")
        for cid, date_str, value, note in cleaned:
            cur = con.execute(
                "INSERT INTO expenses(category_id, month, spent_on, amount, note, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (cid, date_str[:7], date_str, value, note, stamp, stamp),
            )
            ids.append(int(cur.lastrowid))
        freeze_past_months(con)
    return ids


def update_expense(expense_id, category_id, spent_on: str, amount, note: str = "") -> None:
    date_str = parse_date(spent_on)
    value = _clean_amount(amount, allow_zero=False)
    clean_note = _clean_note(note)
    with connect() as con:
        exists = con.execute(
            "SELECT 1 FROM expenses WHERE id = ?", (int(expense_id),)
        ).fetchone()
        if not exists:
            raise ValueError("要修改的流水不存在")
        cid = _check_category(con, category_id)
        con.execute(
            "UPDATE expenses SET category_id = ?, month = ?, spent_on = ?, amount = ?, "
            "note = ?, updated_at = ? WHERE id = ?",
            (cid, date_str[:7], date_str, value, clean_note, now_str(), int(expense_id)),
        )
        freeze_past_months(con)


def delete_expense(expense_id) -> None:
    with connect() as con:
        cur = con.execute("DELETE FROM expenses WHERE id = ?", (int(expense_id),))
        if cur.rowcount == 0:
            raise ValueError("要删除的流水不存在")


def list_expenses(
    month: str | None = None,
    category_id=None,
    day: str | None = None,
) -> list[dict]:
    """按月份、按具体某一天、按分类筛选流水（三者可组合，通常只用其中一个）。"""
    sql = (
        "SELECT e.id, e.category_id, c.name AS category_name, e.spent_on, e.month, "
        "       e.amount, e.note "
        "FROM expenses e JOIN categories c ON c.id = e.category_id WHERE 1 = 1"
    )
    params: list = []
    if month:
        sql += " AND e.month = ?"
        params.append(parse_month(month))
    if day:
        sql += " AND e.spent_on = ?"
        params.append(parse_date(day))
    if category_id not in (None, "", "all"):
        sql += " AND e.category_id = ?"
        params.append(int(category_id))
    sql += " ORDER BY e.spent_on DESC, e.id DESC"

    with connect() as con:
        rows = con.execute(sql, params).fetchall()
    return [_to_dict(row) for row in rows]


def list_days(month: str | None = None) -> list[dict]:
    """出现过流水的日期（倒序），附带当天笔数与合计，用于「按日」快速选取。"""
    sql = "SELECT spent_on, COUNT(*) AS cnt, SUM(amount) AS total FROM expenses"
    params: list = []
    if month:
        sql += " WHERE month = ?"
        params.append(parse_month(month))
    sql += " GROUP BY spent_on ORDER BY spent_on DESC"

    with connect() as con:
        rows = con.execute(sql, params).fetchall()
    return [
        {
            "day": row["spent_on"],
            "count": int(row["cnt"]),
            "total": round(float(row["total"]), 2),
        }
        for row in rows
    ]


def list_months() -> list[str]:
    """所有出现过流水的月份（倒序）。"""
    with connect() as con:
        rows = con.execute(
            "SELECT DISTINCT month FROM expenses ORDER BY month DESC"
        ).fetchall()
    return [row["month"] for row in rows]
