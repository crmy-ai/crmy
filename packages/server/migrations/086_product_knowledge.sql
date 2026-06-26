-- Governed Product Knowledge Retrieval: claim envelopes + retrieval receipts.
-- Product knowledge is a governed sibling namespace to customer Memory. Claims
-- are source-derived envelopes (provenance, grounding, freshness, approval,
-- visibility, conflict). Retrieval receipts are durable proof of what an agent
-- retrieved and why claims were excluded. See
-- docs/governed-product-knowledge-retrieval.md.
-- Up:

CREATE TABLE IF NOT EXISTS knowledge_claims (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category                   TEXT NOT NULL,
  title                      TEXT NOT NULL,
  body                       TEXT NOT NULL,
  summary                    TEXT,

  -- Structured scope for deterministic filtering.
  product_scope              TEXT[] NOT NULL DEFAULT '{}',
  competitors                TEXT[] NOT NULL DEFAULT '{}',
  personas                   TEXT[] NOT NULL DEFAULT '{}',
  industries                 TEXT[] NOT NULL DEFAULT '{}',

  -- Provenance + grounding (external-safe requires grounding in the cited source).
  source_ref                 TEXT,
  source_url                 TEXT,
  source_label               TEXT,
  source_version             TEXT,
  grounded                   BOOLEAN NOT NULL DEFAULT false,
  confidence                 REAL,
  source_priority            TEXT NOT NULL DEFAULT 'secondary'
                             CHECK (source_priority IN ('authoritative', 'secondary', 'informal')),

  -- Governance.
  approval_status            TEXT NOT NULL DEFAULT 'pending'
                             CHECK (approval_status IN ('approved', 'pending', 'unapproved', 'rejected')),
  approved_for_external_use  BOOLEAN NOT NULL DEFAULT false,
  visibility                 TEXT NOT NULL DEFAULT 'internal'
                             CHECK (visibility IN ('external', 'internal')),
  status                     TEXT NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'stale', 'deprecated', 'conflicting', 'rejected')),

  -- Freshness.
  effective_at               TIMESTAMPTZ,
  valid_until                TIMESTAMPTZ,
  last_verified_at           TIMESTAMPTZ,
  review_owner_id            UUID REFERENCES actors(id) ON DELETE SET NULL,

  -- Dedupe key for source-driven upserts (NULL allowed; NULLs are distinct).
  external_key               TEXT,
  metadata                   JSONB NOT NULL DEFAULT '{}',

  search_vector              tsvector GENERATED ALWAYS AS (
                               setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                               setweight(to_tsvector('english', coalesce(body, '')), 'B') ||
                               setweight(to_tsvector('english', coalesce(summary, '')), 'C')
                             ) STORED,

  created_by                 UUID REFERENCES actors(id) ON DELETE SET NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_key)
);

CREATE INDEX IF NOT EXISTS knowledge_claims_tenant_idx
  ON knowledge_claims(tenant_id, status, approval_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS knowledge_claims_fts
  ON knowledge_claims USING GIN (search_vector);

CREATE TABLE IF NOT EXISTS knowledge_retrieval_receipts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id            TEXT,
  query               TEXT NOT NULL,
  audience            TEXT NOT NULL,
  policy              TEXT NOT NULL,
  filters             JSONB NOT NULL DEFAULT '{}',
  returned_claim_ids  UUID[] NOT NULL DEFAULT '{}',
  excluded            JSONB NOT NULL DEFAULT '[]',
  warnings            JSONB NOT NULL DEFAULT '[]',
  subject_type        TEXT,
  subject_id          UUID,
  proposed_action     TEXT,
  retrieved_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_receipts_tenant_idx
  ON knowledge_retrieval_receipts(tenant_id, retrieved_at DESC);

-- Down:
-- DROP TABLE IF EXISTS knowledge_retrieval_receipts;
-- DROP TABLE IF EXISTS knowledge_claims;
