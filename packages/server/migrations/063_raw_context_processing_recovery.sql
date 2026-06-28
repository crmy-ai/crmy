-- Source processing recovery metadata
-- Up:

ALTER TABLE raw_context_sources
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS failure_code TEXT;

CREATE INDEX IF NOT EXISTS raw_context_sources_recovery_idx
  ON raw_context_sources(tenant_id, status, next_retry_at, updated_at)
  WHERE status IN ('pending', 'processing', 'failed');

-- Down:
-- DROP INDEX IF EXISTS raw_context_sources_recovery_idx;
-- ALTER TABLE raw_context_sources
--   DROP COLUMN IF EXISTS failure_code,
--   DROP COLUMN IF EXISTS last_error,
--   DROP COLUMN IF EXISTS next_retry_at,
--   DROP COLUMN IF EXISTS locked_at,
--   DROP COLUMN IF EXISTS attempt_count;
