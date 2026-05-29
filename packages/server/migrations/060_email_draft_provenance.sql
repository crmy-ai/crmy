-- Email draft provenance and provider draft placeholders
-- Up:

ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS draft_origin TEXT NOT NULL DEFAULT 'manual'
    CHECK (draft_origin IN ('manual', 'agent_generated')),
  ADD COLUMN IF NOT EXISTS draft_target TEXT NOT NULL DEFAULT 'crmy'
    CHECK (draft_target IN ('crmy', 'provider_draft')),
  ADD COLUMN IF NOT EXISTS source_email_message_id UUID REFERENCES email_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_draft_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_draft_status TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (provider_draft_status IN ('not_requested', 'unsupported', 'pending', 'created', 'failed')),
  ADD COLUMN IF NOT EXISTS generation_metadata JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS emails_source_email_message_idx
  ON emails(source_email_message_id) WHERE source_email_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS emails_draft_attention_idx
  ON emails(tenant_id, status, draft_origin, created_at DESC)
  WHERE status IN ('draft', 'pending_approval', 'failed', 'rejected');

-- Down:
-- ALTER TABLE emails
--   DROP COLUMN IF EXISTS generation_metadata,
--   DROP COLUMN IF EXISTS provider_draft_status,
--   DROP COLUMN IF EXISTS provider_draft_id,
--   DROP COLUMN IF EXISTS source_email_message_id,
--   DROP COLUMN IF EXISTS draft_target,
--   DROP COLUMN IF EXISTS draft_origin;
