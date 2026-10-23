import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { chatMessageSchema, feedbackSchema } from '../contracts.js';
import type { AgentResult, HistoryMessage, Passage, RetrievalScope } from '../contracts.js';
import { runAgent } from '../agent.js';
import { resolveRetrievalScope } from '../context.js';
import { asksProductFact, inferScope } from '../catalog.js';
import { classifyIntent, detectInjection, stripInjection } from '../intent.js';
import { citationsFor, retrieve } from '../retrieval.js';
import { createTicket, getPendingAction } from '../commerce.js';
import { pool, query } from '../db.js';
import { logger } from '../logger.js';
import { currentTraceId } from '../telemetry.js';
import { rateLimit } from '../http/middleware.js';

export const chatRouter = Router();

type SessionUser = { id: string; email: string; role: string; name?: string | null };

async function ownedChat(chatId: string, userId: string) {
  const result = await query<{
    id: string;
    user_id: string;
    title: string;
    status: string;
    created_at: string;
    updated_at: string;
  }>(`SELECT * FROM chats WHERE id=$1 AND user_id=$2`, [chatId, userId]);
  return result.rows[0];
}

chatRouter.get('/chats', async (_req, res) => {
  const user = res.locals.user as SessionUser;
  const rows = await query(
    `SELECT c.id, c.title, c.status, c.created_at, c.updated_at,
            (SELECT content FROM messages m WHERE m.chat_id=c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message,
            (SELECT count(*)::int FROM messages m WHERE m.chat_id=c.id) AS message_count,
            (SELECT bool_or(rating <= 2) FROM feedback f WHERE f.chat_id=c.id) AS negative_feedback
       FROM chats c WHERE c.user_id=$1 ORDER BY c.updated_at DESC LIMIT 60`,
    [user.id],
  );
  res.json({ chats: rows.rows });
});

chatRouter.post('/chats', async (_req, res) => {
  const user = res.locals.user as SessionUser;
  const id = randomUUID();
  await query(`INSERT INTO chats(id,user_id,title) VALUES($1,$2,'New conversation')`, [
    id,
    user.id,
  ]);
  res.json({ chat: { id, title: 'New conversation', status: 'open' } });
});

chatRouter.get('/chats/:id', async (req, res) => {
  const user = res.locals.user as SessionUser;
  const chat = await ownedChat(String(req.params.id), user.id);
  if (!chat) {
    res.status(404).json({ error: 'Chat not found.' });
    return;
  }
  res.json({ chat });
});

chatRouter.get('/chats/:id/messages', async (req, res) => {
  const user = res.locals.user as SessionUser;
  const chatId = String(req.params.id);
  if (!(await ownedChat(chatId, user.id))) {
    res.status(404).json({ error: 'Chat not found.' });
    return;
  }
  const messages = await query(
    `SELECT m.*, f.rating AS feedback_rating
       FROM messages m
       LEFT JOIN feedback f ON f.message_id=m.id AND f.user_id=$2
      WHERE m.chat_id=$1 ORDER BY m.created_at, m.id`,
    [chatId, user.id],
  );
  const traces = await query(
    `SELECT id, trace_id, data, created_at FROM traces WHERE chat_id=$1 ORDER BY created_at DESC LIMIT 20`,
    [chatId],
  );
  const toolCalls = await query(
    `SELECT id, trace_id, request_id, name, args, result, status, latency_ms, created_at
       FROM tool_calls WHERE chat_id=$1 ORDER BY created_at`,
    [chatId],
  );
  res.json({ messages: messages.rows, traces: traces.rows, toolCalls: toolCalls.rows });
});

chatRouter.delete('/chats/:id', async (req, res) => {
  const user = res.locals.user as SessionUser;
  const result = await query(`DELETE FROM chats WHERE id=$1 AND user_id=$2 RETURNING id`, [
    String(req.params.id),
    user.id,
  ]);
  if (!result.rowCount) {
    res.status(404).json({ error: 'Chat not found.' });
    return;
  }
  res.json({ ok: true });
});

chatRouter.post('/chats/:id/messages', rateLimit('chat', 30), async (req, res) => {
  const user = res.locals.user as SessionUser;
  const chatId = String(req.params.id);
  const body = chatMessageSchema.parse(req.body);
  const fault = body.fault;
  if (fault && (user.role === 'customer' || config.isProduction)) {
    res.status(403).json({ error: 'Fault controls are available to local reviewers only.' });
    return;
  }

  const chat = await ownedChat(chatId, user.id);
  if (!chat) {
    res.status(404).json({ error: 'Chat not found.' });
    return;
  }

  const client = await pool.connect();
  let replay: Record<string, unknown> | null = null;
  let claimed = false;
  let attemptId = '';
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM chats WHERE id=$1 FOR UPDATE', [chatId]);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [body.requestId]);
    const existing = (
      await client.query<{ id: string; chat_id: string; status: string; attempts: number }>(
        `SELECT id,chat_id,status,attempts FROM requests WHERE id=$1`,
        [body.requestId],
      )
    ).rows[0];

    if (existing && existing.chat_id !== chatId) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Request ID belongs to another conversation.' });
      return;
    }
    if (existing) {
      const original = (
        await client.query<{ content: string }>(
          `SELECT content FROM messages WHERE chat_id=$1 AND request_id=$2 AND role='user'`,
          [chatId, body.requestId],
        )
      ).rows[0];
      if (original && original.content !== body.message.trim()) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'A request ID must retain the original message.' });
        return;
      }
      if (existing.status === 'completed') {
        replay = (
          await client.query(
            `SELECT * FROM messages WHERE chat_id=$1 AND request_id=$2 AND role='assistant'`,
            [chatId, body.requestId],
          )
        ).rows[0] as Record<string, unknown>;
      } else if (['running', 'pending'].includes(existing.status)) {
        await client.query('COMMIT');
        res.status(409).json({
          error: 'This message is already being processed.',
          status: existing.status,
        });
        return;
      } else {
        const attempt = (
          await client.query<{ attempts: number }>(
            `UPDATE requests
                SET status='running', attempts=requests.attempts+1, error=NULL, updated_at=now()
              WHERE id=$1 RETURNING attempts`,
            [body.requestId],
          )
        ).rows[0];
        attemptId = `${body.requestId}-${attempt?.attempts ?? 1}`;
        await client.query(
          `UPDATE messages SET status='running' WHERE chat_id=$1 AND request_id=$2 AND role='user'`,
          [chatId, body.requestId],
        );
        claimed = true;
      }
    } else {
      const busy = await client.query(
        `SELECT id FROM requests WHERE chat_id=$1 AND status IN ('running','pending')`,
        [chatId],
      );
      if (busy.rowCount) {
        await client.query('COMMIT');
        res
          .status(409)
          .json({ error: 'Wait for the current reply before sending another message.' });
        return;
      }
      await client.query(
        `INSERT INTO requests(id,chat_id,user_id,status,attempts) VALUES($1,$2,$3,'running',1)`,
        [body.requestId, chatId, user.id],
      );
      attemptId = `${body.requestId}-1`;
      await client.query(
        `INSERT INTO messages(id,chat_id,request_id,role,content,status)
         VALUES($1,$2,$3,'user',$4,'running')`,
        [randomUUID(), chatId, body.requestId, body.message.trim()],
      );
      await client.query(
        `UPDATE chats SET title=$2, updated_at=now() WHERE id=$1 AND title='New conversation'`,
        [chatId, body.message.trim().slice(0, 52)],
      );
      claimed = true;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  if (replay) {
    res.json({ message: replay, replayed: true });
    return;
  }
  if (!claimed) {
    res.status(409).json({ error: 'Request cannot be processed.' });
    return;
  }

  const started = performance.now();
  const traceId = currentTraceId() ?? randomUUID();
  let evidence: Passage[] = [];
  let result: AgentResult | undefined;
  let retrievalMs = 0;
  let agentMs = 0;
  let scope: RetrievalScope = {};
  let injection = { signals: [] as string[], removed: [] as string[] };
  let intent = 'other';
  let history: HistoryMessage[] = [];

  try {
    if (fault === 'restart-delay') await new Promise((resolve) => setTimeout(resolve, 10_000));

    history = (
      await query<HistoryMessage>(
        `SELECT role, content FROM messages
          WHERE chat_id=$1 AND request_id<>$2 AND status='completed' AND role IN ('user','assistant')
          ORDER BY created_at`,
        [chatId, body.requestId],
      )
    ).rows;

    const signals = detectInjection(body.message);
    if (signals.length) {
      const stripped = stripInjection(body.message);
      injection = { signals, removed: stripped.removed };
      body.message = stripped.cleaned;
    }

    intent = classifyIntent(body.message);
    const inferred = inferScope(body.message);
    scope = resolveRetrievalScope(body.message, history);
    const productFact = asksProductFact(body.message);
    if (
      inferred.sourceType === 'manufacturer' &&
      !inferred.product &&
      !inferred.productIds?.length &&
      productFact
    ) {
      intent = 'ambiguous_product';
    }
    if (intent === 'product_comparison' && !scope.productIds?.length && !scope.product) {
      intent = 'ambiguous_product';
    }
    if (intent === 'other' && inferred.product) intent = 'product_question';
    if (intent === 'other' && productFact) intent = 'ambiguous_product';

    const retrievalFault =
      fault === 'retrieval-error'
        ? 'retrieval_unavailable'
        : fault === 'missing-evidence'
          ? 'evidence_absent'
          : fault;
    const retrievalStarted = performance.now();
    evidence = await retrieve(body.message, { scope, fault: retrievalFault });
    retrievalMs = Math.max(0, Math.round(performance.now() - retrievalStarted));

    const pendingAction = await getPendingAction(chatId, user.id);
    const agentStarted = performance.now();
    result = await runAgent({
      question: body.message,
      history,
      evidence,
      chatId,
      requestId: body.requestId,
      userId: user.id,
      userEmail: user.email,
      intent,
      pendingAction: pendingAction
        ? {
            id: pendingAction.id,
            action: pendingAction.action,
            payload: pendingAction.payload,
            expiresAt: pendingAction.expires_at,
          }
        : null,
      fault,
      traceId,
    });
    agentMs = Math.max(0, Math.round(performance.now() - agentStarted));

    const citations = citationsFor(evidence, result.citations);
    const totalMs = Math.max(0, Math.round(performance.now() - started));
    const traceData = {
      traceId,
      requestId: body.requestId,
      attemptId,
      httpRequestId: res.locals.requestId,
      status: 'completed',
      mode: config.liveModel ? 'live' : 'demo',
      model: result.model,
      provider: result.provider,
      intent,
      behavior: result.behavior,
      confidence: result.confidence,
      injection,
      scope,
      retrieval: {
        ms: retrievalMs,
        count: evidence.length,
        mode: config.embeddings ? 'hybrid' : 'lexical',
        passages: evidence.map((passage) => ({
          id: passage.id,
          title: passage.title,
          section: passage.section,
          source_type: passage.source_type,
          product_id: passage.product_id,
          score: passage.score,
          content: passage.content,
        })),
      },
      agent: {
        latencyMs: result.latencyMs,
        usage: result.usage ?? null,
        costUsd: result.costUsd,
        toolCalls: result.toolCalls,
      },
      citations,
      timings: { totalMs, retrievalMs, agentMs },
      spans: [
        {
          name: 'retrieval.hybrid_search',
          startMs: 0,
          durationMs: retrievalMs,
          attributes: { results: evidence.length, mode: config.embeddings ? 'hybrid' : 'lexical' },
        },
        {
          name: 'agent.run',
          startMs: retrievalMs,
          durationMs: agentMs,
          attributes: {
            model: result.model,
            behavior: result.behavior,
            confidence: result.confidence,
            toolCalls: result.toolCalls.length,
          },
        },
        ...result.toolCalls.map((call, index) => ({
          name: `tool.${call.name}`,
          startMs: retrievalMs + index,
          durationMs: call.latencyMs,
          attributes: { status: call.status },
        })),
      ],
      latencyMs: totalMs,
      fault: fault ?? null,
    };

    const saved = await (async () => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query(
          `INSERT INTO traces(id,trace_id,chat_id,request_id,user_id,data)
           VALUES($1,$2,$3,$4,$5,$6)`,
          [randomUUID(), traceId, chatId, body.requestId, user.id, JSON.stringify(traceData)],
        );
        const message = (
          await c.query(
            `INSERT INTO messages(id,chat_id,request_id,role,content,status,citations,intent,behavior,confidence,latency_ms,trace_id)
             VALUES($1,$2,$3,'assistant',$4,'completed',$5,$6,$7,$8,$9,$10)
             ON CONFLICT (chat_id,request_id,role) DO UPDATE
               SET content=excluded.content,status='completed',citations=excluded.citations,
                   intent=excluded.intent,behavior=excluded.behavior,confidence=excluded.confidence,
                   latency_ms=excluded.latency_ms,trace_id=excluded.trace_id
             RETURNING *`,
            [
              randomUUID(),
              chatId,
              body.requestId,
              result!.answer,
              JSON.stringify(citations),
              intent,
              result!.behavior,
              result!.confidence,
              totalMs,
              traceId,
            ],
          )
        ).rows[0];
        await c.query(
          `UPDATE messages SET status='completed' WHERE chat_id=$1 AND request_id=$2 AND role='user'`,
          [chatId, body.requestId],
        );
        await c.query(`UPDATE requests SET status='completed', updated_at=now() WHERE id=$1`, [
          body.requestId,
        ]);
        await c.query(`UPDATE chats SET updated_at=now() WHERE id=$1`, [chatId]);
        if (result!.usage) {
          await c.query(
            `INSERT INTO model_calls(id,trace_id,request_id,chat_id,purpose,provider,model,input_tokens,output_tokens,total_tokens,cost_usd,latency_ms,status,data)
             VALUES($1,$2,$3,$4,'chat',$5,$6,$7,$8,$9,$10,$11,'completed',$12)`,
            [
              randomUUID(),
              traceId,
              body.requestId,
              chatId,
              result!.provider,
              result!.model,
              result!.usage.inputTokens,
              result!.usage.outputTokens,
              result!.usage.inputTokens + result!.usage.outputTokens,
              result!.costUsd,
              result!.latencyMs,
              JSON.stringify({ intent, behavior: result!.behavior }),
            ],
          );
        }
        await c.query('COMMIT');
        return message;
      } catch (error) {
        await c.query('ROLLBACK');
        throw error;
      } finally {
        c.release();
      }
    })();

    res.json({
      message: saved,
      citations,
      traceId,
      intent,
      behavior: result.behavior,
      mode: config.liveModel ? 'live' : 'demo',
      model: result.model,
      usage: result.usage ?? null,
      costUsd: result.costUsd,
      toolCalls: result.toolCalls,
      latencyMs: totalMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const safeMessage = message.startsWith('MODEL_TIMEOUT')
      ? 'The support model timed out. Your message is saved — please retry.'
      : message.startsWith('MODEL_RATE_LIMIT')
        ? 'The support model is busy right now. Your message is saved — please retry in a moment.'
        : 'I couldn’t complete that request. Your message is saved — please retry.';
    logger.error({ err: error, requestId: body.requestId, traceId }, 'Support turn failed');
    const totalMs = Math.max(0, Math.round(performance.now() - started));
    await query(`UPDATE requests SET status='failed', error=$2, updated_at=now() WHERE id=$1`, [
      body.requestId,
      message,
    ]).catch(() => undefined);
    await query(
      `UPDATE messages SET status='failed' WHERE chat_id=$1 AND request_id=$2 AND role='user'`,
      [chatId, body.requestId],
    ).catch(() => undefined);
    await query(
      `INSERT INTO traces(id,trace_id,chat_id,request_id,user_id,data) VALUES($1,$2,$3,$4,$5,$6)`,
      [
        randomUUID(),
        traceId,
        chatId,
        body.requestId,
        user.id,
        JSON.stringify({
          traceId,
          requestId: body.requestId,
          attemptId,
          status: 'failed',
          intent,
          behavior: 'error',
          scope,
          injection,
          retrieval: { ms: retrievalMs, count: evidence.length, passages: evidence },
          error: message,
          latencyMs: totalMs,
          spans: [
            { name: 'retrieval.hybrid_search', startMs: 0, durationMs: retrievalMs },
            { name: 'agent.run', startMs: retrievalMs, durationMs: agentMs },
          ],
          fault: fault ?? null,
          mode: config.liveModel ? 'live' : 'demo',
        }),
      ],
    ).catch(() => undefined);
    res.status(503).json({
      error: safeMessage,
      requestId: body.requestId,
      traceId,
      retryable: true,
      ...(config.isProduction ? {} : { detail: message }),
    });
  }
});

chatRouter.post('/messages/:id/feedback', async (req, res) => {
  const user = res.locals.user as SessionUser;
  const { rating, reason } = feedbackSchema.parse(req.body);
  const message = await query<{ id: string; chat_id: string }>(
    `SELECT m.id, m.chat_id FROM messages m JOIN chats c ON c.id=m.chat_id
      WHERE m.id=$1 AND c.user_id=$2 AND m.role='assistant'`,
    [String(req.params.id), user.id],
  );
  if (!message.rowCount) {
    res.status(404).json({ error: 'Message not found.' });
    return;
  }
  await query(
    `INSERT INTO feedback(id,message_id,chat_id,user_id,rating,reason)
     VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT (message_id,user_id) DO UPDATE SET rating=excluded.rating, reason=excluded.reason`,
    [randomUUID(), message.rows[0].id, message.rows[0].chat_id, user.id, rating, reason ?? null],
  );
  await query(
    `INSERT INTO analytics_events(id,chat_id,user_id,name,props) VALUES($1,$2,$3,'feedback',$4)`,
    [randomUUID(), message.rows[0].chat_id, user.id, JSON.stringify({ rating })],
  );
  res.json({ ok: true, rating });
});

chatRouter.post('/chats/:id/handoff', async (req, res) => {
  const user = res.locals.user as SessionUser;
  const chatId = String(req.params.id);
  if (!(await ownedChat(chatId, user.id))) {
    res.status(404).json({ error: 'Chat not found.' });
    return;
  }
  const reason =
    typeof req.body?.reason === 'string' && req.body.reason.trim()
      ? req.body.reason.trim().slice(0, 1000)
      : 'Customer requested a human specialist';
  const ticket = await createTicket({
    userId: user.id,
    chatId,
    subject: 'Human handoff requested',
    summary: reason,
    priority: 'high',
  });
  await query(`UPDATE chats SET status='handed_off', updated_at=now() WHERE id=$1`, [chatId]);
  const message = await query(
    `INSERT INTO messages(id,chat_id,request_id,role,content,status,intent,behavior)
     VALUES($1,$2,$3,'assistant',$4,'completed','handoff','answer') RETURNING *`,
    [
      randomUUID(),
      chatId,
      `handoff-${randomUUID()}`,
      `I’ve handed this conversation to a human specialist and attached the context. Your reference is **${ticket.id}**; the expected response time is within two business hours.`,
    ],
  );
  res.json({ ok: true, ticket, message: message.rows[0] });
});
