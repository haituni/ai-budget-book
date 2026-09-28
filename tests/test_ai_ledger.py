import json
import unittest
from unittest import mock

from core import ai, assistant


class LedgerAiTests(unittest.TestCase):
    @mock.patch("core.assistant.ai.answer_ledger")
    def test_assistant_delegates_without_rule_fallback(self, mocked):
        mocked.return_value = {"answer": "模型回答"}
        result = assistant.answer_ledger("本月花了多少？", "2026-09")
        self.assertEqual(result["answer"], "模型回答")
        mocked.assert_called_once_with("本月花了多少？", "2026-09")

    @mock.patch("core.ai.build_context")
    @mock.patch("core.ai._chat")
    @mock.patch("core.ai._resolve")
    @mock.patch("core.ai._require_ready")
    def test_answer_ledger_uses_model_json(self, ready, resolve, chat, context):
        resolve.return_value = {"model": "test-model"}
        context.return_value = {
            "overview": {"expense": 88.5},
            "expenses": [{"date": "2026-09-02", "amount": 88.5, "category": "餐饮"}],
        }
        chat.return_value = json.dumps({
            "kind": "monthly_total",
            "answer": "本月支出 88.50 元。",
            "evidence": ["2026-09-02 餐饮 88.50 元"],
        }, ensure_ascii=False)

        result = ai.answer_ledger("本月花了多少？", "2026-09")

        self.assertEqual(result["kind"], "monthly_total")
        self.assertEqual(result["answer"], "本月支出 88.50 元。")
        self.assertEqual(result["evidence"], ["2026-09-02 餐饮 88.50 元"])
        self.assertEqual(result["model"], "test-model")
        ready.assert_called_once_with()
        context.assert_called_once_with("2026-09")
        chat.assert_called_once_with(mock.ANY, resolve.return_value)
        sent_messages = chat.call_args.args[0]
        self.assertEqual(len(sent_messages), 2)
        self.assertIn("本月花了多少？", sent_messages[1]["content"])

    def test_answer_ledger_rejects_empty_question(self):
        with self.assertRaises(ValueError):
            ai.answer_ledger("  ", "2026-09")


if __name__ == "__main__":
    unittest.main()
