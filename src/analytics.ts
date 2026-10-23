import { config } from './config.js';
import { query } from './db.js';

export type AnalyticsRange = { days: number };

export async function getAnalytics(days = 14) {
  const safeDays = Math.min(Math.max(days, 1), 90);
  const since = `now() - ($1 || ' days')::interval`;

  const conversations = await query<{
    total: number;
    resolved: number;
    handed_off: number;
    open: number;
    seeded: number;
  }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status <> 'handed_off')::int AS resolved,
            count(*) FILTER (WHERE status = 'handed_off')::int AS handed_off,
            count(*) FILTER (WHERE status = 'open')::int AS open,
            count(*) FILTER (WHERE is_seed)::int AS seeded
       FROM chats WHERE created_at >= ${since}`,
    [String(safeDays)],
  );

  const messages = await query<{ total: number; user: number; assistant: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE role='user')::int AS "user",
            count(*) FILTER (WHERE role='assistant')::int AS assistant
       FROM messages WHERE created_at >= ${since}`,
    [String(safeDays)],
  );

  const feedback = await query<{ count: number; average: number | null; positive: number }>(
    `SELECT count(*)::int AS count, avg(rating)::float AS average,
            count(*) FILTER (WHERE rating >= 4)::int AS positive
       FROM feedback WHERE created_at >= ${since}`,
    [String(safeDays)],
  );

  const latency = await query<{ p50: number | null; p95: number | null; avg: number | null }>(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (data->>'latencyMs')::float) AS p50,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY (data->>'latencyMs')::float) AS p95,
            avg((data->>'latencyMs')::float) AS avg
       FROM traces
      WHERE created_at >= ${since} AND data->>'latencyMs' IS NOT NULL AND (data->>'latencyMs') ~ '^[0-9.]+$'`,
    [String(safeDays)],
  );

  const cost = await query<{ total: number | null; unknown: number; calls: number }>(
    `SELECT sum(cost_usd)::float AS total,
            count(*) FILTER (WHERE cost_usd IS NULL)::int AS unknown,
            count(*)::int AS calls
       FROM model_calls WHERE created_at >= ${since}`,
    [String(safeDays)],
  );

  const tokens = await query<{ input: number; output: number }>(
    `SELECT COALESCE(sum(input_tokens),0)::int AS input,
            COALESCE(sum(output_tokens),0)::int AS output
       FROM model_calls WHERE created_at >= ${since}`,
    [String(safeDays)],
  );

  const intents = await query<{ intent: string; count: number }>(
    `SELECT COALESCE(data->>'intent','unknown') AS intent, count(*)::int AS count
       FROM traces WHERE created_at >= ${since}
      GROUP BY 1 ORDER BY count DESC`,
    [String(safeDays)],
  );

  const daily = await query<{
    day: string;
    conversations: number;
    handoffs: number;
    answers: number;
  }>(
    `WITH days AS (
       SELECT generate_series((current_date - ($1::int - 1)), current_date, '1 day')::date AS day
     )
     SELECT to_char(d.day,'YYYY-MM-DD') AS day,
            (SELECT count(*)::int FROM chats c WHERE c.created_at::date = d.day) AS conversations,
            (SELECT count(*)::int FROM tickets t WHERE t.created_at::date = d.day) AS handoffs,
            (SELECT count(*)::int FROM messages m WHERE m.role='assistant' AND m.created_at::date = d.day) AS answers
       FROM days d ORDER BY d.day`,
    [safeDays],
  );

  const topQuestions = await query<{ question: string; count: number }>(
    `SELECT content AS question, count(*)::int AS count
       FROM messages WHERE role='user' AND created_at >= ${since}
      GROUP BY content ORDER BY count DESC, max(created_at) DESC LIMIT 8`,
    [String(safeDays)],
  );

  const tools = await query<{ name: string; count: number; failures: number }>(
    `SELECT name, count(*)::int AS count,
            count(*) FILTER (WHERE status <> 'ok')::int AS failures
       FROM tool_calls WHERE created_at >= ${since}
      GROUP BY name ORDER BY count DESC`,
    [String(safeDays)],
  );

  const latestEval = await query<{
    id: string;
    status: string;
    results: Record<string, unknown>;
    created_at: string;
  }>(`SELECT id,status,results,created_at FROM eval_runs ORDER BY created_at DESC LIMIT 1`);

  const total = conversations.rows[0]?.total ?? 0;
  const resolved = conversations.rows[0]?.resolved ?? 0;
  const handoffs = conversations.rows[0]?.handed_off ?? 0;
  const positive = feedback.rows[0]?.positive ?? 0;
  const feedbackCount = feedback.rows[0]?.count ?? 0;
  const costTotal = cost.rows[0]?.total ?? 0;

  return {
    rangeDays: safeDays,
    generatedAt: new Date().toISOString(),
    mode: config.liveModel ? 'live' : 'demo',
    model: config.liveModel ? config.CHAT_MODEL : 'demo-engine',
    conversations: {
      total,
      resolved,
      handoffs,
      open: conversations.rows[0]?.open ?? 0,
      seeded: conversations.rows[0]?.seeded ?? 0,
      containmentRate: total ? resolved / total : null,
      handoffRate: total ? handoffs / total : null,
    },
    messages: messages.rows[0] ?? { total: 0, user: 0, assistant: 0 },
    csat: {
      average: feedback.rows[0]?.average ?? null,
      responses: feedbackCount,
      positiveRate: feedbackCount ? positive / feedbackCount : null,
    },
    latency: {
      p50: latency.rows[0]?.p50 ?? null,
      p95: latency.rows[0]?.p95 ?? null,
      average: latency.rows[0]?.avg ?? null,
    },
    cost: {
      totalUsd: costTotal,
      perConversationUsd: total ? costTotal / total : null,
      calls: cost.rows[0]?.calls ?? 0,
      unknownCostCalls: cost.rows[0]?.unknown ?? 0,
      inputTokens: tokens.rows[0]?.input ?? 0,
      outputTokens: tokens.rows[0]?.output ?? 0,
    },
    intents: intents.rows,
    daily: daily.rows,
    topQuestions: topQuestions.rows,
    tools: tools.rows,
    latestEval: latestEval.rows[0] ?? null,
  };
}
