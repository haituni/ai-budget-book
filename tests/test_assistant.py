import unittest
from unittest.mock import patch

from core.assistant import _proposed_budget, _shift_month, parse_expense_text


class AssistantTests(unittest.TestCase):
    def test_shift_month_crosses_year_boundary(self):
        self.assertEqual(_shift_month("2026-12", 1), "2027-01")
        self.assertEqual(_shift_month("2026-01", -1), "2025-12")

    def test_natural_language_parser_delegates_to_ai(self):
        expected = {"items": [{"amount": 18}], "warnings": [], "parsed_count": 1}
        with patch("core.assistant.ai.parse_expense_text", return_value=expected) as mocked:
            result = parse_expense_text("食堂午饭 18", "2026-09-28")
        self.assertEqual(result, expected)
        mocked.assert_called_once_with("食堂午饭 18", "2026-09-28")

    def test_budget_formula_respects_spending_type(self):
        essential, _ = _proposed_budget("essential", [100, 110, 120], 150)
        flexible, _ = _proposed_budget("flexible", [100, 200, 300], 500)
        occasional, _ = _proposed_budget("occasional", [0, 0, 300], 0)
        self.assertGreaterEqual(essential, 150)
        self.assertEqual(flexible, 200)
        self.assertEqual(occasional, 110)


if __name__ == "__main__":
    unittest.main()
