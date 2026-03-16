-- SPDX-License-Identifier: Apache-2.0
-- Up: Context Engine v2 — registries, enhanced context_entries, governor limits

-- ============================================================
-- activity_type_registry — discoverable activity types
-- ============================================================
CREATE TABLE activity_type_registry (
  type_name    TEXT PRIMARY KEY,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  description  TEXT,
  category     TEXT NOT NULL CHECK (category IN (
                   'outreach', 'meeting', 'proposal', 'contract',
                   'internal', 'lifecycle', 'handoff'
               )),
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_activity_type_registry_tenant ON activity_type_registry(tenant_id);
CREATE INDEX idx_activity_type_registry_category ON activity_type_registry(category);

-- ============================================================
-- context_type_registry — discoverable context types
-- ============================================================
CREATE TABLE context_type_registry (
  type_name    TEXT PRIMARY KEY,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  description  TEXT,
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_context_type_registry_tenant ON context_type_registry(tenant_id);

-- ============================================================
-- Enhance context_entries with tags, source_activity_id,
-- valid_until, reviewed_at, and full-text search
-- ============================================================

-- Tags — JSONB array of strings for cross-cutting queries
ALTER TABLE context_entries ADD COLUMN tags JSONB NOT NULL DEFAULT '[]';

-- Activity provenance — link context back to the activity that produced it
ALTER TABLE context_entries ADD COLUMN source_activity_id UUID REFERENCES activities(id);

-- Staleness tracking
ALTER TABLE context_entries ADD COLUMN valid_until TIMESTAMPTZ;

-- Review tracking
ALTER TABLE context_entries ADD COLUMN reviewed_at TIMESTAMPTZ;

-- Full-text search vector (generated column)
ALTER TABLE context_entries ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', body), 'B')
  ) STORED;

-- Body length constraint
ALTER TABLE context_entries ADD CONSTRAINT chk_context_body_length CHECK (length(body) <= 50000);

-- New indexes for enhanced queries
CREATE INDEX idx_context_tags ON context_entries USING GIN (tags);
CREATE INDEX idx_context_fts ON context_entries USING GIN (search_vector);
CREATE INDEX idx_context_staleness ON context_entries(valid_until)
  WHERE valid_until IS NOT NULL AND is_current = TRUE;
CREATE INDEX idx_context_source_activity ON context_entries(source_activity_id)
  WHERE source_activity_id IS NOT NULL;

-- ============================================================
-- Enhance activities with activity_type column
-- The existing `type` column uses enum ('call','email','meeting','note','task').
-- Add a new `activity_type` column that references the registry (flexible text).
-- ============================================================
ALTER TABLE activities ADD COLUMN activity_type TEXT;

-- Backfill activity_type from existing type column
UPDATE activities SET activity_type = type WHERE activity_type IS NULL;

CREATE INDEX idx_activities_activity_type ON activities(activity_type, occurred_at DESC)
  WHERE activity_type IS NOT NULL;

-- ============================================================
-- Governor limits table
-- ============================================================
CREATE TABLE governor_limits (
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  limit_name  TEXT NOT NULL,
  limit_value INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, limit_name)
);

-- Down:
-- DROP TABLE governor_limits;
-- ALTER TABLE activities DROP COLUMN activity_type;
-- ALTER TABLE context_entries DROP CONSTRAINT chk_context_body_length;
-- ALTER TABLE context_entries DROP COLUMN search_vector;
-- ALTER TABLE context_entries DROP COLUMN reviewed_at;
-- ALTER TABLE context_entries DROP COLUMN valid_until;
-- ALTER TABLE context_entries DROP COLUMN source_activity_id;
-- ALTER TABLE context_entries DROP COLUMN tags;
-- DROP TABLE context_type_registry;
-- DROP TABLE activity_type_registry;
