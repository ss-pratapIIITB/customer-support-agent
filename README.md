# Maxify Support

Local customer support portal with persistent chats, cited answers from preserved official product pages, a reviewer console, Codex SDK customer agents, and LiteLLM usage and cost records. Live model calls require a configured OpenAI API key and network access.

## Start here

- [Product requirements document (PRD)](docs/superpowers/specs/2026-10-08-customer-support-agent-design.md): goals, scope, success metrics, failure scenarios, risks, and the Vercel extension plan. [PRD.md](PRD.md) provides a root-level entry point.
- [Demo walkthrough](docs/DEMO_RUNBOOK.md): customer questions and reviewer screens to show.
- [Demo verification report](docs/DEMO_STATUS.md): recorded results and unmet targets from the original local demo. These results describe that environment; a fresh checkout must run its own checks.
- [Implementation plan](docs/superpowers/plans/2026-10-08-support-demo.md): the original delivery sequence.

## Fresh checkout: Compose with Docker or Colima

Prerequisites: Git, a running Docker-compatible engine with Docker Compose v2, and an OpenAI API key with access to the configured models. On macOS, Colima can provide the engine. Native development also requires Node.js; the application container uses Node.js 24.

```sh
git clone https://github.com/ss-pratapIIITB/customer-support-agent.git
cd customer-support-agent
cp .env.example .env
```

Edit `.env` locally. Set `OPENAI_API_KEY` to your provider key and `LITELLM_API_KEY` to a gateway key of your choice. Use the same gateway key for the app and proxy. The repository includes placeholders only. `.env`, runtime state, database files, and cost logs are excluded from Git.

If you use Colima, start it before Compose:

```sh
colima start
```

Then start the services and ingest the included snapshots:

```sh
mkdir -p .runtime
docker compose up --build -d
docker compose exec app npm run ingest
curl --fail http://127.0.0.1:3000/api/health
```

The health response must report `status: "ready"` and `ingestion.ready: true` before the corpus is ready for questions. Inspect startup problems with `docker compose logs --tail=100 app litellm postgres`. The health endpoint checks the database and corpus; a cited answer is the separate model/gateway smoke check.

Compose exposes the portal on **3000**, LiteLLM on **4000**, and PostgreSQL on **5434**. Containers use PostgreSQL's internal port **5432**. Stop any existing native app and gateway before reusing ports 3000 and 4000. The native PostgreSQL service on 5433 can remain running.

Stop the stack with `docker compose down`. Keep its PostgreSQL volume and `.runtime/` directory to retain conversations and agent state. `docker compose down -v` deletes the stack's database volume.

Full Compose startup remains unverified in the original demo report. The native setup below was the verified runtime; this distinction also applies to the Compose test commands.

## Portal and demo accounts

Open [the local portal](http://127.0.0.1:3000). Seeded demo accounts:

| Role | Email | Password |
| --- | --- | --- |
| Customer | customer@maxify.demo | Demo123! |
| Reviewer | reviewer@maxify.demo | Demo123! |

The verified native setup uses PostgreSQL with pgvector on **5433**, LiteLLM on **4000**, and the portal on **3000**. These demo credentials are seeded local accounts, not production authentication.

## Corpus

The active corpus contains **8 real products, 3 explicitly fictional Demo store policies, 11 sources, and 102 chunks**. Product sources are official Apple specifications: AirPods 5, AirPods Pro 3, AirPods Max 2, iPhone 17, iPad Air, iPad Pro, MacBook Air, and MacBook Pro. Raw snapshots, hashes, capture timestamps, final URLs, and versions are preserved in `data/manifest.json` and `data/raw/`; extracted text is in `data/processed/`. Manufacturer specifications and fictional retailer shipping, returns, and warranty procedures are separate source scopes.

Customer answers use `gpt-6-luna` through the Codex SDK and LiteLLM Responses API. Labels and quality judgments use `gpt-6-sol`; embeddings use `text-embedding-3-small`. Costs come from gateway usage and price estimates; missing or unfinished costs remain unknown. Existing evaluation records retain their original corpus and dataset hashes. The current 24-case quality dataset covers the original headphone/policy scope; adding five products did not silently rewrite that dataset.

## Native startup and restart

Run from this project directory. The existing native database and LiteLLM environment are under `.runtime/`.

1. Install application dependencies with `npm ci`. If configuring a new checkout, copy `.env.example` to `.env` and set the provider and local gateway keys. Preserve an existing working `.env`.
2. Start the existing native database if it is stopped:

   ```sh
   /opt/homebrew/opt/postgresql@15/bin/pg_ctl -D .runtime/pgdata -l .runtime/postgres.log -o '-p 5433 -h 127.0.0.1' start
   ```

   The database cluster must already contain the `support` role/database and pgvector extension. This command reuses the demo cluster; it does not initialize an empty cluster.
3. Start the gateway in a separate terminal, loading `.env` without printing credentials:

   ```sh
   node --input-type=module -e 'import "dotenv/config"; import {spawn} from "node:child_process"; const env={...process.env,PYTHONPATH:process.cwd()+"/litellm",COST_LOG_PATH:process.cwd()+"/.runtime/gateway-costs.jsonl"}; delete env.DATABASE_URL; const p=spawn(".runtime/litellm-venv/bin/litellm",["--config","litellm/config.yaml","--port","4000","--host","127.0.0.1"],{stdio:"inherit",env}); p.on("exit",c=>process.exit(c??1));'
   ```

   For a new environment, create that virtual environment and install `litellm[proxy]` first. Native paths shown here match this macOS demo machine.
4. Run `npm run build`, then `npm start` in another terminal. `npm run dev` is available for source changes.
5. Run `npm run ingest`. Unchanged snapshots reuse cached embeddings and return `unchanged: true`. A new corpus activates only after complete ingestion; interrupted staging preserves the prior active version.
6. Check `http://127.0.0.1:3000/api/health` and open the portal.

To restart the application, stop its terminal process and run `npm start` again. Keep PostgreSQL and LiteLLM running. Committed chats and login sessions persist; interrupted requests offer explicit retry using the same request identity. An interrupted provider call can have an unknown billing outcome.

## Verification and saved evaluations

Run the following commands from the project root after `npm ci`. Basic checks need no provider key or running services:

```sh
npm run typecheck
npm run build
npm test
```

`npm test` runs the basic checks and skips the two opt-in HTTP and RAG integration tests. A passing default run does not certify the live model, database, or gateway.

With the application, PostgreSQL, and LiteLLM running and the corpus ingested, run both opt-in checks:

```sh
HTTP_INTEGRATION=1 RAG_INTEGRATION=1 npm test
```

To run either integration check separately:

```sh
HTTP_INTEGRATION=1 npx tsx --test tests/http.test.ts
RAG_INTEGRATION=1 npx tsx --test tests/rag.test.ts
```

Then run resilience checks and model-graded quality evaluation:

```sh
npx tsx scripts/failure-checks.ts
npm run eval
```

| Check | What it verifies | Dependencies and effects |
| --- | --- | --- |
| Typecheck and build | TypeScript contracts and production web compilation | Installed dependencies; build writes `dist/` |
| Basic tests | Password handling, citation contracts, evidence gaps, context scope, cost tags, extraction, and snapshot hashes | No live provider calls; integration cases are skipped |
| HTTP integration | Reusing a completed request ID with a different question returns a conflict | Running portal; creates a demo login and saved chat turn |
| RAG integration | All eight product scopes, numeric battery evidence for the five additions, ingestion interruption safety, and unchanged ingestion without new document embeddings | PostgreSQL and gateway; writes staging state and may make paid embedding calls |
| Failure checks | Restart, model timeout/rate limit, retrieval outage, absent evidence, ingestion interruption, duplicate requests, and access boundaries | Running database and gateway; creates an isolated app/database and saves outcomes |
| Quality evals | 24 real answering-pipeline cases with labels, evidence, citations, four rubric grades, and rationale | Active corpus and gateway; paid Luna/Sol/embedding calls; results saved in PostgreSQL |

The failure script starts a separate app on **3001** with a `support_checks` database; it needs a database role that can create databases. Restart, duplicate requests, and access checks use actual HTTP/process behavior. Model timeout/rate-limit and retrieval errors are simulated adapter failures. Ingestion interruption uses an injected failure and checks the main corpus, so avoid concurrent ingestion. Do not run two failure scripts simultaneously.

For a Compose deployment, run checks inside the app container:

```sh
docker compose exec app npm run typecheck
docker compose exec app npm test
docker compose exec -e HTTP_INTEGRATION=1 -e RAG_INTEGRATION=1 app npm test
docker compose exec app npx tsx scripts/failure-checks.ts
docker compose exec app npm run eval
```

The image build already runs `npm run build`. The isolated failure app on 3001 runs inside the app container and needs no published host port.

Quality evaluation makes paid model calls and can take several minutes. Start it from the reviewer console or `npm run eval`; avoid starting concurrent runs. Saved results expose run status, per-case evidence, labels, scores, corpus/dataset hashes, and audit status. Model-generated labels and judgments remain preliminary until human review; do not present a running or failed run as a completed score.

### Inspect evaluation and failure results

Log in as the reviewer and open **Reviewer console**:

- **Evaluations**: open a saved run, select a case, and inspect its actual answer, expected behavior, required facts, evidence, citation validity, retrieval hit, and judge rationale. **Run evaluations** starts quality cases only.
- **Failure checks**: inspect outcomes recorded by `scripts/failure-checks.ts`, including the injection type and observed evidence. The quality-evaluation button does not run these checks.
- **Traces & costs**: inspect model calls, request identifiers, usage, purpose, and estimated cost. Missing prices or usage remain unknown.
- **Sources**: inspect the active corpus and preserved raw snapshots.

The 24 cases cover ten product questions, four policy questions, two follow-ups, four ambiguous questions, two unsupported questions, and two prompt-injection questions. Sol generates source-grounded labels on each run and grades correctness, coverage, claim support, and expected behavior. A case passes only when validation succeeds and all four grades pass. Errors and blocked cases remain separate. A completed run can contain failed cases.

Labels are also written to `.runtime/evals/`. Saved evaluation rows and cost records live in the local database; they are not bundled with this repository. Raw source snapshots and the dataset definition are included, so another checkout can generate its own results. The five added products have retrieval checks but still need dedicated quality cases. See the [PRD success metrics](docs/superpowers/specs/2026-10-08-customer-support-agent-design.md#success-metrics) for acceptance targets.

## Deployment status

Hosting is deferred. A Vercel portal would need hosted PostgreSQL/pgvector, durable snapshot storage, and persistent external gateway/Codex services; this local worker and its files cannot be assumed to survive inside serverless functions.

See [the demo walkthrough](docs/DEMO_RUNBOOK.md) and [the product specification](docs/superpowers/specs/2026-10-08-customer-support-agent-design.md).
