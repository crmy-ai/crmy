-- Context source drop schema repair for pre-0.9.4 local/dev installs
-- Up:

CREATE TABLE IF NOT EXISTS context_source_connections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  provider            TEXT NOT NULL CHECK (provider IN ('s3', 'local_folder')),
  status              TEXT NOT NULL DEFAULT 'configured'
                      CHECK (status IN ('configured', 'syncing', 'error', 'disabled')),
  config              JSONB NOT NULL DEFAULT '{}',
  credentials_enc     JSONB,
  sync_cursor          TEXT,
  sync_stats           JSONB NOT NULL DEFAULT '{}',
  last_sync_at         TIMESTAMPTZ,
  last_error           TEXT,
  created_by           UUID REFERENCES actors(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS context_source_connections_tenant_status_idx
  ON context_source_connections(tenant_id, provider, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS context_source_sync_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id   UUID REFERENCES context_source_connections(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS context_source_sync_jobs_ready_idx
  ON context_source_sync_jobs(tenant_id, status, run_after, created_at)
  WHERE status IN ('pending', 'failed');

CREATE TABLE IF NOT EXISTS context_source_objects (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id         UUID REFERENCES context_source_connections(id) ON DELETE CASCADE,
  object_key            TEXT NOT NULL,
  object_version        TEXT,
  content_hash          TEXT NOT NULL,
  size_bytes            BIGINT NOT NULL DEFAULT 0,
  modified_at           TIMESTAMPTZ,
  source_label          TEXT,
  artifact_type         TEXT NOT NULL DEFAULT 'transcript'
                        CHECK (artifact_type IN ('transcript', 'notes', 'summary', 'recording', 'other')),
  match_status          TEXT NOT NULL DEFAULT 'unmatched'
                        CHECK (match_status IN ('unmatched', 'matched', 'ambiguous', 'needs_review', 'ignored')),
  processing_status     TEXT NOT NULL DEFAULT 'discovered'
                        CHECK (processing_status IN ('discovered', 'queued', 'processing', 'processed', 'needs_review', 'failed', 'ignored')),
  match_reason          TEXT,
  candidates            JSONB NOT NULL DEFAULT '[]',
  sidecar_metadata      JSONB NOT NULL DEFAULT '{}',
  text_excerpt          TEXT,
  contact_id            UUID REFERENCES contacts(id) ON DELETE SET NULL,
  account_id            UUID REFERENCES accounts(id) ON DELETE SET NULL,
  opportunity_id        UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  use_case_id           UUID REFERENCES use_cases(id) ON DELETE SET NULL,
  calendar_event_id     UUID REFERENCES calendar_events(id) ON DELETE SET NULL,
  activity_id           UUID REFERENCES activities(id) ON DELETE SET NULL,
  meeting_artifact_id   UUID REFERENCES meeting_artifacts(id) ON DELETE SET NULL,
  raw_context_source_id UUID REFERENCES raw_context_sources(id) ON DELETE SET NULL,
  hitl_request_id       UUID REFERENCES hitl_requests(id) ON DELETE SET NULL,
  failure_code          TEXT,
  failure_reason        TEXT,
  extraction_receipt    JSONB NOT NULL DEFAULT '{}',
  metadata              JSONB NOT NULL DEFAULT '{}',
  ignored_at            TIMESTAMPTZ,
  processed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, connection_id, object_key, content_hash)
);

ALTER TABLE context_source_objects
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS use_case_id UUID REFERENCES use_cases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS calendar_event_id UUID REFERENCES calendar_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS meeting_artifact_id UUID REFERENCES meeting_artifacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS raw_context_source_id UUID REFERENCES raw_context_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hitl_request_id UUID REFERENCES hitl_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS failure_code TEXT,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS extraction_receipt JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ignored_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS context_source_objects_connection_idx
  ON context_source_objects(tenant_id, connection_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS context_source_objects_status_idx
  ON context_source_objects(tenant_id, match_status, processing_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS context_source_objects_records_v2_idx
  ON context_source_objects(tenant_id, account_id, contact_id, opportunity_id, use_case_id, calendar_event_id, activity_id, raw_context_source_id);

CREATE INDEX IF NOT EXISTS context_source_objects_hash_idx
  ON context_source_objects(tenant_id, content_hash, updated_at DESC);

CREATE TABLE IF NOT EXISTS context_source_processing_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_object_id UUID REFERENCES context_source_objects(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  run_after        TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at        TIMESTAMPTZ,
  last_error       TEXT,
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS context_source_processing_jobs_ready_idx
  ON context_source_processing_jobs(tenant_id, status, run_after, created_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS context_source_processing_jobs_object_idx
  ON context_source_processing_jobs(tenant_id, source_object_id, created_at DESC);

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id, connection_id, job_type
           ORDER BY
             CASE status WHEN 'processing' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
             created_at DESC
         ) AS rn
  FROM context_source_sync_jobs
  WHERE status IN ('pending', 'processing', 'failed')
)
DELETE FROM context_source_sync_jobs j
USING ranked r
WHERE j.id = r.id
  AND r.rn > 1;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id, source_object_id
           ORDER BY
             CASE status WHEN 'processing' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
             created_at DESC
         ) AS rn
  FROM context_source_processing_jobs
  WHERE status IN ('pending', 'processing', 'failed')
)
DELETE FROM context_source_processing_jobs j
USING ranked r
WHERE j.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS context_source_sync_jobs_active_unique_idx
  ON context_source_sync_jobs(tenant_id, connection_id, job_type)
  WHERE status IN ('pending', 'processing', 'failed');

CREATE UNIQUE INDEX IF NOT EXISTS context_source_processing_jobs_active_unique_idx
  ON context_source_processing_jobs(tenant_id, source_object_id)
  WHERE status IN ('pending', 'processing', 'failed');

-- Down:
-- DROP INDEX IF EXISTS context_source_objects_records_v2_idx;
