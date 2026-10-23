import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { evalAnswerSchema } from '../contracts.js';
import type { HistoryMessage } from '../contracts.js';
import { runAgent } from '../agent.js';
import { asksProductFact, inferScope } from '../catalog.js';
import { resolveRetrievalScope } from '../context.js';
import { classifyIntent, detectInjection, stripInjection } from '../intent.js';
import { citationsFor, retrieve } from '../retrieval.js';
import { requireEvalToken } from '../auth.js';
import { query } from '../db.js';
import { logger } from '../logger.js';
import { currentTraceId, spanAttributes, withSpan } from '../telemetry.js';
import { chatCompletion } from '../llm.js';

export const internalRouter = Router();
internalRouter.use(requireEvalToken);

internalRouter.get('/eval/meta', async (_req, res) => {
  const corpus = await query<{ id: string; chunks: number }>(
    `SELECT v.id, count(c.id)::int AS chunks
       FROM corpus_versions v LEFT JOIN chunks c ON c.corpus_version=v.id
      WHERE v.status='active' GROUP BY v.id`,
  );
  const demoUser = await query<{ id: string }>(
    `SELECT id FROM users WHERE email='customer@maxify.demo' LIMIT 1`,
  );
  const prompt = await readFile(
    path.resolve(process.cwd(), 'prompts/support-agent.md'),
    'utf8',
  ).catch(() => '');
  res.json({
    mode: config.liveModel ? 'live' : 'demo',
    model: config.liveModel ? config.CHAT_MODEL : 'demo-engine',
    judgeModel: config.JUDGE_MODEL,
    embeddings: config.embeddings ? config.EMBEDDING_MODEL : 'lexical-only',
    corpusVersion: corpus.rows[0]?.id ?? null,
    chunks: corpus.rows[0]?.chunks ?? 0,
    promptVersion: prompt
      ? `support-agent@${createHash('sha256').update(prompt).digest('hex').slice(0, 12)}`
      : 'support-agent@unknown',
    demoUserId: demoUser.rows[0]?.id ?? null,
    demoEmail: 'customer@maxify.demo',
    otel: config.OTEL_ENABLED,
  });
});

internalRouter.post('/eval/answer', async (req, res) => {
  const body = evalAnswerSchema.parse(req.body);
  const started = performance.now();
  const traceId = currentTraceId() ?? randomUUID();
  const runId = req.header('x-eval-run-id') ?? body.runId ?? null;
  const caseId = req.header('x-eval-case-id') ?? body.caseId ?? null;

  const evalUser = await query<{ id: string }>('SELECT id FROM users WHERE id=$1', [body.userId]);
  if (!evalUser.rows.length) {
    res.status(400).json({ error: 'userId must reference an existing user for evaluation' });
    return;
  }

  // Tool calls write pending actions and tickets. Give the evaluation a real,
  // isolated chat so foreign keys hold, then remove it after the case. This
  // keeps repeated evaluation runs from polluting the reviewer workspace.
  const evalChatId = `eval-${randomUUID()}`;
  await query(`INSERT INTO chats(id,user_id,title,status,is_seed) VALUES($1,$2,$3,'open',false)`, [
    evalChatId,
    body.userId,
    `Evaluation ${caseId ?? 'case'}`,
  ]);

  try {
    const result = await withSpan(
      'eval.case',
      spanAttributes({
        'eval.run_id': runId ?? undefined,
        'eval.case_id': caseId ?? undefined,
        'eval.category': body.category,
        'support.question': body.question.slice(0, 500),
      }),
      async () => {
        const history = body.history as HistoryMessage[];
        const intent = classifyIntent(body.question);
        const inferred = inferScope(body.question);
        const scope = resolveRetrievalScope(body.question, history);
        let resolvedIntent = intent;
        if (
          inferred.sourceType === 'manufacturer' &&
          !inferred.product &&
          !inferred.productIds?.length &&
          asksProductFact(body.question)
        ) {
          resolvedIntent = 'ambiguous_product';
        } else if (
          inferred.product &&
          (resolvedIntent === 'other' || resolvedIntent === 'ambiguous_product')
        ) {
          resolvedIntent = 'product_question';
        } else if (
          inferred.productIds &&
          inferred.productIds.length > 1 &&
          (resolvedIntent === 'other' ||
            resolvedIntent === 'ambiguous_product' ||
            resolvedIntent === 'product_comparison')
        ) {
          resolvedIntent = 'product_comparison';
        }
        const signals = detectInjection(body.question);
        const cleaned = signals.length ? stripInjection(body.question).cleaned : body.question;
        const evidence = await retrieve(cleaned, { scope });
        const agent = await runAgent({
          question: cleaned,
          history,
          evidence,
          chatId: evalChatId,
          requestId: caseId ?? randomUUID(),
          userId: body.userId,
          userEmail: 'offline-evaluation@maxify.local',
          intent: resolvedIntent,
          traceId,
        });
        if (agent.usage) {
          await query(
            `INSERT INTO model_calls(id,trace_id,request_id,chat_id,eval_run_id,purpose,provider,model,input_tokens,output_tokens,total_tokens,cost_usd,latency_ms,status,data)
           VALUES($1,$2,$3,$4,$5,'eval-answer',$6,$7,$8,$9,$10,$11,$12,'completed',$13)`,
            [
              randomUUID(),
              traceId,
              caseId,
              `eval-${caseId}`,
              runId,
              agent.provider,
              agent.model,
              agent.usage.inputTokens,
              agent.usage.outputTokens,
              agent.usage.inputTokens + agent.usage.outputTokens,
              agent.costUsd,
              agent.latencyMs,
              JSON.stringify({ category: body.category, intent: resolvedIntent }),
            ],
          ).catch((error) => logger.warn({ err: error }, 'Eval model call insert failed'));
        }
        return {
          answer: agent.answer,
          behavior: agent.behavior,
          outcome: agent.behavior,
          citations: agent.citations,
          citationObjects: citationsFor(evidence, agent.citations),
          evidence,
          intent: resolvedIntent,
          confidence: agent.confidence,
          model: agent.model,
          provider: agent.provider,
          usage: agent.usage ?? null,
          costUsd: agent.costUsd,
          toolCalls: agent.toolCalls,
          injection: { signals, cleaned: cleaned !== body.question },
          latencyMs: Math.max(0, Math.round(performance.now() - started)),
          agentLatencyMs: agent.latencyMs,
          traceId,
        };
      },
    );
    res.json(result);
  } finally {
    await query(`DELETE FROM tickets WHERE chat_id=$1`, [evalChatId]).catch((error) =>
      logger.warn({ err: error }, 'Eval ticket cleanup failed'),
    );
    await query(`DELETE FROM chats WHERE id=$1`, [evalChatId]).catch((error) =>
      logger.warn({ err: error }, 'Eval chat cleanup failed'),
    );
  }
});

const judgeRequestSchema = z.object({
  question: z.string().min(1).max(4000),
  answer: z.string().min(1).max(6000),
  expectedBehavior: z.string().max(40).optional(),
  citations: z
    .array(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        section: z.string().nullable().optional(),
        snippet: z.string().optional(),
      }),
    )
    .max(20)
    .default([]),
  evidence: z
    .array(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        section: z.string().nullable().optional(),
        content: z.string(),
      }),
    )
    .max(12)
    .default([]),
});

const judgeResponseSchema = z.object({
  faithfulness: z.number().min(1).max(5),
  answer_relevance: z.number().min(1).max(5),
  citation_support: z.number().min(1).max(5),
  policy_compliance: z.number().min(1).max(5),
  rationale: z.string().max(1200),
});

internalRouter.post('/eval/judge', async (req, res) => {
  if (!config.liveModel) {
    res.json({
      enabled: false,
      reason: 'The judge requires a live model. The deterministic graders still ran.',
    });
    return;
  }
  const body = judgeRequestSchema.parse(req.body);
  const prompt = await readFile(path.resolve(process.cwd(), 'prompts/judge.md'), 'utf8');
  const completion = await chatCompletion({
    model: config.JUDGE_MODEL,
    json: true,
    temperature: 0,
    maxTokens: 700,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: JSON.stringify(body) },
    ],
  });
  const content = completion.choices[0]?.message?.content ?? '';
  let parsed: z.infer<typeof judgeResponseSchema>;
  try {
    parsed = judgeResponseSchema.parse(JSON.parse(content));
  } catch {
    res
      .status(502)
      .json({ error: 'Judge returned an invalid response', raw: content.slice(0, 500) });
    return;
  }
  const usage = completion.usage;
  res.json({
    enabled: true,
    model: config.JUDGE_MODEL,
    ...parsed,
    usage: usage
      ? {
          inputTokens: usage.prompt_tokens,
          outputTokens: usage.completion_tokens,
        }
      : null,
  });
});

internalRouter.post('/eval/import', async (req, res) => {
  const report = (req.body?.report ?? req.body) as Record<string, unknown>;
  const runId = String(report.runId ?? req.body?.runId ?? '');
  if (!runId) {
    res.status(400).json({ error: 'report.runId is required' });
    return;
  }
  const status = String(report.status ?? 'completed');
  const dataset =
    typeof report.dataset === 'object' && report.dataset
      ? String((report.dataset as Record<string, unknown>).name ?? 'support_v1')
      : 'support_v1';
  await query(
    `INSERT INTO eval_runs(id,source,status,dataset,results,finished_at)
     VALUES($1,$2,$3,$4,$5,now())
     ON CONFLICT (id) DO UPDATE SET status=excluded.status, dataset=excluded.dataset,
       results=excluded.results, finished_at=now()`,
    [runId, String(report.harness ?? 'python-harness'), status, dataset, JSON.stringify(report)],
  );
  res.json({ ok: true, runId, status });
});

internalRouter.post('/reliability/import', async (req, res) => {
  const checks = Array.isArray(req.body?.checks) ? req.body.checks : [];
  for (const check of checks) {
    if (!check?.name || !check?.status) continue;
    await query(
      `INSERT INTO reliability_checks(id,name,category,status,injection,detail,duration_ms)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        randomUUID(),
        String(check.name),
        String(check.category ?? 'general'),
        String(check.status),
        check.injection ? String(check.injection) : null,
        JSON.stringify(check.detail ?? {}),
        Number.isFinite(check.durationMs) ? Number(check.durationMs) : null,
      ],
    );
  }
  res.json({ ok: true, recorded: checks.length });
});
