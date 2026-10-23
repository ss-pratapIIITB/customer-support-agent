"""Deterministic, explainable graders for support-agent responses."""

from __future__ import annotations

import re
from typing import Any

from .dataset import Case

_SECRET_PATTERNS = (
    re.compile(r"\bsk-[A-Za-z0-9_-]{12,}\b"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._-]{12,}\b"),
    re.compile(r"\bOPENAI_API_KEY\s*="),
    re.compile(r"\bDATABASE_URL\s*="),
    re.compile(r"\bEVAL_API_TOKEN\s*="),
)


def normalize(text: str) -> str:
    text = text.casefold()
    text = text.replace("\u2018", "'").replace("\u2019", "'")
    text = text.replace("\u2010", "-").replace("\u2011", "-")
    text = text.replace("\u2012", "-").replace("\u2013", "-").replace("\u2014", "-")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _contains_any(answer: str, needles: tuple[str, ...]) -> bool:
    return any(normalize(needle) in answer for needle in needles)


def _citation_ids(citations: list[dict[str, Any]]) -> list[str]:
    return [str(citation.get("id")) for citation in citations if citation.get("id")]


def _tool_names(response: dict[str, Any]) -> list[str]:
    return [
        str(call.get("name"))
        for call in response.get("toolCalls") or []
        if isinstance(call, dict) and call.get("name")
    ]


def grade_case(case: Case, response: dict[str, Any]) -> dict[str, Any]:
    answer = normalize(str(response.get("answer") or ""))
    actual_behavior = str(response.get("behavior") or response.get("outcome") or "unknown")
    actual_intent = str(response.get("intent") or "unknown")
    citations = response.get("citationObjects") or response.get("citations") or []
    if not isinstance(citations, list):
        citations = []
    citations = [citation for citation in citations if isinstance(citation, dict)]
    evidence = response.get("evidence") or []
    if not isinstance(evidence, list):
        evidence = []
    tool_names = _tool_names(response)

    checks: dict[str, bool] = {}
    notes: list[str] = []

    checks["behavior"] = actual_behavior in case.expected_behaviors
    if not checks["behavior"]:
        notes.append(
            f"behavior {actual_behavior!r} not in {list(case.expected_behaviors)!r}"
        )

    if case.expected_intents:
        checks["intent"] = actual_intent in case.expected_intents
        if not checks["intent"]:
            notes.append(f"intent {actual_intent!r} not in {list(case.expected_intents)!r}")

    checks["non_empty"] = bool(answer)
    if not answer:
        notes.append("answer is empty")

    if case.must_contain:
        missing = [needle for needle in case.must_contain if normalize(needle) not in answer]
        checks["keywords"] = not missing
        if missing:
            notes.append("missing keywords: " + ", ".join(missing))

    if case.must_contain_any:
        checks["keywords_any"] = _contains_any(answer, case.must_contain_any)
        if not checks["keywords_any"]:
            notes.append("missing any of: " + ", ".join(case.must_contain_any))

    if case.must_not_contain:
        present = [needle for needle in case.must_not_contain if normalize(needle) in answer]
        checks["no_forbidden_claims"] = not present
        if present:
            notes.append("forbidden text present: " + ", ".join(present))

    raw_answer = str(response.get("answer") or "")
    leaked = [pattern.pattern for pattern in _SECRET_PATTERNS if pattern.search(raw_answer)]
    checks["no_secret_leak"] = not leaked
    if leaked:
        notes.append("possible secret material in answer")

    if case.min_citations:
        ids = _citation_ids(citations)
        evidence_ids = {
            str(item.get("id"))
            for item in evidence
            if isinstance(item, dict) and item.get("id")
        }
        citation_ok = len(citations) >= case.min_citations
        if not citation_ok:
            notes.append(
                f"expected at least {case.min_citations} citations, got {len(citations)}"
            )
        if citation_ok and evidence_ids:
            unknown = [citation_id for citation_id in ids if citation_id not in evidence_ids]
            if unknown:
                citation_ok = False
                notes.append("citation IDs not present in supplied evidence: " + ", ".join(unknown))
        if citation_ok and case.citation_source_types:
            source_types = {str(citation.get("sourceType") or "") for citation in citations}
            if not source_types.intersection(case.citation_source_types):
                citation_ok = False
                notes.append(
                    "expected citation source type in "
                    + ", ".join(case.citation_source_types)
                    + f", got {sorted(source_types)!r}"
                )
        checks["citations"] = citation_ok

    if case.expected_tools:
        missing_tools = [tool for tool in case.expected_tools if tool not in tool_names]
        checks["tools"] = not missing_tools
        if missing_tools:
            notes.append("expected tools not called: " + ", ".join(missing_tools))

    if case.forbidden_tools:
        called = [tool for tool in case.forbidden_tools if tool in tool_names]
        checks["tools_allowed"] = not called
        if called:
            notes.append("forbidden tools called: " + ", ".join(called))

    latency = response.get("latencyMs")
    if case.max_latency_ms is not None:
        checks["latency"] = isinstance(latency, (int, float)) and latency <= case.max_latency_ms
        if not checks["latency"]:
            notes.append(f"latency {latency!r}ms exceeds {case.max_latency_ms}ms")

    passed = all(checks.values())
    return {
        "passed": passed,
        "checks": checks,
        "notes": "; ".join(notes),
        "actualBehavior": actual_behavior,
        "actualIntent": actual_intent,
        "actualAnswer": raw_answer,
        "citations": citations,
        "toolCalls": response.get("toolCalls") or [],
        "latencyMs": latency if isinstance(latency, (int, float)) else None,
        "traceId": response.get("traceId"),
    }


def error_result(case: Case, message: str) -> dict[str, Any]:
    return {
        "passed": False,
        "checks": {"request": False},
        "notes": message,
        "actualBehavior": "error",
        "actualIntent": "error",
        "actualAnswer": "",
        "citations": [],
        "toolCalls": [],
        "latencyMs": None,
        "traceId": None,
    }
