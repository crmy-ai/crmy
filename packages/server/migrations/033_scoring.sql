-- SPDX-License-Identifier: Apache-2.0
-- Up: Lead and deal health scoring columns.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lead_score INT,
  ADD COLUMN IF NOT EXISTS lead_score_updated_at TIMESTAMPTZ;

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS deal_health_score INT,
  ADD COLUMN IF NOT EXISTS deal_health_score_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_contacts_lead_score_updated
  ON contacts (tenant_id, lead_score_updated_at)
  WHERE lead_score_updated_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_opportunities_health_score_updated
  ON opportunities (tenant_id, deal_health_score_updated_at)
  WHERE deal_health_score_updated_at IS NOT NULL;

-- Down:
-- DROP INDEX IF EXISTS idx_opportunities_health_score_updated;
-- DROP INDEX IF EXISTS idx_contacts_lead_score_updated;
-- ALTER TABLE opportunities DROP COLUMN IF EXISTS deal_health_score, DROP COLUMN IF EXISTS deal_health_score_updated_at;
-- ALTER TABLE contacts DROP COLUMN IF EXISTS lead_score, DROP COLUMN IF EXISTS lead_score_updated_at;
