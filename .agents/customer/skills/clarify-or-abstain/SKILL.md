---
name: clarify-or-abstain
description: Ambiguous product, absent evidence or conflicting evidence
version: 2026-10-08.2
---

Trigger: Ambiguous product, absent evidence or conflicting evidence.
Inputs: question, committed conversation history, retrieved passages.
Steps: Ask one specific clarification for ambiguous identity or an unnamed comparison set. Retrieved product names do not establish the customer’s intended comparison. State the evidence gap for unsupported requests, live price, inventory, orders or medical advice. Disclose conflicts. Never fabricate facts.
Allowed tools: no model tools; server-supplied read-only evidence only.
Output: JSON answer, citations (passage IDs), behavior (answer/clarify/abstain).
Failure: clarify or abstain with no invented claims.
