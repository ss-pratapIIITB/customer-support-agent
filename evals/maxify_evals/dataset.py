"""Dataset loading and validation.

The harness intentionally uses only the Python standard library so a reviewer
can run it with a stock Python 3 installation.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable


class DatasetError(ValueError):
    """Raised when an evaluation dataset is malformed."""


@dataclass(frozen=True)
class Case:
    id: str
    category: str
    question: str
    expected_behaviors: tuple[str, ...]
    expected_intents: tuple[str, ...] = ()
    must_contain: tuple[str, ...] = ()
    must_contain_any: tuple[str, ...] = ()
    must_not_contain: tuple[str, ...] = ()
    min_citations: int = 0
    citation_source_types: tuple[str, ...] = ()
    expected_tools: tuple[str, ...] = ()
    forbidden_tools: tuple[str, ...] = ()
    history: tuple[dict[str, str], ...] = ()
    use_demo_user: bool = False
    notes: str = ""
    max_latency_ms: int | None = None
    tags: tuple[str, ...] = field(default_factory=tuple)

    @property
    def expected_behavior(self) -> str:
        return "/".join(self.expected_behaviors)


def _as_tuple(value: Any) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        return (value,)
    if isinstance(value, (list, tuple)):
        return tuple(str(item) for item in value)
    raise DatasetError(f"expected a string or list, got {type(value).__name__}")


def _parse_case(raw: dict[str, Any], line_number: int) -> Case:
    try:
        case_id = str(raw["id"]).strip()
        category = str(raw["category"]).strip()
        question = str(raw["question"]).strip()
        expected = _as_tuple(raw.get("expected_behavior"))
    except KeyError as error:
        raise DatasetError(f"line {line_number}: missing field {error.args[0]!r}") from error

    if not case_id:
        raise DatasetError(f"line {line_number}: id is empty")
    if not category:
        raise DatasetError(f"line {line_number}: category is empty")
    if not question:
        raise DatasetError(f"line {line_number}: question is empty")
    if not expected:
        raise DatasetError(f"line {line_number}: expected_behavior is required")

    history_raw = raw.get("history") or []
    if not isinstance(history_raw, list):
        raise DatasetError(f"line {line_number}: history must be a list")
    history: list[dict[str, str]] = []
    for message in history_raw:
        if not isinstance(message, dict) or message.get("role") not in {"user", "assistant"}:
            raise DatasetError(f"line {line_number}: history entries need role and content")
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            raise DatasetError(f"line {line_number}: history content must be non-empty text")
        history.append({"role": message["role"], "content": content})

    min_citations = raw.get("min_citations", 0)
    if not isinstance(min_citations, int) or min_citations < 0:
        raise DatasetError(f"line {line_number}: min_citations must be a non-negative integer")

    max_latency = raw.get("max_latency_ms")
    if max_latency is not None and (not isinstance(max_latency, int) or max_latency <= 0):
        raise DatasetError(f"line {line_number}: max_latency_ms must be a positive integer")

    return Case(
        id=case_id,
        category=category,
        question=question,
        expected_behaviors=expected,
        expected_intents=_as_tuple(raw.get("expected_intent") or raw.get("expected_intents")),
        must_contain=_as_tuple(raw.get("must_contain")),
        must_contain_any=_as_tuple(raw.get("must_contain_any")),
        must_not_contain=_as_tuple(raw.get("must_not_contain")),
        min_citations=min_citations,
        citation_source_types=_as_tuple(raw.get("citation_source_types")),
        expected_tools=_as_tuple(raw.get("expected_tools")),
        forbidden_tools=_as_tuple(raw.get("forbidden_tools")),
        history=tuple(history),
        use_demo_user=bool(raw.get("use_demo_user", False)),
        notes=str(raw.get("notes") or ""),
        max_latency_ms=max_latency,
        tags=_as_tuple(raw.get("tags")),
    )


def load_dataset(path: Path) -> list[Case]:
    if not path.exists():
        raise DatasetError(f"dataset not found: {path}")

    cases: list[Case] = []
    seen: set[str] = set()
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        try:
            raw = json.loads(line)
        except json.JSONDecodeError as error:
            raise DatasetError(f"line {line_number}: invalid JSON: {error}") from error
        if not isinstance(raw, dict):
            raise DatasetError(f"line {line_number}: expected a JSON object")
        if "_meta" in raw:
            continue
        case = _parse_case(raw, line_number)
        if case.id in seen:
            raise DatasetError(f"line {line_number}: duplicate case id {case.id!r}")
        seen.add(case.id)
        cases.append(case)

    if not cases:
        raise DatasetError(f"dataset is empty: {path}")
    return cases


def dataset_name(path: Path) -> str:
    return path.stem


def category_totals(cases: Iterable[Case]) -> dict[str, int]:
    totals: dict[str, int] = {}
    for case in cases:
        totals[case.category] = totals.get(case.category, 0) + 1
    return totals
