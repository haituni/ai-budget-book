import json
import unittest
from unittest.mock import patch

from core.ai import (
    _ASK_CURRENT,
    _EXAMPLE_REPORT_CURRENT,
    _EXAMPLE_REPORT_PAST,
    _SYSTEM_PROMPT,
    _analysis_metrics,
    _local_report,
    _data_block,
    _data_quality_notes,
    _priority_drivers,
    _normalize_report,
    _validate_report,
    _forecast_confidence,
    _compact_agent_data,
    _parse_specialist_result,
    _repair_messages,
    _run_specialists,
    _specialist_messages,
    _user_prompt,
    _visuals_of,
    MAX_ANALYSIS_CALLS,
    SPECIALIST_COUNT,
)


class AiPromptTests(unittest.TestCase):
    def setUp(self):
        self.ctx = {
            "month_label": "2026 年 9 月",
            "is_current": True,
            "today": "2026-09-20",
            "days_in_month": 30,
            "day_of_month": 20,
            "days_left": 10,
            "remaining_period": "2026-09-21 至 2026-09-30",
            "progress": 2 / 3,
            "totals": {"budget": 1000, "spent": 800, "remaining": 200, "usage": 0.8},
            "categories": [
                {"name": "餐饮", "budget": 600, "spent": 500, "remaining": 100,
                 "usage": 5 / 6, "status_text": "正常"},
                {"name": "娱乐", "budget": 100, "spent": 180, "remaining": -80,
                 "usage": 1.8, "status_text": "已超预算"},
                {"name": "交通", "budget": 300, "spent": 120, "remaining": 180,
                 "usage": 0.4, "status_text": "正常"},
            ],
            "expenses": [
                {"spent_on": "2026-09-18", "category_name": "娱乐", "amount": 120, "note": ""},
                {"spent_on": "2026-09-10", "category_name": "餐饮", "amount": 80, "note": ""},
            ],
            "history": [
                {"month": "2026-08", "budget": 1000, "spent": 600, "remaining": 400, "usage": 0.6},
                {"month": "2026-07", "budget": 1000, "spent": 700, "remaining": 300, "usage": 0.7},
            ],
            "avg_per_day": 40,
            "projected": 1200,
            "future_expenses": [],
            "future_expense_total": 0,
        }

    def test_metrics_cover_pace_concentration_and_history(self):
        text = "\n".join(_analysis_metrics(self.ctx))
        self.assertIn("预算已用 80%", text)
        self.assertIn("快于时间进度 13 个百分点", text)
        self.assertIn("最大支出分类是餐饮 ¥500.00", text)
        self.assertIn("最大单笔是 2026-09-18 的娱乐 ¥120.00", text)
        self.assertIn("月底预测较该均值高 85%", text)

    def test_data_block_includes_precomputed_metrics_and_exact_period(self):
        text = _data_block(self.ctx)
        self.assertIn("【决策指标】（已由程序计算，可直接引用，不要自行改算）", text)
        self.assertIn("还剩 10 个完整自然日，不含今天", text)
        self.assertIn("剩余区间：2026-09-21 至 2026-09-30", text)
        self.assertIn("【行动约束】总预算剩余额度 ¥200.00", text)
        self.assertIn("【程序预排关键驱动】", text)

    def test_data_block_respects_user_defined_spending_type(self):
        self.ctx["categories"][0]["spending_type_text"] = "必要支出"
        self.ctx["categories"][0]["recurring"] = True
        self.ctx["categories"][0]["monthly_average"] = 480
        text = _data_block(self.ctx)
        self.assertIn("属性：必要支出", text)
        self.assertIn("近月月均 ¥480.00", text)
        self.assertIn("必要支出 / 可调整 / 偶发支出", _SYSTEM_PROMPT)

    def test_prompt_blocks_drafts_reallocation_and_unsupported_trends(self):
        self.assertIn("只输出最终报告", _SYSTEM_PROMPT)
        self.assertIn("禁止写某分类", _SYSTEM_PROMPT)
        self.assertIn("不能把总余额悄悄当成该分类余额", _SYSTEM_PROMPT)
        self.assertIn("不得把下月预算写成确定结论", _SYSTEM_PROMPT)
        self.assertIn("所有行动金额必须能同时成立", _SYSTEM_PROMPT)
        self.assertIn("不得凭空选择 ¥15、¥170", _SYSTEM_PROMPT)
        self.assertIn("直接采用其前 2~3 项及顺序", _SYSTEM_PROMPT)
        self.assertIn("<final_report>", _ASK_CURRENT)
        self.assertIn("**关键驱动**", _ASK_CURRENT)
        self.assertIn("**行动清单**", _ASK_CURRENT)

    def test_report_normalizer_removes_code_fences_and_compacts_headings(self):
        fence = chr(96) * 3
        raw = f"{fence}markdown\n## 结论\n状态正常\n\n\n- 动作\n{fence}"
        self.assertEqual(_normalize_report(raw), "**结论**：\n状态正常\n\n- 动作")

    def test_normalizer_keeps_only_last_formal_report(self):
        raw = (
            "先计算一下。结论：这是草稿。\n写简洁。\n"
            "结论：第一版\n关键驱动：\n- 草稿\n行动清单：\n- 草稿动作\n"
            "数一下字数，重新写。\n"
            "<final_report>\n**结论**：最终结论\n**关键驱动**：\n"
            "- [高] 最终驱动一\n- [中] 最终驱动二\n"
            "**行动清单**：\n- 最终动作一\n- 最终动作二\n</final_report>"
        )
        report = _normalize_report(raw)
        self.assertTrue(report.startswith("**结论**：最终结论"))
        self.assertNotIn("数一下字数", report)
        self.assertNotIn("第一版", report)
        _validate_report(report)

    def test_program_ranks_budget_variance_before_at_limit_risk(self):
        self.ctx["categories"] = [
            {"name": "伙食", "budget": 600, "spent": 600, "remaining": 0,
             "usage": 1.0, "status_text": "接近上限"},
            {"name": "其他", "budget": 0, "spent": 238, "remaining": -238,
             "usage": None, "status_text": "未设预算"},
            {"name": "备用金", "budget": 100, "spent": 168, "remaining": -68,
             "usage": 1.68, "status_text": "已超预算"},
        ]
        drivers = _priority_drivers(self.ctx)
        self.assertIn("其他：无预算支出 ¥238.00", drivers[0])
        self.assertIn("备用金：已超预算 ¥68.00", drivers[1])
        self.assertIn("伙食：预算已用 100%", drivers[2])

    def test_forecast_is_low_confidence_with_future_and_concentrated_spend(self):
        self.ctx["future_expenses"] = [
            {"spent_on": "2026-09-30", "amount": 80, "category_name": "餐饮"}
        ]
        self.ctx["history"] = []
        self.ctx["expenses"][0]["amount"] = 400
        confidence, reasons = _forecast_confidence(self.ctx)
        self.assertEqual(confidence, "低")
        self.assertIn("含未来日期流水", reasons)
        self.assertIn("没有历史基准", reasons)
        self.assertTrue(any("最大单笔占总支出" in item for item in reasons))

    def test_repair_messages_only_request_final_report(self):
        base = [{"role": "system", "content": "规则"}]
        repaired = _repair_messages(base, "候选与计算过程")
        self.assertEqual(repaired[-2]["role"], "assistant")
        self.assertIn("程序预排关键驱动", repaired[-1]["content"])
        self.assertIn("<final_report>", repaired[-1]["content"])

    def test_multi_agent_call_budget_stays_below_user_limit(self):
        self.assertEqual(SPECIALIST_COUNT, 3)
        self.assertLessEqual(MAX_ANALYSIS_CALLS, 10)
        self.assertEqual(MAX_ANALYSIS_CALLS, SPECIALIST_COUNT + 2)

    def test_specialist_data_is_compact_and_structured(self):
        payload = json.loads(_compact_agent_data(self.ctx))
        self.assertIn("pre_ranked_drivers", payload)
        self.assertIn("data_boundaries", payload)
        self.assertLessEqual(len(payload["top_expenses"]), 12)
        messages = _specialist_messages(self.ctx, "data_auditor")
        self.assertIn("只返回一个合法 JSON 对象", messages[0]["content"])

    def test_specialist_parser_ignores_reasoning_and_code_fence(self):
        fence = chr(96) * 3
        raw = (
            "<think>内部分析不能进入结果</think>\n"
            f"{fence}json\n{{\"verdict\":\"数据可用\",\"flags\":[]}}\n{fence}"
        )
        parsed = _parse_specialist_result("data_auditor", raw)
        self.assertEqual(parsed["status"], "ok")
        self.assertEqual(parsed["result"]["verdict"], "数据可用")

    def test_three_specialists_run_and_return_in_stable_order(self):
        def fake_chat(messages, cfg, **kwargs):
            return json.dumps({"verdict": "完成", "items": []}, ensure_ascii=False)

        with patch("core.ai._chat", side_effect=fake_chat):
            results = _run_specialists(self.ctx, {"model": "test"})
        self.assertEqual(list(results), ["data_auditor", "budget_analyst", "action_planner"])
        self.assertTrue(all(item["status"] == "ok" for item in results.values()))

    def test_synthesis_prompt_contains_specialist_reviews(self):
        reviews = {
            "data_auditor": {
                "agent": "data_auditor", "label": "数据审计员",
                "status": "ok", "result": {"verdict": "低可信度预测"},
            }
        }
        prompt = _user_prompt(self.ctx, specialist_reviews=reviews)
        self.assertIn("【多角色专业审阅】", prompt)
        self.assertIn("低可信度预测", prompt)

    def test_visual_snapshot_uses_deterministic_workbook_data(self):
        visuals = _visuals_of(self.ctx)
        self.assertEqual(visuals["budget_path"]["budget"], 1000)
        self.assertEqual(visuals["budget_path"]["spent"], 800)
        self.assertEqual(visuals["categories"][0]["name"], "餐饮")
        self.assertAlmostEqual(visuals["categories"][0]["share"], 0.625)
        self.assertEqual(visuals["data_flags"]["future_expense_count"], 0)

    def test_bundled_examples_pass_strict_validation(self):
        for raw in (_EXAMPLE_REPORT_CURRENT, _EXAMPLE_REPORT_PAST):
            _validate_report(_normalize_report(raw))

    def test_candidate_reasoning_output_is_rejected(self):
        raw = (
            "**结论**：预算已用96%，月底可能超支。要≤65字。\n"
            "**关键驱动**：候选：\n"
            "1. [高] 其他无预算支出，是否关键？\n"
            "2. [高] 备用金超支。\n"
            "按金额影响排序，再决定。\n"
            "**行动清单**：要对应驱动：\n"
            "- 先考虑额度。\n- 写简洁。"
        )
        with self.assertRaises(ValueError):
            _validate_report(_normalize_report(raw))

    def test_normalizer_decodes_html_entities_before_rendering(self):
        report = _normalize_report(
            "**结论**：预算已&#x652F;出 **¥10.00**\n"
            "**关键驱动**：\n- 已&#x82B1; **¥10.00**\n"
            "**行动清单**：\n- 停止新增"
        )
        self.assertIn("预算已支出", report)
        self.assertIn("已花", report)
        self.assertNotIn("&#x", report)

    def test_quality_notes_flag_future_and_unbudgeted_data(self):
        self.ctx["future_expenses"] = [
            {"spent_on": "2026-09-30", "amount": 80, "category_name": "餐饮"}
        ]
        self.ctx["future_expense_total"] = 80
        self.ctx["history"] = []
        self.ctx["categories"].append(
            {"name": "其他", "budget": 0, "spent": 50, "remaining": -50,
             "usage": None, "status_text": "未设预算"}
        )
        notes = "\n".join(_data_quality_notes(self.ctx))
        self.assertIn("2026-09-30", notes)
        self.assertIn("可能是预记账或日期误填", notes)
        self.assertIn("存在无预算支出：其他 ¥50.00", notes)
        self.assertIn("不能判断环比或长期趋势", notes)

    def test_validator_rejects_unstructured_draft(self):
        with self.assertRaises(ValueError):
            _validate_report("先计算预算使用率，再决定怎么写。")

    def test_local_report_is_structured_and_evidence_based(self):
        self.ctx["intelligence"] = {
            "forecast": {
                "central": 1180, "lower": 1080, "upper": 1280,
                "confidence": "medium",
            },
            "features": [],
            "anomalies": [],
        }
        self.ctx["anomalies"] = []
        report = _local_report(self.ctx, "未配置 API Key")
        _validate_report(report)
        self.assertIn("¥1180.00", report)
        self.assertIn("¥1080.00~¥1280.00", report)
        self.assertIn("本地规则生成", report)


if __name__ == "__main__":
    unittest.main()
