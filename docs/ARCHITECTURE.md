# Architecture

## Components

```text
┌──────────────────────────────┐
│ React 19 portal               │
│ customer chat + reviewer UI   │
└──────────────┬───────────────┘
               │ session cookie / JSON
┌──────────────▼───────────────┐
│ Express 5 API                 │
│ auth, rate limits, request IDs│
│ chat, admin, internal eval    │
└───┬───────────┬───────────┬──┘
    │           │           │
    │           │           └──────────────► OpenTelemetry
    │           │                            ├─ OTLP → Jaeger
    │           │                            └─ Prometheus :9464
    │           │
    │           └──► agent orchestration
    │                ├─ intent + scope
    │                ├─ retrieval + citations
    │                ├─ deterministic engine or live model
    │                └─ tools → PostgreSQL
    │
    └──► PostgreSQL 17 + pgvector
         users, chats, messages, traces,
         corpus, orders, returns, tickets,
         tool calls, eval runs, reliability
```

There is one deployable process. The Python harness and browser are clients. Docker Compose adds Postgres, Jaeger, and Prometheus.

## Request lifecycle

1. **Authentication.** `POST /api/login` verifies a scrypt password hash and sets an HTTP-only session cookie. The session row has an expiry; `COOKIE_SECURE=true` is required behind HTTPS.
2. **Authorization.** Chat, order, return, and ticket queries always include the authenticated `user_id`. Reviewer/admin routes require the `reviewer` or `admin` role.
3. **Request identity.** `POST /api/chats/:id/messages` requires a client-generated `requestId`. A unique `(chat_id, request_id, role)` constraint makes retries idempotent. Reusing an ID with a different question returns `409`.
4. **Intent and scope.** `classifyIntent` identifies order, return, policy, product, comparison, handoff, symptom, unsupported, greeting, and other intents. `inferScope` maps product aliases to source scopes. Conversation history is used only for genuine follow-ups.
5. **Retrieval.** `retrieve()` runs a hybrid query:
   - lexical full-text search (`tsvector` / `ts_rank_cd`);
   - semantic search with pgvector cosine distance when embeddings are available;
   - trigram similarity for exact phrases.
     Product names are removed from the lexical terms when the scope already pins products, so “MacBook Air vs MacBook Pro battery” ranks battery sections rather than random product text. Aspect terms expand with domain synonyms (`battery` → listening/playback/hours, `chip` → CPU/GPU/core, etc.).
6. **Answer generation.** In demo mode, `demoAgent` selects an answer template, extracts relevant specification lines, enforces safety branches, and attaches citation IDs. In live mode, `llmAgent` calls an OpenAI-compatible Chat Completions endpoint with tool definitions.
7. **Tool execution.** Tools are typed with Zod schemas. Each call is persisted in `tool_calls` with args, result, status, latency, trace ID, and request ID. Return flow is two-step:
   - `start_return` evaluates policy and creates a pending action with `confirmation_required`;
   - `confirm` executes it and creates an RMA, or routes to human review.
8. **Evidence validation.** Before returning an answer, citations are mapped back to retrieved passages. An answer whose citation IDs are absent from the evidence is downgraded to an abstention.
9. **Persistence and telemetry.** Messages, citations, behavior, intent, confidence, latency, trace ID, and tool calls are stored. A trace summary is written for the reviewer UI and exported via OTel.

## Retrieval and grounding

The retrieval contract is deliberately conservative:

- `UNSUPPORTED` questions (live price, stock, medical, prescription) short-circuit before retrieval unless the scope is a Demo policy.
- Policy questions are scoped to `demo_policy`; product questions to `manufacturer`.
- Comparison questions require at least two product scopes. Only eight product sources exist; there is intentionally no separate iPhone 17 Pro source.
- Citation snippets are selected from the highest-signal line in the passage (numbers, durations, policy qualifiers), not blindly from the first line.
- When the corpus has no active version, retrieval fails closed rather than answering from model priors.

Embedding mode:

| Mode             | Behaviour                                                                     |
| ---------------- | ----------------------------------------------------------------------------- |
| `on`             | Require embeddings; fail retrieval if the provider is unavailable             |
| `off`            | Lexical + trigram only                                                        |
| `auto` (default) | Use embeddings only when the live model path is active; demo mode stays local |

An expired or invalid key never causes repeated network calls in demo mode. A provider failure trips a process-local breaker and falls back to lexical retrieval.

## Data model

| Table                                  | Purpose                                         |
| -------------------------------------- | ----------------------------------------------- |
| `users`, `auth_sessions`               | Accounts and server-side sessions               |
| `chats`, `messages`, `requests`        | Conversations, idempotent turns, status         |
| `traces`, `tool_calls`, `model_calls`  | Audit, UI trace waterfall, usage/cost           |
| `corpus_versions`, `sources`, `chunks` | Versioned, atomic corpus with embeddings        |
| `orders`, `returns`, `tickets`         | Commerce state                                  |
| `pending_actions`                      | Confirmation-gated side effects                 |
| `eval_runs`, `reliability_checks`      | Reviewer-visible quality and resilience results |
| `feedback`                             | Customer rating hooks                           |

Corpus activation is atomic: chunks are written for a new version, the version is marked `active`, and the prior active version is retired in one transaction. `corpus_one_active` enforces a single active version.

## Evaluation isolation

`POST /api/internal/eval/answer` creates a temporary chat row so tool foreign keys are valid, runs the same agent path, then deletes tickets, pending actions, and the chat. This keeps repeated runs from polluting the reviewer workspace. The endpoint requires a shared token; it never exposes provider keys. The Python process sees only HTTP responses (answer, evidence, citations, tools, trace ID, latency).

## Failure handling

- **Model timeout / 429** → explicit user-visible retry, no duplicate messages.
- **Retrieval unavailable / empty** → abstain or request more information; never invent.
- **Tool failure** → tool status is recorded; the answer explains the gap.
- **Interrupted ingestion** → previous active corpus remains live.
- **Process restart** → sessions and chats persist; in-flight requests are retryable by request ID.
- **Secret exposure** → provider response bodies are not logged; eval graders scan answers for key-shaped strings.

## Trade-offs

- One process keeps the demo simple; horizontal scale would need shared rate limiting, a job queue for ingestion, and session storage review.
- The deterministic engine is bounded and reviewable, but cannot generalize like a live model. The eval harness is the contract for both.
- Lexical retrieval is the reliable fallback; semantic retrieval improves recall when embeddings are configured, but is not required for the demo.
