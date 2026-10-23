import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import {
  trace,
  metrics,
  SpanStatusCode,
  type Attributes,
  type Span,
  type Counter,
  type Histogram,
  type Meter,
} from '@opentelemetry/api';
import { config } from './config.js';
import { logger } from './logger.js';

let sdk: NodeSDK | undefined;
export const tracer = trace.getTracer('maxify-support', '1.0.0');

type Instruments = {
  answers: Counter;
  handoffs: Counter;
  toolCalls: Counter;
  tokens: Counter;
  cost: Counter;
  latency: Histogram;
  retrieval: Histogram;
};

function createInstruments(meter: Meter): Instruments {
  return {
    answers: meter.createCounter('support.answers.total', {
      description: 'Agent answers by behavior and intent',
    }),
    handoffs: meter.createCounter('support.handoffs.total', {
      description: 'Conversations escalated to a human',
    }),
    toolCalls: meter.createCounter('support.tool_calls.total', {
      description: 'Executed agent tool calls',
    }),
    tokens: meter.createCounter('gen_ai.tokens.total', {
      description: 'Model tokens consumed',
    }),
    cost: meter.createCounter('support.cost.usd', {
      description: 'Estimated model spend in USD',
    }),
    latency: meter.createHistogram('support.answer.latency_ms', {
      description: 'End-to-end answer latency in milliseconds',
      unit: 'ms',
    }),
    retrieval: meter.createHistogram('support.retrieval.latency_ms', {
      description: 'Hybrid retrieval latency in milliseconds',
      unit: 'ms',
    }),
  };
}

// Until startTelemetry installs the SDK, these are no-op instruments. They are
// replaced after sdk.start() so the Prometheus reader owns the real meter.
export let instruments = createInstruments(metrics.getMeter('maxify-support', '1.0.0'));

export function startTelemetry(): void {
  if (!config.OTEL_ENABLED || sdk) return;
  const metricReader = new PrometheusExporter(
    { port: config.OTEL_METRICS_PORT, host: config.OTEL_METRICS_HOST, preventServerStart: false },
    () => logger.info({ port: config.OTEL_METRICS_PORT }, 'Prometheus metrics listening'),
  );
  sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: config.OTEL_SERVICE_NAME,
      [ATTR_SERVICE_VERSION]: '1.0.0',
      'deployment.environment': config.NODE_ENV,
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${config.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, '')}/v1/traces`,
    }),
    metricReader,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-express': { enabled: true },
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (req) => {
            const url = req.url ?? '';
            return url.startsWith('/metrics') || url.startsWith('/api/health');
          },
        },
      }),
    ],
  });
  sdk.start();
  instruments = createInstruments(metrics.getMeter('maxify-support', '1.0.0'));
  logger.info(
    { endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT, metricsPort: config.OTEL_METRICS_PORT },
    'OpenTelemetry tracing enabled',
  );
}

export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown().catch(() => undefined);
  sdk = undefined;
}

export function currentTraceId(): string | null {
  return trace.getActiveSpan()?.spanContext().traceId ?? null;
}

export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    const start = performance.now();
    try {
      const result = await fn(span);
      span.setAttribute('duration_ms', Math.max(0, Math.round(performance.now() - start)));
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function spanAttributes(input: Record<string, string | number | boolean | undefined>) {
  const out: Attributes = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}
