-- Tenant-visible Signal readiness source quality settings.
-- These preserve current defaults unless an admin changes them.

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS signal_source_quality JSONB NOT NULL DEFAULT
  '{"high":1.0,"medium":0.9,"lower":0.75,"fallback":0.85}'::jsonb;
