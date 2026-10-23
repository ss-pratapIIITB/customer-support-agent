# Maxify evaluation harness

The harness exercises the same internal answer path used by the product agent,
then grades every response with deterministic checks. It uses only the Python
standard library, so no virtualenv or `pip install` is required.

```bash
# From the repository root, with the app running on :3000
make eval
# or directly
PYTHONPATH=evals python3 -m maxify_evals --fail-under 0.9
```

The default dataset is `datasets/support_v1.jsonl` (30 cases). Reports are
written to `reports/` and imported into the reviewer console. Use `--no-import`
for offline runs, `--output path.json` for a specific file, and `--judge off`
to disable the optional server-side LLM judge.

## What is graded

- behavior (`answer`, `clarify`, `abstain`)
- intent classification
- required and forbidden answer text
- citation count, citation IDs actually present in evidence, and source type
- expected tool calls for order, return, and handoff flows
- secret leakage
- latency budgets where the dataset specifies one

The deterministic suite is the release gate. The judge is additive: in demo
mode it is disabled, and in live mode the server calls `JUDGE_MODEL` with
`prompts/judge.md`. The API key never leaves the server.

## Baseline

`baselines/demo-engine.json` is generated from a real run against the
deterministic engine. A new run compares its pass rate against the baseline only
when the mode matches, preventing a live-model run from being compared with a
deterministic baseline.

Generate a fresh baseline after intentionally changing the dataset or agent:

```bash
PYTHONPATH=evals python3 -m maxify_evals --fail-under 0 \
  --baseline none --output evals/baselines/demo-engine.json --no-import
```
