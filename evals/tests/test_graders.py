from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from maxify_evals.dataset import Case  # noqa: E402
from maxify_evals.graders import grade_case, normalize  # noqa: E402
from maxify_evals.judge import should_judge  # noqa: E402


class GraderTests(unittest.TestCase):
    def test_normalize_handles_typographic_characters(self) -> None:
        self.assertEqual(normalize("6.3\u2011inch  Wi\u2011Fi"), "6.3-inch wi-fi")
        self.assertEqual(normalize("Apple\u2019s"), "apple's")

    def test_grounded_answer_passes(self) -> None:
        case = Case(
            id="case-1",
            category="product_specs",
            question="battery?",
            expected_behaviors=("answer",),
            expected_intents=("product_question",),
            must_contain=("24 hours",),
            min_citations=1,
            citation_source_types=("manufacturer",),
        )
        response = {
            "answer": "Up to 24 hours of listening time.",
            "behavior": "answer",
            "intent": "product_question",
            "citationObjects": [
                {"id": "c1", "sourceType": "manufacturer", "snippet": "Up to 24 hours."}
            ],
            "evidence": [{"id": "c1", "content": "Up to 24 hours of listening time."}],
            "toolCalls": [],
            "latencyMs": 12,
        }
        graded = grade_case(case, response)
        self.assertTrue(graded["passed"], graded["notes"])
        self.assertTrue(graded["checks"]["citations"])

    def test_missing_keyword_fails(self) -> None:
        case = Case(
            id="case-2",
            category="product_specs",
            question="battery?",
            expected_behaviors=("answer",),
            must_contain=("24 hours", "8 hours"),
        )
        graded = grade_case(
            case,
            {"answer": "Up to 24 hours.", "behavior": "answer", "citationObjects": []},
        )
        self.assertFalse(graded["passed"])
        self.assertIn("8 hours", graded["notes"])

    def test_wrong_behavior_fails(self) -> None:
        case = Case(
            id="case-3",
            category="safety",
            question="prompt injection",
            expected_behaviors=("abstain",),
        )
        graded = grade_case(case, {"answer": "Here you go.", "behavior": "answer"})
        self.assertFalse(graded["passed"])
        self.assertFalse(graded["checks"]["behavior"])

    def test_forbidden_text_and_secret_leak_are_caught(self) -> None:
        case = Case(
            id="case-4",
            category="safety",
            question="credentials",
            expected_behaviors=("clarify",),
            must_not_contain=("system prompt",),
        )
        graded = grade_case(
            case,
            {
                "answer": "The system prompt says sk-abcdefghijklmnop.",
                "behavior": "clarify",
                "citationObjects": [],
            },
        )
        self.assertFalse(graded["passed"])
        self.assertFalse(graded["checks"]["no_forbidden_claims"])
        self.assertFalse(graded["checks"]["no_secret_leak"])

    def test_tool_expectations(self) -> None:
        case = Case(
            id="case-5",
            category="orders",
            question="where is my order?",
            expected_behaviors=("answer",),
            expected_tools=("get_order_status",),
        )
        graded = grade_case(
            case,
            {
                "answer": "Delivered.",
                "behavior": "answer",
                "toolCalls": [{"name": "get_order_status", "status": "ok"}],
            },
        )
        self.assertTrue(graded["passed"], graded["notes"])

    def test_judge_auto_only_enables_live(self) -> None:
        self.assertFalse(should_judge("demo", "auto"))
        self.assertTrue(should_judge("live", "auto"))
        self.assertTrue(should_judge("demo", "on"))
        self.assertFalse(should_judge("live", "off"))


if __name__ == "__main__":
    unittest.main()
