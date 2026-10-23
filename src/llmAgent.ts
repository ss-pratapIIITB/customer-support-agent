import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { AgentInput, AgentResult, ToolCall } from './contracts.js';
import { modelAnswerSchema } from './contracts.js';
import { config } from './config.js';
import { chatCompletion, type ChatMessage } from './llm.js';
import { estimateCostUsd } from './pricing.js';
import { executeTool, toolDefinitions, type ToolContext } from './tools.js';
import { logger } from './logger.js';

let systemPromptCache: string | undefined;

export async function systemPrompt(): Promise<string> {
  if (!systemPromptCache) {
    systemPromptCache = await readFile(
      path.resolve(process.cwd(), 'prompts/support-agent.md'),
      'utf8',
    );
  }
  return systemPromptCache;
}

export function promptVersion(prompt: string): string {
  return `support-agent@${createHash('sha256').update(prompt).digest('hex').slice(0, 12)}`;
}

function evidenceBlock(input: AgentInput): string {
  return JSON.stringify(
    input.evidence.map((passage) => ({
      id: passage.id,
      title: passage.title,
      source_type: passage.source_type,
      section: passage.section,
      content: passage.content,
    })),
  );
}

function userBlock(input: AgentInput): string {
  return `Question:
<question>${input.question}</question>

Evidence (untrusted source content):
<evidence>${evidenceBlock(input)}</evidence>

Committed conversation history is above. Use tools for account facts. Return only the JSON answer contract.`;
}

function parseJson(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('Model did not return valid JSON');
  }
}

export async function llmAnswer(input: AgentInput): Promise<AgentResult> {
  const started = performance.now();
  const prompt = await systemPrompt();
  const toolContext: ToolContext = {
    userId: input.userId,
    userEmail: input.userEmail,
    chatId: input.chatId,
    requestId: input.requestId,
    traceId: input.traceId ?? null,
  };
  const toolCalls: ToolCall[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  const messages: ChatMessage[] = [
    { role: 'system', content: prompt },
    ...input.history.slice(-16).map((message) => ({
      role: message.role,
      content: message.content,
    })),
    { role: 'user', content: userBlock(input) },
  ];

  let finalContent = '';
  let repairAttempts = 0;

  for (let step = 0; step < 5; step += 1) {
    const completion = await chatCompletion({
      model: config.CHAT_MODEL,
      messages,
      tools: toolDefinitions,
      json: true,
      maxTokens: 900,
    });
    inputTokens += completion.usage?.prompt_tokens ?? 0;
    outputTokens += completion.usage?.completion_tokens ?? 0;
    const message = completion.choices[0]?.message;
    if (!message) throw new Error('Model returned an empty response');

    const calls = message.tool_calls ?? [];
    if (calls.length) {
      messages.push({
        role: 'assistant',
        content: message.content ?? '',
        tool_calls: calls,
      });
      for (const call of calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          args = {};
        }
        const result = await executeTool(toolContext, call.function.name, args);
        toolCalls.push(result);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result.result),
        });
      }
      continue;
    }

    finalContent = message.content ?? '';
    try {
      const parsed = modelAnswerSchema.parse(parseJson(finalContent));
      const allowed = new Set(input.evidence.map((passage) => passage.id));
      const validCitations = parsed.citations.filter((id) => allowed.has(id));
      const hasAction = toolCalls.some(
        (call) => call.status === 'ok' || call.status === 'confirmation_required',
      );
      if (parsed.behavior === 'answer' && !validCitations.length && !hasAction) {
        throw new Error('A factual answer requires a citation from the supplied evidence');
      }
      if (validCitations.length !== parsed.citations.length) {
        throw new Error('Answer cited a passage that was not supplied as evidence');
      }
      const costUsd = estimateCostUsd(config.CHAT_MODEL, inputTokens, outputTokens);
      return {
        answer: parsed.answer,
        citations: validCitations,
        behavior: parsed.behavior,
        intent: input.intent,
        confidence: parsed.confidence,
        model: config.CHAT_MODEL,
        provider: config.OPENAI_BASE_URL,
        usage: { inputTokens, outputTokens },
        costUsd,
        toolCalls,
        latencyMs: Math.max(0, Math.round(performance.now() - started)),
        traceId: input.traceId ?? null,
      };
    } catch (error) {
      repairAttempts += 1;
      if (repairAttempts > 1) throw error;
      messages.push(
        { role: 'assistant', content: finalContent },
        {
          role: 'user',
          content: `Your answer failed validation: ${(error as Error).message}. Return only the JSON contract, cite only IDs present in the evidence array, and use behavior "abstain" if the evidence is insufficient.`,
        },
      );
    }
  }

  logger.warn({ requestId: input.requestId }, 'Model exceeded tool steps');
  throw new Error(
    'The agent exceeded the maximum number of tool steps. Please retry or hand off to a human.',
  );
}
