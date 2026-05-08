-- Up: Unified actor and auth lifecycle metadata

CREATE TABLE IF NOT EXISTS user_auth_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  token_type  TEXT NOT NULL CHECK (token_type IN ('invite', 'password_reset')),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_auth_tokens_user
  ON user_auth_tokens(tenant_id, user_id, token_type, used_at, expires_at);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

ALTER TABLE actors
  ADD COLUMN IF NOT EXISTS registration_source TEXT NOT NULL DEFAULT 'migration',
  ADD COLUMN IF NOT EXISTS registration_status TEXT NOT NULL DEFAULT 'approved';

UPDATE actors
SET registration_source = 'migration'
WHERE registration_source IS NULL;

UPDATE actors
SET registration_status = 'approved'
WHERE registration_status IS NULL;

-- Down:
-- ALTER TABLE actors DROP COLUMN IF EXISTS registration_status;
-- ALTER TABLE actors DROP COLUMN IF EXISTS registration_source;
-- ALTER TABLE users DROP COLUMN IF EXISTS last_login_at;
-- ALTER TABLE users DROP COLUMN IF EXISTS password_set_at;
-- ALTER TABLE users DROP COLUMN IF EXISTS invited_at;
-- ALTER TABLE users DROP COLUMN IF EXISTS is_active;
-- DROP TABLE IF EXISTS user_auth_tokens;
