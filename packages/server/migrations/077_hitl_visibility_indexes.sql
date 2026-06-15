-- SPDX-License-Identifier: Apache-2.0
-- Up: Support query-layer HITL visibility filtering for hosted/multi-user installs.

CREATE INDEX IF NOT EXISTS hitl_tenant_status_created_idx
  ON hitl_requests(tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS hitl_tenant_session_idx
  ON hitl_requests(tenant_id, session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS hitl_payload_gin_idx
  ON hitl_requests USING GIN (action_payload jsonb_path_ops);

CREATE INDEX IF NOT EXISTS agent_sessions_tenant_context_idx
  ON agent_sessions(tenant_id, context_type, context_id)
  WHERE context_type IS NOT NULL AND context_id IS NOT NULL;

-- Down:
-- DROP INDEX IF EXISTS agent_sessions_tenant_context_idx;
-- DROP INDEX IF EXISTS hitl_payload_gin_idx;
-- DROP INDEX IF EXISTS hitl_tenant_session_idx;
-- DROP INDEX IF EXISTS hitl_tenant_status_created_idx;
