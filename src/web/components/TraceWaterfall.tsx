import { useState } from 'react';
import { Activity, Check, Copy, ExternalLink, GitBranch, Wrench } from 'lucide-react';
import type { Trace } from '../types.js';
import { money, ms } from '../api.js';

export function TraceWaterfall({ trace, jaegerUrl }: { trace: Trace; jaegerUrl?: string | null }) {
  const [copied, setCopied] = useState(false);
  const data = trace.data ?? {};
  const spans =
    data.spans && data.spans.length
      ? data.spans
      : [
          {
            name: 'retrieval.hybrid_search',
            startMs: 0,
            durationMs: data.retrieval?.ms ?? 0,
          },
          {
            name: 'agent.run',
            startMs: data.retrieval?.ms ?? 0,
            durationMs: data.agent?.latencyMs ?? data.latencyMs ?? 0,
          },
        ];
  const max = Math.max(1, ...spans.map((span) => span.startMs + span.durationMs));
  const total = data.latencyMs ?? max;
  const toolCalls = data.agent?.toolCalls ?? data.toolCalls ?? [];
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  async function copyId() {
    try {
      await navigator.clipboard.writeText(trace.trace_id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="trace-waterfall">
      <div className="trace-summary">
        <div>
          <span>Trace</span>
          <code>{trace.trace_id.slice(0, 16)}…</code>
          <button
            className="icon-button small"
            onClick={() => void copyId()}
            aria-label="Copy trace ID"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
        <div>
          <span>Status</span>
          <strong className={data.status === 'failed' ? 'bad' : 'good'}>
            {data.status ?? 'completed'}
          </strong>
        </div>
        <div>
          <span>Intent</span>
          <strong>{data.intent?.replace(/_/g, ' ') ?? '—'}</strong>
        </div>
        <div>
          <span>Latency</span>
          <strong>{ms(total)}</strong>
        </div>
        <div>
          <span>Cost</span>
          <strong>{money(data.agent?.costUsd ?? 0)}</strong>
        </div>
      </div>

      <div className="waterfall-axis">
        {ticks.map((tick) => (
          <span key={tick} style={{ left: `${tick * 100}%` }}>
            {ms(max * tick)}
          </span>
        ))}
      </div>

      <div className="waterfall-rows">
        {spans.map((span, index) => {
          const tone = span.name.startsWith('tool.')
            ? 'tool'
            : span.name.startsWith('agent')
              ? 'agent'
              : span.name.startsWith('retrieval')
                ? 'retrieval'
                : 'other';
          return (
            <div className="waterfall-row" key={`${span.name}-${index}`}>
              <div className="span-name" title={span.name}>
                {tone === 'tool' ? <Wrench size={12} /> : <GitBranch size={12} />}
                {span.name}
              </div>
              <div className="span-track">
                <span
                  className={`span-bar ${tone}`}
                  style={{
                    left: `${(span.startMs / max) * 100}%`,
                    width: `${Math.max(0.7, (span.durationMs / max) * 100)}%`,
                  }}
                  title={`${span.name} · ${ms(span.durationMs)}`}
                />
              </div>
              <div className="span-duration">{ms(span.durationMs)}</div>
            </div>
          );
        })}
      </div>

      {toolCalls.length ? (
        <div className="trace-tools">
          <h4>
            <Wrench size={13} /> Tool calls
          </h4>
          {toolCalls.map((call, index) => (
            <div className="trace-tool-row" key={`${call.name}-${index}`}>
              <code>{call.name}</code>
              <span className={`tool-status ${call.status}`}>{call.status.replace(/_/g, ' ')}</span>
              <span>{ms(call.latencyMs)}</span>
              <details>
                <summary>args & result</summary>
                <pre>{JSON.stringify({ args: call.args, result: call.result }, null, 2)}</pre>
              </details>
            </div>
          ))}
        </div>
      ) : null}

      <div className="trace-links">
        <span>
          <Activity size={13} /> OpenTelemetry span tree · exported to the configured OTLP collector
        </span>
        {jaegerUrl ? (
          <a href={jaegerUrl} target="_blank" rel="noreferrer">
            Open in Jaeger <ExternalLink size={13} />
          </a>
        ) : null}
      </div>
    </div>
  );
}
