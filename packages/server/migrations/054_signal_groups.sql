-- Signal Groups: evidence-backed claim clusters for inferred context
-- Up:

CREATE TABLE IF NOT EXISTS signal_groups (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_type               TEXT NOT NULL,
  subject_id                 UUID NOT NULL,
  context_type               TEXT NOT NULL,
  claim_key                  TEXT NOT NULL,
  title                      TEXT,
  normalized_claim           TEXT NOT NULL,
  status                     TEXT NOT NULL DEFAULT 'gathering'
                             CHECK (status IN ('gathering', 'ready', 'promoted', 'blocked', 'dismissed', 'conflicting')),
  aggregate_confidence       DOUBLE PRECISION NOT NULL DEFAULT 0,
  support_count              INTEGER NOT NULL DEFAULT 0,
  independent_source_count   INTEGER NOT NULL DEFAULT 0,
  conflict_count             INTEGER NOT NULL DEFAULT 0,
  evidence_count             INTEGER NOT NULL DEFAULT 0,
  latest_signal_id           UUID REFERENCES context_entries(id) ON DELETE SET NULL,
  promoted_context_entry_id  UUID REFERENCES context_entries(id) ON DELETE SET NULL,
  blocked_reason             TEXT,
  metadata                   JSONB NOT NULL DEFAULT '{}',
  dismissed_at               TIMESTAMPTZ,
  dismissed_by               UUID REFERENCES actors(id) ON DELETE SET NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, subject_type, subject_id, context_type, claim_key)
);

CREATE TABLE IF NOT EXISTS signal_group_members (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  signal_group_id   UUID NOT NULL REFERENCES signal_groups(id) ON DELETE CASCADE,
  context_entry_id  UUID NOT NULL REFERENCES context_entries(id) ON DELETE CASCADE,
  relation          TEXT NOT NULL DEFAULT 'supports'
                    CHECK (relation IN ('supports', 'conflicts', 'supersedes')),
  similarity_score  DOUBLE PRECISION NOT NULL DEFAULT 0,
  evidence_weight   DOUBLE PRECISION NOT NULL DEFAULT 1,
  source_key        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, signal_group_id, context_entry_id)
);

CREATE INDEX IF NOT EXISTS signal_groups_tenant_status_idx
  ON signal_groups(tenant_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS signal_groups_subject_idx
  ON signal_groups(tenant_id, subject_type, subject_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS signal_group_members_group_idx
  ON signal_group_members(tenant_id, signal_group_id, created_at DESC);

CREATE INDEX IF NOT EXISTS signal_group_members_entry_idx
  ON signal_group_members(tenant_id, context_entry_id);

-- Down:
-- DROP INDEX IF EXISTS signal_group_members_entry_idx;
-- DROP INDEX IF EXISTS signal_group_members_group_idx;
-- DROP INDEX IF EXISTS signal_groups_subject_idx;
-- DROP INDEX IF EXISTS signal_groups_tenant_status_idx;
-- DROP TABLE IF EXISTS signal_group_members;
-- DROP TABLE IF EXISTS signal_groups;
