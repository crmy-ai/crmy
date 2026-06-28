-- Source extraction attempt ledger
-- Up:

CREATE TABLE IF NOT EXISTS raw_context_extraction_attempts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  raw_context_source_id  UUID REFERENCES raw_context_sources(id) ON DELETE CASCADE,
  activity_id            UUID REFERENCES activities(id) ON DELETE SET NULL,
  attempt_number         INTEGER NOT NULL DEFAULT 1,
  status                 TEXT NOT NULL DEFAULT 'running'
                         CHECK (status IN ('running', 'succeeded', 'failed')),
  outcome                TEXT,
  stage                  TEXT NOT NULL DEFAULT 'extract_signals',
  model                  TEXT,
  response_format        TEXT,
  timeout_ms             INTEGER,
  prompt_version         TEXT NOT NULL DEFAULT 'context_extraction_v1',
  input_summary          JSONB NOT NULL DEFAULT '{}',
  telemetry              JSONB NOT NULL DEFAULT '{}',
  output_summary         JSONB NOT NULL DEFAULT '{}',
  raw_output_excerpt     TEXT,
  repaired_output_excerpt TEXT,
  failure_code           TEXT,
  failure_reason         TEXT,
  latency_ms             INTEGER,
  started_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS raw_context_extraction_attempts_number_idx
  ON raw_context_extraction_attempts(tenant_id, raw_context_source_id, attempt_number)
  WHERE raw_context_source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS raw_context_extraction_attempts_source_idx
  ON raw_context_extraction_attempts(tenant_id, raw_context_source_id, started_at DESC);

CREATE INDEX IF NOT EXISTS raw_context_extraction_attempts_status_idx
  ON raw_context_extraction_attempts(tenant_id, status, started_at DESC);

CREATE INDEX IF NOT EXISTS raw_context_extraction_attempts_activity_idx
  ON raw_context_extraction_attempts(tenant_id, activity_id, started_at DESC)
  WHERE activity_id IS NOT NULL;

-- Down:
-- DROP INDEX IF EXISTS raw_context_extraction_attempts_activity_idx;
-- DROP INDEX IF EXISTS raw_context_extraction_attempts_status_idx;
-- DROP INDEX IF EXISTS raw_context_extraction_attempts_source_idx;
-- DROP INDEX IF EXISTS raw_context_extraction_attempts_number_idx;
-- DROP TABLE IF EXISTS raw_context_extraction_attempts;
