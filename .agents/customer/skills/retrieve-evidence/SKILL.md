---
name: retrieve-evidence
description: A factual claim requires evidence
version: 2026-10-08.2
---

Trigger: A factual claim requires evidence.
Inputs: question, committed conversation history, retrieved passages.
Steps: Use only passages supplied by the server read-only retrieval adapter. The adapter is already executed before your turn. Preserve passage identifiers, source type and version. Do not call shell, network, SQL or filesystem tools.
Allowed tools: no model tools; server-supplied read-only evidence only.
Output: JSON answer, citations (passage IDs), behavior (answer/clarify/abstain).
Failure: clarify or abstain with no invented claims.
