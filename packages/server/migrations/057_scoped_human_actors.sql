-- Up: Scoped human actors for rep, manager, and admin workspaces

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS users_tenant_manager_idx
  ON users(tenant_id, manager_id)
  WHERE manager_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_tenant_role_idx
  ON users(tenant_id, role);

-- Existing owner indexes cover the core objects. Add tenant+owner indexes so
-- scoped list queries avoid scanning a tenant's whole book of business.
CREATE INDEX IF NOT EXISTS contacts_tenant_owner_idx
  ON contacts(tenant_id, owner_id)
  WHERE owner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS accounts_tenant_owner_idx
  ON accounts(tenant_id, owner_id)
  WHERE owner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS opportunities_tenant_owner_idx
  ON opportunities(tenant_id, owner_id)
  WHERE owner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS use_cases_tenant_owner_idx
  ON use_cases(tenant_id, owner_id)
  WHERE owner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS activities_tenant_owner_idx
  ON activities(tenant_id, owner_id)
  WHERE owner_id IS NOT NULL;

-- Down:
-- DROP INDEX IF EXISTS activities_tenant_owner_idx;
-- DROP INDEX IF EXISTS use_cases_tenant_owner_idx;
-- DROP INDEX IF EXISTS opportunities_tenant_owner_idx;
-- DROP INDEX IF EXISTS accounts_tenant_owner_idx;
-- DROP INDEX IF EXISTS contacts_tenant_owner_idx;
-- DROP INDEX IF EXISTS users_tenant_role_idx;
-- DROP INDEX IF EXISTS users_tenant_manager_idx;
-- ALTER TABLE users DROP COLUMN IF EXISTS manager_id;
