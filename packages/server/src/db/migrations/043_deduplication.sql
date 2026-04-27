-- Migration 043: Deduplication indexes and merge support
-- Copyright 2026 CRMy Contributors

-- ── Contacts: unique email per tenant ───────────────────────────────────────
-- First, resolve any existing email conflicts by nullifying duplicates
-- (keeps the earliest-created record per email per tenant)
WITH dupes AS (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY tenant_id, lower(email) ORDER BY created_at) AS rn
  FROM contacts
  WHERE email IS NOT NULL AND email != ''
)
UPDATE contacts SET email = NULL WHERE id IN (SELECT id FROM dupes WHERE rn > 1);

-- Unique partial index: one contact per (tenant, email)
CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_email_unique
  ON contacts (tenant_id, lower(email))
  WHERE email IS NOT NULL AND email != '';

-- ── Accounts: unique domain per tenant ──────────────────────────────────────
-- First, resolve any existing domain conflicts
WITH dupes AS (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY tenant_id, lower(domain) ORDER BY created_at) AS rn
  FROM accounts
  WHERE domain IS NOT NULL AND domain != ''
)
UPDATE accounts SET domain = NULL WHERE id IN (SELECT id FROM dupes WHERE rn > 1);

-- Unique partial index: one account per (tenant, domain)
CREATE UNIQUE INDEX IF NOT EXISTS accounts_tenant_domain_unique
  ON accounts (tenant_id, lower(domain))
  WHERE domain IS NOT NULL AND domain != '';

-- ── Merge tracking ───────────────────────────────────────────────────────────
-- merged_into marks a record as absorbed into another (soft-deleted via merge)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES accounts(id) ON DELETE SET NULL;

-- Index so we can quickly find all records merged into a given primary
CREATE INDEX IF NOT EXISTS contacts_merged_into_idx ON contacts(merged_into) WHERE merged_into IS NOT NULL;
CREATE INDEX IF NOT EXISTS accounts_merged_into_idx ON accounts(merged_into) WHERE merged_into IS NOT NULL;
