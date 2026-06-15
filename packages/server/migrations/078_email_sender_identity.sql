-- Up: Make mailbox context and outbound sender identity explicit.

ALTER TABLE mailbox_connections
  ADD COLUMN IF NOT EXISTS context_sync_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS send_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS provider_draft_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS send_status TEXT NOT NULL DEFAULT 'not_authorized'
    CHECK (send_status IN ('not_authorized', 'ready', 'disabled', 'error')),
  ADD COLUMN IF NOT EXISTS send_last_error TEXT,
  ADD COLUMN IF NOT EXISTS is_default_sender BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS from_email TEXT,
  ADD COLUMN IF NOT EXISTS from_name TEXT,
  ADD COLUMN IF NOT EXISTS sender_type TEXT NOT NULL DEFAULT 'tenant_provider'
    CHECK (sender_type IN ('actor_mailbox', 'tenant_provider', 'unknown')),
  ADD COLUMN IF NOT EXISTS mailbox_connection_id UUID REFERENCES mailbox_connections(id) ON DELETE SET NULL;

ALTER TABLE email_messages
  ADD COLUMN IF NOT EXISTS reply_to_email_message_id UUID REFERENCES email_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conversation_root_email_message_id UUID REFERENCES email_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS mailbox_connections_default_sender_idx
  ON mailbox_connections(tenant_id, user_id, is_default_sender)
  WHERE is_default_sender = true;

CREATE INDEX IF NOT EXISTS mailbox_connections_send_ready_idx
  ON mailbox_connections(tenant_id, user_id, send_enabled, send_status)
  WHERE send_enabled = true;

CREATE INDEX IF NOT EXISTS emails_sender_mailbox_idx
  ON emails(tenant_id, mailbox_connection_id)
  WHERE mailbox_connection_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_messages_thread_lookup_idx
  ON email_messages(tenant_id, mailbox_connection_id, thread_id)
  WHERE thread_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_messages_reply_link_idx
  ON email_messages(tenant_id, reply_to_email_message_id)
  WHERE reply_to_email_message_id IS NOT NULL;

-- Backfill stored sender identity for existing governed emails from the tenant fallback provider.
UPDATE emails e
SET
  from_email = COALESCE(e.from_email, p.from_email),
  from_name = COALESCE(e.from_name, p.from_name),
  sender_type = COALESCE(e.sender_type, 'tenant_provider')
FROM email_providers p
WHERE e.tenant_id = p.tenant_id
  AND e.from_email IS NULL;

-- Down:
-- DROP INDEX IF EXISTS email_messages_reply_link_idx;
-- DROP INDEX IF EXISTS email_messages_thread_lookup_idx;
-- DROP INDEX IF EXISTS emails_sender_mailbox_idx;
-- DROP INDEX IF EXISTS mailbox_connections_send_ready_idx;
-- DROP INDEX IF EXISTS mailbox_connections_default_sender_idx;
-- ALTER TABLE email_messages
--   DROP COLUMN IF EXISTS conversation_root_email_message_id,
--   DROP COLUMN IF EXISTS reply_to_email_message_id;
-- ALTER TABLE emails
--   DROP COLUMN IF EXISTS mailbox_connection_id,
--   DROP COLUMN IF EXISTS sender_type,
--   DROP COLUMN IF EXISTS from_name,
--   DROP COLUMN IF EXISTS from_email;
-- ALTER TABLE mailbox_connections
--   DROP COLUMN IF EXISTS is_default_sender,
--   DROP COLUMN IF EXISTS send_last_error,
--   DROP COLUMN IF EXISTS send_status,
--   DROP COLUMN IF EXISTS provider_draft_enabled,
--   DROP COLUMN IF EXISTS send_enabled,
--   DROP COLUMN IF EXISTS context_sync_enabled;
