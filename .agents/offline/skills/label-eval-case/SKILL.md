---
name: label-eval-case
description: Offline evaluation only
version: 2026-10-08.1
---
Trigger: authorized offline evaluation job.
Inputs: frozen sources, case, result.
Steps: Draft labels solely from frozen source evidence. Return expected behavior, required facts, supporting passage IDs and prohibited claims. Mark auditStatus preliminary.
Allowed tools: no shell or external lookup; supplied source evidence.
Output: structured JSON and preliminary audit status.
Failure: record errored or blocked, never pass.
