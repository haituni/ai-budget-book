"""在一台普通电脑上跑一遍安卓入口，验证「Android 模式」下的 core 后端。

它复用 app/src/main/python 下同步过来的同一份代码，只是把数据目录指向
临时目录，因此不会碰到真实账本数据。

用法：python Android/tools/smoke_test.py
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY_DIR = HERE.parent / "app" / "src" / "main" / "python"
sys.path.insert(0, str(PY_DIR))
# 不要在被同步的源码目录里留下 __pycache__，免得被一起打进 APK
sys.dont_write_bytecode = True

import android_entry  # noqa: E402


def call(method, *args):
    raw = android_entry.call_json(method, json.dumps(list(args), ensure_ascii=False))
    result = json.loads(raw)
    if not result.get("ok"):
        raise AssertionError(f"{method} 失败：{result.get('error')}")
    return result["data"]


def main() -> int:
    failures: list[str] = []

    def check(label, func):
        try:
            value = func()
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{label}: {type(exc).__name__}: {exc}")
            print(f"  [FAIL] {label}: {exc}")
            return None
        print(f"  [ok]   {label}")
        return value

    with tempfile.TemporaryDirectory() as tmp:
        db_path = android_entry.setup(tmp)
        print(f"数据目录：{db_path}")

        check("bootstrap", lambda: call("bootstrap"))
        check("app_info", lambda: call("app_info"))
        categories = check("list_categories", lambda: call("list_categories"))
        check("category_memories", lambda: call("category_memories"))
        check("suggest_category", lambda: call("suggest_category", "食堂午饭 18", 18))
        check("threshold", lambda: call("threshold"))
        check("set_threshold", lambda: call("set_threshold", 75))
        check("overview(空库)", lambda: call("overview", "2026-09"))

        if categories:
            target = categories[0]["id"]
            check(
                "add_expense",
                lambda: call(
                    "add_expense",
                    {
                        "category_id": target,
                        "spent_on": "2026-09-28",
                        "amount": 18.5,
                        "note": "食堂午饭",
                    },
                ),
            )
            check(
                "add_expenses_batch",
                lambda: call(
                    "add_expenses_batch",
                    {
                        "items": [
                            {
                                "category_id": target,
                                "spent_on": "2026-09-27",
                                "amount": 22,
                                "note": "打车",
                            }
                        ]
                    },
                ),
            )
            check("list_expenses", lambda: call("list_expenses", "2026-09"))
            check("list_days", lambda: call("list_days", "2026-09"))
            check("overview(有数据)", lambda: call("overview", "2026-09"))
            check("intelligence", lambda: call("intelligence", "2026-09"))
            check("history", lambda: call("history", "2026-10"))
            check("backtest_intelligence", lambda: call("backtest_intelligence", 3))
            check("set_month_budget", lambda: call(
                "set_month_budget",
                {"category_id": target, "month": "2026-09", "amount": 800},
            ))
            check("ai_config", lambda: call("ai_config"))
            check("save_ai_config", lambda: call(
                "save_ai_config",
                {
                    "base_url": "https://api.deepseek.com/v1",
                    "model": "deepseek-chat",
                    "api_key": "sk-smoke-test-key-123456",
                    "enabled": True,
                },
            ))
            check("ai_config(有 Key)", lambda: call("ai_config"))
            check("list_ai_reports", lambda: call("list_ai_reports", None, 10))
            export_path = check("export_csv", lambda: call("export_csv", "2026-09", None, None))
            if export_path:
                print(f"         导出文件：{export_path.get('path')}")

        check("open_data_folder", lambda: call("open_data_folder"))
        snapshot = android_entry.snapshot_db()
        print(f"  [ok]   snapshot_db -> {snapshot}")

    if failures:
        print(f"\n失败 {len(failures)} 项：")
        for item in failures:
            print(f"  - {item}")
        return 1
    print("\n全部通过：Android 模式下的后端可正常调用。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
