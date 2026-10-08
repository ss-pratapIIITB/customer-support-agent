---
name: evaluate-support-run
description: Offline evaluation only
version: 2026-10-08.1
---
Trigger: authorized offline evaluation job.
Inputs: frozen sources, case, result.
Steps: Judge supplied labels, evidence and actual response. Grade correctness, coverage, claim support and expected behavior separately. Explain failures. Model judgments remain preliminary.
Allowed tools: no shell or external lookup; supplied source evidence.
Output: structured JSON and preliminary audit status.
Failure: record errored or blocked, never pass.
