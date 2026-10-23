# Product overview

## Problem

Support agents need to answer product and policy questions without inventing facts, act on customer accounts without crossing authorization boundaries, and escalate risky actions. A chat transcript alone is not enough: teams need evidence, tool audit trails, evaluation results, and traces.

Maxify Support is a compact reference implementation of that workflow. It is intentionally runnable on a laptop, but structured like a service that could be hardened for production.

## Users

| Persona                 | Needs                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| Customer                | Fast, grounded answers; order status; a clear return path; a human when needed                    |
| Reviewer / support lead | Inspect conversations and traces; approve high-value returns; review eval and reliability results |
| Engineer / operator     | Reproducible setup, deterministic tests, observable failures, safe deployment defaults            |

## Scope

### In scope

- Product specifications for eight Apple products from preserved official snapshots.
- Three clearly labelled fictional Demo store policies (shipping, returns, warranty).
- Account-scoped order lookup and order history.
- Return eligibility, confirmation, RMA creation, and human review above a configurable threshold.
- Warranty assessment handoff and human escalation.
- Safety handling for prompt injection, medical advice, secrets, live pricing, and out-of-domain questions.
- Reviewer console with sources, traces, tool calls, evaluations, and reliability checks.
- Python evaluation harness with deterministic graders and an optional judge.
- OpenTelemetry tracing, Prometheus metrics, structured logs, Docker Compose.

### Out of scope

- Real payments, refunds, carrier APIs, manufacturer service systems, or email delivery.
- SSO, SCIM, billing, multi-region deployment, or a hosted control plane.
- A general-purpose assistant. The agent is deliberately bounded to the corpus and commerce tools.
- Training or fine-tuning models on customer data.

## Behavioural contract

1. **Answer only with evidence.** Product and policy claims require retrieved source passages. If there is no evidence, the agent abstains or clarifies.
2. **Distinguish sources.** Manufacturer specifications are never presented as retailer policy, and Demo store policies are explicitly fictional.
3. **Respect account scope.** Orders, returns, tickets, and chats are filtered by the authenticated user in SQL, not only in prompts.
4. **Ask before side effects.** A return creates an RMA only after confirmation. High-value returns require reviewer approval. Warranty flows create a ticket only after confirmation.
5. **Escalate rather than guess.** Human handoff is a first-class tool, not a fallback apology.
6. **Refuse unsafe requests.** Prompt injection, credential extraction, medical diagnosis, and live pricing are refused or redirected.
7. **Stay deterministic in demo mode.** The same question against the same corpus and account produces the same answer, with no external calls.

## Demo data

| Order      | Item                     | Scenario                                                             |
| ---------- | ------------------------ | -------------------------------------------------------------------- |
| `MAX-1042` | AirPods Pro 3            | Delivered, unopened, inside the 14-day window; eligible              |
| `MAX-2087` | MacBook Air 13-inch (M5) | Delivered; total above the review threshold; requires human approval |
| `MAX-3120` | AirPods Max 2            | Delivered 22+ days ago and opened; change-of-mind return refused     |
| `MAX-4411` | iPad Air 11-inch (M4)    | In transit; tracking available                                       |
| `MAX-5008` | iPhone 17                | Processing; no tracking yet                                          |

Return policy highlights:

- 14 calendar days from delivery.
- Unopened products in original packaging with proof of purchase.
- Opened headphones and earbuds are not eligible for change-of-mind returns for hygiene reasons.
- Returns above S$500 require human approval.
- Faulty items follow a warranty assessment path, not the change-of-mind path.

## Success criteria

| Signal                 | Target                                     | Current demo                            |
| ---------------------- | ------------------------------------------ | --------------------------------------- |
| Eval pass rate         | 100% on the checked-in deterministic suite | 30/30                                   |
| Answer accuracy        | 100% of answer-expected cases              | 100%                                    |
| Citation validity      | 100% of required citations                 | 100%                                    |
| Unsafe rate            | 0%                                         | 0%                                      |
| p95 answer latency     | < 2s local                                 | 13–43ms demo engine                     |
| Unit/integration/smoke | All green                                  | 18 + 4 + 7                              |
| Reliability checks     | All green                                  | 8/8                                     |
| Secret leakage         | None                                       | None in repository scan or eval graders |

These are demo measurements, not production SLOs. Live-model quality and latency depend on the provider and must be measured separately against the same harness.

## Trust boundaries

- Browser session cookie → Express API.
- Express API → PostgreSQL (pgvector).
- Express API → model provider only in `auto`/`live` modes.
- Express API → OTLP collector and Prometheus scrape.
- Python harness → token-protected internal HTTP endpoints only. It never receives provider credentials.
- Reviewer actions → role-checked admin routes.

See [SECURITY.md](SECURITY.md) for threat handling and [ARCHITECTURE.md](ARCHITECTURE.md) for request flow.
