-- Migration 020: Agent activity log + context entry attribution
-- Copyright 2026 CRMy Contributors · SPDX-License-Identifier: Apache-2.0

-- Per-turn tool call log for agent observability
CREATE TABLE IF NOT EXISTS agent_activity_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL,
  session_id   UUID        NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL,
  turn_index   INTEGER     NOT NULL DEFAULT 0,
  tool_name    TEXT        NOT NULL,
  tool_args    JSONB       NOT NULL DEFAULT '{}',
  tool_result  JSONB,
  is_error     BOOLEAN     NOT NULL DEFAULT false,
  duration_ms  INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_activity_tenant_time
  ON agent_activity_log(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_activity_session
  ON agent_activity_log(session_id);

CREATE INDEX IF NOT EXISTS idx_agent_activity_tool
  ON agent_activity_log(tenant_id, tool_name);

-- Link context entries to the agent session that created them (attribution)
ALTER TABLE context_entries
  ADD COLUMN IF NOT EXISTS agent_session_id UUID REFERENCES agent_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_context_entries_session_id
  ON context_entries(agent_session_id)
  WHERE agent_session_id IS NOT NULL;
