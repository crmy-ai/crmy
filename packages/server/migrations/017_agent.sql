-- Agent configuration and chat sessions
-- Up:

-- One config row per tenant — admin-managed LLM settings
CREATE TABLE agent_configs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  enabled     BOOLEAN NOT NULL DEFAULT false,
  provider    TEXT NOT NULL DEFAULT 'anthropic',
  base_url    TEXT NOT NULL DEFAULT 'https://api.anthropic.com/v1',
  api_key_enc TEXT,  -- AES-256-GCM encrypted; never returned to clients after save
  model       TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
  system_prompt        TEXT,
  max_tokens_per_turn  INTEGER NOT NULL DEFAULT 4000,
  history_retention_days INTEGER NOT NULL DEFAULT 90,
  can_write_objects    BOOLEAN NOT NULL DEFAULT false,
  can_log_activities   BOOLEAN NOT NULL DEFAULT true,
  can_create_assignments BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id)
);

-- Chat sessions with message history
CREATE TABLE agent_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label        TEXT,
  context_type TEXT,    -- contact | account | opportunity | use-case
  context_id   UUID,
  context_name TEXT,
  messages     JSONB NOT NULL DEFAULT '[]'::jsonb,
  token_count  INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_sessions_tenant_user ON agent_sessions(tenant_id, user_id, updated_at DESC);
CREATE INDEX idx_agent_sessions_retention   ON agent_sessions(created_at);

-- Down:
DROP TABLE IF EXISTS agent_sessions;
DROP TABLE IF EXISTS agent_configs;
