import { z } from 'zod';

export type Passage = {
  id: string;
  content: string;
  title: string;
  url: string;
  source_type: string;
  product_id?: string | null;
  section?: string | null;
  score?: number;
  [key: string]: unknown;
};

export type Citation = {
  id: string;
  title: string;
  url: string;
  sourceType: string;
  section?: string | null;
  snippet: string;
};

export type HistoryMessage = { role: 'user' | 'assistant'; content: string };

export type RetrievalScope = {
  product?: string;
  productIds?: string[];
  sourceType?: string;
  intent?: string;
};

export type ToolCall = {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  status: 'ok' | 'denied' | 'error' | 'confirmation_required';
  latencyMs: number;
};

export type AgentInput = {
  question: string;
  history: HistoryMessage[];
  evidence: Passage[];
  chatId: string;
  requestId: string;
  userId: string;
  userEmail: string;
  intent: string;
  pendingAction?: PendingAction | null;
  fault?: string;
  traceId?: string | null;
  onChunk?: (chunk: string) => void;
};

export type PendingAction = {
  id: string;
  action: string;
  payload: Record<string, unknown>;
  expiresAt: string;
};

export type AgentResult = {
  answer: string;
  citations: string[];
  behavior: 'answer' | 'clarify' | 'abstain';
  intent: string;
  confidence: number;
  model: string;
  provider: string;
  usage?: { inputTokens: number; outputTokens: number };
  costUsd: number | null;
  toolCalls: ToolCall[];
  pendingActionId?: string | null;
  traceId?: string | null;
  latencyMs: number;
};

export const answerBehavior = z.enum(['answer', 'clarify', 'abstain']);

export const modelAnswerSchema = z.object({
  answer: z.string().min(1).max(6000),
  citations: z.array(z.string()).max(20).default([]),
  behavior: answerBehavior.default('answer'),
  confidence: z.number().min(0).max(1).default(0.7),
});

export const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});

export const chatMessageSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  requestId: z.string().regex(/^[a-zA-Z0-9-]{8,100}$/),
  fault: z.string().max(50).optional(),
});

export const feedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  reason: z.string().max(500).optional(),
});

export const evalAnswerSchema = z.object({
  question: z.string().trim().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .max(40)
    .default([]),
  category: z.string().max(40).default('general'),
  userId: z.string().max(80).default('offline-evaluation'),
  runId: z.string().max(80).optional(),
  caseId: z.string().max(40).optional(),
});

export const evalImportSchema = z.object({
  report: z.record(z.unknown()),
  source: z.string().max(80).default('python-harness'),
});

export type EvalCaseResult = {
  id: string;
  category: string;
  question: string;
  expectedBehavior: string;
  actualAnswer: string;
  actualBehavior: string;
  citations: string[];
  evidence: Passage[];
  checks: Record<string, boolean | null>;
  passed: boolean;
  latencyMs: number;
  traceId?: string | null;
  notes?: string;
};
