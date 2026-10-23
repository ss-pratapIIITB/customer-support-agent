export type User = {
  id: string;
  email: string;
  role: 'customer' | 'reviewer' | 'admin';
  name?: string | null;
};
export type Citation = {
  id: string;
  title: string;
  url: string;
  sourceType: string;
  section?: string | null;
  snippet: string;
};
export type Chat = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_message?: string;
  message_count?: number;
  negative_feedback?: boolean;
};
export type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  status: string;
  citations?: Citation[];
  intent?: string;
  behavior?: string;
  confidence?: number;
  latency_ms?: number;
  trace_id?: string;
  request_id?: string;
  feedback_rating?: number | null;
  created_at: string;
};
export type ToolCall = {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  status: string;
  latencyMs: number;
};
export type TraceData = {
  traceId?: string;
  status?: string;
  mode?: string;
  model?: string;
  intent?: string;
  behavior?: string;
  confidence?: number;
  latencyMs?: number;
  retrieval?: {
    ms?: number;
    count?: number;
    mode?: string;
    passages?: Array<Record<string, unknown>>;
  };
  agent?: {
    latencyMs?: number;
    usage?: { inputTokens: number; outputTokens: number } | null;
    costUsd?: number | null;
    toolCalls?: ToolCall[];
  };
  citations?: Citation[];
  spans?: Array<{
    name: string;
    startMs: number;
    durationMs: number;
    attributes?: Record<string, unknown>;
  }>;
  toolCalls?: ToolCall[];
};
export type Trace = {
  id: string;
  trace_id: string;
  chat_id: string;
  request_id: string;
  data: TraceData;
  created_at: string;
  summary?: Record<string, unknown>;
  jaegerUrl?: string | null;
  email?: string;
};
export type Mode = 'demo' | 'live';
export type Me = {
  user: User;
  chatId: string | null;
  mode: Mode;
  model: string;
  embeddings: string;
  otel: boolean;
};
