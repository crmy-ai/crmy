-- Up: Per-mapping sync checkpoints for systems of record

ALTER TABLE external_object_mappings
  ADD COLUMN IF NOT EXISTS sync_cursor TEXT,
  ADD COLUMN IF NOT EXISTS sync_watermark TEXT,
  ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sync_run_id UUID REFERENCES external_sync_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS external_mappings_checkpoint_idx
  ON external_object_mappings(tenant_id, system_id, last_sync_at DESC);

-- Down:
-- DROP INDEX IF EXISTS external_mappings_checkpoint_idx;
-- ALTER TABLE external_object_mappings DROP COLUMN IF EXISTS last_sync_run_id;
-- ALTER TABLE external_object_mappings DROP COLUMN IF EXISTS last_sync_at;
-- ALTER TABLE external_object_mappings DROP COLUMN IF EXISTS sync_watermark;
-- ALTER TABLE external_object_mappings DROP COLUMN IF EXISTS sync_cursor;
