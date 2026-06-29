-- Up: governed Tier-2 automatic-promotion policy

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS tier2_autopromote_policy TEXT;

ALTER TABLE agent_configs
  DROP CONSTRAINT IF EXISTS chk_agent_tier2_autopromote_policy;

ALTER TABLE agent_configs
  ADD CONSTRAINT chk_agent_tier2_autopromote_policy
  CHECK (tier2_autopromote_policy IN ('corroborated', 'human_only'));

-- Down:
-- ALTER TABLE agent_configs DROP CONSTRAINT IF EXISTS chk_agent_tier2_autopromote_policy;
-- ALTER TABLE agent_configs DROP COLUMN IF EXISTS tier2_autopromote_policy;
