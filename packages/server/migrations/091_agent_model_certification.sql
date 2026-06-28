-- Up: Model certification gate for automatic Memory promotion

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS model_certification_status TEXT NOT NULL DEFAULT 'uncertified',
  ADD COLUMN IF NOT EXISTS model_certification_profile TEXT,
  ADD COLUMN IF NOT EXISTS model_certification_run_id TEXT,
  ADD COLUMN IF NOT EXISTS model_certification_score DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS model_certified_at TIMESTAMPTZ;

ALTER TABLE agent_configs
  DROP CONSTRAINT IF EXISTS chk_agent_model_certification_status;

ALTER TABLE agent_configs
  ADD CONSTRAINT chk_agent_model_certification_status
  CHECK (model_certification_status IN ('uncertified', 'certified', 'failed'));

ALTER TABLE agent_configs
  DROP CONSTRAINT IF EXISTS chk_agent_model_certification_score;

ALTER TABLE agent_configs
  ADD CONSTRAINT chk_agent_model_certification_score
  CHECK (model_certification_score IS NULL OR (model_certification_score BETWEEN 0.0 AND 1.0));

-- Down:
-- ALTER TABLE agent_configs DROP CONSTRAINT IF EXISTS chk_agent_model_certification_score;
-- ALTER TABLE agent_configs DROP CONSTRAINT IF EXISTS chk_agent_model_certification_status;
-- ALTER TABLE agent_configs
--   DROP COLUMN IF EXISTS model_certified_at,
--   DROP COLUMN IF EXISTS model_certification_score,
--   DROP COLUMN IF EXISTS model_certification_run_id,
--   DROP COLUMN IF EXISTS model_certification_profile,
--   DROP COLUMN IF EXISTS model_certification_status;
