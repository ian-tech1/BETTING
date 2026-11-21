CREATE TABLE IF NOT EXISTS visitor_presence (
  visitor_id TEXT PRIMARY KEY,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visitor_presence_last_seen_idx
  ON visitor_presence (last_seen_at);
