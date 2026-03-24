-- Up: Structured context templates + activity extraction pipeline

-- ── Context type registry: add schema and extraction fields ─────────────────

ALTER TABLE context_type_registry ADD COLUMN IF NOT EXISTS json_schema       JSONB;
ALTER TABLE context_type_registry ADD COLUMN IF NOT EXISTS extraction_prompt TEXT;
ALTER TABLE context_type_registry ADD COLUMN IF NOT EXISTS is_extractable    BOOLEAN NOT NULL DEFAULT false;

-- ── Activities: track LLM extraction status ─────────────────────────────────

ALTER TABLE activities ADD COLUMN IF NOT EXISTS extraction_status TEXT
  CHECK (extraction_status IN ('pending', 'done', 'skipped', 'error'));
ALTER TABLE activities ADD COLUMN IF NOT EXISTS extraction_error  TEXT;

-- Index for the background worker to efficiently find pending extractions
CREATE INDEX IF NOT EXISTS idx_activities_extraction_pending
  ON activities(tenant_id, created_at DESC)
  WHERE extraction_status = 'pending';

-- Down:
-- ALTER TABLE activities DROP COLUMN IF EXISTS extraction_error;
-- ALTER TABLE activities DROP COLUMN IF EXISTS extraction_status;
-- ALTER TABLE context_type_registry DROP COLUMN IF EXISTS is_extractable;
-- ALTER TABLE context_type_registry DROP COLUMN IF EXISTS extraction_prompt;
-- ALTER TABLE context_type_registry DROP COLUMN IF EXISTS json_schema;
