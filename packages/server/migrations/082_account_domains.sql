-- Dedicated account domains used for customer-source matching.
-- The primary accounts.domain remains the canonical display/default domain.

CREATE TABLE IF NOT EXISTS account_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS account_domains_tenant_domain_unique
  ON account_domains (tenant_id, lower(domain));

CREATE INDEX IF NOT EXISTS account_domains_tenant_account_idx
  ON account_domains (tenant_id, account_id);

INSERT INTO account_domains (tenant_id, account_id, domain, source, is_primary)
SELECT tenant_id, id, lower(domain), 'account.domain', TRUE
FROM accounts
WHERE domain IS NOT NULL AND btrim(domain) <> ''
ON CONFLICT DO NOTHING;
