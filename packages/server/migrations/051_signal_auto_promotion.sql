-- Signal auto-promotion settings
-- Up:

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS auto_promote_signals BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS signal_auto_promote_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.85;
