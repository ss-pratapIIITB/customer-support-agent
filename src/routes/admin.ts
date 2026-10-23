import { Router } from 'express';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { getAnalytics } from '../analytics.js';
import { getIngestionStatus, getSource, ingest, listSources } from '../ingest.js';
import { one, query } from '../db.js';
import { logger } from '../logger.js';
import { version } from '../version.js';

export const adminRouter = Router();
let ingestionRunning = false;
let evalRunning = false;

const systemInfo = () => ({
  version,
  mode: config.liveModel ? 'live' : 'demo',
  chatModel: config.liveModel ? config.CHAT_MODEL : 'demo-engine',
  judgeModel: config.JUDGE_MODEL,
  embeddingModel: config.embeddings ? config.EMBEDDING_MODEL : 'lexical-only',
  otelEnabled: config.OTEL_ENABLED,
  otelEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
  jaegerUrl: config.JAEGER_UI_URL,
  metricsPort: config.OTEL_METRICS_PORT,
  node: process.version,
  uptimeSec: Math.round(process.uptime()),
  autoBootstrap: config.AUTO_BOOTSTRAP,
});

adminRouter.get('/overview', async (_req, res) => {
  const [analytics, sources, ingestion, evalRuns, traces, costs, reliability] = await Promise.all([
    getAnalytics(14),
    listSources(),
    getIngestionStatus(),
    query(
      `SELECT id,source,status,dataset,results,created_at,finished_at FROM eval_runs ORDER BY created_at DESC LIMIT 10`,
    ),
    query(
      `SELECT id,trace_id,chat_id,request_id,data,created_at FROM traces ORDER BY created_at DESC LIMIT 20`,
    ),
    getCosts(),
    query(`SELECT * FROM reliability_checks ORDER BY created_at DESC LIMIT 20`),
  ]);
  res.json({
    analytics,
    sources,
    ingestion,
    evalRuns: evalRuns.rows,
    traces: traces.rows,
    costs,
    reliability: reliability.rows,
    system: systemInfo(),
  });
});

adminRouter.get('/analytics', async (req, res) => {
  const days = Number(req.query.days ?? 14);
  res.json(await getAnalytics(Number.isFinite(days) ? days : 14));
});

adminRouter.get('/conversations', async (req, res) => {
  const search = typeof req.query.search === 'string' ? `%${req.query.search}%` : '%';
  const limit = Math.min(Number(req.query.limit ?? 40) || 40, 100);
  const rows = await query(
    `SELECT c.id,c.title,c.status,c.created_at,c.updated_at,c.is_seed,u.email,
            (SELECT content FROM messages m WHERE m.chat_id=c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
            (SELECT count(*)::int FROM messages m WHERE m.chat_id=c.id) AS message_count,
            (SELECT bool_or(rating <= 2) FROM feedback f WHERE f.chat_id=c.id) AS negative_feedback,
            (SELECT trace_id FROM messages m WHERE m.chat_id=c.id AND m.trace_id IS NOT NULL ORDER BY m.created_at DESC LIMIT 1) AS trace_id
       FROM chats c JOIN users u ON u.id=c.user_id
      WHERE c.title ILIKE $1 OR u.email ILIKE $1
      ORDER BY c.updated_at DESC LIMIT $2`,
    [search, limit],
  );
  res.json({ conversations: rows.rows });
});

adminRouter.get('/conversations/:id', async (req, res) => {
  const chatId = String(req.params.id);
  const chat = await one(
    `SELECT c.*, u.email, u.name FROM chats c JOIN users u ON u.id=c.user_id WHERE c.id=$1`,
    [chatId],
  );
  if (!chat) {
    res.status(404).json({ error: 'Conversation not found.' });
    return;
  }
  const [messages, traces, tools, tickets, returns, pending] = await Promise.all([
    query(
      `SELECT m.*, f.rating AS feedback_rating, f.reason AS feedback_reason
         FROM messages m LEFT JOIN feedback f ON f.message_id=m.id
        WHERE m.chat_id=$1 ORDER BY m.created_at,m.id`,
      [chatId],
    ),
    query(
      `SELECT id,trace_id,request_id,data,created_at FROM traces WHERE chat_id=$1 ORDER BY created_at`,
      [chatId],
    ),
    query(`SELECT * FROM tool_calls WHERE chat_id=$1 ORDER BY created_at`, [chatId]),
    query(`SELECT * FROM tickets WHERE chat_id=$1 ORDER BY created_at`, [chatId]),
    query(
      `SELECT r.* FROM returns r JOIN orders o ON o.id=r.order_id JOIN chats c ON c.user_id=o.user_id WHERE c.id=$1 ORDER BY r.created_at`,
      [chatId],
    ),
    query(`SELECT * FROM pending_actions WHERE chat_id=$1 ORDER BY created_at DESC`, [chatId]),
  ]);
  res.json({
    chat,
    messages: messages.rows,
    traces: traces.rows,
    toolCalls: tools.rows,
    tickets: tickets.rows,
    returns: returns.rows,
    pendingActions: pending.rows,
  });
});

adminRouter.get('/traces', async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
  const rows = await query(
    `SELECT t.id,t.trace_id,t.chat_id,t.request_id,t.data,t.created_at,u.email
       FROM traces t LEFT JOIN users u ON u.id=t.user_id
      ORDER BY t.created_at DESC LIMIT $1`,
    [limit],
  );
  res.json({
    traces: rows.rows.map((row) => ({
      ...row,
      summary: {
        intent: row.data?.intent,
        behavior: row.data?.behavior,
        status: row.data?.status,
        model: row.data?.model,
        mode: row.data?.mode,
        latencyMs: row.data?.latencyMs,
        costUsd: row.data?.agent?.costUsd ?? null,
        toolCalls: row.data?.agent?.toolCalls?.length ?? 0,
        citations: row.data?.citations?.length ?? 0,
      },
      jaegerUrl: row.trace_id ? `${config.JAEGER_UI_URL}/trace/${row.trace_id}` : null,
    })),
  });
});

adminRouter.get('/traces/:id', async (req, res) => {
  const id = String(req.params.id);
  const trace = await one<{
    id: string;
    trace_id: string | null;
    chat_id: string | null;
    request_id: string | null;
    data: Record<string, unknown>;
    created_at: string;
  }>(`SELECT * FROM traces WHERE id=$1 OR trace_id=$1 ORDER BY created_at DESC LIMIT 1`, [id]);
  if (!trace) {
    res.status(404).json({ error: 'Trace not found.' });
    return;
  }
  const [tools, calls] = await Promise.all([
    query(`SELECT * FROM tool_calls WHERE trace_id=$1 ORDER BY created_at`, [trace.trace_id]),
    query(`SELECT * FROM model_calls WHERE trace_id=$1 ORDER BY created_at`, [trace.trace_id]),
  ]);
  res.json({
    trace,
    toolCalls: tools.rows,
    modelCalls: calls.rows,
    jaegerUrl: trace.trace_id ? `${config.JAEGER_UI_URL}/trace/${trace.trace_id}` : null,
  });
});

adminRouter.get('/costs', async (_req, res) => {
  res.json(await getCosts());
});

async function getCosts() {
  const totals = await one(
    `SELECT count(*)::int AS calls, COALESCE(sum(cost_usd),0)::float AS total_usd,
            count(*) FILTER (WHERE cost_usd IS NULL)::int AS unknown_costs,
            COALESCE(sum(input_tokens),0)::int AS input_tokens,
            COALESCE(sum(output_tokens),0)::int AS output_tokens
       FROM model_calls`,
  );
  const byPurpose = await query(
    `SELECT purpose,model,provider,count(*)::int AS calls,
            COALESCE(sum(cost_usd),0)::float AS cost_usd,
            count(*) FILTER (WHERE cost_usd IS NULL)::int AS unknown_costs,
            COALESCE(sum(total_tokens),0)::int AS tokens
       FROM model_calls GROUP BY purpose,model,provider ORDER BY cost_usd DESC`,
  );
  const byDay = await query(
    `SELECT to_char(created_at::date,'YYYY-MM-DD') AS day, count(*)::int AS calls,
            COALESCE(sum(cost_usd),0)::float AS cost_usd,
            COALESCE(sum(total_tokens),0)::int AS tokens
       FROM model_calls GROUP BY 1 ORDER BY 1`,
  );
  return {
    mode: config.liveModel ? 'live' : 'demo',
    note: config.liveModel
      ? 'Estimated from published list prices and provider-reported usage.'
      : 'The deterministic demo engine makes no model calls, so spend is $0.00. Set OPENAI_API_KEY to measure live spend.',
    totals: totals ?? {
      calls: 0,
      total_usd: 0,
      unknown_costs: 0,
      input_tokens: 0,
      output_tokens: 0,
    },
    byPurpose: byPurpose.rows,
    byDay: byDay.rows,
  };
}

adminRouter.get('/evals', async (_req, res) => {
  const rows = await query(
    `SELECT id,source,status,dataset,results,created_at,finished_at FROM eval_runs ORDER BY created_at DESC LIMIT 30`,
  );
  res.json({ runs: rows.rows, running: evalRunning });
});

adminRouter.get('/evals/:id', async (req, res) => {
  const row = await one(`SELECT * FROM eval_runs WHERE id=$1`, [String(req.params.id)]);
  if (!row) {
    res.status(404).json({ error: 'Evaluation run not found.' });
    return;
  }
  res.json({ run: row });
});

adminRouter.post('/evals/run', async (_req, res) => {
  if (evalRunning) {
    res.status(409).json({ error: 'An evaluation is already running.' });
    return;
  }
  evalRunning = true;
  const runId = randomUUID();
  const reportPath = path.resolve('.runtime/evals', `${runId}.json`);
  const logPath = path.resolve('.runtime/evals', `${runId}.log`);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await query(
    `INSERT INTO eval_runs(id,source,status,dataset,results) VALUES($1,'python-harness','running','support_v1',$2)`,
    [
      runId,
      JSON.stringify({
        runId,
        status: 'running',
        startedAt: new Date().toISOString(),
        mode: config.liveModel ? 'live' : 'demo',
        model: config.liveModel ? config.CHAT_MODEL : 'demo-engine',
      }),
    ],
  );

  const args = [
    '-m',
    'maxify_evals',
    '--base-url',
    config.APP_BASE_URL,
    '--token',
    config.EVAL_API_TOKEN,
    '--run-id',
    runId,
    '--output',
    reportPath,
    '--dataset',
    path.resolve('evals/datasets/support_v1.jsonl'),
  ];
  const baseline = path.resolve(
    'evals/baselines',
    `${config.liveModel ? 'live' : 'demo-engine'}.json`,
  );
  try {
    await access(baseline);
    args.push('--baseline', baseline);
  } catch {
    // No baseline for this mode yet.
  }
  if (config.liveModel) args.push('--judge');

  const child = spawn(config.EVAL_PYTHON, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PYTHONPATH: path.resolve('evals'),
      EVAL_API_TOKEN: config.EVAL_API_TOKEN,
      OTEL_ENABLED: String(config.OTEL_ENABLED),
      OTEL_EXPORTER_OTLP_ENDPOINT: config.OTEL_EXPORTER_OTLP_ENDPOINT,
      OTEL_SERVICE_NAME: 'maxify-evals',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = createWriteStream(logPath, { flags: 'a' });
  let output = '';
  child.stdout?.on('data', (chunk) => {
    output = (output + chunk.toString()).slice(-20_000);
    log.write(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    output = (output + chunk.toString()).slice(-20_000);
    log.write(chunk);
  });
  child.on('error', async (error) => {
    evalRunning = false;
    await query(`UPDATE eval_runs SET status='failed', results=$2, finished_at=now() WHERE id=$1`, [
      runId,
      JSON.stringify({ runId, status: 'failed', error: error.message, logPath }),
    ]);
  });
  child.on('exit', async (code) => {
    evalRunning = false;
    log.end();
    if (code !== 0) {
      const status = await one<{ status: string }>(`SELECT status FROM eval_runs WHERE id=$1`, [
        runId,
      ]);
      if (status?.status === 'running') {
        await query(
          `UPDATE eval_runs SET status='failed', results=$2, finished_at=now() WHERE id=$1`,
          [
            runId,
            JSON.stringify({
              runId,
              status: 'failed',
              exitCode: code,
              error: 'Python evaluation process exited before importing a report.',
              log: output.slice(-4000),
              logPath,
            }),
          ],
        );
      }
    }
    logger.info({ runId, code }, 'Evaluation process exited');
  });
  res.status(202).json({ runId, status: 'running', log: logPath });
});

adminRouter.post('/ingest', async (_req, res) => {
  if (ingestionRunning) {
    res.status(409).json({ error: 'Ingestion is already running.' });
    return;
  }
  ingestionRunning = true;
  try {
    res.json({ summary: await ingest() });
  } finally {
    ingestionRunning = false;
  }
});

adminRouter.get('/sources', async (_req, res) => {
  res.json({ sources: await listSources(), ingestion: await getIngestionStatus() });
});

adminRouter.get('/sources/:id/raw', async (req, res) => {
  const source = await getSource(String(req.params.id));
  if (!source) {
    res.status(404).json({ error: 'Source not found.' });
    return;
  }
  const rawPath = path.resolve(process.cwd(), source.manifest.raw_path);
  const root = path.resolve(process.cwd(), 'data/raw') + path.sep;
  if (!rawPath.startsWith(root)) {
    res.status(403).json({ error: 'Invalid source path.' });
    return;
  }
  res.type('text/plain').send(await readFile(rawPath, 'utf8'));
});

adminRouter.get('/reliability', async (_req, res) => {
  const rows = await query(`SELECT * FROM reliability_checks ORDER BY created_at DESC LIMIT 50`);
  res.json({ checks: rows.rows });
});
