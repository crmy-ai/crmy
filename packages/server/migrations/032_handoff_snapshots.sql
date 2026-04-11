-- SPDX-License-Identifier: Apache-2.0
-- Up: Agent handoff snapshots — preserve agent reasoning and findings across HITL/assignment handoffs.

CREATE TABLE IF NOT EXISTS agent_handoff_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  session_id      TEXT,
  actor_id        UUID REFERENCES actors(id),
  subject_type    TEXT,
  subject_id      UUID,
  reasoning       TEXT NOT NULL,
  key_findings    JSONB NOT NULL DEFAULT '[]',
  tools_called    JSONB NOT NULL DEFAULT '[]',
  confidence      REAL,
  handoff_type    TEXT NOT NULL DEFAULT 'hitl'
                    CHECK (handoff_type IN ('hitl', 'assignment', 'pause')),
  reference_id    UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resumed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_handoff_snapshots_tenant_actor
  ON agent_handoff_snapshots (tenant_id, actor_id, created_at DESC);

-- Add snapshot FK to hitl_requests
ALTER TABLE hitl_requests
  ADD COLUMN IF NOT EXISTS handoff_snapshot_id UUID REFERENCES agent_handoff_snapshots(id);

-- Add snapshot FK to assignments
ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS handoff_snapshot_id UUID REFERENCES agent_handoff_snapshots(id);

-- Down:
-- ALTER TABLE assignments DROP COLUMN IF EXISTS handoff_snapshot_id;
-- ALTER TABLE hitl_requests DROP COLUMN IF EXISTS handoff_snapshot_id;
-- DROP TABLE IF EXISTS agent_handoff_snapshots;
