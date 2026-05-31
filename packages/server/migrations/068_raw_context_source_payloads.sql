-- Replayable Raw Context source payloads
-- Up:

CREATE TABLE IF NOT EXISTS raw_context_source_payloads (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  raw_context_source_id  UUID NOT NULL REFERENCES raw_context_sources(id) ON DELETE CASCADE,
  document_hash          TEXT NOT NULL,
  document_text          TEXT NOT NULL,
  source_label           TEXT,
  source_occurred_at     TIMESTAMPTZ,
  subjects               JSONB NOT NULL DEFAULT '[]',
  proposed_records       JSONB NOT NULL DEFAULT '[]',
  metadata               JSONB NOT NULL DEFAULT '{}',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, raw_context_source_id)
);

CREATE INDEX IF NOT EXISTS raw_context_source_payloads_hash_idx
  ON raw_context_source_payloads(tenant_id, document_hash, created_at DESC);

-- Down:
-- DROP INDEX IF EXISTS raw_context_source_payloads_hash_idx;
-- DROP TABLE IF EXISTS raw_context_source_payloads;
