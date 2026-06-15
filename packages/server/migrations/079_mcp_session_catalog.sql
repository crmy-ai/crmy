-- SPDX-License-Identifier: Apache-2.0
-- Up: Durable MCP session catalog for hosted multi-instance routing safety.

CREATE TABLE IF NOT EXISTS mcp_sessions (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
  actor_role TEXT NOT NULL CHECK (actor_role IN ('owner', 'admin', 'manager', 'member')),
  scope_hash TEXT NOT NULL,
  actor_identity_hash TEXT NOT NULL,
  owning_instance_id TEXT NOT NULL,
  transport_state TEXT NOT NULL DEFAULT 'active'
    CHECK (transport_state IN ('active', 'closed', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  close_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS mcp_sessions_tenant_active_idx
  ON mcp_sessions (tenant_id, expires_at DESC)
  WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS mcp_sessions_owner_active_idx
  ON mcp_sessions (owning_instance_id, expires_at DESC)
  WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS mcp_session_subscriptions (
  session_id TEXT NOT NULL REFERENCES mcp_sessions(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  resource_uri TEXT NOT NULL,
  last_event_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, resource_uri)
);

CREATE INDEX IF NOT EXISTS mcp_session_subscriptions_tenant_idx
  ON mcp_session_subscriptions (tenant_id, resource_uri);

CREATE TABLE IF NOT EXISTS mcp_instance_heartbeats (
  instance_id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS mcp_instance_heartbeats_last_seen_idx
  ON mcp_instance_heartbeats (last_seen_at DESC);

-- Down:
-- DROP INDEX IF EXISTS mcp_instance_heartbeats_last_seen_idx;
-- DROP TABLE IF EXISTS mcp_instance_heartbeats;
-- DROP INDEX IF EXISTS mcp_session_subscriptions_tenant_idx;
-- DROP TABLE IF EXISTS mcp_session_subscriptions;
-- DROP INDEX IF EXISTS mcp_sessions_owner_active_idx;
-- DROP INDEX IF EXISTS mcp_sessions_tenant_active_idx;
-- DROP TABLE IF EXISTS mcp_sessions;
