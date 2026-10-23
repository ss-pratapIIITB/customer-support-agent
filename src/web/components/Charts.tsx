import type { ReactNode } from 'react';

export type TrendPoint = {
  day: string;
  conversations: number;
  answers: number;
  handoffs: number;
};

export function TrendChart({ data }: { data: TrendPoint[] }) {
  if (!data.length) {
    return <div className="chart-empty">No activity in this range yet.</div>;
  }
  const width = 720;
  const height = 220;
  const padding = { top: 16, right: 12, bottom: 28, left: 34 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const max = Math.max(4, ...data.map((point) => Math.max(point.answers, point.conversations)));
  const ceiling = Math.ceil(max / 4) * 4;
  const x = (index: number) =>
    padding.left + (data.length === 1 ? innerW / 2 : (index / (data.length - 1)) * innerW);
  const y = (value: number) => padding.top + innerH - (value / ceiling) * innerH;

  const line = (key: 'answers' | 'conversations') =>
    data.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point[key])}`).join(' ');
  const area = `${line('answers')} L ${x(data.length - 1)} ${padding.top + innerH} L ${x(0)} ${
    padding.top + innerH
  } Z`;
  const ticks = [0, 1, 2, 3, 4].map((step) => (ceiling / 4) * step);
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));

  return (
    <div className="trend-chart">
      <div className="chart-legend">
        <span>
          <i className="legend-answers" /> Answers
        </span>
        <span>
          <i className="legend-conversations" /> Conversations
        </span>
        <span>
          <i className="legend-handoffs" /> Handoffs
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Support activity trend">
        <defs>
          <linearGradient id="answerFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2a7f7d" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#2a7f7d" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(tick)}
              y2={y(tick)}
              className="grid-line"
            />
            <text x={padding.left - 10} y={y(tick) + 4} textAnchor="end" className="axis-label">
              {tick}
            </text>
          </g>
        ))}
        <path d={area} fill="url(#answerFill)" />
        <path d={line('answers')} className="line-answers" />
        <path d={line('conversations')} className="line-conversations" />
        {data.map((point, index) => (
          <g key={point.day}>
            {point.handoffs > 0 ? (
              <circle cx={x(index)} cy={y(point.handoffs)} r="3" className="dot-handoffs">
                <title>
                  {point.day}: {point.handoffs} handoffs
                </title>
              </circle>
            ) : null}
            <circle cx={x(index)} cy={y(point.answers)} r="2.6" className="dot-answers">
              <title>
                {point.day}: {point.answers} answers, {point.conversations} conversations
              </title>
            </circle>
            {index % labelEvery === 0 || index === data.length - 1 ? (
              <text x={x(index)} y={height - 8} textAnchor="middle" className="axis-label">
                {new Date(`${point.day}T00:00:00`).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );
}

export function IntentBars({
  data,
  total,
}: {
  data: Array<{ intent: string; count: number }>;
  total?: number;
}) {
  if (!data.length) return <div className="chart-empty">No intent data yet.</div>;
  const max = Math.max(...data.map((item) => item.count), 1);
  const sum = total ?? data.reduce((acc, item) => acc + item.count, 0);
  return (
    <div className="intent-bars">
      {data.slice(0, 6).map((item, index) => (
        <div className="intent-row" key={item.intent}>
          <div className="intent-label">
            <span>{prettyIntent(item.intent)}</span>
            <strong>{item.count}</strong>
          </div>
          <div className="intent-track">
            <span
              style={{
                width: `${Math.max(4, (item.count / max) * 100)}%`,
                animationDelay: `${index * 55}ms`,
              }}
            />
          </div>
          <small>{sum ? `${Math.round((item.count / sum) * 100)}%` : '—'}</small>
        </div>
      ))}
    </div>
  );
}

export function Donut({
  segments,
  center,
  caption,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  center: ReactNode;
  caption?: string;
}) {
  const total = segments.reduce((acc, segment) => acc + segment.value, 0);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <div className="donut">
        <svg viewBox="0 0 140 140" role="img" aria-label={caption ?? 'Distribution'}>
          <circle cx="70" cy="70" r={radius} className="donut-track" />
          {segments.map((segment) => {
            const portion = total ? segment.value / total : 0;
            const dash = portion * circumference;
            const element = (
              <circle
                key={segment.label}
                cx="70"
                cy="70"
                r={radius}
                className="donut-segment"
                stroke={segment.color}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
              >
                <title>
                  {segment.label}: {segment.value}
                </title>
              </circle>
            );
            offset += dash;
            return element;
          })}
        </svg>
        <div className="donut-center">{center}</div>
      </div>
      <div className="donut-legend">
        {segments.map((segment) => (
          <span key={segment.label}>
            <i style={{ background: segment.color }} />
            {segment.label}
            <strong>{segment.value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

export function Sparkline({ values, tone = 'teal' }: { values: number[]; tone?: string }) {
  if (values.length < 2) return null;
  const width = 120;
  const height = 34;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - 4 - ((value - min) / Math.max(1, max - min)) * (height - 8);
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg className={`sparkline ${tone}`} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={points} fill="none" />
    </svg>
  );
}

function prettyIntent(intent: string): string {
  const labels: Record<string, string> = {
    product_question: 'Product questions',
    product_comparison: 'Comparisons',
    ambiguous_product: 'Needs clarification',
    policy_returns: 'Returns policy',
    policy_shipping: 'Shipping policy',
    policy_warranty: 'Warranty',
    order_status: 'Order status',
    return_request: 'Return requests',
    human_handoff: 'Human handoff',
    unsupported: 'Out of scope',
    greeting: 'Greetings',
    thanks: 'Thanks',
  };
  return labels[intent] ?? intent.replace(/_/g, ' ');
}
