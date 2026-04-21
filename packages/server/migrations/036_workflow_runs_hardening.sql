-- Up: Workflow reliability hardening — action logs, duration tracking, rate limits, error counts

-- Per-action execution log: [{index, type, status, error, duration_ms, started_at}]
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS action_logs JSONB NOT NULL DEFAULT '[]';

-- Computed total execution duration in milliseconds
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS duration_ms INT;

-- Enforce valid status values at the DB level
ALTER TABLE workflow_runs ADD CONSTRAINT IF NOT EXISTS workflow_runs_status_check
  CHECK (status IN ('running','completed','failed'));

-- Index for time-range queries (e.g. "failed runs in last hour")
CREATE INDEX IF NOT EXISTS workflow_runs_started_at_idx
  ON workflow_runs(workflow_id, started_at DESC);

-- Per-workflow rate limiting
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS max_runs_per_hour INT;

-- Per-workflow error tracking (incremented each time a run fails)
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS error_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ;

-- Down:
-- ALTER TABLE workflow_runs DROP COLUMN IF EXISTS action_logs;
-- ALTER TABLE workflow_runs DROP COLUMN IF EXISTS duration_ms;
-- ALTER TABLE workflow_runs DROP CONSTRAINT IF EXISTS workflow_runs_status_check;
-- DROP INDEX IF EXISTS workflow_runs_started_at_idx;
-- ALTER TABLE workflows DROP COLUMN IF EXISTS max_runs_per_hour;
-- ALTER TABLE workflows DROP COLUMN IF EXISTS error_count;
-- ALTER TABLE workflows DROP COLUMN IF EXISTS last_error_at;
