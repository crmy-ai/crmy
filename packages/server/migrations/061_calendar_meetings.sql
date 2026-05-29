-- Customer activity calendar capture and meeting classification
-- Up:

CREATE TABLE IF NOT EXISTS meeting_classification_registry (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type_name                  TEXT NOT NULL,
  label                      TEXT NOT NULL,
  description                TEXT,
  mapped_activity_type       TEXT NOT NULL DEFAULT 'meeting_held',
  matching_hints             TEXT[] NOT NULL DEFAULT '{}',
  is_customer_facing         BOOLEAN NOT NULL DEFAULT TRUE,
  required_record_types      TEXT[] NOT NULL DEFAULT '{}',
  required_artifact_types    TEXT[] NOT NULL DEFAULT '{}',
  auto_process_raw_context   BOOLEAN NOT NULL DEFAULT TRUE,
  is_default                 BOOLEAN NOT NULL DEFAULT FALSE,
  is_enabled                 BOOLEAN NOT NULL DEFAULT TRUE,
  display_order              INTEGER NOT NULL DEFAULT 100,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, type_name)
);

CREATE INDEX IF NOT EXISTS meeting_classification_registry_tenant_idx
  ON meeting_classification_registry(tenant_id, is_enabled, display_order);

INSERT INTO meeting_classification_registry (
  tenant_id, type_name, label, description, mapped_activity_type, matching_hints,
  is_customer_facing, required_record_types, required_artifact_types,
  auto_process_raw_context, is_default, display_order
)
SELECT t.id, v.type_name, v.label, v.description, v.mapped_activity_type, v.matching_hints,
       v.is_customer_facing, v.required_record_types, v.required_artifact_types,
       v.auto_process_raw_context, TRUE, v.display_order
FROM tenants t
CROSS JOIN (VALUES
  ('discovery', 'Discovery', 'Customer discovery or qualification conversation.', 'meeting_held', ARRAY['discovery','qualification','intro','requirements'], TRUE, ARRAY['account'], ARRAY['notes','transcript'], TRUE, 10),
  ('demo', 'Demo', 'Product demo or solution walkthrough.', 'demo', ARRAY['demo','walkthrough','product tour','solution review'], TRUE, ARRAY['account'], ARRAY['notes','transcript'], TRUE, 20),
  ('workshop', 'Workshop', 'Collaborative customer workshop or architecture session.', 'meeting_held', ARRAY['workshop','architecture','working session','design session'], TRUE, ARRAY['account'], ARRAY['notes','transcript'], TRUE, 30),
  ('status_update', 'Status Update', 'Regular customer status or implementation update.', 'status_update', ARRAY['status','sync','standup','check-in','implementation update'], TRUE, ARRAY['account'], ARRAY['notes'], TRUE, 40),
  ('qbr', 'QBR', 'Quarterly business review or executive business review.', 'meeting_held', ARRAY['qbr','ebr','business review','quarterly review'], TRUE, ARRAY['account'], ARRAY['notes','transcript'], TRUE, 50),
  ('handoff', 'Handoff', 'Internal or customer-facing handoff between teams.', 'handoff', ARRAY['handoff','transition','handover'], TRUE, ARRAY['account'], ARRAY['notes'], TRUE, 60),
  ('support_escalation', 'Support Escalation', 'Escalation meeting around support, risk, or incident resolution.', 'meeting_held', ARRAY['escalation','incident','support','sev','blocker'], TRUE, ARRAY['account'], ARRAY['notes','transcript'], TRUE, 70),
  ('internal', 'Internal', 'Internal-only meeting that should not become customer context by default.', 'meeting_held', ARRAY['internal','pipeline review','team sync','forecast'], FALSE, ARRAY[]::TEXT[], ARRAY[]::TEXT[], FALSE, 80),
  ('unknown', 'Unknown', 'Meeting type could not be classified confidently.', 'meeting_held', ARRAY[]::TEXT[], TRUE, ARRAY['account'], ARRAY['notes','transcript'], FALSE, 90)
) AS v(type_name, label, description, mapped_activity_type, matching_hints, is_customer_facing, required_record_types, required_artifact_types, auto_process_raw_context, display_order)
ON CONFLICT (tenant_id, type_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS calendar_connections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
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

CREATE INDEX IF NOT EXISTS calendar_connections_tenant_user_idx
  ON calendar_connections(tenant_id, user_id, status);

CREATE TABLE IF NOT EXISTS calendar_sync_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id   UUID REFERENCES calendar_connections(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS calendar_sync_jobs_ready_idx
  ON calendar_sync_jobs(tenant_id, status, run_after, created_at)
  WHERE status IN ('pending', 'failed');

CREATE TABLE IF NOT EXISTS calendar_events (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  calendar_connection_id    UUID REFERENCES calendar_connections(id) ON DELETE SET NULL,
  user_id                   UUID REFERENCES users(id) ON DELETE SET NULL,
  provider                  TEXT NOT NULL DEFAULT 'manual',
  provider_event_id         TEXT,
  i_cal_uid                 TEXT,
  title                     TEXT NOT NULL DEFAULT '(untitled meeting)',
  description               TEXT,
  organizer_email           TEXT,
  organizer_name            TEXT,
  attendee_emails           TEXT[] NOT NULL DEFAULT '{}',
  attendee_names            TEXT[] NOT NULL DEFAULT '{}',
  meeting_url               TEXT,
  location                  TEXT,
  starts_at                 TIMESTAMPTZ NOT NULL,
  ends_at                   TIMESTAMPTZ,
  status                    TEXT NOT NULL DEFAULT 'scheduled'
                            CHECK (status IN ('scheduled','held','cancelled','ignored')),
  classification            TEXT NOT NULL DEFAULT 'unknown',
  classification_confidence NUMERIC(4,3) NOT NULL DEFAULT 0.5,
  classification_reason     TEXT,
  validation_status         TEXT NOT NULL DEFAULT 'needs_review'
                            CHECK (validation_status IN ('ready','missing_context','needs_record_link','needs_review','skipped_internal','failed')),
  validation_blockers       TEXT[] NOT NULL DEFAULT '{}',
  processing_status         TEXT NOT NULL DEFAULT 'unprocessed'
                            CHECK (processing_status IN ('unprocessed','processing','processed','needs_review','skipped','failed','ignored')),
  processing_reason         TEXT,
  contact_id                UUID REFERENCES contacts(id) ON DELETE SET NULL,
  account_id                UUID REFERENCES accounts(id) ON DELETE SET NULL,
  opportunity_id            UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  use_case_id               UUID REFERENCES use_cases(id) ON DELETE SET NULL,
  activity_id               UUID REFERENCES activities(id) ON DELETE SET NULL,
  raw_context_source_id     UUID REFERENCES raw_context_sources(id) ON DELETE SET NULL,
  extraction_receipt        JSONB NOT NULL DEFAULT '{}',
  metadata                  JSONB NOT NULL DEFAULT '{}',
  ignored_at                TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_provider_event_unique
  ON calendar_events(tenant_id, calendar_connection_id, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS calendar_events_tenant_time_idx
  ON calendar_events(tenant_id, starts_at DESC);

CREATE INDEX IF NOT EXISTS calendar_events_records_idx
  ON calendar_events(tenant_id, account_id, contact_id, opportunity_id, use_case_id);

CREATE INDEX IF NOT EXISTS calendar_events_processing_idx
  ON calendar_events(tenant_id, validation_status, processing_status, starts_at DESC);

CREATE TABLE IF NOT EXISTS meeting_artifacts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  calendar_event_id     UUID REFERENCES calendar_events(id) ON DELETE CASCADE,
  activity_id           UUID REFERENCES activities(id) ON DELETE SET NULL,
  email_message_id      UUID REFERENCES email_messages(id) ON DELETE SET NULL,
  raw_context_source_id UUID REFERENCES raw_context_sources(id) ON DELETE SET NULL,
  artifact_type         TEXT NOT NULL DEFAULT 'notes'
                        CHECK (artifact_type IN ('transcript','notes','summary','recording','other')),
  source                TEXT NOT NULL DEFAULT 'manual',
  source_label          TEXT,
  text_content          TEXT,
  text_excerpt          TEXT,
  processing_status     TEXT NOT NULL DEFAULT 'unprocessed'
                        CHECK (processing_status IN ('unprocessed','processing','processed','needs_review','skipped','failed','ignored')),
  processing_reason     TEXT,
  extraction_receipt    JSONB NOT NULL DEFAULT '{}',
  metadata              JSONB NOT NULL DEFAULT '{}',
  created_by            UUID REFERENCES actors(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meeting_artifacts_event_idx
  ON meeting_artifacts(tenant_id, calendar_event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS meeting_artifacts_processing_idx
  ON meeting_artifacts(tenant_id, processing_status, created_at DESC);

-- Down:
-- DROP TABLE IF EXISTS meeting_artifacts;
-- DROP TABLE IF EXISTS calendar_events;
-- DROP TABLE IF EXISTS calendar_sync_jobs;
-- DROP TABLE IF EXISTS calendar_connections;
-- DROP TABLE IF EXISTS meeting_classification_registry;
