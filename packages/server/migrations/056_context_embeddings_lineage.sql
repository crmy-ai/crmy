-- Copyright 2026 CRMy Contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Durable embedding catch-up and lineage support.
-- Vector columns are added only when the vector extension is installed so
-- non-pgvector deployments continue to migrate and run in keyword/fallback mode.

-- Up:

CREATE TABLE IF NOT EXISTS context_embedding_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('context_entry', 'signal_group')),
  entity_id       UUID NOT NULL,
  text_hash       TEXT NOT NULL,
  provider        TEXT,
  model           TEXT,
  dimensions      INTEGER,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  locked_at       TIMESTAMPTZ,
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity_type, entity_id, text_hash)
);

CREATE INDEX IF NOT EXISTS context_embedding_jobs_claim_idx
  ON context_embedding_jobs(status, created_at)
  WHERE status IN ('pending', 'failed', 'processing');

CREATE INDEX IF NOT EXISTS context_embedding_jobs_entity_idx
  ON context_embedding_jobs(tenant_id, entity_type, entity_id, created_at DESC);

ALTER TABLE signal_groups
  ADD COLUMN IF NOT EXISTS merged_into_signal_group_id UUID REFERENCES signal_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ;

ALTER TABLE signal_groups DROP CONSTRAINT IF EXISTS signal_groups_status_check;
ALTER TABLE signal_groups
  ADD CONSTRAINT signal_groups_status_check
  CHECK (status IN ('gathering', 'ready', 'promoted', 'blocked', 'dismissed', 'conflicting', 'merged'));

CREATE INDEX IF NOT EXISTS signal_groups_merged_into_idx
  ON signal_groups(tenant_id, merged_into_signal_group_id)
  WHERE merged_into_signal_group_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE 'ALTER TABLE signal_groups ADD COLUMN IF NOT EXISTS embedding vector(${EMBEDDING_DIMENSIONS})';
    EXECUTE 'CREATE INDEX IF NOT EXISTS signal_groups_embedding_hnsw
      ON signal_groups
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
      WHERE embedding IS NOT NULL';
  END IF;
END $$;

-- Down:
-- DROP INDEX IF EXISTS signal_groups_embedding_hnsw;
-- ALTER TABLE signal_groups DROP COLUMN IF EXISTS embedding;
-- DROP INDEX IF EXISTS signal_groups_merged_into_idx;
-- ALTER TABLE signal_groups DROP COLUMN IF EXISTS merged_at;
-- ALTER TABLE signal_groups DROP COLUMN IF EXISTS merged_into_signal_group_id;
-- DROP INDEX IF EXISTS context_embedding_jobs_entity_idx;
-- DROP INDEX IF EXISTS context_embedding_jobs_claim_idx;
-- DROP TABLE IF EXISTS context_embedding_jobs;
