"""Report construction and baseline comparison."""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .dataset import Case
from .judge import aggregate as aggregate_judge


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _ratio(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 1.0


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, math.ceil(percentile * len(ordered)) - 1)
    return round(ordered[index], 1)


def _load_baseline(path: Path | None) -> dict[str, Any] | None:
    if path is None or not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def build_report(
    *,
    run_id: str,
    dataset_name: str,
    dataset_path: str,
    cases: list[Case],
    results: list[dict[str, Any]],
    meta: dict[str, Any],
    started_at: str,
    finished_at: str,
    baseline_path: Path | None,
    judge_aggregate: dict[str, Any] | None,
) -> dict[str, Any]:
    passed = sum(1 for item in results if item.get("passed"))
    total = len(results)
    latencies = [
        float(item["latencyMs"])
        for item in results
        if isinstance(item.get("latencyMs"), (int, float))
    ]

    answer_cases = [item for item in results if "answer" in item.get("expectedBehaviors", [])]
    citation_cases = [
        item
        for item in answer_cases
        if item.get("minCitations", 0) > 0
    ]
    safety_cases = [item for item in results if item.get("category") == "safety"]

    summary = {
        "total": total,
        "passed": passed,
        "failed": total - passed,
        "passRate": _ratio(passed, total),
        "answerAccuracy": _ratio(
            sum(1 for item in answer_cases if item.get("passed")),
            len(answer_cases),
        ),
        "citationValidity": _ratio(
            sum(1 for item in citation_cases if item.get("checks", {}).get("citations") is True),
            len(citation_cases),
        ),
        "unsafeRate": _ratio(
            sum(1 for item in safety_cases if not item.get("passed")),
            len(safety_cases),
        ),
        "avgLatencyMs": round(sum(latencies) / len(latencies), 1) if latencies else None,
        "p95LatencyMs": _percentile(latencies, 0.95),
        "toolCalls": sum(len(item.get("toolCalls") or []) for item in results),
    }

    categories: dict[str, dict[str, Any]] = {}
    for item in results:
        category = str(item.get("category") or "general")
        bucket = categories.setdefault(category, {"category": category, "total": 0, "passed": 0})
        bucket["total"] += 1
        if item.get("passed"):
            bucket["passed"] += 1
    category_rows = []
    for bucket in sorted(categories.values(), key=lambda row: row["category"]):
        bucket["passRate"] = _ratio(bucket["passed"], bucket["total"])
        category_rows.append(bucket)

    mode = str(meta.get("mode") or "demo")
    comparison = None
    baseline = _load_baseline(baseline_path)
    if (
        baseline
        and isinstance(baseline.get("summary"), dict)
        and baseline.get("mode") == mode
        and isinstance(baseline["summary"].get("passRate"), (int, float))
    ):
        baseline_rate = float(baseline["summary"]["passRate"])
        delta = round(summary["passRate"] - baseline_rate, 4)
        baseline_id = str(baseline.get("runId") or "checked-in baseline")
        if delta == 0:
            summary_text = f"Matched the checked-in {mode} baseline at {baseline_rate * 100:.1f}% pass rate."
        else:
            sign = "+" if delta >= 0 else ""
            summary_text = (
                f"Compared with {baseline_id}: {sign}{delta * 100:.1f} pts "
                f"(baseline {baseline_rate * 100:.1f}%)."
            )
        comparison = {
            "baselineRunId": baseline_id,
            "baselinePassRate": baseline_rate,
            "passRateDelta": delta,
            "summary": summary_text,
        }

    judge = judge_aggregate if judge_aggregate and judge_aggregate.get("enabled") else {
        "enabled": False,
        "casesJudged": 0,
        "model": meta.get("judgeModel"),
        "reason": "deterministic grading only",
    }

    return {
        "runId": run_id,
        "harness": "python-harness",
        "status": "completed",
        "mode": mode,
        "model": meta.get("model"),
        "promptVersion": meta.get("promptVersion"),
        "corpusVersion": meta.get("corpusVersion"),
        "embeddings": meta.get("embeddings"),
        "dataset": {
            "name": dataset_name,
            "version": "1.0.0",
            "path": dataset_path,
            "cases": len(cases),
        },
        "judge": judge,
        "summary": summary,
        "categories": category_rows,
        "cases": results,
        "comparison": comparison,
        "startedAt": started_at,
        "finishedAt": finished_at,
    }
