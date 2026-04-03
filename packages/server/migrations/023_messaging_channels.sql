-- Multi-channel messaging: channel configs + delivery tracking

CREATE TABLE IF NOT EXISTS messaging_channels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  name        TEXT NOT NULL,
  provider    TEXT NOT NULL,
  config      JSONB NOT NULL DEFAULT '{}',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messaging_channels_tenant
  ON messaging_channels(tenant_id);

CREATE TABLE IF NOT EXISTS message_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  channel_id      UUID NOT NULL REFERENCES messaging_channels(id),
  recipient       TEXT,
  subject         TEXT,
  body            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  provider_msg_id TEXT,
  response_status INTEGER,
  response_body   TEXT,
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  next_retry_at   TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  error           TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_deliveries_channel
  ON message_deliveries(channel_id);

CREATE INDEX IF NOT EXISTS idx_message_deliveries_tenant_status
  ON message_deliveries(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_message_deliveries_retry
  ON message_deliveries(status, next_retry_at)
  WHERE status = 'retrying';
