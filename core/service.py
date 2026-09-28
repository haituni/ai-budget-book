"""业务统计层：月度汇总、预算消耗与预警判定、CSV 生成。

所有金额计算都在这里完成，前端只负责展示。
"""

from __future__ import annotations

import csv
import io
import re
from datetime import datetime

from .db import DATA_DIR, DEFAULT_SETTINGS, connect, parse_month
from .repo import list_months, override_detail_map


def _round(value: float) -> float:
    return round(float(value or 0) + 0.0, 2)


def alert_threshold() -> float:
    """预警阈值（0~1）。取不到或非法时回落到默认 0.8。"""
    with connect() as con:
        row = con.execute(
            "SELECT value FROM settings WHERE key = 'alert_threshold'"
        ).fetchone()
    raw = row["value"] if row else DEFAULT_SETTINGS["alert_threshold"]
    try:
        value = float(raw)
    except (TypeError, ValueError):
        value = 0.8
    return min(max(value, 0.1), 1.0)


def set_alert_threshold(percent) -> float:
    """前端传百分比（如 80），这里换算成 0~1 存起来。"""
    try:
        value = float(percent)
    except (TypeError, ValueError) as exc:
        raise ValueError("阈值必须是数字") from exc
    if value > 1:  # 兼容直接传 0.8 的写法
        value = value / 100.0
    value = min(max(value, 0.1), 1.0)
    with connect() as con:
        con.execute(
            "INSERT INTO settings(key, value) VALUES ('alert_threshold', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (str(value),),
        )
    return value


def _status(budget: float, spent: float, threshold: float) -> str:
    if budget <= 0:
        return "unbudgeted" if spent > 0 else "none"
    if spent > budget:
        return "over"
    if spent >= budget * threshold:
        return "near"
    return "ok"


def month_overview(month: str) -> dict:
    """某个月的完整视图：分类预算消耗明细 + 当月总计。"""
    clean_month = parse_month(month)
    threshold = alert_threshold()

    with connect() as con:
        categories = con.execute(
            "SELECT id, name, monthly_budget, spending_type, is_system FROM categories "
            "ORDER BY sort_order, id"
        ).fetchall()
        overrides = override_detail_map(con, clean_month)
        spent_rows = con.execute(
            "SELECT category_id, SUM(amount) AS spent FROM expenses "
            "WHERE month = ? GROUP BY category_id",
            (clean_month,),
        ).fetchall()

    spent_by_category = {
        int(r["category_id"]): float(r["spent"]) for r in spent_rows
    }

    items: list[dict] = []
    total_budget = 0.0
    for row in categories:
        cid = int(row["id"])
        override = overrides.get(cid)
        budget = _round(override["amount"] if override else row["monthly_budget"])
        spent = _round(spent_by_category.get(cid, 0.0))
        remaining = _round(budget - spent)
        total_budget += budget
        items.append(
            {
                "id": cid,
                "name": row["name"],
                "spending_type": row["spending_type"],
                "is_system": int(row["is_system"]),
                "default_budget": _round(row["monthly_budget"]),
                "budget": budget,
                "budget_is_override": override is not None,
                # user = 该月手动设置过；auto = 月份已归档、预算已固定
                "budget_source": override["source"] if override else None,
                "spent": spent,
                "remaining": remaining,
                "usage": round(spent / budget, 4) if budget > 0 else None,
                "status": _status(budget, spent, threshold),
            }
        )

    total_spent = _round(sum(spent_by_category.values()))
    total_budget = _round(total_budget)

    # 饼图只关心有实际支出的分类，按金额从大到小
    pie = sorted(
        (
            {"id": item["id"], "name": item["name"], "value": item["spent"]}
            for item in items
            if item["spent"] > 0
        ),
        key=lambda entry: entry["value"],
        reverse=True,
    )

    return {
        "month": clean_month,
        "threshold": threshold,
        "categories": items,
        "totals": {
            "budget": total_budget,
            "spent": total_spent,
            "remaining": _round(total_budget - total_spent),
            "usage": round(total_spent / total_budget, 4) if total_budget > 0 else None,
        },
        "pie": pie,
        "alerts": {
            "over": [i["name"] for i in items if i["status"] == "over"],
            "near": [i["name"] for i in items if i["status"] == "near"],
            "unbudgeted": [i["name"] for i in items if i["status"] == "unbudgeted"],
        },
    }


def month_history(before_month: str, limit: int = 6) -> dict:
    """当前所选月份之前、有消费记录的月份回顾。

    每个月的预算 = 该月所有分类的生效预算之和（分类默认预算，或该月的单独覆盖值）。
    各月独立计算，不做结转。
    """
    anchor = parse_month(before_month)
    limit = max(1, min(int(limit), 60))

    with connect() as con:
        total_months = con.execute(
            "SELECT COUNT(DISTINCT month) AS c FROM expenses WHERE month < ?",
            (anchor,),
        ).fetchone()["c"]
        # 每条支出记录顺带算出该月的预算合计，一条 SQL 搞定（原来是每个月再查一次）
        spent_rows = con.execute(
            "SELECT e.month AS month, SUM(e.amount) AS spent, "
            "       (SELECT COALESCE(SUM(COALESCE(o.amount, c.monthly_budget)), 0) "
            "          FROM categories c "
            "          LEFT JOIN budget_overrides o "
            "                 ON o.category_id = c.id AND o.month = e.month"
            "       ) AS budget "
            "FROM expenses e WHERE e.month < ? "
            "GROUP BY e.month ORDER BY e.month DESC LIMIT ?",
            (anchor, limit),
        ).fetchall()

        months: list[dict] = []
        for row in spent_rows:
            month = row["month"]
            budget = _round(row["budget"])
            spent = _round(row["spent"])
            months.append(
                {
                    "month": month,
                    "budget": budget,
                    "spent": spent,
                    "remaining": _round(budget - spent),
                    "usage": round(spent / budget, 4) if budget > 0 else None,
                }
            )

    return {
        "months": months,
        "total_months": int(total_months),
        "limit": limit,
        "totals": {
            "budget": _round(sum(m["budget"] for m in months)),
            "spent": _round(sum(m["spent"] for m in months)),
            "remaining": _round(sum(m["remaining"] for m in months)),
        },
    }


def bootstrap() -> dict:
    """前端启动时一次性拉取的基础数据。"""
    from .db import DB_PATH

    return {
        "db_path": str(DB_PATH),
        # 必须和 api.EXPORT_DIR 指向同一处：CSV 实际就写在那里
        "export_dir": str(DATA_DIR / "exports"),
        "months": list_months(),
        "threshold": alert_threshold(),
    }


# Windows 文件名里不允许这些字符；结尾的点和空格也会被系统悄悄去掉
_INVALID_FILENAME_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def safe_filename(name: str) -> str:
    """把建议文件名清洗成 Windows 上一定写得下去的合法名字。"""
    cleaned = _INVALID_FILENAME_CHARS.sub("_", name).rstrip(" .")
    return cleaned or "消费流水.csv"


def build_csv(
    month: str | None = None,
    category_id=None,
    day: str | None = None,
) -> tuple[str, str]:
    """生成流水 CSV 文本，返回 (建议文件名, 内容)。

    使用 utf-8-sig，Excel 双击打开不会乱码。
    """
    from .repo import list_expenses

    rows = list_expenses(month=month, category_id=category_id, day=day)
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    writer.writerow(["日期", "月份", "分类", "金额", "备注"])
    total = 0.0
    for row in rows:
        total += float(row["amount"])
        writer.writerow(
            [
                row["spent_on"],
                row["month"],
                row["category_name"],
                f"{float(row['amount']):.2f}",
                row["note"],
            ]
        )
    writer.writerow([])
    writer.writerow(["合计", "", "", f"{round(total, 2):.2f}", f"共 {len(rows)} 笔"])

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    if day:
        scope = day
    elif month:
        scope = month
    else:
        scope = "全部"
    if category_id not in (None, "", "all"):
        name = next(
            (r["category_name"] for r in rows),
            None,
        )
        scope = f"{scope}_{name}" if name else scope
    # 分类名允许任意字符，统一清洗，避免导出时抛 OSError
    filename = safe_filename(f"消费流水_{scope}_{stamp}.csv")
    return filename, buffer.getvalue()
