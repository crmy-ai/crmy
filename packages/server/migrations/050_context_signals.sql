-- Up: Signals and confirmed memory lifecycle for context entries

ALTER TABLE context_entries
  ADD COLUMN IF NOT EXISTS memory_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS promoted_by UUID REFERENCES actors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES actors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

ALTER TABLE context_entries
  DROP CONSTRAINT IF EXISTS chk_context_entries_memory_status;

ALTER TABLE context_entries
  ADD CONSTRAINT chk_context_entries_memory_status
  CHECK (memory_status IN ('signal', 'active', 'rejected', 'superseded'));

UPDATE context_entries
SET memory_status = CASE
  WHEN is_current = false THEN 'superseded'
  ELSE 'active'
END
WHERE memory_status IS NULL OR memory_status = 'active';

CREATE INDEX IF NOT EXISTS idx_context_memory_status
  ON context_entries(tenant_id, memory_status, is_current, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_context_signals_subject
  ON context_entries(tenant_id, subject_type, subject_id, created_at DESC)
  WHERE memory_status = 'signal';

-- Down:
-- DROP INDEX IF EXISTS idx_context_signals_subject;
-- DROP INDEX IF EXISTS idx_context_memory_status;
-- ALTER TABLE context_entries DROP CONSTRAINT IF EXISTS chk_context_entries_memory_status;
-- ALTER TABLE context_entries
--   DROP COLUMN IF EXISTS rejection_reason,
--   DROP COLUMN IF EXISTS rejected_by,
--   DROP COLUMN IF EXISTS rejected_at,
--   DROP COLUMN IF EXISTS promoted_by,
--   DROP COLUMN IF EXISTS promoted_at,
--   DROP COLUMN IF EXISTS evidence,
--   DROP COLUMN IF EXISTS memory_status;
