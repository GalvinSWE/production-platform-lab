CREATE TABLE IF NOT EXISTS processed_jobs (
  event_id UUID PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES items(id),
  worker_id TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
