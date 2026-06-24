-- Up: shared unauthenticated auth rate-limit buckets

CREATE TABLE IF NOT EXISTS auth_rate_limit_buckets (
  bucket_key    TEXT NOT NULL,
  identity_hash TEXT NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_key, identity_hash, window_start)
);

CREATE INDEX IF NOT EXISTS auth_rate_limit_buckets_stale_idx
  ON auth_rate_limit_buckets(updated_at);

-- Down:
-- DROP TABLE IF EXISTS auth_rate_limit_buckets;
