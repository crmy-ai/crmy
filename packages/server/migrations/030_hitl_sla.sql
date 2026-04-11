-- SPDX-License-Identifier: Apache-2.0
-- Up: HITL priority, SLA enforcement, escalation, and notification tracking.

ALTER TABLE hitl_requests
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  ADD COLUMN IF NOT EXISTS sla_minutes INT NOT NULL DEFAULT 1440,  -- 24 hours
  ADD COLUMN IF NOT EXISTS escalate_to_id UUID REFERENCES actors(id),
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

-- Index to efficiently find pending requests that have breached their SLA
CREATE INDEX IF NOT EXISTS idx_hitl_sla_check
  ON hitl_requests (tenant_id, status, created_at)
  WHERE status = 'pending' AND escalated_at IS NULL;

-- Down:
-- DROP INDEX IF EXISTS idx_hitl_sla_check;
-- ALTER TABLE hitl_requests
--   DROP COLUMN IF EXISTS priority,
--   DROP COLUMN IF EXISTS sla_minutes,
--   DROP COLUMN IF EXISTS escalate_to_id,
--   DROP COLUMN IF EXISTS notified_at,
--   DROP COLUMN IF EXISTS escalated_at;
