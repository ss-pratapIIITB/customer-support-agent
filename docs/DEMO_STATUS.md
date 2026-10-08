# Demo verification — 8 October 2026

The local portal is running at http://localhost:3000 with native PostgreSQL/pgvector and LiteLLM. Colima is installed and running; Compose configuration validates. Full Compose startup and Vercel hosting remain unverified.

- Type checking and production web build pass.
- All 17 unit, HTTP, and live RAG checks pass, with no skipped checks.
- All six failure scenarios and cross-user access checks pass. Service restart uses an actual process termination; timeout/rate-limit and retrieval failures are simulated.
- Eight real products and three fictional store policies are active: 11 sources and 102 indexed chunks. Raw snapshots remain separate. Expanded ingestion took 3.697 seconds on this machine; unchanged ingestion makes no new document embedding calls.
- A browser check confirmed a cited MacBook Air battery answer and visible evaluation results and gateway costs.
- Latest quality run: `39155097-d5d0-47ff-9814-1a0f54a5ba45`, 19 passed, 5 failed, 0 errors. All 24 citation identifiers and expected behaviors passed. Claim support passed 23/24; correctness passed 15/17 answerable cases. All labels and judgments are unaudited.

The demo is available, but the PRD accuracy and latency gates are not yet met. Failures include omitted battery details, missing compatibility qualifications, and labels that require information beyond a question. Preserve these results for human calibration; do not interpret valid citations alone as factual accuracy. The five added products have live retrieval checks, but they still need dedicated labeled quality cases.

Gateway callbacks append usage and price estimates to a local file, which the app imports idempotently into PostgreSQL. This implements the local cost view without a separate LiteLLM spend database. Provider retry behavior is not validated by simulated timeout checks. Hosting requires durable external workers and storage.
