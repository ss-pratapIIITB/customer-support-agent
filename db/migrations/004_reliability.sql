CREATE TABLE IF NOT EXISTS reliability_checks (
  id text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  status text NOT NULL,
  injection text,
  detail jsonb NOT NULL DEFAULT '{}',
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reliability_checks_created ON reliability_checks(created_at DESC);
