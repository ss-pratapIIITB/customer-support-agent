CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('customer', 'reviewer', 'admin')),
  name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);

CREATE TABLE IF NOT EXISTS chats (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New conversation',
  status text NOT NULL DEFAULT 'open',
  channel text NOT NULL DEFAULT 'web',
  summary text,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chats_owner ON chats(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chats_status ON chats(status, created_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id text PRIMARY KEY,
  chat_id text NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  request_id text,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  status text NOT NULL DEFAULT 'completed',
  citations jsonb NOT NULL DEFAULT '[]',
  intent text,
  behavior text,
  confidence real,
  latency_ms integer,
  trace_id text,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_id, request_id, role)
);
CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat_id, created_at, id);
CREATE INDEX IF NOT EXISTS messages_trace ON messages(trace_id);

CREATE TABLE IF NOT EXISTS requests (
  id text PRIMARY KEY,
  chat_id text NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_id, id)
);
CREATE INDEX IF NOT EXISTS requests_chat ON requests(chat_id, status);

CREATE TABLE IF NOT EXISTS traces (
  id text PRIMARY KEY,
  trace_id text,
  chat_id text,
  request_id text,
  user_id text,
  data jsonb NOT NULL,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS traces_created ON traces(created_at DESC);
CREATE INDEX IF NOT EXISTS traces_request ON traces(request_id);
CREATE INDEX IF NOT EXISTS traces_chat ON traces(chat_id);

CREATE TABLE IF NOT EXISTS model_calls (
  id text PRIMARY KEY,
  trace_id text,
  request_id text,
  chat_id text,
  eval_run_id text,
  purpose text NOT NULL,
  provider text,
  model text,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  cost_usd double precision,
  latency_ms integer,
  status text NOT NULL DEFAULT 'completed',
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS model_calls_request ON model_calls(request_id);
CREATE INDEX IF NOT EXISTS model_calls_chat ON model_calls(chat_id);
CREATE INDEX IF NOT EXISTS model_calls_eval ON model_calls(eval_run_id);

CREATE TABLE IF NOT EXISTS tool_calls (
  id text PRIMARY KEY,
  trace_id text,
  request_id text,
  chat_id text,
  user_id text,
  name text NOT NULL,
  args jsonb NOT NULL DEFAULT '{}',
  result jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tool_calls_trace ON tool_calls(trace_id);
CREATE INDEX IF NOT EXISTS tool_calls_chat ON tool_calls(chat_id);

CREATE TABLE IF NOT EXISTS feedback (
  id text PRIMARY KEY,
  message_id text NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  chat_id text NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS pending_actions (
  id text PRIMARY KEY,
  chat_id text NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS pending_actions_chat ON pending_actions(chat_id, status);

CREATE TABLE IF NOT EXISTS corpus_versions (
  id text PRIMARY KEY,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  error text
);
CREATE UNIQUE INDEX IF NOT EXISTS corpus_one_active ON corpus_versions(status) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS sources (
  id text PRIMARY KEY,
  title text NOT NULL,
  url text NOT NULL,
  source_type text NOT NULL,
  product_id text,
  version text NOT NULL,
  manifest jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id text NOT NULL,
  corpus_version text NOT NULL REFERENCES corpus_versions(id) ON DELETE CASCADE,
  source_id text NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  content text NOT NULL,
  section text,
  ordinal integer NOT NULL DEFAULT 0,
  token_estimate integer,
  embedding vector(1536),
  search tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  PRIMARY KEY (corpus_version, id)
);
CREATE INDEX IF NOT EXISTS chunks_search ON chunks USING gin(search);
CREATE INDEX IF NOT EXISTS chunks_trgm ON chunks USING gin(content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS chunks_source_version ON chunks(corpus_version, source_id);
CREATE INDEX IF NOT EXISTS chunks_product ON chunks(source_id);
CREATE INDEX IF NOT EXISTS sources_product ON sources(product_id, version);
CREATE INDEX IF NOT EXISTS chunks_embedding ON chunks USING hnsw(embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS embedding_cache (
  hash text PRIMARY KEY,
  model text NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS eval_runs (
  id text PRIMARY KEY,
  source text NOT NULL DEFAULT 'python-harness',
  status text NOT NULL,
  dataset text,
  results jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS eval_runs_created ON eval_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS analytics_events (
  id text PRIMARY KEY,
  chat_id text,
  user_id text,
  name text NOT NULL,
  props jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_events_name ON analytics_events(name, created_at DESC);

CREATE TABLE IF NOT EXISTS app_meta (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
