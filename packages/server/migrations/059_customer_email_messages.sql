-- Customer email message ledger and mailbox connection scaffolding
-- Up:

CREATE TABLE IF NOT EXISTS mailbox_connections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL CHECK (provider IN ('google', 'microsoft', 'webhook')),
  email_address  TEXT NOT NULL,
  display_name   TEXT,
  status         TEXT NOT NULL DEFAULT 'configuration_required'
                 CHECK (status IN ('configuration_required', 'connected', 'syncing', 'error', 'disconnected')),
  scopes         TEXT[] NOT NULL DEFAULT '{}',
  sync_cursor    TEXT,
  settings       JSONB NOT NULL DEFAULT '{}',
  last_sync_at   TIMESTAMPTZ,
  last_error     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, provider, email_address)
);

CREATE INDEX IF NOT EXISTS mailbox_connections_tenant_user_idx
  ON mailbox_connections(tenant_id, user_id, status);

CREATE TABLE IF NOT EXISTS mailbox_sync_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id   UUID REFERENCES mailbox_connections(id) ON DELETE CASCADE,
  job_type        TEXT NOT NULL DEFAULT 'sync',
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  run_after       TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at       TIMESTAMPTZ,
  last_error      TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mailbox_sync_jobs_ready_idx
  ON mailbox_sync_jobs(tenant_id, status, run_after, created_at)
  WHERE status IN ('pending', 'failed');

CREATE TABLE IF NOT EXISTS email_messages (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mailbox_connection_id UUID REFERENCES mailbox_connections(id) ON DELETE SET NULL,
  user_id               UUID REFERENCES users(id) ON DELETE SET NULL,
  direction             TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  source                TEXT NOT NULL DEFAULT 'manual',
  provider_message_id   TEXT,
  message_id            TEXT,
  thread_id             TEXT,
  in_reply_to           TEXT,
  references_header     TEXT[] NOT NULL DEFAULT '{}',
  from_email            TEXT NOT NULL,
  from_name             TEXT,
  to_emails             TEXT[] NOT NULL DEFAULT '{}',
  cc_emails             TEXT[] NOT NULL DEFAULT '{}',
  subject               TEXT NOT NULL DEFAULT '(no subject)',
  body_text             TEXT,
  body_html             TEXT,
  snippet               TEXT,
  classification        TEXT NOT NULL DEFAULT 'unknown'
                        CHECK (classification IN ('customer', 'mixed', 'internal', 'automated', 'unknown')),
  processing_status     TEXT NOT NULL DEFAULT 'unprocessed'
                        CHECK (processing_status IN ('unprocessed', 'processing', 'processed', 'needs_review', 'skipped', 'failed', 'ignored')),
  processing_reason     TEXT,
  contact_id            UUID REFERENCES contacts(id) ON DELETE SET NULL,
  account_id            UUID REFERENCES accounts(id) ON DELETE SET NULL,
  opportunity_id        UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  use_case_id           UUID REFERENCES use_cases(id) ON DELETE SET NULL,
  activity_id           UUID REFERENCES activities(id) ON DELETE SET NULL,
  raw_context_source_id UUID REFERENCES raw_context_sources(id) ON DELETE SET NULL,
  email_id              UUID REFERENCES emails(id) ON DELETE SET NULL,
  extraction_receipt    JSONB NOT NULL DEFAULT '{}',
  metadata              JSONB NOT NULL DEFAULT '{}',
  received_at           TIMESTAMPTZ,
  sent_at               TIMESTAMPTZ,
  ignored_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS email_messages_provider_msg_unique
  ON email_messages(tenant_id, mailbox_connection_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS email_messages_message_id_unique
  ON email_messages(tenant_id, source, message_id)
  WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_messages_tenant_created_idx
  ON email_messages(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS email_messages_processing_idx
  ON email_messages(tenant_id, processing_status, classification, created_at DESC);

CREATE INDEX IF NOT EXISTS email_messages_records_idx
  ON email_messages(tenant_id, account_id, contact_id, opportunity_id, use_case_id);

ALTER TABLE email_providers
  ADD COLUMN IF NOT EXISTS internal_domains TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS excluded_domains TEXT[] NOT NULL DEFAULT '{}';

-- Down:
-- ALTER TABLE email_providers DROP COLUMN IF EXISTS excluded_domains, DROP COLUMN IF EXISTS internal_domains;
-- DROP TABLE IF EXISTS email_messages;
-- DROP TABLE IF EXISTS mailbox_sync_jobs;
-- DROP TABLE IF EXISTS mailbox_connections;
