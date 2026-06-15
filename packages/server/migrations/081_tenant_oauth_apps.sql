-- Up: Tenant-owned OAuth apps for hosted System Connections

CREATE TABLE IF NOT EXISTS tenant_oauth_apps (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  enabled             BOOLEAN NOT NULL DEFAULT true,
  client_id           TEXT NOT NULL,
  client_secret_enc   JSONB NOT NULL,
  microsoft_tenant_id TEXT,
  created_by          UUID REFERENCES users(id),
  updated_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS tenant_oauth_apps_tenant_idx ON tenant_oauth_apps(tenant_id);

-- Down:
-- DROP TABLE tenant_oauth_apps;
