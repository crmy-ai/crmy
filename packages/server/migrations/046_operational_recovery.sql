-- Migration 046: Operational recovery controls
-- Copyright 2026 CRMy Contributors

CREATE TABLE IF NOT EXISTS ops_recovery_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  queue_name      TEXT NOT NULL,
  job_id          UUID NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('retry', 'park', 'mark_failed')),
  previous_status TEXT,
  new_status      TEXT NOT NULL,
  reason          TEXT,
  actor_id        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ops_recovery_log_tenant_time_idx
  ON ops_recovery_log(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ops_recovery_log_job_idx
  ON ops_recovery_log(queue_name, job_id, created_at DESC);

ALTER TABLE context_outbox DROP CONSTRAINT IF EXISTS context_outbox_status_check;
ALTER TABLE context_outbox
  ADD CONSTRAINT context_outbox_status_check
  CHECK (status IN ('pending', 'processing', 'complete', 'failed', 'parked'));

ALTER TABLE workflow_runs DROP CONSTRAINT IF EXISTS workflow_runs_status_check;
ALTER TABLE workflow_runs
  ADD CONSTRAINT workflow_runs_status_check
  CHECK (status IN ('running', 'completed', 'failed', 'parked'));
