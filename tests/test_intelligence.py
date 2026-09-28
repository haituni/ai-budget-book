import unittest
from datetime import date

from core.intelligence import _analyze_rows


def expense(row_id, category_id, category_name, spent_on, amount, note=""):
    return {
        "id": row_id,
        "category_id": category_id,
        "category_name": category_name,
        "spent_on": spent_on,
        "month": spent_on[:7],
        "amount": amount,
        "note": note,
    }


class IntelligenceTests(unittest.TestCase):
    def setUp(self):
        self.overview = {
            "categories": [
                {"id": 1, "name": "伙食费", "budget": 600, "spent": 0},
                {"id": 2, "name": "学习", "budget": 200, "spent": 0},
            ],
            "totals": {"budget": 800, "spent": 0},
        }
        self.rows = []
        row_id = 1
        for month in ("2026-06", "2026-07", "2026-08"):
            for day in (2, 6, 10, 14, 18, 22):
                self.rows.append(expense(row_id, 1, "伙食费", f"{month}-{day:02d}", 30))
                row_id += 1
        for day in (2, 4, 6, 8, 10, 12, 14):
            self.rows.append(expense(row_id, 1, "伙食费", f"2026-09-{day:02d}", 35))
            row_id += 1

    def analyze(self):
        return _analyze_rows(
            "2026-09",
            self.rows,
            self.overview,
            date(2026, 9, 15),
            6,
            False,
        )

    def test_builds_category_features_and_prediction_range(self):
        result = self.analyze()
        food = result["features"][0]
        self.assertEqual(food["name"], "伙食费")
        self.assertEqual(food["observed_transaction_count"], 7)
        self.assertEqual(food["history_months"], 3)
        self.assertGreater(food["forecast"]["central"], food["spent"])
        self.assertLessEqual(food["forecast"]["lower"], food["forecast"]["central"])
        self.assertGreaterEqual(food["forecast"]["upper"], food["forecast"]["central"])

    def test_amount_outlier_uses_historical_typical_amount(self):
        self.rows.append(expense(100, 1, "伙食费", "2026-09-15", 300))
        result = self.analyze()
        outliers = [item for item in result["anomalies"] if item["type"] == "amount_outlier"]
        self.assertEqual(len(outliers), 1)
        self.assertEqual(outliers[0]["amount"], 300)
        self.assertEqual(outliers[0]["evidence"]["typical_amount"], 30)

    def test_duplicate_detection_is_deterministic(self):
        self.rows.extend([
            expense(101, 2, "学习", "2026-09-15", 50, "打印"),
            expense(102, 2, "学习", "2026-09-15", 50, "打印"),
        ])
        result = self.analyze()
        duplicates = [item for item in result["anomalies"] if item["type"] == "possible_duplicate"]
        self.assertEqual(len(duplicates), 1)
        self.assertEqual(duplicates[0]["evidence"]["count"], 2)

    def test_backtest_mode_does_not_peek_after_cutoff(self):
        self.rows.append(expense(103, 1, "伙食费", "2026-09-28", 500))
        result = self.analyze()
        food = next(item for item in result["features"] if item["id"] == 1)
        self.assertEqual(food["committed_future"], 0)
        self.assertEqual(food["observed_transaction_count"], 7)


if __name__ == "__main__":
    unittest.main()
