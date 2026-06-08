-- Preserve customer-memory anchors when users "delete" primary CRM records.
-- Delete commands now archive rows by setting archived_at instead of removing them.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE use_cases ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS accounts_active_tenant_created_idx
  ON accounts(tenant_id, created_at DESC)
  WHERE archived_at IS NULL AND merged_into IS NULL;

CREATE INDEX IF NOT EXISTS contacts_active_tenant_created_idx
  ON contacts(tenant_id, created_at DESC)
  WHERE archived_at IS NULL AND merged_into IS NULL;

CREATE INDEX IF NOT EXISTS opportunities_active_tenant_created_idx
  ON opportunities(tenant_id, created_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS use_cases_active_tenant_created_idx
  ON use_cases(tenant_id, created_at DESC)
  WHERE archived_at IS NULL;
