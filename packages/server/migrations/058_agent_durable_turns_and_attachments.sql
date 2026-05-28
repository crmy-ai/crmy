-- Durable Workspace Agent turns and session attachments
-- Copyright 2026 CRMy Contributors
-- SPDX-License-Identifier: Apache-2.0

-- Up:

CREATE TABLE IF NOT EXISTS agent_turns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id      UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  input_message   TEXT NOT NULL,
  context_detail  TEXT,
  error_message   TEXT,
  final_label     TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_turns_one_active_per_session
  ON agent_turns(session_id)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_agent_turns_pending
  ON agent_turns(tenant_id, created_at)
  WHERE status = 'queued' OR status = 'running';

CREATE INDEX IF NOT EXISTS idx_agent_turns_session_time
  ON agent_turns(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_turn_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  turn_id       UUID NOT NULL REFERENCES agent_turns(id) ON DELETE CASCADE,
  event_index   INTEGER NOT NULL,
  event_type    TEXT NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(turn_id, event_index)
);

CREATE INDEX IF NOT EXISTS idx_agent_turn_events_turn_index
  ON agent_turn_events(turn_id, event_index);

CREATE TABLE IF NOT EXISTS agent_session_attachments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id            UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename              TEXT NOT NULL,
  format                TEXT,
  mode                  TEXT NOT NULL CHECK (mode IN ('active_context', 'raw_context')),
  status                TEXT NOT NULL DEFAULT 'ready'
                        CHECK (status IN ('ready', 'processing', 'processed', 'failed', 'consumed')),
  extracted_text        TEXT,
  text_excerpt          TEXT,
  truncated             BOOLEAN NOT NULL DEFAULT false,
  raw_context_result    JSONB,
  raw_context_source_id UUID REFERENCES raw_context_sources(id) ON DELETE SET NULL,
  consumed_turn_id      UUID REFERENCES agent_turns(id) ON DELETE SET NULL,
  consumed_at           TIMESTAMPTZ,
  error_message         TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_session_attachments_session
  ON agent_session_attachments(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_session_attachments_unconsumed
  ON agent_session_attachments(session_id, mode, status, created_at)
  WHERE consumed_at IS NULL;

-- Down:
DROP TABLE IF EXISTS agent_session_attachments;
DROP TABLE IF EXISTS agent_turn_events;
DROP TABLE IF EXISTS agent_turns;
