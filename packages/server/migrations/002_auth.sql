-- Up: Auth tables

CREATE TABLE api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  key_hash     TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL,
  scopes       TEXT[] NOT NULL DEFAULT '{read,write}',
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Down:
-- DROP TABLE api_keys;
