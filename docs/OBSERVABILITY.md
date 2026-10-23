# Observability

The service emits three complementary signals:

- **Traces** for request-level causality, exported over OTLP to Jaeger.
- **Metrics** for rates, latency, tools, tokens, cost, and retrieval health, exposed in Prometheus format.
- **Structured logs** with request and trace context for local debugging.

## Trace topology

A typical chat turn produces:

```text
POST /api/chats/:id/messages          (HTTP auto-instrumentation)
└── retrieval.hybrid_search
    └── embeddings.request            (live/embedding mode only)
└── agent.run
    ├── tool.get_order_status
    └── tool.start_return
```

Evaluation answers use the same path under `eval.case`. Important span attributes include:

- `support.intent`, `support.behavior`, `support.confidence`
- `support.evidence_count`, `support.citations`, `support.tool_calls`
- `support.retrieval.result_count`, `support.retrieval.mode`, `support.retrieval.duration_ms`
- `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`
- `support.cost_usd`, `support.failure`
- `eval.run_id`, `eval.case_id`, `eval.category`

Messages persist `trace_id`, and the reviewer console links a message to its trace waterfall and raw trace JSON.

### Local Jaeger

```bash
docker compose up -d jaeger
open http://127.0.0.1:16686
```

Service name: `maxify-support`. Native runs export to `http://127.0.0.1:4318` by default. Set `OTEL_EXPORTER_OTLP_ENDPOINT` for another collector.

## Metrics

Prometheus endpoint: `http://127.0.0.1:9464/metrics`.

Custom instruments (created after the SDK starts so the Prometheus reader owns the real meter):

| Metric                         | Type      | Labels                         | Meaning                      |
| ------------------------------ | --------- | ------------------------------ | ---------------------------- |
| `support_answers_total`        | counter   | `behavior`, `intent`, `engine` | Answers by outcome           |
| `support_handoffs_total`       | counter   | `reason`                       | Human escalations            |
| `support_tool_calls_total`     | counter   | `tool`, `status`               | Tool executions and outcomes |
| `gen_ai_tokens_total`          | counter   | `model`, `direction`           | Input/output tokens          |
| `support_cost_usd`             | counter   | `model`                        | Estimated model spend        |
| `support_answer_latency_ms`    | histogram | `behavior`, `intent`, `engine` | Answer latency               |
| `support_retrieval_latency_ms` | histogram | `mode`, `scope`                | Retrieval latency            |

Auto-instrumentation adds HTTP and PostgreSQL metrics such as `http_server_duration` and `db_client_operation_duration`.

Useful PromQL:

```promql
# Answer rate by behavior
sum by (behavior) (rate(support_answers_total[5m]))

# Tool error ratio
sum(rate(support_tool_calls_total{status="error"}[5m]))
/
sum(rate(support_tool_calls_total[5m]))

# p95 answer latency
histogram_quantile(0.95, sum by (le) (rate(support_answer_latency_ms_bucket[5m])))

# Human review pressure
sum(rate(support_tool_calls_total{status="confirmation_required"}[5m]))
```

Prometheus scrapes `app:9464` every 15 seconds in Compose (`infra/prometheus.yml`). The UI is at `http://127.0.0.1:9090`.

## Logs

Pino JSON logs include service name, request method/URL/status, response time, and request errors. In production, ship them to your log platform and redact cookies, authorization headers, and provider payloads. Provider response bodies are intentionally not logged for embeddings; do the same for any new integration.

## Health

`GET /api/health` reports:

- `status`: `ready` when the database is reachable and the corpus is active
- `mode`, `model`, `embeddings`
- `otel`: whether telemetry is enabled
- `ingestion`: active corpus version, source/chunk counts, embedded count, lexical-only flag, recent versions
- `uptimeSec`

The Docker healthcheck polls this endpoint. A ready health check does **not** prove live-model quality; run the evaluation harness for that.

## Alert ideas

- `support_answers_total{behavior="abstain"}` spikes → retrieval or scope regression.
- `support_tool_calls_total{status="error"}` rises → database or tool contract issue.
- `support_retrieval_latency_ms` p95 rises → index/corpus growth or embedding provider latency.
- `support_answers_total` stops while HTTP traffic continues → instrumentation or agent failure.
- `support_handoffs_total` rises with `support_tool_calls_total{tool="start_return",status="confirmation_required"}` → policy friction or a prompt regression.

## Reliability script

`npm run reliability` checks health, eval metadata, token rejection, grounded retrieval, injection refusal, order tool execution, return confirmation, and the Prometheus endpoint. Results are imported into the reviewer console and are visible on the reliability page.
