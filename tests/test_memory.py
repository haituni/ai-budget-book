import unittest

from core.memory import _rank_category_suggestions, normalize_note


class MemoryTests(unittest.TestCase):
    def setUp(self):
        self.categories = [
            {"id": 1, "name": "伙食费", "spending_type": "essential"},
            {"id": 2, "name": "学习用品", "spending_type": "occasional"},
        ]

    def test_note_normalization_removes_variable_numbers(self):
        self.assertEqual(normalize_note("食堂午饭 18.50 元"), "食堂午饭 元")

    def test_exact_history_suggests_previous_category(self):
        expenses = [
            {"category_id": 1, "note": "食堂午饭", "amount": 18},
            {"category_id": 1, "note": "食堂午饭", "amount": 20},
            {"category_id": 2, "note": "打印论文", "amount": 12},
        ]
        result = _rank_category_suggestions(
            "食堂午饭 19元", self.categories, expenses, [], 19
        )
        self.assertEqual(result[0]["category_id"], 1)
        self.assertIn("同名备注", result[0]["reason"])

    def test_rejected_suggestion_teaches_chosen_category(self):
        expenses = [
            {"category_id": 1, "note": "校园卡充值", "amount": 100},
            {"category_id": 1, "note": "校园卡充值", "amount": 100},
        ]
        feedback = [
            {
                "note_key": "校园卡充值",
                "suggested_category_id": 1,
                "chosen_category_id": 2,
                "accepted": 0,
            },
            {
                "note_key": "校园卡充值",
                "suggested_category_id": 2,
                "chosen_category_id": 2,
                "accepted": 1,
            },
        ]
        result = _rank_category_suggestions(
            "校园卡充值", self.categories, expenses, feedback, 100
        )
        self.assertEqual(result[0]["category_id"], 2)
        self.assertIn("确认过相似备注", result[0]["reason"])


if __name__ == "__main__":
    unittest.main()
