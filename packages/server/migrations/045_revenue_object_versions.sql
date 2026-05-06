-- Migration 045: Revenue object optimistic concurrency versions
-- Copyright 2026 CRMy Contributors

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS row_version INT NOT NULL DEFAULT 1;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS row_version INT NOT NULL DEFAULT 1;

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS row_version INT NOT NULL DEFAULT 1;

ALTER TABLE use_cases
  ADD COLUMN IF NOT EXISTS row_version INT NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS contacts_tenant_version_idx
  ON contacts(tenant_id, id, row_version);

CREATE INDEX IF NOT EXISTS accounts_tenant_version_idx
  ON accounts(tenant_id, id, row_version);

CREATE INDEX IF NOT EXISTS opportunities_tenant_version_idx
  ON opportunities(tenant_id, id, row_version);

CREATE INDEX IF NOT EXISTS use_cases_tenant_version_idx
  ON use_cases(tenant_id, id, row_version);
