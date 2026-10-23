# Maxify Support

A production-shaped AI customer-support demo: grounded product answers, real commerce tools, human-review guardrails, OpenTelemetry traces and metrics, and a Python evaluation gate that runs against the actual HTTP API.

The demo is fully functional **without an API key**. It defaults to a deterministic support engine, a local pgvector/Postgres corpus, and lexical retrieval. A live OpenAI-compatible model can be enabled explicitly.

[![CI](https://github.com/ss-pratapIIITB/customer-support-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/ss-pratapIIITB/customer-support-agent/actions/workflows/ci.yml)

![Customer chat with citations](docs/screenshots/chat-grounding.jpg)

![Reviewer console with evaluation and trace summary](docs/screenshots/reviewer-console.jpg)

## What is included

- **Grounded answers** over 8 official Apple product specification snapshots and 3 explicitly fictional Demo store policies: 11 sources, 297 indexed chunks. Every factual answer carries citation IDs that are validated against retrieved evidence.
- **Real tools**, not prompt-only theatre: order lookup, order history, return evaluation, return confirmation, warranty ticket creation, and human handoff. Tool calls are persisted and shown in the UI.
- **Human-in-the-loop returns**: opened headphones/earbuds and change-of-mind requests outside 14 days are refused; returns above `RETURN_AUTO_APPROVE_LIMIT_CENTS` (default S$500) require reviewer approval.
- **Safety paths** for prompt injection, medical advice, live pricing, secrets, out-of-domain questions, and ambiguous product questions.
- **A reviewer console** with chats, traces, sources, evaluation runs, reliability checks, and tool/audit detail.
- **Observability** through OpenTelemetry traces (OTLP → Jaeger), Prometheus metrics, structured logs, trace IDs on messages, and per-request latency.
- **A real eval harness** in Python (standard library only): 30 labelled cases, deterministic graders, citation and tool assertions, baseline comparison, optional server-side LLM judge, and CI integration. Latest demo run: **30/30 passed, 100% answer accuracy, 100% citation validity, 0% unsafe**.
- **Operational checks**: 7 TypeScript and 11 Python unit tests, 4 HTTP integration tests, 7 smoke checks, 8 reliability checks, lint, typecheck, production build, Docker/Compose, and GitHub Actions.

## Quick start

### Docker Compose (recommended)

Prerequisites: Docker or Colima with Compose v2.

```bash
git clone https://github.com/ss-pratapIIITB/customer-support-agent.git
cd customer-support-agent
docker compose up --build -d
curl --fail http://127.0.0.1:3000/api/health
```

The app bootstraps its schema, ingests the included snapshots, and seeds the demo workspace on startup. Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

| Service        | URL                                    |
| -------------- | -------------------------------------- |
| Support portal | http://127.0.0.1:3000                  |
| Jaeger UI      | http://127.0.0.1:16686                 |
| Prometheus     | http://127.0.0.1:9090                  |
| App metrics    | http://127.0.0.1:9464/metrics          |
| PostgreSQL     | `127.0.0.1:5435` (container port 5432) |

Demo accounts:

| Role     | Email                  | Password   |
| -------- | ---------------------- | ---------- |
| Customer | `customer@maxify.demo` | `Demo123!` |
| Reviewer | `reviewer@maxify.demo` | `Demo123!` |

These are local seeded accounts, not production credentials.

### Native development

Prerequisites: Node.js 22+, Python 3.10+, PostgreSQL 17 with pgvector.

```bash
cp .env.example .env
npm ci
# Point DATABASE_URL at your Postgres instance, then:
npm run bootstrap
npm run start:dev
```

`npm run bootstrap` is idempotent: it migrates, ingests preserved snapshots when no active corpus exists, and seeds the demo. For a fresh database:

```bash
createdb support
psql support -c 'CREATE EXTENSION IF NOT EXISTS vector;'
```

The default `DATABASE_URL` expects `postgres://support:support@127.0.0.1:5435/support`.

## Agent modes

| Mode             | Behaviour                                                              | Key required |
| ---------------- | ---------------------------------------------------------------------- | ------------ |
| `demo` (default) | Deterministic engine, lexical retrieval, no external calls             | No           |
| `auto`           | Uses the live model when `OPENAI_API_KEY` is non-empty, otherwise demo | Optional     |
| `live`           | Always calls the configured OpenAI-compatible model                    | Yes          |

```bash
# Native live model
AGENT_MODE=live OPENAI_API_KEY=... npm run start:dev

# Compose live model
MAXIFY_AGENT_MODE=live MAXIFY_OPENAI_API_KEY=... docker compose up --build -d
```

Relevant settings are documented in [`.env.example`](.env.example). `OPENAI_BASE_URL` works with OpenAI, Azure OpenAI, LiteLLM, vLLM, Ollama, OpenRouter, and other compatible endpoints. In demo mode, embeddings default to off even if a stale key is present, so the demo never makes accidental paid calls.

## Evaluation

The release gate runs the same internal answer path used by the product:

```bash
make eval
# or
PYTHONPATH=evals python3 -m maxify_evals --fail-under 0.9
```

It writes a report to `evals/reports/` and imports it into the reviewer console. The checked-in baseline is `evals/baselines/demo-engine.json`.

```bash
make eval-baseline   # regenerate after intentional dataset changes
make test-python     # grader/dataset unit tests
```

The 30 cases cover product specifications, policies, orders, returns, safety, ambiguity, comparisons, and human handoff. The optional judge is additive and disabled in demo mode; in live mode the server calls `JUDGE_MODEL`, keeping the provider key server-side. See [docs/EVALS.md](docs/EVALS.md).

## Verification

With the app running:

```bash
npm run typecheck
npm run lint
npm test
PYTHONPATH=evals python3 -m unittest discover -s evals/tests -v
npm run test:integration
npm run smoke
npm run reliability
make eval
```

`test:integration` and the smoke/reliability scripts expect a running app at `MAXIFY_BASE_URL` (default `http://127.0.0.1:3000`). Reliability requires the metrics endpoint. Unit tests and the Python grader tests need neither a database nor a model key.

The CI workflow runs lint, typecheck, unit tests, Python tests, build, then a full Postgres-backed smoke/integration/reliability/evaluation job.

## Architecture at a glance

```text
Browser (React 19)
   │  session cookie, JSON
Express 5 API  ── auth / rate limits / request IDs / audit
   │
   ├── intent + scope resolution
   ├── hybrid retrieval (pgvector when configured, lexical fallback)
   ├── demo engine  ──or──  live model (tool calling)
   ├── commerce tools ── orders / returns / tickets / human review
   └── evidence validation + citations
   │
PostgreSQL 17 + pgvector      OpenTelemetry → Jaeger
                               Prometheus /metrics
```

Key properties:

- **Tenant scoping** is enforced in SQL: chats, orders, returns, and tickets are always filtered by the authenticated user.
- **Evidence before prose**: unsupported questions abstain; answers are rejected if cited IDs are not in the retrieved set.
- **Idempotent requests**: each chat turn uses a client request ID, so retries cannot duplicate messages or side effects.
- **Atomic ingestion**: a new corpus version becomes active only after all chunks are written; an interrupted run leaves the previous active version intact.
- **Migrations on boot** use advisory locking and are safe to rerun.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## API surface

| Method     | Path                               | Purpose                                          |
| ---------- | ---------------------------------- | ------------------------------------------------ |
| `GET`      | `/api/health`                      | Readiness, corpus status, mode, model, telemetry |
| `POST`     | `/api/login` / `/api/logout`       | Session authentication                           |
| `GET`      | `/api/me`                          | Current user and workspace defaults              |
| `GET/POST` | `/api/chats`                       | List and create conversations                    |
| `GET`      | `/api/chats/:id/messages`          | Messages, traces, tool calls                     |
| `POST`     | `/api/chats/:id/messages`          | Send a message (`requestId` required)            |
| `GET`      | `/api/admin/evals`                 | Reviewer-only evaluation runs                    |
| `GET`      | `/api/admin/reliability`           | Reviewer-only reliability runs                   |
| `GET`      | `/api/internal/eval/meta`          | Corpus/model metadata for the harness            |
| `POST`     | `/api/internal/eval/answer`        | Isolated answer execution for evaluation         |
| `POST`     | `/api/internal/eval/import`        | Import an eval report                            |
| `POST`     | `/api/internal/reliability/import` | Import reliability checks                        |

Internal routes require `x-eval-token: $EVAL_API_TOKEN`.

## Repository layout

```text
src/
  agent.ts, demoAgent.ts, llmAgent.ts   answer orchestration and engines
  intent.ts, context.ts, catalog.ts     intent, scope, product aliases
  retrieval.ts                          hybrid search, citations, excerpts
  commerce.ts, tools.ts                 orders, returns, tickets, tools
  routes/                               auth, chat, admin, internal eval
  ingest.ts, bootstrap.ts, seed.ts      corpus, schema, demo data
  telemetry.ts, logger.ts               OpenTelemetry and structured logs
  web/                                  React reviewer/customer UI
db/migrations/                          SQL schema
data/                                   preserved snapshots and manifest
evals/                                  Python harness, dataset, baseline
scripts/                                bootstrap, ingest, seed, smoke, reliability
tests/                                  unit and integration tests
docs/                                   architecture, evals, security, demo script
```

## Operational notes

- Demo data is seeded idempotently. `SEED_DEMO=false` disables it.
- `AUTO_BOOTSTRAP=false` is recommended for controlled production deployments; run `npm run bootstrap` as a migration job instead.
- Use a strong `EVAL_API_TOKEN`, HTTPS, and `COOKIE_SECURE=true` outside local development.
- The internal eval endpoints are token-protected and should not be exposed to the public internet.
- Model and judge calls are never made by the Python harness directly; the server owns provider credentials.

## Status and limitations

This is a production-shaped local reference implementation, not a hosted multi-tenant SaaS. It does not include SSO, billing, email delivery, durable job queues, or real carrier/manufacturer integrations. The corpus is a preserved snapshot; product specifications can change upstream. The deterministic engine is intentionally bounded and should not be presented as a general-purpose LLM.

Latest verified run (24 Oct 2026): typecheck, lint, 18 unit tests, 4 integration tests, 7 smoke checks, 8 reliability checks, 30/30 eval cases, and the production build pass. The same smoke, integration, reliability, and evaluation gates also pass against the containerized Compose stack, with traces visible in Jaeger and metrics scraped by Prometheus.

## Documentation

- [Product overview](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Evaluation guide](docs/EVALS.md)
- [Observability](docs/OBSERVABILITY.md)
- [Security](docs/SECURITY.md)
- [Demo script](docs/DEMO_SCRIPT.md)
- [Contributing](CONTRIBUTING.md)
- [License](LICENSE)

## License

MIT. See [LICENSE](LICENSE).
