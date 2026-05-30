-- Email and activity source filtering plus OAuth token/cursor persistence

CREATE TABLE IF NOT EXISTS source_filter_settings (
  tenant_id                 UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  internal_domains          TEXT[] NOT NULL DEFAULT '{}',
  excluded_domains          TEXT[] NOT NULL DEFAULT '{}',
  excluded_senders          TEXT[] NOT NULL DEFAULT '{}',
  excluded_local_parts      TEXT[] NOT NULL DEFAULT ARRAY[
    'no-reply',
    'noreply',
    'donotreply',
    'do-not-reply',
    'notifications',
    'notification',
    'mailer-daemon',
    'postmaster'
  ],
  included_mailbox_labels   TEXT[] NOT NULL DEFAULT '{}',
  excluded_mailbox_labels   TEXT[] NOT NULL DEFAULT '{}',
  skip_spam_trash           BOOLEAN NOT NULL DEFAULT TRUE,
  skip_promotions           BOOLEAN NOT NULL DEFAULT TRUE,
  skip_newsletters          BOOLEAN NOT NULL DEFAULT TRUE,
  include_internal_calendar BOOLEAN NOT NULL DEFAULT FALSE,
  email_initial_backfill_days INTEGER NOT NULL DEFAULT 30,
  calendar_initial_past_days  INTEGER NOT NULL DEFAULT 45,
  calendar_initial_future_days INTEGER NOT NULL DEFAULT 30,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE mailbox_connections
  ADD COLUMN IF NOT EXISTS provider_account_id TEXT,
  ADD COLUMN IF NOT EXISTS access_token_enc TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token_enc TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sync_stats JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE calendar_connections
  ADD COLUMN IF NOT EXISTS provider_account_id TEXT,
  ADD COLUMN IF NOT EXISTS access_token_enc TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token_enc TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sync_stats JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS source_filter_settings_updated_idx
  ON source_filter_settings(updated_at DESC);

CREATE INDEX IF NOT EXISTS mailbox_connections_provider_account_idx
  ON mailbox_connections(tenant_id, provider, provider_account_id)
  WHERE provider_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS calendar_connections_provider_account_idx
  ON calendar_connections(tenant_id, provider, provider_account_id)
  WHERE provider_account_id IS NOT NULL;
