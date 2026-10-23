import OpenAI from 'openai';
import { config } from './config.js';

let client: OpenAI | undefined;

export function openaiClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: config.OPENAI_API_KEY,
      baseURL: config.OPENAI_BASE_URL,
      maxRetries: 0,
      timeout: config.MODEL_TIMEOUT_MS,
    });
  }
  return client;
}

export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;
export type ChatCompletion = OpenAI.Chat.Completions.ChatCompletion;

export async function chatCompletion(input: {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
}): Promise<ChatCompletion> {
  const client = openaiClient();
  const base = {
    model: input.model,
    messages: input.messages,
    temperature: input.temperature ?? 0.2,
    max_tokens: input.maxTokens ?? 900,
    ...(input.tools?.length ? { tools: input.tools, tool_choice: 'auto' as const } : {}),
  };
  if (input.json) {
    try {
      return await client.chat.completions.create({
        ...base,
        response_format: { type: 'json_object' },
      });
    } catch (error) {
      // Some OpenAI-compatible gateways reject response_format when tools are
      // present. Fall back to the same request without it; the prompt still
      // requires JSON and the answer validator is the real gate.
      const message = error instanceof Error ? error.message : '';
      if (!/response_format|json_object|unsupported|invalid.*format/i.test(message)) throw error;
    }
  }
  return client.chat.completions.create(base);
}
