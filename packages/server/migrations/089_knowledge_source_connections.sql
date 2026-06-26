-- MCP-only knowledge source connectors.
-- These are outbound connector credentials for importing governed knowledge
-- snippets into knowledge_claims. They are intentionally separate from CRMy
-- API keys, which authenticate clients accessing CRMy.
-- Up:

CREATE TABLE IF NOT EXISTS knowledge_source_connections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  provider            TEXT NOT NULL DEFAULT 'mcp'
                      CHECK (provider IN ('mcp')),
  transport           TEXT NOT NULL DEFAULT 'streamable_http'
                      CHECK (transport IN ('streamable_http')),
  auth_type           TEXT NOT NULL DEFAULT 'bearer_token'
                      CHECK (auth_type IN ('none', 'bearer_token')),
  status              TEXT NOT NULL DEFAULT 'configured'
                      CHECK (status IN ('configured', 'syncing', 'error', 'disabled')),
  config              JSONB NOT NULL DEFAULT '{}',
  credentials_enc     JSONB,
  sync_stats          JSONB NOT NULL DEFAULT '{}',
  last_test_at        TIMESTAMPTZ,
  last_sync_at        TIMESTAMPTZ,
  last_error          TEXT,
  created_by          UUID REFERENCES actors(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS knowledge_source_connections_tenant_status_idx
  ON knowledge_source_connections(tenant_id, provider, status, updated_at DESC);

-- Down:
-- DROP TABLE IF EXISTS knowledge_source_connections;
