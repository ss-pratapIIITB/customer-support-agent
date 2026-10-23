# Contributing

## Setup

```bash
git clone https://github.com/ss-pratapIIITB/customer-support-agent.git
cd customer-support-agent
cp .env.example .env
npm ci
npm run bootstrap
npm run start:dev
```

Node.js 22+, Python 3.10+, and PostgreSQL 17 with pgvector are required. The default `.env` runs the deterministic demo engine and makes no provider calls.

## Before opening a PR

```bash
npm run lint
npm run typecheck
npm test
PYTHONPATH=evals python3 -m unittest discover -s evals/tests -v
npm run build
```

With the app running:

```bash
npm run test:integration
npm run smoke
npm run reliability
make eval
```

All gates should pass. If you intentionally change agent behaviour or the dataset, update `evals/baselines/demo-engine.json` with `make eval-baseline` and explain the delta in the PR.

## Code conventions

- TypeScript strict mode; prefer explicit types at boundaries and Zod validation for external input.
- Keep SQL scoped by `user_id` for customer data. Never trust a prompt to enforce tenancy.
- New tools need: a Zod schema, an ownership check, an audit row, a tool metric, and test coverage.
- New retrieval behaviour needs an eval case that would fail without it.
- Keep deterministic behavior in demo mode. No accidental external calls when no key is configured.
- Do not commit `.env`, provider keys, customer data, runtime state, or generated reports.
- Follow the existing Prettier configuration (`npm run format`); do not reformat unrelated files.

## Evaluation changes

Adding or changing a case:

1. Add a JSONL row to `evals/datasets/support_v1.jsonl`.
2. Run the case against the app and inspect the actual answer/evidence.
3. Make the assertion about observable behavior, not implementation wording.
4. Run the full suite and the Python unit tests.
5. Regenerate the baseline only after the suite is intentionally correct.

Do not weaken a grader to make a real regression pass.

## Commits

Use focused conventional commits, for example:

```text
feat(agent): add warranty assessment handoff
fix(retrieval): rank battery sections for product comparisons
test(evals): cover high-value return review
docs: document Prometheus metrics
```

Do not force-push `main`. Do not commit secrets. If a secret is exposed, rotate it immediately and rewrite history only with explicit coordination.

## Security

Read [docs/SECURITY.md](docs/SECURITY.md). Report vulnerabilities privately rather than opening a public issue with exploit details.
