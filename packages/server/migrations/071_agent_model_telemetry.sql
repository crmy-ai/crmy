-- Workspace Agent model call telemetry
-- Up:

CREATE TABLE IF NOT EXISTS agent_model_call_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id     UUID REFERENCES agent_sessions(id) ON DELETE SET NULL,
  turn_id        UUID REFERENCES agent_turns(id) ON DELETE SET NULL,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  round_index    INTEGER NOT NULL DEFAULT 0,
  provider       TEXT NOT NULL,
  model          TEXT NOT NULL,
  route          TEXT NOT NULL CHECK (route IN ('primary', 'backup')),
  attempt_number INTEGER NOT NULL DEFAULT 1,
  outcome        TEXT NOT NULL CHECK (outcome IN ('success', 'error')),
  is_transient   BOOLEAN NOT NULL DEFAULT false,
  error_message  TEXT,
  duration_ms    INTEGER,
  timeout_ms     INTEGER,
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_model_call_log_tenant_time
  ON agent_model_call_log(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_model_call_log_turn
  ON agent_model_call_log(turn_id, created_at)
  WHERE turn_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_model_call_log_outcome
  ON agent_model_call_log(tenant_id, outcome, is_transient, created_at DESC);

-- Down:
DROP TABLE IF EXISTS agent_model_call_log;
