-- Up: Per-step execution log for sequence enrollments

CREATE TABLE IF NOT EXISTS sequence_step_executions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID        NOT NULL REFERENCES sequence_enrollments(id) ON DELETE CASCADE,
  tenant_id     UUID        NOT NULL,
  step_index    INT         NOT NULL,
  step_type     TEXT        NOT NULL DEFAULT 'email',
  status        TEXT        NOT NULL DEFAULT 'pending',
  -- status: pending | sent | failed | skipped | approval_pending
  executed_at   TIMESTAMPTZ,
  email_id      UUID        REFERENCES emails(id) ON DELETE SET NULL,
  error         TEXT,
  metadata      JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seq_step_exec_enrollment_idx
  ON sequence_step_executions(enrollment_id);

CREATE INDEX IF NOT EXISTS seq_step_exec_tenant_idx
  ON sequence_step_executions(tenant_id, created_at DESC);

-- Down:
-- DROP TABLE IF EXISTS sequence_step_executions;
