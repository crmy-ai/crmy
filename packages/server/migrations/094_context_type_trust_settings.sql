-- Up: tenant-configurable trust settings for customer Memory context types

ALTER TABLE context_type_registry
  ADD COLUMN IF NOT EXISTS default_freshness_days INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS claim_tier INTEGER NOT NULL DEFAULT 0;

ALTER TABLE context_type_registry
  DROP CONSTRAINT IF EXISTS chk_context_type_registry_default_freshness_days;

ALTER TABLE context_type_registry
  ADD CONSTRAINT chk_context_type_registry_default_freshness_days
  CHECK (default_freshness_days BETWEEN 1 AND 3650);

ALTER TABLE context_type_registry
  DROP CONSTRAINT IF EXISTS chk_context_type_registry_claim_tier;

ALTER TABLE context_type_registry
  ADD CONSTRAINT chk_context_type_registry_claim_tier
  CHECK (claim_tier IN (0, 1, 2));

-- Preserve the pre-WS4 built-in policy defaults while making them tenant-editable.
UPDATE context_type_registry
SET default_freshness_days = CASE
      WHEN type_name ~ '(forecast|next_step|approval)' THEN 30
      WHEN type_name ~ '(risk|objection|methodology|competitive)' THEN 45
      WHEN type_name ~ '(commitment|buying_process|decision)' THEN 60
      WHEN type_name ~ '(stakeholder|success_criteria|key_fact)' THEN 90
      WHEN type_name ~ '(preference|relationship)' THEN 180
      ELSE 120
    END,
    claim_tier = CASE
      WHEN type_name IN ('approval', 'commitment', 'deal_risk', 'forecast', 'forecast_risk', 'forecast_signal', 'risk') THEN 2
      WHEN type_name IN (
        'buying_process', 'competitive_intel', 'decision', 'key_fact', 'methodology_gap',
        'next_step', 'objection', 'stakeholder', 'stakeholder_map', 'stakeholder_role',
        'success_criteria'
      ) THEN 1
      ELSE 0
    END;

-- Down:
-- ALTER TABLE context_type_registry DROP CONSTRAINT IF EXISTS chk_context_type_registry_claim_tier;
-- ALTER TABLE context_type_registry DROP CONSTRAINT IF EXISTS chk_context_type_registry_default_freshness_days;
-- ALTER TABLE context_type_registry
--   DROP COLUMN IF EXISTS claim_tier,
--   DROP COLUMN IF EXISTS default_freshness_days;
