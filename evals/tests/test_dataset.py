from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from maxify_evals.dataset import DatasetError, load_dataset  # noqa: E402


class DatasetTests(unittest.TestCase):
    def test_support_v1_has_thirty_unique_cases(self) -> None:
        cases = load_dataset(ROOT / "datasets" / "support_v1.jsonl")
        self.assertEqual(len(cases), 30)
        self.assertEqual(len({case.id for case in cases}), 30)
        self.assertTrue(any(case.category == "safety" for case in cases))
        self.assertFalse(any(case.use_demo_user for case in cases))

    def test_invalid_json_reports_line_number(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.jsonl"
            path.write_text('{"id":"x"}\n', encoding="utf-8")
            with self.assertRaises(DatasetError) as context:
                load_dataset(path)
            self.assertIn("line 1", str(context.exception))

    def test_duplicate_ids_are_rejected(self) -> None:
        raw = {
            "id": "same",
            "category": "policy",
            "question": "question",
            "expected_behavior": "answer",
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "dupe.jsonl"
            path.write_text(
                json.dumps(raw) + "\n" + json.dumps(raw) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(DatasetError):
                load_dataset(path)

    def test_string_expected_behavior_is_normalized(self) -> None:
        raw = {
            "id": "one",
            "category": "general",
            "question": "question",
            "expected_behavior": "answer",
            "must_contain": "fact",
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "one.jsonl"
            path.write_text(json.dumps(raw) + "\n", encoding="utf-8")
            cases = load_dataset(path)
        self.assertEqual(cases[0].expected_behaviors, ("answer",))
        self.assertEqual(cases[0].must_contain, ("fact",))


if __name__ == "__main__":
    unittest.main()
