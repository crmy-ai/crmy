-- Source processing ledger
-- Up:

CREATE TABLE IF NOT EXISTS raw_context_sources (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_type       TEXT NOT NULL,
  source_ref        TEXT NOT NULL,
  source_label      TEXT,
  subject_type      TEXT,
  subject_id        UUID,
  actor_id          UUID REFERENCES actors(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'processed', 'needs_review', 'failed', 'skipped')),
  stage             TEXT NOT NULL DEFAULT 'received',
  raw_excerpt       TEXT,
  detected_subjects JSONB NOT NULL DEFAULT '[]',
  signals_created   INTEGER NOT NULL DEFAULT 0,
  memory_created    INTEGER NOT NULL DEFAULT 0,
  skipped           INTEGER NOT NULL DEFAULT 0,
  failure_reason    TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}',
  processed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_type, source_ref)
);

CREATE INDEX IF NOT EXISTS raw_context_sources_tenant_created_idx
  ON raw_context_sources(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS raw_context_sources_status_idx
  ON raw_context_sources(tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS raw_context_sources_subject_idx
  ON raw_context_sources(tenant_id, subject_type, subject_id, created_at DESC)
  WHERE subject_type IS NOT NULL AND subject_id IS NOT NULL;

-- Down:
-- DROP TABLE IF EXISTS raw_context_sources;
