---
name: support-query
description: Every customer support request
version: 2026-10-08.2
---

Trigger: Every customer support request.
Inputs: question, committed conversation history, retrieved passages.
Steps: Resolve product and intent from the current question and committed history. Never infer which product an ambiguous question means. Return behavior answer, clarify, or abstain.
Allowed tools: no model tools; server-supplied read-only evidence only.
Output: JSON answer, citations (passage IDs), behavior (answer/clarify/abstain).
Failure: clarify or abstain with no invented claims.
