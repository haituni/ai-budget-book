import json
import unittest
from unittest.mock import patch

from core.ai import parse_expense_text


class AiExpenseParserTests(unittest.TestCase):
    def test_model_json_becomes_editable_expenses(self):
        categories = [
            {"id": 1, "name": "伙食费"},
            {"id": 2, "name": "学习用品"},
        ]
        model_result = {
            "items": [
                {
                    "spent_on": "2026-09-28",
                    "amount": 18,
                    "note": "食堂午饭",
                    "category_id": 1,
                    "confidence": "高",
                    "reason": "餐饮消费",
                    "source_text": "今晚食堂 18",
                },
                {
                    "spent_on": "2026-09-27",
                    "amount": 46,
                    "note": "买书",
                    "category_id": 2,
                    "confidence": "中",
                    "reason": "学习相关",
                    "source_text": "昨天买书 46",
                },
            ],
            "warnings": [],
        }
        with (
            patch("core.ai.repo.list_categories", return_value=categories),
            patch("core.ai._require_ready"),
            patch("core.ai._resolve", return_value={"model": "test", "base_url": "https://example.com/v1", "api_key": "x"}),
            patch("core.ai._chat", return_value=json.dumps(model_result, ensure_ascii=False)),
        ):
            result = parse_expense_text("今晚食堂 18，昨天买书 46", "2026-09-28")

        self.assertEqual(result["parsed_count"], 2)
        self.assertEqual([item["category_id"] for item in result["items"]], [1, 2])
        self.assertEqual([item["amount"] for item in result["items"]], [18.0, 46.0])

    def test_rejects_category_not_in_current_book(self):
        model_result = {
            "items": [{
                "spent_on": "2026-09-28",
                "amount": 18,
                "note": "午饭",
                "category_id": 999,
            }],
            "warnings": [],
        }
        with (
            patch("core.ai.repo.list_categories", return_value=[{"id": 1, "name": "伙食费"}]),
            patch("core.ai._require_ready"),
            patch("core.ai._resolve", return_value={"model": "test", "base_url": "https://example.com/v1", "api_key": "x"}),
            patch("core.ai._chat", return_value=json.dumps(model_result, ensure_ascii=False)),
        ):
            with self.assertRaisesRegex(ValueError, "分类不存在"):
                parse_expense_text("午饭 18", "2026-09-28")


if __name__ == "__main__":
    unittest.main()
