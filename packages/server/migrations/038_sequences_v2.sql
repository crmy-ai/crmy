-- Up: Evolve email_sequences → general multi-channel sequences

-- ── Rename base table ──────────────────────────────────────────────────────────
ALTER TABLE email_sequences RENAME TO sequences;

-- ── New columns on sequences ───────────────────────────────────────────────────
ALTER TABLE sequences
  ADD COLUMN IF NOT EXISTS channel_types     TEXT[]  NOT NULL DEFAULT ARRAY['email'],
  ADD COLUMN IF NOT EXISTS goal_event        TEXT,
  ADD COLUMN IF NOT EXISTS goal_object_type  TEXT,
  ADD COLUMN IF NOT EXISTS exit_on_reply     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS ai_persona        TEXT,
  ADD COLUMN IF NOT EXISTS tags              TEXT[]  NOT NULL DEFAULT '{}';

-- ── New columns on enrollments ─────────────────────────────────────────────────
ALTER TABLE sequence_enrollments
  ADD COLUMN IF NOT EXISTS variables    JSONB       NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS paused_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS goal_met_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exit_reason  TEXT;
  -- exit_reason: replied | goal_met | manual | completed

-- ── Allow re-enrollment after completion ───────────────────────────────────────
-- Drop the hard unique constraint that prevented re-enrolling a completed contact
ALTER TABLE sequence_enrollments
  DROP CONSTRAINT IF EXISTS sequence_enrollments_sequence_id_contact_id_key;

-- Replace with partial index — only one ACTIVE or PAUSED enrollment per contact per sequence
CREATE UNIQUE INDEX IF NOT EXISTS sequence_enrollments_active_unique
  ON sequence_enrollments(sequence_id, contact_id)
  WHERE status IN ('active', 'paused');

-- ── Backward-compat view for existing code that references email_sequences ─────
CREATE OR REPLACE VIEW email_sequences AS
  SELECT * FROM sequences WHERE 'email' = ANY(channel_types);

-- ── Analytics rollup table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sequence_analytics_rollup (
  id              UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id     UUID  NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  tenant_id       UUID  NOT NULL,
  period_start    DATE  NOT NULL,
  period_type     TEXT  NOT NULL DEFAULT 'day',
  enrolled_count  INT   NOT NULL DEFAULT 0,
  completed_count INT   NOT NULL DEFAULT 0,
  exited_count    INT   NOT NULL DEFAULT 0,
  emails_sent     INT   NOT NULL DEFAULT 0,
  emails_opened   INT   NOT NULL DEFAULT 0,
  emails_clicked  INT   NOT NULL DEFAULT 0,
  replies_count   INT   NOT NULL DEFAULT 0,
  tasks_created   INT   NOT NULL DEFAULT 0,
  UNIQUE(sequence_id, period_start, period_type)
);

CREATE INDEX IF NOT EXISTS seq_analytics_seq_idx
  ON sequence_analytics_rollup(sequence_id, period_start DESC);

-- Down:
-- DROP TABLE IF EXISTS sequence_analytics_rollup;
-- DROP VIEW IF EXISTS email_sequences;
-- DROP INDEX IF EXISTS sequence_enrollments_active_unique;
-- ALTER TABLE sequence_enrollments ADD CONSTRAINT sequence_enrollments_sequence_id_contact_id_key UNIQUE (sequence_id, contact_id);
-- ALTER TABLE sequences RENAME TO email_sequences;
