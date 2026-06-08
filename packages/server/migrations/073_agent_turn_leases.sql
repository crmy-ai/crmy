-- Durable Workspace Agent turn leases
-- Copyright 2026 CRMy Contributors
-- SPDX-License-Identifier: Apache-2.0

-- Up:

ALTER TABLE agent_turns
  ADD COLUMN IF NOT EXISTS worker_id TEXT,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_agent_turns_lease_recovery
  ON agent_turns(status, lease_expires_at, created_at)
  WHERE status IN ('queued', 'running');

-- Down:
DROP INDEX IF EXISTS idx_agent_turns_lease_recovery;
ALTER TABLE agent_turns
  DROP COLUMN IF EXISTS attempt_count,
  DROP COLUMN IF EXISTS heartbeat_at,
  DROP COLUMN IF EXISTS lease_expires_at,
  DROP COLUMN IF EXISTS worker_id;
