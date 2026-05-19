-- Up: Enterprise systems-of-record overlay

CREATE TABLE external_systems (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  system_type           TEXT NOT NULL CHECK (system_type IN ('hubspot', 'salesforce', 'databricks', 'snowflake')),
  auth_type             TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'disconnected'
                          CHECK (status IN ('disconnected', 'connected', 'error', 'paused')),
  encrypted_credentials JSONB,
  config                JSONB NOT NULL DEFAULT '{}',
  sync_settings         JSONB NOT NULL DEFAULT '{}',
  health                JSONB NOT NULL DEFAULT '{}',
  last_sync_at          TIMESTAMPTZ,
  last_error            TEXT,
  created_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX external_systems_tenant_idx ON external_systems(tenant_id, system_type);
CREATE INDEX external_systems_status_idx ON external_systems(tenant_id, status);

CREATE TABLE external_object_mappings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  system_id             UUID NOT NULL REFERENCES external_systems(id) ON DELETE CASCADE,
  object_type           TEXT NOT NULL CHECK (object_type IN ('contact', 'account', 'opportunity', 'activity', 'use_case', 'context_entry')),
  external_object       TEXT NOT NULL,
  external_id_field     TEXT NOT NULL DEFAULT 'id',
  watermark_field       TEXT,
  field_mapping         JSONB NOT NULL DEFAULT '{}',
  readable_fields       TEXT[] NOT NULL DEFAULT '{}',
  writable_fields       TEXT[] NOT NULL DEFAULT '{}',
  source_authority      TEXT NOT NULL DEFAULT 'external'
                          CHECK (source_authority IN ('crmy', 'external', 'bidirectional', 'read_only', 'approval_required')),
  writeback_mode        TEXT CHECK (writeback_mode IN ('append_event', 'mapped_upsert', 'stored_procedure')),
  writeback_config      JSONB NOT NULL DEFAULT '{}',
  allow_source_loop     BOOLEAN NOT NULL DEFAULT false,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, system_id, object_type, external_object)
);

CREATE INDEX external_mappings_tenant_idx ON external_object_mappings(tenant_id, system_id);
CREATE INDEX external_mappings_object_idx ON external_object_mappings(tenant_id, object_type);

CREATE TABLE external_record_refs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  system_id             UUID NOT NULL REFERENCES external_systems(id) ON DELETE CASCADE,
  mapping_id            UUID REFERENCES external_object_mappings(id) ON DELETE SET NULL,
  object_type           TEXT NOT NULL,
  object_id             UUID NOT NULL,
  external_object       TEXT NOT NULL,
  external_record_id    TEXT NOT NULL,
  external_updated_at   TIMESTAMPTZ,
  source_hash           TEXT,
  last_sync_run_id      UUID,
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata              JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, system_id, external_object, external_record_id),
  UNIQUE (tenant_id, system_id, object_type, object_id, external_object)
);

CREATE INDEX external_refs_object_idx ON external_record_refs(tenant_id, object_type, object_id);
CREATE INDEX external_refs_system_idx ON external_record_refs(tenant_id, system_id, external_object);

CREATE TABLE external_sync_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  system_id             UUID NOT NULL REFERENCES external_systems(id) ON DELETE CASCADE,
  mapping_id            UUID REFERENCES external_object_mappings(id) ON DELETE SET NULL,
  mode                  TEXT NOT NULL DEFAULT 'incremental'
                          CHECK (mode IN ('test', 'full', 'incremental', 'replay', 'writeback')),
  status                TEXT NOT NULL DEFAULT 'running'
                          CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  cursor_value          TEXT,
  watermark_value       TEXT,
  records_seen          INT NOT NULL DEFAULT 0,
  records_created       INT NOT NULL DEFAULT 0,
  records_updated       INT NOT NULL DEFAULT 0,
  records_skipped       INT NOT NULL DEFAULT 0,
  conflicts_created     INT NOT NULL DEFAULT 0,
  error                 TEXT,
  replay_of_run_id      UUID REFERENCES external_sync_runs(id) ON DELETE SET NULL,
  metadata              JSONB NOT NULL DEFAULT '{}',
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ
);

CREATE INDEX external_sync_runs_system_idx ON external_sync_runs(tenant_id, system_id, started_at DESC);
CREATE INDEX external_sync_runs_status_idx ON external_sync_runs(tenant_id, status);

CREATE TABLE external_sync_conflicts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  system_id             UUID NOT NULL REFERENCES external_systems(id) ON DELETE CASCADE,
  mapping_id            UUID REFERENCES external_object_mappings(id) ON DELETE SET NULL,
  sync_run_id           UUID REFERENCES external_sync_runs(id) ON DELETE SET NULL,
  object_type           TEXT NOT NULL,
  object_id             UUID,
  external_object       TEXT NOT NULL,
  external_record_id    TEXT NOT NULL,
  field_name            TEXT NOT NULL,
  local_value           JSONB,
  external_value        JSONB,
  status                TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'resolved_local', 'resolved_external', 'ignored')),
  resolution_note       TEXT,
  resolved_by           TEXT,
  resolved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX external_conflicts_system_idx ON external_sync_conflicts(tenant_id, system_id, status);
CREATE INDEX external_conflicts_object_idx ON external_sync_conflicts(tenant_id, object_type, object_id);

CREATE TABLE external_writeback_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  system_id             UUID NOT NULL REFERENCES external_systems(id) ON DELETE CASCADE,
  mapping_id            UUID REFERENCES external_object_mappings(id) ON DELETE SET NULL,
  object_type           TEXT NOT NULL,
  object_id             UUID,
  external_object       TEXT NOT NULL,
  external_record_id    TEXT,
  operation             TEXT NOT NULL CHECK (operation IN ('create', 'update', 'upsert', 'append_event', 'stored_procedure')),
  writeback_mode        TEXT NOT NULL CHECK (writeback_mode IN ('append_event', 'mapped_upsert', 'stored_procedure')),
  preview               JSONB NOT NULL DEFAULT '{}',
  payload               JSONB NOT NULL DEFAULT '{}',
  policy_result         JSONB NOT NULL DEFAULT '{}',
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'approval_required', 'approved', 'executing', 'completed', 'failed', 'rejected', 'cancelled')),
  hitl_request_id       UUID REFERENCES hitl_requests(id) ON DELETE SET NULL,
  idempotency_key       TEXT,
  execution_result      JSONB NOT NULL DEFAULT '{}',
  requested_by          TEXT,
  executed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, system_id, idempotency_key)
);

CREATE INDEX external_writebacks_system_idx ON external_writeback_requests(tenant_id, system_id, status);
CREATE INDEX external_writebacks_object_idx ON external_writeback_requests(tenant_id, object_type, object_id);

-- Down:
-- DROP TABLE external_writeback_requests;
-- DROP TABLE external_sync_conflicts;
-- DROP TABLE external_sync_runs;
-- DROP TABLE external_record_refs;
-- DROP TABLE external_object_mappings;
-- DROP TABLE external_systems;
