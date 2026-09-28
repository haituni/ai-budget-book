"""个人消费记忆：分类画像、备注分类建议与提醒反馈。

所有学习都保存在本地 SQLite。建议只作为候选，必须由用户确认后才会影响分类。
"""

from __future__ import annotations

import re
import sqlite3
from collections import Counter, defaultdict
from statistics import median

from .db import connect, now_str


SPENDING_TYPES = {"unknown", "essential", "flexible", "occasional"}
SPENDING_TYPE_TEXT = {
    "unknown": "未标记",
    "essential": "必要支出",
    "flexible": "可调整",
    "occasional": "偶发支出",
}


def clean_spending_type(value) -> str:
    text = str(value or "unknown").strip().lower()
    if text not in SPENDING_TYPES:
        raise ValueError("消费属性必须是必要支出、可调整、偶发支出或未标记")
    return text


def normalize_note(value) -> str:
    text = str(value or "").strip().casefold()
    text = re.sub(r"\d+(?:\.\d+)?", " ", text)
    text = re.sub(r"[^0-9a-z\u4e00-\u9fff]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _tokens(value: str) -> set[str]:
    text = normalize_note(value)
    tokens: set[str] = set()
    for part in text.split():
        if len(part) >= 2:
            tokens.add(part)
        if re.fullmatch(r"[\u4e00-\u9fff]+", part):
            for size in (2, 3):
                if len(part) >= size:
                    tokens.update(part[index:index + size] for index in range(len(part) - size + 1))
    return tokens


def _similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    a, b = _tokens(left), _tokens(right)
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _rank_category_suggestions(
    note: str,
    categories: list[dict],
    expenses: list[dict],
    feedback: list[dict],
    amount: float | None = None,
) -> list[dict]:
    """纯计算排序函数，便于测试；分数越高越可能是用户想要的分类。"""
    key = normalize_note(note)
    if len(key) < 2:
        return []

    category_map = {int(row["id"]): row for row in categories}
    scores: dict[int, float] = defaultdict(float)
    evidence: dict[int, Counter] = defaultdict(Counter)

    for category in categories:
        cid = int(category["id"])
        name_key = normalize_note(category["name"])
        if name_key and name_key in key:
            scores[cid] += 6.0
            evidence[cid]["category_name"] += 1

    for row in expenses:
        cid = int(row["category_id"])
        if cid not in category_map:
            continue
        row_key = normalize_note(row.get("note"))
        similarity = _similarity(key, row_key)
        if similarity < 0.24:
            continue
        weight = 5.0 if similarity == 1 else similarity * 2.5
        if amount not in (None, 0, ""):
            try:
                ratio = float(amount) / max(float(row.get("amount") or 0), 0.01)
            except (TypeError, ValueError):
                ratio = 0
            if 0.5 <= ratio <= 2:
                weight += 0.4
        scores[cid] += weight
        evidence[cid]["exact_history" if similarity == 1 else "similar_history"] += 1

    for row in feedback:
        similarity = _similarity(key, str(row.get("note_key") or ""))
        if similarity < 0.24:
            continue
        chosen = row.get("chosen_category_id")
        suggested = row.get("suggested_category_id")
        accepted = int(row.get("accepted") or 0) == 1
        multiplier = 1.0 if similarity == 1 else similarity
        if chosen is not None and int(chosen) in category_map:
            scores[int(chosen)] += 8.0 * multiplier
            evidence[int(chosen)]["accepted_feedback"] += 1
        if not accepted and suggested is not None and int(suggested) in category_map:
            scores[int(suggested)] -= 6.0 * multiplier
            evidence[int(suggested)]["rejected_feedback"] += 1

    ranked = sorted(
        ((cid, score) for cid, score in scores.items() if score >= 1.5),
        key=lambda item: (-item[1], category_map[item[0]]["name"]),
    )
    if not ranked:
        return []
    second_score = ranked[1][1] if len(ranked) > 1 else 0.0
    results = []
    for cid, score in ranked[:3]:
        counts = evidence[cid]
        confidence = score / (score + max(second_score, 0) + 2.0)
        reasons = []
        if counts["accepted_feedback"]:
            reasons.append(f"你曾 {counts['accepted_feedback']} 次确认过相似备注")
        if counts["exact_history"]:
            reasons.append(f"历史上有 {counts['exact_history']} 笔同名备注")
        elif counts["similar_history"]:
            reasons.append(f"匹配 {counts['similar_history']} 笔相似备注")
        if counts["category_name"]:
            reasons.append("备注包含分类名称")
        results.append({
            "category_id": cid,
            "category_name": category_map[cid]["name"],
            "score": round(score, 3),
            "confidence": round(min(max(confidence, 0), 0.99), 3),
            "confidence_text": "高" if confidence >= 0.75 else "中" if confidence >= 0.52 else "低",
            "reason": "；".join(reasons[:2]) or "与历史备注模式相似",
        })
    return results


def suggest_category(note: str, amount=None) -> dict | None:
    key = normalize_note(note)
    if len(key) < 2:
        return None
    with connect() as con:
        categories = [dict(row) for row in con.execute(
            "SELECT id, name, spending_type FROM categories ORDER BY sort_order, id"
        ).fetchall()]
        expenses = [dict(row) for row in con.execute(
            "SELECT category_id, amount, note FROM expenses WHERE TRIM(note) <> '' "
            "ORDER BY id DESC LIMIT 1000"
        ).fetchall()]
        feedback = [dict(row) for row in con.execute(
            "SELECT note_key, suggested_category_id, chosen_category_id, accepted "
            "FROM classification_feedback ORDER BY id DESC LIMIT 500"
        ).fetchall()]
    ranked = _rank_category_suggestions(note, categories, expenses, feedback, amount)
    if not ranked:
        return None
    return {"suggestion": ranked[0], "alternatives": ranked[1:]}


def record_classification_feedback(note, suggested_category_id, chosen_category_id) -> None:
    key = normalize_note(note)
    if len(key) < 2 or suggested_category_id in (None, ""):
        return
    suggested = int(suggested_category_id)
    chosen = int(chosen_category_id)
    with connect() as con:
        valid = {
            int(row["id"]) for row in con.execute(
                "SELECT id FROM categories WHERE id IN (?, ?)", (suggested, chosen)
            ).fetchall()
        }
        if suggested not in valid or chosen not in valid:
            return
        con.execute(
            "INSERT INTO classification_feedback"
            "(note_key, suggested_category_id, chosen_category_id, accepted, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (key, suggested, chosen, int(suggested == chosen), now_str()),
        )


def category_memories(limit_months: int = 12) -> list[dict]:
    limit_months = max(1, min(int(limit_months), 60))
    with connect() as con:
        categories = [dict(row) for row in con.execute(
            "SELECT id, name, spending_type FROM categories ORDER BY sort_order, id"
        ).fetchall()]
        rows = [dict(row) for row in con.execute(
            "SELECT category_id, month, amount, note FROM expenses ORDER BY spent_on DESC, id DESC"
        ).fetchall()]

    months = sorted({str(row["month"]) for row in rows}, reverse=True)[:limit_months]
    month_set = set(months)
    results = []
    for category in categories:
        cid = int(category["id"])
        items = [row for row in rows if int(row["category_id"]) == cid and str(row["month"]) in month_set]
        active_months = len({str(row["month"]) for row in items})
        amounts = [float(row["amount"]) for row in items]
        notes = [str(row["note"]).strip() for row in items if str(row.get("note") or "").strip()]
        note_counts = Counter(notes)
        recurrence = active_months / len(months) if months else 0.0
        results.append({
            "category_id": cid,
            "category_name": category["name"],
            "spending_type": category.get("spending_type") or "unknown",
            "spending_type_text": SPENDING_TYPE_TEXT.get(category.get("spending_type") or "unknown", "未标记"),
            "observed_months": len(months),
            "active_months": active_months,
            "recurrence": round(recurrence, 3),
            "recurring": active_months >= 3 and recurrence >= 0.6,
            "transaction_count": len(items),
            "monthly_average": round(sum(amounts) / len(months), 2) if months else 0.0,
            "typical_amount": round(float(median(amounts)), 2) if amounts else 0.0,
            "top_notes": [name for name, _ in note_counts.most_common(3)],
        })
    return results


def record_insight_feedback(fingerprint: str, decision: str) -> dict:
    clean_fingerprint = re.sub(r"[^a-zA-Z0-9_-]", "", str(fingerprint or ""))[:80]
    clean_decision = str(decision or "").strip().lower()
    if not clean_fingerprint:
        raise ValueError("提醒标识不能为空")
    if clean_decision not in {"useful", "dismissed"}:
        raise ValueError("提醒反馈必须是有用或忽略")
    with connect() as con:
        con.execute(
            "INSERT INTO insight_feedback(fingerprint, decision, feedback_count, updated_at) "
            "VALUES (?, ?, 1, ?) ON CONFLICT(fingerprint) DO UPDATE SET "
            "decision = excluded.decision, feedback_count = insight_feedback.feedback_count + 1, "
            "updated_at = excluded.updated_at",
            (clean_fingerprint, clean_decision, now_str()),
        )
        row = con.execute(
            "SELECT fingerprint, decision, feedback_count, updated_at "
            "FROM insight_feedback WHERE fingerprint = ?", (clean_fingerprint,)
        ).fetchone()
    return dict(row)


def insight_feedback_map(fingerprints: list[str]) -> dict[str, str]:
    clean = [str(item) for item in fingerprints if item]
    if not clean:
        return {}
    placeholders = ",".join("?" for _ in clean)
    try:
        with connect() as con:
            rows = con.execute(
                f"SELECT fingerprint, decision FROM insight_feedback WHERE fingerprint IN ({placeholders})",
                clean,
            ).fetchall()
    except sqlite3.OperationalError:
        return {}
    return {str(row["fingerprint"]): str(row["decision"]) for row in rows}
