CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_email text NOT NULL,
  status text NOT NULL,
  placed_at timestamptz NOT NULL,
  delivered_at timestamptz,
  total_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'SGD',
  tracking_number text,
  carrier text,
  items jsonb NOT NULL DEFAULT '[]',
  opened boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id, placed_at DESC);

CREATE TABLE IF NOT EXISTS returns (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL,
  reason text NOT NULL,
  rma text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS returns_order ON returns(order_id);

CREATE TABLE IF NOT EXISTS tickets (
  id text PRIMARY KEY,
  chat_id text REFERENCES chats(id) ON DELETE SET NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  summary text NOT NULL,
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tickets_user ON tickets(user_id, created_at DESC);
