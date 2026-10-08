# Customer Support Demo Implementation Plan

> **For agentic workers:** Use subagent-driven-development for the independent tasks below. The product owner explicitly authorized parallel implementation.

**Goal:** Deliver a working local support portal by 10:45 AM Singapore time.

**Architecture:** Express serves a React portal and authenticated APIs. A local Codex SDK answers using PostgreSQL hybrid retrieval, with all model requests passing through LiteLLM. PostgreSQL persists user sessions, chats, evidence, traces, and evaluations.

**Tech Stack:** TypeScript, React, Express, PostgreSQL, pgvector, Codex SDK, LiteLLM, Docker Compose.

## Global constraints

- Customer model is gpt-6-luna; offline labeling and judging use gpt-6-sol.
- Real public product snapshots and visibly fictional retailer policies form the corpus.
- Authentication and chat ownership are enforced server-side; restart recovery and duplicate protection require durable state.
- Raw documents remain separately available. Quality results distinguish audited, preliminary, failed, and skipped cases.
- Six distinct failures are verified; simulation versus real integration is explicit.
- Agents edit disjoint owned files; root owns dependency files, API routes, deployment, and integration.

## Task 1 Data and retrieval

Owned files: src/db.ts, src/rag.ts, scripts/ingest.ts, data/**, tests/rag.test.ts. Export query<T>(sql, values) returning rows/rowCount, pool, initializeDatabase(). Export retrieve(question, options?) returning Passage[], ingest(options?) returning a summary, and listSources(). Create users/auth_sessions/chats/messages/requests/traces/eval_runs plus document/version/chunk tables. Root receives the schema promptly. Preserve six sources; batch and cache embeddings; stage corpus activation; create GIN/B-tree/HNSW indexes. Verify evidence lookup and interruption/idempotent ingestion behavior with meaningful tests.

## Task 2 Agent and evaluations

Owned files: src/agent.ts, src/evals.ts, scripts/eval.ts, .agents/**, tests/agent.test.ts. Export generateAnswer(input:AgentInput):Promise<AgentResult> using shared contracts. Export runEvals():Promise<any> and listEvalRuns():Promise<any[]>; store results in eval_runs(id, created_at, status, results jsonb). Use actual local Codex SDK through LiteLLM, customer-specific runtime state, explicit skills, structured citations, trace correlation, and timeouts. Build 24 genuine quality cases with Sol labels/judging, preliminary audit status, and separate deterministic failure checks. Do not fake scores. Verify citation validation and unsupported-evidence handling before implementation, then run those checks.

## Task 3 Portal

Owned files: index.html, src/web/**. Build React login, chat, evidence drawer, reviewer overview, evaluations, and traces. Consume REST contracts provided in dispatch. Show honest readiness, errors, model identity, citation evidence, cost unknown states, and simulation labels. Verify build and responsive layout; keep implementation details out of customer flows.

## Task 4 Integration and recovery

Owned files: src/server.ts, src/auth.ts, tests/auth.test.ts, tests/integration.test.ts, compose.yaml, Dockerfile, litellm/**, README.md. Implement seeded login, durable cookies, ownership, chat creation, unique request IDs, committed-before-model messages, one visible answer, recovery on startup, and admin APIs. Start PostgreSQL and gateway first, then ingest and smoke-test a real Luna answer. Verify unauthorized access, duplicate calls, service restart, failure injection, and end-to-end UI.

## Review and verification

- [ ] Review each agent's files against the PRD and interfaces.
- [ ] Run typecheck, UI build, and meaningful tests.
- [ ] Run actual ingestion, a live model answer, and genuine evaluations.
- [ ] Restart the application during a request and inspect durable history.
- [ ] At 10:35 stop adding features; publish actual readiness and demo instructions by 10:45.
