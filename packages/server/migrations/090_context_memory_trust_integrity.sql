-- Up: Memory trust integrity metadata

ALTER TABLE context_entries
  ADD COLUMN IF NOT EXISTS grounding_method TEXT NOT NULL DEFAULT 'lexical';

ALTER TABLE context_entries
  DROP CONSTRAINT IF EXISTS chk_context_entries_grounding_method;

ALTER TABLE context_entries
  ADD CONSTRAINT chk_context_entries_grounding_method
  CHECK (grounding_method IN ('lexical', 'corroborated', 'human_reviewed'));

CREATE INDEX IF NOT EXISTS idx_context_grounding_method
  ON context_entries(tenant_id, grounding_method, memory_status, is_current);

-- Down:
-- DROP INDEX IF EXISTS idx_context_grounding_method;
-- ALTER TABLE context_entries DROP CONSTRAINT IF EXISTS chk_context_entries_grounding_method;
-- ALTER TABLE context_entries DROP COLUMN IF EXISTS grounding_method;
