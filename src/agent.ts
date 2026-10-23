import { config } from './config.js';
import type { AgentInput, AgentResult, PendingAction, ToolCall } from './contracts.js';
import { demoAnswer, unsupportedAnswer } from './demoAgent.js';
import { llmAnswer } from './llmAgent.js';
import { resolvePendingAction } from './commerce.js';
import { executeTool, type ToolContext } from './tools.js';
import { currentTraceId, instruments, spanAttributes, withSpan } from './telemetry.js';
import { logger } from './logger.js';

export const SKILL_VERSION = 'support-agent-2026.10';
export const CUSTOMER_MODEL = config.liveModel ? config.CHAT_MODEL : 'demo-engine';

function pendingAnswer(text: string, input: AgentInput, toolCalls: ToolCall[]): AgentResult {
  return {
    answer: text,
    citations: [],
    behavior: 'answer',
    intent: input.intent,
    confidence: 0.95,
    model: CUSTOMER_MODEL,
    provider: config.liveModel ? config.OPENAI_BASE_URL : 'deterministic',
    costUsd: 0,
    toolCalls,
    latencyMs: 0,
    traceId: input.traceId ?? null,
  };
}

async function handlePendingAction(input: AgentInput): Promise<AgentResult | null> {
  const pending = input.pendingAction;
  if (!pending) return null;
  const isConfirm = /^(yes|yeah|yep|sure|ok(?:ay)?|please do|go ahead|confirm|do it)\b/i.test(
    input.question.trim(),
  );
  const isCancel = /^(no|nope|cancel|stop|don't|do not)\b/i.test(input.question.trim());
  if (!isConfirm && !isCancel) {
    await resolvePendingAction(pending.id, 'cancelled');
    return null;
  }
  if (isCancel) {
    await resolvePendingAction(pending.id, 'cancelled');
    return pendingAnswer(
      'No problem — I’ve cancelled that request. Is there anything else I can help with?',
      input,
      [],
    );
  }

  const context: ToolContext = {
    userId: input.userId,
    userEmail: input.userEmail,
    chatId: input.chatId,
    requestId: input.requestId,
    traceId: input.traceId ?? null,
  };
  if (pending.action === 'start_return') {
    const call = await executeTool(context, 'start_return', {
      order_id: pending.payload.orderId,
      reason: pending.payload.reason,
      confirm: true,
    });
    await resolvePendingAction(pending.id, 'completed');
    const result = call.result as {
      rma?: string;
      order_id?: string;
      next_step?: string;
      requires_review?: boolean;
    };
    return pendingAnswer(
      `Done — return **${result.rma ?? ''}** is now open for order **${result.order_id ?? pending.payload.orderId}**.${
        result.requires_review
          ? ' A support specialist will review it within one business day.'
          : ''
      }\n\n${result.next_step ?? ''}`,
      input,
      [call],
    );
  }
  if (pending.action === 'create_ticket') {
    const call = await executeTool(context, 'create_support_ticket', {
      subject: String(pending.payload.subject ?? 'Warranty assessment'),
      summary: String(pending.payload.summary ?? input.question),
      priority: 'normal',
    });
    await resolvePendingAction(pending.id, 'completed');
    return pendingAnswer(
      'Done — I’ve created a warranty assessment ticket. A support specialist will respond within two business days.',
      input,
      [call],
    );
  }
  await resolvePendingAction(pending.id, 'cancelled');
  return null;
}

export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const result = await runAgentInternal(input);
  const attributes = {
    behavior: result.behavior,
    intent: result.intent,
    engine: config.liveModel ? 'live' : 'demo',
  };
  instruments.answers.add(1, attributes);
  instruments.latency.record(result.latencyMs, attributes);
  if (result.usage) {
    instruments.tokens.add(result.usage.inputTokens, { model: CUSTOMER_MODEL, direction: 'input' });
    instruments.tokens.add(result.usage.outputTokens, {
      model: CUSTOMER_MODEL,
      direction: 'output',
    });
  }
  if (result.costUsd) instruments.cost.add(result.costUsd, { model: CUSTOMER_MODEL });
  return result;
}

async function runAgentInternal(input: AgentInput): Promise<AgentResult> {
  if (input.fault === 'model-timeout' || input.fault === 'timeout') {
    throw new Error('MODEL_TIMEOUT: simulated provider timeout');
  }
  if (input.fault === 'model-429' || input.fault === '429') {
    throw new Error('MODEL_RATE_LIMIT: simulated provider 429');
  }
  const traceId = input.traceId ?? currentTraceId() ?? null;
  const withTrace = { ...input, traceId };
  const pending = await handlePendingAction(withTrace);
  if (pending) return { ...pending, latencyMs: pending.latencyMs };

  const canAnswerWithoutEvidence = [
    'order_status',
    'return_request',
    'greeting',
    'thanks',
    'human_handoff',
    'confirm',
    'cancel',
    'ambiguous_product',
  ].includes(input.intent);
  if (!input.evidence.length && !canAnswerWithoutEvidence) {
    const text =
      input.intent === 'unsupported'
        ? unsupportedAnswer(input.question).answer
        : 'I don’t have evidence in the current support sources to answer that. I can help with product specifications, Demo store policies, and orders placed on this account.';
    return {
      answer: text,
      citations: [],
      behavior: 'abstain',
      intent: input.intent,
      confidence: 0.5,
      model: CUSTOMER_MODEL,
      provider: 'deterministic',
      costUsd: 0,
      toolCalls: [],
      latencyMs: 0,
      traceId,
    };
  }

  return withSpan(
    'agent.run',
    spanAttributes({
      'gen_ai.system': config.liveModel ? 'openai' : 'deterministic',
      'gen_ai.request.model': CUSTOMER_MODEL,
      'gen_ai.operation.name': 'chat',
      'support.intent': input.intent,
      'support.evidence_count': input.evidence.length,
      'support.chat_id': input.chatId,
      'support.request_id': input.requestId,
      'support.engine': config.liveModel ? 'llm' : 'demo',
    }),
    async (span) => {
      try {
        const result = config.liveModel ? await llmAnswer(withTrace) : await demoAnswer(withTrace);
        span.setAttribute('support.behavior', result.behavior);
        span.setAttribute('support.confidence', result.confidence);
        span.setAttribute('support.citations', result.citations.length);
        span.setAttribute('support.tool_calls', result.toolCalls.length);
        span.setAttribute('support.latency_ms', result.latencyMs);
        if (result.usage) {
          span.setAttribute('gen_ai.usage.input_tokens', result.usage.inputTokens);
          span.setAttribute('gen_ai.usage.output_tokens', result.usage.outputTokens);
        }
        if (result.costUsd !== null) span.setAttribute('support.cost_usd', result.costUsd);
        return { ...result, traceId };
      } catch (error) {
        logger.warn({ err: error, requestId: input.requestId }, 'Agent run failed');
        span.setAttribute(
          'support.failure',
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    },
  );
}

export function missingEvidenceAnswer(
  question = '',
): Pick<AgentResult, 'answer' | 'citations' | 'behavior'> {
  return {
    answer: /price|stock|inventory/i.test(question)
      ? 'The current support sources do not contain live prices or stock counts, and I cannot access inventory.'
      : 'I do not have evidence in the current support sources to answer that. Please describe the information you need.',
    citations: [],
    behavior: 'abstain',
  };
}

export function pendingActionOf(value: PendingAction | undefined): PendingAction | null {
  return value ?? null;
}
