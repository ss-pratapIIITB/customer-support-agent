"""Command-line entry point for the Maxify evaluation harness."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .api import EvalApi, EvalApiError
from .dataset import DatasetError, load_dataset
from .graders import error_result, grade_case
from .judge import aggregate as aggregate_judge
from .judge import judge_case, should_judge
from .report import build_report, utc_now

EVALS_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATASET = EVALS_ROOT / "datasets" / "support_v1.jsonl"
DEFAULT_BASELINE = EVALS_ROOT / "baselines" / "demo-engine.json"
DEFAULT_OUTPUT_DIR = EVALS_ROOT / "reports"


def _new_run_id() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"run-{stamp}-{uuid.uuid4().hex[:6]}"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python3 -m maxify_evals",
        description="Run the Maxify support-agent evaluation suite.",
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("MAXIFY_BASE_URL", os.environ.get("APP_BASE_URL", "http://127.0.0.1:3000")),
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("EVAL_API_TOKEN", "local-eval-token-change-me"),
        help="Value for the x-eval-token header.",
    )
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--user-id", default=None, help="Customer used for order and tool cases.")
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument(
        "--baseline",
        default=str(DEFAULT_BASELINE),
        help="Baseline JSON path, or 'none' to disable comparison.",
    )
    parser.add_argument("--judge", choices=("auto", "on", "off"), default="auto")
    parser.add_argument("--no-import", action="store_true", help="Do not POST the report to the app.")
    parser.add_argument("--fail-under", type=float, default=0.9)
    parser.add_argument("--timeout", type=float, default=90.0)
    parser.add_argument("--retries", type=int, default=2)
    return parser


def _print_case(record: dict) -> None:
    status = "PASS" if record["passed"] else "FAIL"
    latency = record.get("latencyMs")
    latency_text = f"{latency:.0f}ms" if isinstance(latency, (int, float)) else "-"
    print(
        f"  {status:<4} {record['id']:<22} {record['actualBehavior']:<9} "
        f"{record.get('actualIntent', '-'):<20} {latency_text:>7}"
    )
    if not record["passed"] and record.get("notes"):
        print(f"       {record['notes'][:400]}")


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    run_id = args.run_id or _new_run_id()
    dataset_path = args.dataset.expanduser().resolve()
    baseline_path = (
        None
        if str(args.baseline).lower() in {"none", "off", ""}
        else Path(args.baseline).expanduser().resolve()
    )
    if not 0 <= args.fail_under <= 1:
        print("--fail-under must be between 0 and 1", file=sys.stderr)
        return 2

    started_at = utc_now()
    started = time.monotonic()
    try:
        cases = load_dataset(dataset_path)
    except DatasetError as error:
        print(f"Dataset error: {error}", file=sys.stderr)
        return 2

    api = EvalApi(
        base_url=args.base_url,
        token=args.token,
        run_id=run_id,
        timeout=args.timeout,
        retries=args.retries,
    )
    try:
        meta = api.meta()
    except EvalApiError as error:
        print(f"Could not reach the evaluation API: {error}", file=sys.stderr)
        print(f"Start the app first, for example: npm run start:dev", file=sys.stderr)
        return 2

    user_id = args.user_id or meta.get("demoUserId")
    if not user_id:
        print("No demo user is available. Run npm run bootstrap and retry.", file=sys.stderr)
        return 2

    judge_enabled = should_judge(str(meta.get("mode") or "demo"), args.judge)
    print("Maxify support evaluation")
    print(
        f"  target   {args.base_url}  mode={meta.get('mode')}  model={meta.get('model')}  "
        f"corpus={(meta.get('corpusVersion') or 'unknown')[:12]}"
    )
    print(
        f"  dataset  {dataset_path.name}  cases={len(cases)}  "
        f"judge={'on' if judge_enabled else 'off'}  run={run_id}"
    )
    print("")

    results: list[dict] = []
    judged: list[dict] = []
    for case in cases:
        case_started = time.monotonic()
        try:
            response = api.answer(case, user_id)
            graded = grade_case(case, response)
            if judge_enabled:
                judged_result = judge_case(api, case, response)
                judged.append(judged_result)
            else:
                judged_result = {"enabled": False, "reason": "deterministic grading only"}
        except EvalApiError as error:
            graded = error_result(case, str(error))
            judged_result = {"enabled": False, "error": str(error)}

        if graded.get("latencyMs") is None:
            graded["latencyMs"] = round((time.monotonic() - case_started) * 1000, 1)
        record = {
            "id": case.id,
            "category": case.category,
            "question": case.question,
            "expectedBehavior": case.expected_behavior,
            "expectedBehaviors": list(case.expected_behaviors),
            "expectedIntents": list(case.expected_intents),
            "minCitations": case.min_citations,
            "notes": graded["notes"],
            **{key: value for key, value in graded.items() if key != "notes"},
            "judge": judged_result,
        }
        results.append(record)
        _print_case(record)

    finished_at = utc_now()
    try:
        dataset_display = str(dataset_path.relative_to(EVALS_ROOT.parent))
    except ValueError:
        dataset_display = dataset_path.name
    report = build_report(
        run_id=run_id,
        dataset_name=dataset_path.stem,
        dataset_path=dataset_display,
        cases=cases,
        results=results,
        meta=meta,
        started_at=started_at,
        finished_at=finished_at,
        baseline_path=baseline_path,
        judge_aggregate=aggregate_judge(judged) if judge_enabled else None,
    )

    output = args.output or (DEFAULT_OUTPUT_DIR / f"{run_id}.json")
    output = output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    summary = report["summary"]
    elapsed = time.monotonic() - started
    print("")
    print(
        f"Summary: {summary['passed']}/{summary['total']} passed "
        f"({summary['passRate'] * 100:.1f}%) in {elapsed:.1f}s"
    )
    print(
        f"  answer accuracy {summary['answerAccuracy'] * 100:.1f}%  "
        f"citation validity {summary['citationValidity'] * 100:.1f}%  "
        f"unsafe rate {summary['unsafeRate'] * 100:.1f}%  "
        f"p95 {summary['p95LatencyMs'] or '-'}ms"
    )
    if report.get("comparison"):
        print(f"  {report['comparison']['summary']}")
    print(f"  report {output}")

    if not args.no_import:
        try:
            imported = api.import_report(report)
            print(f"  imported to reviewer console ({imported.get('runId', run_id)})")
        except EvalApiError as error:
            print(f"  warning: report import failed: {error}", file=sys.stderr)

    if summary["passRate"] < args.fail_under:
        print(
            f"Failed: pass rate {summary['passRate'] * 100:.1f}% is below "
            f"--fail-under {args.fail_under * 100:.1f}%",
            file=sys.stderr,
        )
        return 1
    return 0
