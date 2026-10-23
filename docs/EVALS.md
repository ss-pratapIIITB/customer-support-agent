# Evaluation guide

The evaluation harness is the release gate. It runs against the same HTTP API and answer path as the product, grades deterministic properties, and can optionally ask a server-side LLM judge for rubric scores.

## Why two layers

**Deterministic graders** answer “did the system do the required thing?” They are reproducible, cheap, and suitable for CI:

- expected behavior (`answer`, `clarify`, `abstain`)
- intent class
- required and forbidden text
- citation count, citation IDs present in evidence, citation source type
- required/forbidden tool calls
- secret-shaped leakage
- optional latency budgets

**LLM judge** answers “is the prose faithful and well-supported?” It is additive, disabled in demo mode, and never replaces deterministic checks. In live mode the application server calls `JUDGE_MODEL`; the Python harness never receives the provider key.

## Running

```bash
# App running at :3000
make eval

# Explicit options
PYTHONPATH=evals python3 -m maxify_evals \
  --base-url http://127.0.0.1:3000 \
  --token local-eval-token-change-me \
  --fail-under 0.9

# Offline report, no reviewer import
PYTHONPATH=evals python3 -m maxify_evals --no-import --baseline none

# Regenerate the checked-in baseline
make eval-baseline
```

Exit codes: `0` pass, `1` below `--fail-under`, `2` dataset/configuration/API error.

Reports are written to `evals/reports/<run-id>.json` and imported into the reviewer console unless `--no-import` is set. Use `--output` to choose a path. Reviewers can also press **Run evals** in the console; the server launches the same harness and imports the report automatically.

## Dataset

`evals/datasets/support_v1.jsonl` contains 30 cases. Each line is a JSON object:

```json
{
  "id": "prod-battery-pro",
  "category": "product_specs",
  "question": "What is the battery life of AirPods Pro 3?",
  "expected_behavior": "answer",
  "expected_intent": "product_question",
  "must_contain": ["24 hours", "8 hours"],
  "min_citations": 1,
  "citation_source_types": ["manufacturer"],
  "tags": ["grounded", "headphones"]
}
```

Optional fields:

| Field                   | Meaning                                        |
| ----------------------- | ---------------------------------------------- |
| `must_contain_any`      | At least one of these strings must appear      |
| `must_not_contain`      | None of these strings may appear               |
| `citation_source_types` | Required source type(s) among citations        |
| `expected_tools`        | Tool names that must be called                 |
| `forbidden_tools`       | Tool names that must not be called             |
| `history`               | Prior user/assistant turns for follow-up cases |
| `max_latency_ms`        | Per-case latency budget                        |
| `notes`                 | Human context, not graded                      |

Coverage: 6 product specs, 4 policies, 4 orders, 4 returns, 5 safety, 3 ambiguity, 3 comparisons, 1 handoff.

## Grading rules

A case passes only when every applicable check passes. The report includes a `checks` object per case so failures are inspectable.

Citation validity requires:

1. at least `min_citations` citations;
2. every citation ID exists in the response evidence;
3. at least one citation matches each required `citation_source_types` entry when specified.

The harness normalizes typographic quotes and dashes so `6.3‑inch` and `6.3-inch` compare correctly. Secret scanning rejects key-shaped strings such as `sk-...`, bearer tokens, and `OPENAI_API_KEY=`/`DATABASE_URL=` assignments.

## Baseline comparison

`evals/baselines/demo-engine.json` is generated from a real run against the deterministic engine. A run is compared only when the report mode matches the baseline mode, preventing a live-model run from being compared with demo numbers. The report shows the baseline run ID, baseline pass rate, delta in percentage points, and a one-line comparison.

Regenerate the baseline after an intentional change to the dataset or demo engine:

```bash
make eval-baseline
make eval
```

Do not “fix” a regression by immediately regenerating the baseline. Inspect the failing cases and the diff first.

## CI

`.github/workflows/ci.yml` runs two jobs:

1. lint, typecheck, TypeScript tests, Python grader tests, production build;
2. a Postgres-backed end-to-end job: bootstrap, start the app, smoke, HTTP integration, reliability, then `make eval` with the checked-in baseline.

The evaluation job uploads application logs on failure.

## Unit tests

```bash
PYTHONPATH=evals python3 -m unittest discover -s evals/tests -v
```

The tests cover dataset validation, normalization, pass/fail grading, citation/tool checks, secret detection, and judge enablement. They require no database or network.

## Limitations

- The dataset is intentionally small and domain-specific; 30/30 does not imply general support quality.
- The deterministic engine and dataset share assumptions. The optional judge and live-model runs provide independent signal.
- The judge is not a human label. Treat its scores as triage until reviewed.
- Cases with account state (orders) depend on the seeded demo data.
- Latency budgets are local defaults, not production SLOs.
