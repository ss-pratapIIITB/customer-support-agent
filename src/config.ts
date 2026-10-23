import 'dotenv/config';
import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return fallback;
      return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_BASE_URL: z.string().url().default('http://127.0.0.1:3000'),
  DATABASE_URL: z.string().default('postgres://support:support@127.0.0.1:5435/support'),
  AUTO_BOOTSTRAP: bool(true),
  SEED_DEMO: bool(true),

  AGENT_MODE: z.enum(['auto', 'demo', 'live']).default('demo'),
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  CHAT_MODEL: z.string().default('gpt-4.1-mini'),
  JUDGE_MODEL: z.string().default('gpt-4.1'),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDINGS_MODE: z.enum(['auto', 'on', 'off']).default('auto'),

  OTEL_ENABLED: bool(true),
  OTEL_SERVICE_NAME: z.string().default('maxify-support'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://127.0.0.1:4318'),
  OTEL_METRICS_HOST: z.string().default('127.0.0.1'),
  OTEL_METRICS_PORT: z.coerce.number().int().min(1).max(65535).default(9464),
  JAEGER_UI_URL: z.string().default('http://127.0.0.1:16686'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  EVAL_API_TOKEN: z.string().min(8).default('local-eval-token-change-me'),
  EVAL_PYTHON: z.string().default('python3'),

  MAX_MESSAGE_CHARS: z.coerce.number().int().min(100).max(20000).default(2000),
  MODEL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180000).default(45000),
  RETURN_AUTO_APPROVE_LIMIT_CENTS: z.coerce.number().int().min(0).default(50000),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(60),
  COOKIE_SECURE: bool(false),
  SESSION_HOURS: z.coerce.number().int().min(1).max(720).default(8),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${details}`);
}

const raw = parsed.data;
export const config = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  liveModel:
    raw.AGENT_MODE === 'live' ||
    (raw.AGENT_MODE === 'auto' && raw.OPENAI_API_KEY.trim().length > 0),
  // Auto embeddings follow the live model path. Demo mode is fully local and
  // deterministic, even when a (possibly stale) key is present in the shell.
  embeddings:
    raw.EMBEDDINGS_MODE === 'on'
      ? true
      : raw.EMBEDDINGS_MODE === 'off'
        ? false
        : raw.AGENT_MODE !== 'demo' && raw.OPENAI_API_KEY.trim().length > 0,
  chatModel:
    raw.AGENT_MODE === 'live' || (raw.AGENT_MODE === 'auto' && raw.OPENAI_API_KEY.trim().length > 0)
      ? raw.CHAT_MODEL
      : 'demo-engine',
} as const;

export type AppConfig = typeof config;
