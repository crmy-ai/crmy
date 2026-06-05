-- Workspace Agent backup provider
-- Up:

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS backup_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS backup_provider TEXT,
  ADD COLUMN IF NOT EXISTS backup_base_url TEXT,
  ADD COLUMN IF NOT EXISTS backup_api_key_enc TEXT,
  ADD COLUMN IF NOT EXISTS backup_model TEXT;

-- Down:
ALTER TABLE agent_configs
  DROP COLUMN IF EXISTS backup_model,
  DROP COLUMN IF EXISTS backup_api_key_enc,
  DROP COLUMN IF EXISTS backup_base_url,
  DROP COLUMN IF EXISTS backup_provider,
  DROP COLUMN IF EXISTS backup_enabled;
