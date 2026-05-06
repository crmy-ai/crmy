-- Up: Idempotency keys for retried agent operations

CREATE TABLE idempotency_keys (
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id        TEXT NOT NULL,
  operation       TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'in_progress'
                  CHECK (status IN ('in_progress', 'completed', 'failed')),
  response         JSONB,
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, actor_id, operation, idempotency_key)
);

CREATE INDEX idx_idempotency_keys_stale
  ON idempotency_keys(updated_at)
  WHERE status IN ('in_progress', 'failed');

-- Down:
-- DROP TABLE idempotency_keys;
