"""本地消费智能层：特征、异常检测、分类预测与历史回测。

这里的结论全部由账本数据确定性计算，不调用大模型，也不写数据库。
大模型只能消费这些结果并负责解释，不能覆盖这里的数值口径。
"""

from __future__ import annotations

import calendar
import hashlib
import math
from collections import defaultdict
from datetime import date, datetime, timedelta
from statistics import median

from . import memory, repo, service
from .db import parse_date, parse_month


def _round(value: float) -> float:
    return round(float(value or 0), 2)


def _date(value: str) -> date:
    return datetime.strptime(parse_date(value), "%Y-%m-%d").date()


def _month_end(month: str) -> date:
    year, mon = (int(part) for part in parse_month(month).split("-"))
    return date(year, mon, calendar.monthrange(year, mon)[1])


def _month_start(month: str) -> date:
    year, mon = (int(part) for part in parse_month(month).split("-"))
    return date(year, mon, 1)


def _day_counts(start: date, end: date) -> tuple[int, int]:
    """返回闭区间内 (工作日数, 周末数)。"""
    if end < start:
        return 0, 0
    weekdays = weekends = 0
    cursor = start
    while cursor <= end:
        if cursor.weekday() < 5:
            weekdays += 1
        else:
            weekends += 1
        cursor += timedelta(days=1)
    return weekdays, weekends


def _median(values: list[float]) -> float | None:
    return float(median(values)) if values else None


def _mad(values: list[float], center: float) -> float:
    return float(median([abs(value - center) for value in values])) if values else 0.0


def _history_months(rows: list[dict], before_month: str, limit: int) -> list[str]:
    return sorted(
        {str(row["month"]) for row in rows if str(row["month"]) < before_month},
        reverse=True,
    )[:limit]


def _severity_rank(value: str) -> int:
    return {"high": 0, "medium": 1, "low": 2}.get(value, 9)


def _feature_of(
    category: dict,
    visible_rows: list[dict],
    all_month_rows: list[dict],
    history_rows: list[dict],
    history_months: list[str],
    month: str,
    cutoff: date,
    include_known_future: bool,
) -> dict:
    cid = int(category["id"])
    start = _month_start(month)
    end = _month_end(month)
    elapsed_weekdays, elapsed_weekends = _day_counts(start, cutoff)
    remaining_weekdays, remaining_weekends = _day_counts(cutoff + timedelta(days=1), end)

    current = [row for row in visible_rows if int(row["category_id"]) == cid]
    recorded = [row for row in all_month_rows if int(row["category_id"]) == cid]
    future = [row for row in recorded if _date(str(row["spent_on"])) > cutoff]
    if not include_known_future:
        future = []

    amounts = [float(row["amount"]) for row in current]
    weekday_spend = sum(
        float(row["amount"])
        for row in current
        if _date(str(row["spent_on"])).weekday() < 5
    )
    weekend_spend = sum(amounts) - weekday_spend
    active_days = {str(row["spent_on"]) for row in current}
    future_total = sum(float(row["amount"]) for row in future)

    historical = [row for row in history_rows if int(row["category_id"]) == cid]
    history_amounts = [float(row["amount"]) for row in historical]
    historical_month_totals = []
    historical_month_counts = []
    for historical_month in history_months:
        month_items = [row for row in historical if str(row["month"]) == historical_month]
        historical_month_totals.append(sum(float(row["amount"]) for row in month_items))
        historical_month_counts.append(len(month_items))

    historical_weekday_spend = sum(
        float(row["amount"])
        for row in historical
        if _date(str(row["spent_on"])).weekday() < 5
    )
    historical_weekend_spend = sum(history_amounts) - historical_weekday_spend
    history_weekdays = history_weekends = 0
    for historical_month in history_months:
        wd, we = _day_counts(_month_start(historical_month), _month_end(historical_month))
        history_weekdays += wd
        history_weekends += we

    return {
        "id": cid,
        "name": category["name"],
        "spending_type": category.get("spending_type") or "unknown",
        "budget": _round(category["budget"]),
        "spent": _round(sum(amounts) + future_total),
        "observed_spent": _round(sum(amounts)),
        "committed_future": _round(future_total),
        "transaction_count": len(current) + len(future),
        "observed_transaction_count": len(current),
        "active_days": len(active_days),
        "average_amount": _round(sum(amounts) / len(amounts)) if amounts else 0.0,
        "median_amount": _round(_median(amounts) or 0),
        "max_amount": _round(max(amounts)) if amounts else 0.0,
        "weekday_spend": _round(weekday_spend),
        "weekend_spend": _round(weekend_spend),
        "weekday_daily_rate": _round(weekday_spend / elapsed_weekdays) if elapsed_weekdays else 0.0,
        "weekend_daily_rate": _round(weekend_spend / elapsed_weekends) if elapsed_weekends else 0.0,
        "remaining_weekdays": remaining_weekdays,
        "remaining_weekends": remaining_weekends,
        "history_months": len(history_months),
        "history_average_monthly_spend": _round(
            sum(historical_month_totals) / len(historical_month_totals)
        ) if historical_month_totals else 0.0,
        "history_average_monthly_count": round(
            sum(historical_month_counts) / len(historical_month_counts), 2
        ) if historical_month_counts else 0.0,
        "history_median_amount": _round(_median(history_amounts) or 0),
        "history_amount_count": len(history_amounts),
        "history_weekday_daily_rate": _round(
            historical_weekday_spend / history_weekdays
        ) if history_weekdays else 0.0,
        "history_weekend_daily_rate": _round(
            historical_weekend_spend / history_weekends
        ) if history_weekends else 0.0,
        "_current_amounts": amounts,
        "_history_amounts": history_amounts,
    }


def _forecast_of(feature: dict, elapsed_days: int, days_in_month: int) -> dict:
    history_count = int(feature["history_months"])
    observed_count = int(feature["observed_transaction_count"])
    progress = elapsed_days / days_in_month if days_in_month else 1.0

    if history_count:
        current_weight = min(0.8, max(0.35, progress)) if elapsed_days >= 5 else 0.25
    else:
        current_weight = 1.0

    weekday_rate = (
        current_weight * float(feature["weekday_daily_rate"])
        + (1 - current_weight) * float(feature["history_weekday_daily_rate"])
    )
    weekend_rate = (
        current_weight * float(feature["weekend_daily_rate"])
        + (1 - current_weight) * float(feature["history_weekend_daily_rate"])
    )
    pace_total = (
        float(feature["observed_spent"])
        + weekday_rate * int(feature["remaining_weekdays"])
        + weekend_rate * int(feature["remaining_weekends"])
    )
    recorded_floor = float(feature["spent"])
    central = max(recorded_floor, pace_total)

    if history_count >= 4 and observed_count >= 8 and elapsed_days >= 14:
        confidence, uncertainty = "high", 0.15
    elif history_count >= 2 and observed_count >= 3 and elapsed_days >= 7:
        confidence, uncertainty = "medium", 0.25
    else:
        confidence, uncertainty = "low", 0.40

    if central <= 0:
        lower = upper = 0.0
    else:
        lower = max(recorded_floor, central * (1 - uncertainty))
        upper = max(lower, central * (1 + uncertainty))

    budget = float(feature["budget"])
    return {
        "method": "weekday_weekend_hybrid" if history_count else "current_pace",
        "confidence": confidence,
        "central": _round(central),
        "lower": _round(lower),
        "upper": _round(upper),
        "budget_gap": _round(budget - central),
        "projected_usage": round(central / budget, 4) if budget > 0 else None,
        "current_weight": round(current_weight, 2),
        "history_weight": round(1 - current_weight, 2),
    }


def _anomalies(
    features: list[dict],
    forecasts: dict[int, dict],
    visible_rows: list[dict],
    progress: float,
) -> list[dict]:
    findings: list[dict] = []

    duplicate_groups: dict[tuple, list[dict]] = defaultdict(list)
    for row in visible_rows:
        key = (
            str(row["spent_on"]),
            int(row["category_id"]),
            round(float(row["amount"]), 2),
            str(row.get("note") or "").strip().casefold(),
        )
        duplicate_groups[key].append(row)
    for group in duplicate_groups.values():
        if len(group) < 2:
            continue
        sample = group[0]
        findings.append({
            "type": "possible_duplicate",
            "severity": "medium",
            "category_id": int(sample["category_id"]),
            "category": sample["category_name"],
            "amount": _round(float(sample["amount"])),
            "message": f"{sample['spent_on']} 有 {len(group)} 笔相同流水，请确认是否重复记账",
            "evidence": {"count": len(group), "date": sample["spent_on"]},
        })

    for feature in features:
        cid = int(feature["id"])
        forecast = forecasts[cid]
        budget = float(feature["budget"])
        history_amounts = list(feature["_history_amounts"])
        baseline = history_amounts if len(history_amounts) >= 5 else list(feature["_current_amounts"])
        if len(baseline) >= 5:
            center = _median(baseline) or 0.0
            mad = _mad(baseline, center)
            scale = max(1.4826 * mad, center * 0.25, 1.0)
            threshold = max(center * 2.5, center + 3 * scale)
            category_rows = [row for row in visible_rows if int(row["category_id"]) == cid]
            for row in category_rows:
                amount = float(row["amount"])
                robust_z = (amount - center) / scale
                if amount < threshold or amount - center < 20:
                    continue
                severity = "high" if robust_z >= 6 or amount >= center * 4 else "medium"
                findings.append({
                    "type": "amount_outlier",
                    "severity": severity,
                    "category_id": cid,
                    "category": feature["name"],
                    "amount": _round(amount),
                    "message": f"{feature['name']}有一笔 ¥{amount:.2f}，明显高于典型单笔 ¥{center:.2f}",
                    "evidence": {"date": row["spent_on"], "typical_amount": _round(center), "robust_z": round(robust_z, 2)},
                })

        projected = float(forecast["central"])
        if budget > 0 and projected > budget * 1.1 and projected - budget >= 20:
            severity = "high" if projected > budget * 1.25 else "medium"
            findings.append({
                "type": "budget_pace",
                "severity": severity,
                "category_id": cid,
                "category": feature["name"],
                "amount": _round(projected - budget),
                "message": f"{feature['name']}按当前节奏预计超预算 ¥{projected - budget:.2f}",
                "evidence": {"budget": _round(budget), "forecast": _round(projected), "forecast_range": [forecast["lower"], forecast["upper"]]},
            })

        expected_count = float(feature["history_average_monthly_count"]) * progress
        actual_count = int(feature["observed_transaction_count"])
        if int(feature["history_months"]) >= 2 and expected_count >= 1 and actual_count >= max(expected_count * 1.7, expected_count + 3):
            findings.append({
                "type": "frequency_spike",
                "severity": "medium",
                "category_id": cid,
                "category": feature["name"],
                "amount": actual_count,
                "message": f"{feature['name']}本月已记 {actual_count} 笔，高于历史同期约 {expected_count:.1f} 笔",
                "evidence": {"actual_count": actual_count, "expected_count": round(expected_count, 1), "history_months": int(feature["history_months"])},
            })

    for item in findings:
        evidence = item.get("evidence") or {}
        identity = "|".join((
            str(item.get("type") or ""),
            str(item.get("category_id") or ""),
            str(evidence.get("date") or ""),
            str(item.get("amount") or ""),
            str(evidence.get("actual_count") or ""),
        ))
        item["fingerprint"] = hashlib.sha1(identity.encode("utf-8")).hexdigest()[:20]

    feedback = memory.insight_feedback_map([item["fingerprint"] for item in findings])
    visible = []
    for item in findings:
        decision = feedback.get(item["fingerprint"], "")
        if decision == "dismissed":
            continue
        item["feedback"] = decision
        visible.append(item)
    visible.sort(key=lambda item: (
        0 if item.get("feedback") == "useful" else 1,
        _severity_rank(str(item["severity"])),
        -float(item.get("amount") or 0),
        str(item["type"]),
    ))
    return visible[:20]


def _strip_private(feature: dict) -> dict:
    return {key: value for key, value in feature.items() if not key.startswith("_")}


def _analyze_rows(
    month: str,
    all_rows: list[dict],
    overview: dict,
    cutoff: date,
    history_limit: int,
    include_known_future: bool,
) -> dict:
    clean = parse_month(month)
    start, end = _month_start(clean), _month_end(clean)
    cutoff = min(max(cutoff, start), end)
    month_rows = [row for row in all_rows if str(row["month"]) == clean]
    visible_rows = [row for row in month_rows if _date(str(row["spent_on"])) <= cutoff]
    history_months = _history_months(all_rows, clean, history_limit)
    history_rows = [row for row in all_rows if str(row["month"]) in history_months]
    elapsed_days = (cutoff - start).days + 1
    days_in_month = end.day
    progress = elapsed_days / days_in_month

    features = [
        _feature_of(category, visible_rows, month_rows, history_rows, history_months, clean, cutoff, include_known_future)
        for category in overview["categories"]
        if float(category["budget"]) > 0 or any(int(row["category_id"]) == int(category["id"]) for row in month_rows)
    ]
    forecasts = {int(item["id"]): _forecast_of(item, elapsed_days, days_in_month) for item in features}
    anomalies = _anomalies(features, forecasts, visible_rows, progress)

    categories = []
    for feature in features:
        public_feature = _strip_private(feature)
        public_feature["forecast"] = forecasts[int(feature["id"])]
        categories.append(public_feature)
    categories.sort(key=lambda item: float(item["spent"]), reverse=True)

    central = sum(float(item["forecast"]["central"]) for item in categories)
    lower = sum(float(item["forecast"]["lower"]) for item in categories)
    upper = sum(float(item["forecast"]["upper"]) for item in categories)
    total_budget = float(overview["totals"]["budget"])
    confidence_values = [item["forecast"]["confidence"] for item in categories]
    confidence = ("low" if "low" in confidence_values else "medium" if "medium" in confidence_values else "high") if confidence_values else "low"

    return {
        "month": clean,
        "as_of": cutoff.isoformat(),
        "elapsed_days": elapsed_days,
        "days_in_month": days_in_month,
        "progress": round(progress, 4),
        "history_months": history_months,
        "features": categories,
        "forecast": {
            "method": "category_weekday_weekend_hybrid",
            "confidence": confidence,
            "central": _round(central),
            "lower": _round(lower),
            "upper": _round(upper),
            "budget": _round(total_budget),
            "budget_gap": _round(total_budget - central),
            "projected_usage": round(central / total_budget, 4) if total_budget > 0 else None,
        },
        "anomalies": anomalies,
        "data_quality": {
            "visible_transactions": len(visible_rows),
            "future_transactions": len(month_rows) - len(visible_rows) if include_known_future else 0,
            "history_month_count": len(history_months),
        },
    }


def month_intelligence(month: str, as_of: str | None = None, history_limit: int = 6) -> dict:
    """返回某月的本地智能分析；自定义 as_of 主要供测试和回测使用。"""
    clean = parse_month(month)
    history_limit = max(1, min(int(history_limit), 24))
    today = datetime.now().date()
    end = _month_end(clean)
    if as_of:
        cutoff = _date(as_of)
        if cutoff.strftime("%Y-%m") != clean:
            raise ValueError("分析截止日期必须位于所选月份")
        include_known_future = clean == today.strftime("%Y-%m") and cutoff == today
    else:
        cutoff = min(today, end)
        include_known_future = clean == today.strftime("%Y-%m")
    if _month_start(clean) > today:
        raise ValueError("未来月份还没有可分析的消费数据")
    return _analyze_rows(clean, repo.list_expenses(), service.month_overview(clean), cutoff, history_limit, include_known_future)


def backtest_forecasts(limit: int = 6, checkpoints: tuple[float, ...] = (0.5, 0.75)) -> dict:
    """用已结束月份回测分类预测，返回 MAE/MAPE 和逐月样本。"""
    limit = max(1, min(int(limit), 24))
    today_month = datetime.now().strftime("%Y-%m")
    all_rows = repo.list_expenses()
    months = sorted({str(row["month"]) for row in all_rows if str(row["month"]) < today_month}, reverse=True)[:limit]
    samples = []
    for month in months:
        overview = service.month_overview(month)
        actual = sum(float(row["amount"]) for row in all_rows if str(row["month"]) == month)
        days = _month_end(month).day
        for checkpoint in checkpoints:
            fraction = min(max(float(checkpoint), 0.1), 0.95)
            day_number = max(1, min(days - 1, math.ceil(days * fraction)))
            cutoff = date(int(month[:4]), int(month[5:7]), day_number)
            result = _analyze_rows(month, all_rows, overview, cutoff, 6, False)
            predicted = float(result["forecast"]["central"])
            absolute_error = abs(predicted - actual)
            samples.append({
                "month": month,
                "checkpoint": round(day_number / days, 4),
                "as_of": cutoff.isoformat(),
                "actual": _round(actual),
                "predicted": _round(predicted),
                "absolute_error": _round(absolute_error),
                "absolute_percentage_error": round(absolute_error / actual, 4) if actual > 0 else None,
            })

    percentage_errors = [float(item["absolute_percentage_error"]) for item in samples if item["absolute_percentage_error"] is not None]
    absolute_errors = [float(item["absolute_error"]) for item in samples]
    return {
        "months": months,
        "checkpoints": list(checkpoints),
        "sample_count": len(samples),
        "metrics": {
            "mae": _round(sum(absolute_errors) / len(absolute_errors)) if absolute_errors else None,
            "mape": round(sum(percentage_errors) / len(percentage_errors), 4) if percentage_errors else None,
            "median_ape": round(float(median(percentage_errors)), 4) if percentage_errors else None,
        },
        "samples": samples,
    }
