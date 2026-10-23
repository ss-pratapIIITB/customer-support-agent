"""Optional LLM judge.

The API key never leaves the application server. The Python harness calls the
internal judge endpoint, which uses the server-side JUDGE_MODEL.
"""

from __future__ import annotations

from typing import Any

from .api import EvalApi, EvalApiError
from .dataset import Case

DIMENSIONS = ("faithfulness", "answer_relevance", "citation_support", "policy_compliance")


def should_judge(mode: str, requested: str) -> bool:
    if requested == "off":
        return False
    if requested == "on":
        return True
    return mode == "live"


def judge_case(
    api: EvalApi,
    case: Case,
    response: dict[str, Any],
) -> dict[str, Any]:
    citations = response.get("citationObjects") or []
    evidence = response.get("evidence") or []
    try:
        result = api.judge(
            question=case.question,
            answer=str(response.get("answer") or ""),
            expected_behavior=case.expected_behavior,
            citations=[
                {
                    "id": str(item.get("id")),
                    "title": item.get("title"),
                    "section": item.get("section"),
                    "snippet": item.get("snippet"),
                }
                for item in citations
                if isinstance(item, dict) and item.get("id")
            ],
            evidence=[
                {
                    "id": str(item.get("id")),
                    "title": item.get("title"),
                    "section": item.get("section"),
                    "content": str(item.get("content") or "")[:2000],
                }
                for item in evidence[:8]
                if isinstance(item, dict) and item.get("id")
            ],
        )
    except EvalApiError as error:
        return {"enabled": False, "error": str(error)}

    if not result.get("enabled"):
        return {
            "enabled": False,
            "reason": result.get("reason") or "judge is unavailable",
        }

    scores = {
        dimension: result.get(dimension)
        for dimension in DIMENSIONS
        if isinstance(result.get(dimension), (int, float))
    }
    return {
        "enabled": True,
        "model": result.get("model"),
        "scores": scores,
        "mean": round(sum(scores.values()) / len(scores), 2) if scores else None,
        "rationale": str(result.get("rationale") or "")[:1200],
        "usage": result.get("usage"),
    }


def aggregate(judged_cases: list[dict[str, Any]]) -> dict[str, Any]:
    enabled = [item for item in judged_cases if item.get("enabled")]
    if not enabled:
        return {"enabled": False, "casesJudged": 0}
    totals = {dimension: 0.0 for dimension in DIMENSIONS}
    counts = {dimension: 0 for dimension in DIMENSIONS}
    for item in enabled:
        for dimension, value in (item.get("scores") or {}).items():
            if dimension in totals:
                totals[dimension] += float(value)
                counts[dimension] += 1
    means = {
        dimension: round(totals[dimension] / counts[dimension], 2)
        for dimension in DIMENSIONS
        if counts[dimension]
    }
    overall = round(sum(means.values()) / len(means), 2) if means else None
    return {
        "enabled": True,
        "casesJudged": len(enabled),
        "model": next((item.get("model") for item in enabled if item.get("model")), None),
        "means": means,
        "mean": overall,
    }
