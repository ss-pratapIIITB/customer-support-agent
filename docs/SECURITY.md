# Security

This document describes the implemented controls, their limits, and what must change before exposing the service publicly.

## Secret handling

- `.env` is gitignored. `.env.example` contains placeholders only.
- Provider keys are read only by the Node server. The Python harness calls token-protected internal endpoints and never receives an API key.
- Provider error response bodies are not logged; they can echo request metadata. Embedding failures log only status and a safe message.
- Eval graders scan answer text for key-shaped strings (`sk-...`, bearer tokens, `OPENAI_API_KEY=`, `DATABASE_URL=`, `EVAL_API_TOKEN=`).
- Demo mode defaults embeddings off even when a stale key exists, preventing accidental external calls.

Before every push:

```bash
git status --short --ignored
git ls-files | grep -E '^\.env$'
git grep -I -n -E 'sk-[A-Za-z0-9]{10,}|Bearer [A-Za-z0-9._-]{12,}'
```

The last command should only match test fixtures that intentionally use fake key-shaped strings.

## Authentication and authorization

- Passwords are hashed with Node `scrypt` and a random salt; verification uses `timingSafeEqual`.
- Sessions are server-side rows with an expiry. Cookies are HTTP-only and should be `Secure` behind HTTPS (`COOKIE_SECURE=true`).
- Roles: `customer`, `reviewer`, `admin`. Admin routes require reviewer/admin.
- Every customer-side SQL query is scoped by `user_id`. Cross-account order and chat access is denied at the data layer, not just in prompts.
- Internal eval and reliability endpoints require `x-eval-token`, compared in constant time. They are not intended for public exposure.
- Login, chat writes, and internal endpoints are rate-limited per client IP; the API-wide limiter bounds total traffic.

## Input and prompt safety

- Messages are capped by `MAX_MESSAGE_CHARS` (default 2000).
- Prompt-injection patterns are detected and stripped; the remaining legitimate request is still processed. Safety cases must abstain rather than reveal instructions or secrets.
- Medical questions, live pricing/stock, and credential extraction are refused with a clear scope statement.
- Product and policy claims require retrieved evidence. Unsupported questions abstain.
- Citation IDs are validated against the retrieved passages before an answer is accepted.
- Tool arguments are validated with Zod schemas; tool outputs are persisted for audit.
- Return side effects require confirmation. High-value returns require human approval.

## Data protection

- Chat messages, traces, tool calls, and order data live in Postgres. There is no retention job in this demo; add one for production.
- Logs may contain order IDs, emails, and chat content. Treat logs as sensitive and redact at the platform boundary.
- Do not put real customer data into the seeded demo database.
- Backups and the Postgres volume are unencrypted by default in Compose. Use managed encryption and access controls in production.

## Threat model

| Threat                      | Control                                                                      | Residual risk                                                |
| --------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Prompt injection            | Pattern detection, scope minimization, evidence-bound answers, refusal path  | Novel injections may pass; evaluate and monitor              |
| Cross-account data access   | SQL `user_id` scoping, session auth                                          | A future query that forgets the predicate; enforce in review |
| Credential leakage          | Server-side keys, no key in harness, secret scan, no provider bodies in logs | Logs from new integrations; review every logger call         |
| Return abuse                | Eligibility rules, confirmation, high-value review                           | Policy gaps; reviewer judgment                               |
| Tool argument tampering     | Zod validation, server-side ownership lookup                                 | New tools must follow the same pattern                       |
| Eval endpoint abuse         | Shared token, isolated temporary chats, deletion after each case             | Token rotation and network restriction required              |
| DoS                         | Rate limits, message size cap, statement timeout, model timeout              | Single-process limits; add a gateway/WAF for public traffic  |
| Data exfiltration via model | No provider in demo; live mode sends only the prompt/evidence needed         | Provider retention terms; use a compliant provider           |

## Deployment checklist

- [ ] Set a strong, unique `EVAL_API_TOKEN`; never use the example value.
- [ ] Set `COOKIE_SECURE=true` and terminate TLS in front of the app.
- [ ] Set `AUTO_BOOTSTRAP=false`; run migrations/ingestion as a controlled job.
- [ ] Restrict internal routes (`/api/internal/*`) to the eval runner network or block them at the edge.
- [ ] Use a least-privilege database role and encrypted backups.
- [ ] Configure a real OTLP collector and retain traces per policy.
- [ ] Set `SEED_DEMO=false`; remove demo accounts and data.
- [ ] Add retention/deletion jobs for chats, traces, and tool calls.
- [ ] Run the eval and reliability suites in CI and on deploy.
- [ ] Review provider data-retention and residency terms if live mode is enabled.

## Reporting

This is a demo repository. Do not include real customer data or live secrets in issues. For a deployment, establish a private security contact and a coordinated disclosure process.
