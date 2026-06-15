-- Up: shared authenticated actor rate-limit buckets

CREATE TABLE IF NOT EXISTS actor_rate_limit_buckets (
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id     TEXT NOT NULL,
  route_key    TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, actor_id, route_key, window_start)
);

CREATE INDEX IF NOT EXISTS actor_rate_limit_buckets_stale_idx
  ON actor_rate_limit_buckets(updated_at);

-- Down:
-- DROP TABLE IF EXISTS actor_rate_limit_buckets;
