# Customer Support Agent PRD

Status: Demo implementation with verified native runtime; quality audit and hosting pending  
Date: 8 October 2026  
Demo deadline: 10:45 AM Asia/Singapore on 8 October 2026  
Audience: Product owner, implementation team, and demo reviewers

Build a local customer support portal that answers product and store-policy questions using retrieved evidence. Customers must log in before chatting. Conversations must survive application restarts. Reviewers must be able to inspect answer evidence, agent skills, failure behavior, evaluation results, and model costs.

The first release is a small, verifiable demo. Hosting the portal and evaluation results on Vercel is an extended goal. Local-first means the application, database, raw corpus, gateway, and evaluation runner run locally; OpenAI inference and embedding requests still require network access.

## Confirmed requirements and working assumptions

The product owner selected hybrid data, PostgreSQL for user and RAG data, an OpenAI Codex agent with defined skills, GPT-6 Sol for labeling, Luna for customer answers, LiteLLM cost monitoring, and Docker Compose for local startup. API credentials are available; runtime compatibility and account access require an initial smoke check.

Working assumptions for this draft: English only; one fictional electronics retailer; public electronics specifications; seeded customer and reviewer accounts; informational support without order actions. The customer runtime uses `gpt-6-luna`; labeling uses `gpt-6-sol`. Product category, model identifiers, and corpus size remain configurable. These assumptions reduce setup time and require no signup, email delivery, or external commerce integration.

## Goals

1. Give correct, source-supported answers to questions within the demo corpus.
2. Ask useful clarification questions and acknowledge missing evidence rather than inventing facts.
3. Preserve customer identity, session ownership, committed messages, and conversational context across application restarts.
4. Demonstrate at least six distinct failure scenarios with repeatable checks and visible outcomes.
5. Make quality, retrieval behavior, skill use, latency, and model cost inspectable in the portal.
6. Start and ingest the small demo corpus quickly using the verified native setup; retain Docker Compose as an alternative.

## Scope and priorities

| Priority | Deliverable |
| --- | --- |
| Required for demo | Login, automatic chat-session creation, session history, cited RAG answers, PostgreSQL persistence, raw corpus, indexed retrieval, actual Codex runtime, explicit skills, LiteLLM costs, quality evals, six failure checks, reviewer dashboard |
| After the core works | Streaming answers, additional source-conflict and session-expiry cases, richer trace navigation |
| Extended goal | Vercel portal, hosted PostgreSQL with pgvector, hosted gateway and Codex worker, hosted evaluation-result viewing |
| Outside the first release | Order lookup, refunds or purchases, human-support messaging, production signup, multilingual support, broad website crawling, high availability |

Do not silently replace the Codex runtime, the selected answer model, or real model evaluations with a mock to meet the deadline. A blocked capability must appear as blocked in the demo readiness report.

## Customer and reviewer flows

A customer logs in with a seeded account. The server creates a chat session, or restores that account's selected session. The customer sends a question, receives an answer with evidence links, and can ask follow-up questions using the conversation context. A source panel identifies public product evidence and fictional retailer policy evidence separately.

A reviewer logs in with a separate role and sees dataset versions, ingestion status, quality scores, failure results, traces, and costs. Each evaluation case links to its input, expected behavior, actual answer, retrieved passages, citations, grading rationale, and trace. Customer accounts cannot access reviewer controls or another customer's sessions.

## Data and source policy

Use preserved snapshots of eight official product specification pages: [AirPods 5](https://www.apple.com/airpods-5/specs/), [AirPods Pro 3](https://www.apple.com/airpods-pro/specs/), [AirPods Max 2](https://www.apple.com/airpods-max/specs/), [iPhone 17](https://www.apple.com/iphone-17/specs/), [iPad Air](https://www.apple.com/ipad-air/specs/), [iPad Pro](https://www.apple.com/ipad-pro/specs/), [MacBook Air](https://www.apple.com/macbook-air/specs/), and [MacBook Pro](https://www.apple.com/macbook-pro/specs/). The active corpus has 11 sources (8 products and 3 demo policies) and 102 chunks. Preserve variants and qualifiers when extracting facts. The original HTML, hashes, capture timestamps, and final URLs are stored independently of the index. The original 24-case quality dataset remains frozen to its headphone/policy scope; the five additions have live scoped retrieval checks, not a newly claimed human-audited quality score.

Create separate fictional retailer documents covering shipping, returns, and warranty support. Every such document and its citation must say "Demo store policy." Store policy answers must never describe these policies as Apple's policies. Product specifications come from the manufacturer; retailer procedures come from the demo store. If authoritative evidence in the same scope conflicts, disclose the uncertainty instead of choosing arbitrarily. Live price, inventory, account orders, and medical advice are unsupported.

Keep original HTML or other source payloads in `data/raw/`, extracted documents in `data/processed/`, and source manifests with URL, final redirect URL, capture time, content hash, source type, product identifier, and document version. Raw files remain available independently of PostgreSQL chunks and embeddings. Reviewer-only source previews make the indexed passages auditable against these snapshots.

## Architecture and runtime decision

Use a TypeScript web portal, a local Codex worker, a LiteLLM proxy, and PostgreSQL with pgvector. The verified native runtime uses PostgreSQL on 5433, LiteLLM on 4000, and the app on 3000. Compose is configured as an alternate workflow with a separate PostgreSQL volume exposed on 5434; its full startup requires independent verification. Evaluation and ingestion commands use the same application retrieval and agent paths as customer chat.

The recommended runtime is the local [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk), which supports starting and resuming local threads. It fits the local-first requirement and supports repository skills. The alternative is the managed [Agents API](https://developers.openai.com/api/docs/guides/agents-api/overview), which runs the Codex harness remotely but adds API permissions and skill-environment setup. Use the local SDK for this demo; validate Luna and gateway compatibility before investing in UI work.

Route Codex requests through a dedicated LiteLLM provider configured for the Responses API. LiteLLM documents [Codex integration](https://docs.litellm.ai/docs/proxy/client_setup/codex_cli) and [customer and tag attribution](https://docs.litellm.ai/docs/tutorials/codex_customer_tracking). Keep the worker's Codex configuration and runtime directory isolated from the developer's own Codex settings.

PostgreSQL is the application's source of truth. Persist the Codex thread identifier against each chat and mount its runtime state on a durable volume. If local thread state cannot be resumed, rebuild the agent context from committed PostgreSQL history and record that recovery in the trace.

## Agent skills and tool boundaries

Define versioned `SKILL.md` manifests with a trigger, inputs, steps, allowed tools, output contract, and failure behavior. Local Codex discovers repository skills through `.agents/skills`; see [Build skills](https://learn.chatgpt.com/docs/build-skills).

| Skill | Trigger and responsibility | Observable output |
| --- | --- | --- |
| support-query | A customer asks a support question; resolve intent and product using current text and session context | Intent, product scope, and answer or clarification decision |
| retrieve-evidence | A factual or policy claim needs grounding; search only the active corpus | Ranked passage IDs, source versions, and retrieval timing |
| grounded-answer | Relevant evidence is available; answer with supported facts and citations | Answer, cited passage IDs, and source types |
| clarify-or-abstain | Product identity is ambiguous, evidence is absent, or evidence conflicts | Specific clarification or an explanation of the evidence gap |
| label-eval-case | An offline labeling job runs with GPT-6 Sol | Expected facts, evidence IDs, prohibited claims, expected behavior, and audit status |
| evaluate-support-run | A reviewer starts the evaluation runner | Per-case checks, rubric results, failure evidence, and aggregate metrics |

Customer agents receive only the customer skills and constrained retrieval tools. They do not receive labeling tools, evaluation controls, SQL credentials, unrestricted shell access, or fault controls. Expose retrieval through a narrow read-only tool adapter, such as MCP, that returns passages from PostgreSQL. The server enforces authorization, request limits, and allowed operations; skills do not replace those controls. Log actual skill-loading or invocation evidence where available. Label inferred routing separately from observed skill use.

## RAG ingestion and retrieval

Ingestion reads preserved source snapshots, extracts meaningful sections, chunks by section, generates embeddings through LiteLLM, and writes versioned chunks into PostgreSQL. Use `text-embedding-3-small` as the proposed embedding model, subject to the initial access check. Keep embedding dimension and model version consistent between documents and queries.

Batch embeddings with bounded concurrency. Cache them by content hash and embedding configuration so unchanged content does not incur repeat calls. Build a new corpus version in staging and activate it only after required documents, embeddings, and indexes are complete. On interruption, restart from completed work; the previous active corpus remains available. Initial ingestion with no active corpus keeps chat unavailable with a clear readiness message.

Combine PostgreSQL full-text retrieval with vector similarity and fuse their ranks. Preserve exact product identifiers and filter source scope before selecting evidence. Create GIN indexes for full-text search, B-tree indexes for product/version and session ownership, and an HNSW cosine index for vector access. Compare approximate retrieval against exact vector search on the small evaluation corpus; use exact vector search if it improves recall while meeting latency targets. pgvector documents the [speed and recall tradeoff](https://github.com/pgvector/pgvector).

Start with up to eight passages per request. Tune against labeled evidence rather than treating similarity scores as confidence probabilities. Validate that returned citation IDs belong to the retrieved active corpus. Citation existence is deterministic; whether a citation supports a claim requires separate evaluation.

## Sessions and recovery

Persist users, authentication sessions, chats, messages, request attempts, and traces in PostgreSQL. Hash passwords and use server-validated session cookies. Login creates the first chat; a new-chat action creates another owned session. Indexed ownership checks apply to every session read and write.

Every submission has a client request ID with a uniqueness constraint scoped to the chat. Commit the customer message and request state before invoking the agent. States distinguish pending, running, completed, interrupted, and failed requests. Serialize active turns within one chat to preserve conversational order.

On application restart, keep completed turns intact, release expired work leases, and mark interrupted work for explicit retry. A retry uses the same customer message and creates a new attempt; it does not add a duplicate customer turn. Replaying a completed request returns its stored result. Guarantee at most one visible completed answer per request. A provider call interrupted after submission can have an unknown billing outcome, so do not claim exactly-once provider execution or zero duplicate cost.

## Failure testing

Fault controls are local-only reviewer operations, scoped to a test request or job, with automatic cleanup. Store injection method, observed outcome, and verification status. An injected adapter failure is identified as simulated; a real process restart is identified as an integration test.

| Scenario | Injection | Required result |
| --- | --- | --- |
| F1 Application restart | Restart the application or worker after a customer message is committed and before completion | Same login and chat history survive; interrupted request can be retried; no duplicate visible turns |
| F2 Model unavailable | Inject timeout or 429 at the gateway boundary | Bounded retry policy, clear failure state, recorded attempts; no invented answer or silent model upgrade |
| F3 Retrieval unavailable | Inject an error in the retrieval adapter | Request fails clearly; no answer without evidence; committed customer message remains retryable |
| F4 Evidence absent | Submit an unsupported query or return no eligible passages | Agent acknowledges the gap or asks a useful clarification; no fabricated specifications or policy |
| F5 Ingestion interruption | Stop ingestion after partial staging writes, then rerun it | Active corpus remains usable; unfinished version is not activated; no duplicate chunks on rerun |
| F6 Duplicate submission | Send concurrent requests with the same client request ID | One customer message and at most one completed answer; second caller observes the existing request |

Timeout and rate-limit errors are subcases of F2, not two separate categories. Source conflict, malicious retrieved instructions, expired login, and cross-user session access are additional correctness and access-control checks. A full PostgreSQL outage is an extended integration case: requests must not be acknowledged as durably accepted when they cannot be committed.

## Local evaluation plan

Use a lightweight local runner and versioned JSONL cases instead of adding another evaluation service. Three approaches were considered: a custom runner gives the shortest path to application-specific recovery checks; a general evaluation framework offers reusable graders but adds setup; hosted evaluation tooling adds external dependencies. Choose the custom runner and standard output files for the demo.

Start with 24 quality cases: 10 product questions, four store-policy questions, two multi-turn questions, four ambiguous questions, two unsupported questions, and two instruction-injection questions. Run the six failure scenarios separately. Expand the quality set to 60–100 cases after the core demo works.

Use GPT-6 Sol to draft labels from the frozen source snapshot. Each case records the question or conversation, category, expected behavior, required facts, supporting passage IDs, prohibited claims, and human-audit status. Keep labels and reference answers out of the RAG corpus. Use separate development questions; freeze the evaluation set before measuring the demo candidate. If an evaluation question is used to tune the agent, mark it as a regression case rather than continuing to claim it is held out.

Run deterministic checks for fact fields where practical, citation references, ownership, duplicates, and recovery states. Use a separate Sol grading call for nuanced correctness and claim support. A model-written label or model grade is not independent ground truth. Human-review the quality labels and calibrate the judge on representative correct, incorrect, and unsupported answers before reporting an audited quality score. Until then, show scores as preliminary. This follows [OpenAI evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices).

Store corpus hash, dataset hash, prompt and skill versions, runtime model identifiers, retrieval configuration, timings, per-case outcomes, grading rationale, audit status, and costs for every run. Report skipped, errored, blocked, and unaudited cases separately; never count them as passes. Aggregate deterministic resilience results separately from model-graded answer quality.

## Success metrics

These are proposed acceptance targets, not measured results. All latency measurements use the named demo machine and report sample count. A 24-case dataset is a demo smoke set, not evidence of broad production accuracy.

| Metric | Demo target and measurement |
| --- | --- |
| Answer correctness | At least 15 of 16 answerable cases contain required facts and no material contradictions; refusals fail answerable cases |
| Answer coverage | At least 15 of 16 answerable cases receive a substantive supported answer |
| Retrieval hit rate | Required evidence is present among the top eight passages for at least 15 of 16 answerable cases |
| Citation validity | 100% of cited passage IDs exist and belong to retrieved evidence |
| Claim support | At least 95% of assessed factual claims are supported; fabricated policy or critical product facts block readiness |
| Clarification and abstention | All four ambiguous and both unsupported cases exhibit the labeled behavior |
| Instruction handling | Both injection cases preserve agent instructions and allowed-tool boundaries |
| Failure behavior | All six scenarios have passing executable checks, with actual versus simulated injection identified |
| Session integrity | Zero missing committed turns or duplicate visible turns in restart and replay tests; cross-user access denied |
| Retrieval latency | p95 at or below 250 ms for database retrieval over 30 warm queries; query-embedding time reported separately |
| Answer latency | p95 at or below 15 seconds over the 16 answerable cases; disclose the small sample and provider variability |
| Ingestion | Full six-document corpus ready within three minutes; unchanged rerun within 30 seconds and no new document-embedding calls |
| Startup | Warm Compose startup ready within 90 seconds; first image build and downloads reported separately |
| Trace coverage | Every application-observed model attempt correlates to a chat/request or evaluation case; unknown provider outcomes are explicit |
| Cost visibility | Chat, embedding, labeling, and judging costs are separate; missing prices appear as unknown rather than free |

## LiteLLM costs and traces

All application model calls, including Codex internal calls, embeddings, labels, and judging, must traverse LiteLLM. Use correlation tags for application, user, chat, request, attempt, evaluation run, and case. Supply these within an isolated worker request context, not a shared process-wide mutation that can mix customers.

Keep application trace spans for authentication, retrieval, agent execution, gateway calls, validation, and persistence. Attach model name, token usage where provided, latency, error category, retry count, and estimated USD cost to the relevant model span. Persist traces in the application database and LiteLLM spend records in a separate logical database on the same PostgreSQL service. Import spend records idempotently using their gateway request identifier; sum each billable call once.

The reviewer dashboard shows per-message cost, per-session total, evaluation-run total, and costs grouped by purpose and model. LiteLLM provides [spend tracking](https://docs.litellm.ai/docs/proxy/cost_tracking) and [custom callbacks](https://docs.litellm.ai/docs/observability/custom_callback); use supported spend records or callbacks without relying on enterprise reporting endpoints. LiteLLM cost is an estimate from usage and pricing configuration, not an invoice. Record the pricing version, flag missing rates, and expose failed attempts with unavailable usage as unknown. Never log API keys or authentication tokens.

Do not add Langfuse or another trace service for the first demo. Keep trace review in the portal. Configure one owner of automatic retries to avoid multiplied retries across application, Codex, and proxy layers. No automatic escalation from Luna to Sol for customer answers.

## Deadline and delivery order

PRD preparation began with about 42 minutes remaining. Approval and further discussion consume that same window; the full build is a target, not a delivery guarantee.

After PRD approval, first verify Codex → LiteLLM → Luna, Sol labeling, embeddings, and a persisted gateway cost record. Then build the vertical path: Compose and database, preserved sources and ingestion, login and durable chat, retrieval and cited answers. Next run the quality and failure checks and expose their saved results and costs in a compact reviewer view.

At 10:35 AM Singapore time, stop adding features and reserve the final ten minutes for verification and the demo walkthrough. Cut catalog breadth, streaming, and visual polish before cutting persistence, evidence checks, runtime requirements, or visible evaluation status. If a required capability remains blocked, list it explicitly in the readiness report.

## Risks and mitigations

| Risk | Consequence | Mitigation |
| --- | --- | --- |
| Short build window | Complete scope may not fit before 10:45 | Verify the model path first; preserve the verified eight-product corpus; freeze features at 10:35; report readiness honestly |
| Codex, Luna, and LiteLLM incompatibility | Customer runtime cannot execute | Initial real smoke call using exact configured models; treat failure as blocking, without silent substitution |
| Model-generated labels and judge bias | Inflated accuracy | Human audit, judge calibration, source-grounded labels, separate held-out and regression status |
| Changing pages, variants, or lost qualifiers | Incorrect product answers | Preserve snapshots and hashes; retain product variants, conditions, and footnotes |
| Fictional policies confused with manufacturer terms | Misleading support advice | Visible source types and policy labels; evaluate source precedence |
| Approximate retrieval misses evidence | Wrong answers or unnecessary refusals | Hybrid retrieval; compare against exact search; tune using evidence IDs |
| Restart during a provider call | Duplicate charges or ambiguous completion | Durable request state, leases, explicit retry, one visible answer, unknown-cost state |
| Incomplete ingestion | Partially indexed answers | Stage versions and activate only complete corpora; preserve raw data and cached embeddings |
| Missing LiteLLM price mapping | Costs incorrectly shown as zero | Validate price entries; display unknown; retain usage and pricing version |
| Customer input reaches broad Codex capabilities | Unwanted commands or data access | Isolated worker, constrained read-only retrieval, server-enforced authorization, injection checks |
| Network or API failure | Local demo cannot answer live questions | Preflight connectivity; saved eval results remain viewable and identified as earlier runs |
| Vercel runtime constraints | Local deployment cannot move unchanged | Keep gateway and Codex behind service boundaries; plan durable external infrastructure |

## Vercel extended goal

Deploy the portal and reviewer dashboard to Vercel. Move application data, vectors, traces, and evaluation results to hosted PostgreSQL with pgvector. Move raw snapshots to durable object storage. Run LiteLLM and the local Codex worker on a persistent external container service unless a separately validated managed runtime removes that requirement. Do not assume Docker Compose, worker state, or local files persist inside Vercel Functions; review [Vercel Function limits](https://vercel.com/docs/functions/limitations).

The Vercel dashboard must display the same saved evaluation schema, corpus versions, audit status, traces, and cost breakdown. Running evaluations remotely is a subsequent capability; viewing genuine saved local results is the first hosting target. Disable fault injection in the public deployment.

## Demo acceptance walkthrough

1. Start the documented local setup and inspect ingestion readiness.
2. Log in as a customer and ask a product question; inspect its supporting snapshot.
3. Ask a follow-up question and verify context, then ask about a visibly fictional store policy.
4. Ask an unsupported question and observe appropriate uncertainty.
5. Restart the worker during a request, reopen the same chat, and retry without duplicate visible messages.
6. Log in as a reviewer and inspect all six failure outcomes and the latest quality run, including errors and audit status.
7. Open a trace and inspect retrieved passages, actual skill evidence, model attempts, and LiteLLM costs.

The readiness report distinguishes passing requirements, unmet targets, blocked capabilities, and deferred hosting work. The README and demo runbook describe the implemented local setup. Report any pending evaluation audit or deployment work separately from verified local behavior.
