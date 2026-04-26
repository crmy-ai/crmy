-- Copyright 2026 CRMy Contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Performance indexes for the context/memory system.
--
-- The primary briefing query path is:
--   SELECT * FROM context_entries
--   WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3
--     AND is_current = true
--   ORDER BY created_at DESC;
--
-- The existing idx_context_subject covers (subject_type, subject_id, is_current,
-- created_at DESC) but omits tenant_id, forcing a post-filter scan on large
-- multi-tenant deployments.  This migration adds a tenant-scoped covering index
-- that will be chosen by the planner in all single-tenant lookups.

-- Primary briefing lookup: tenant + subject + currency + time order
CREATE INDEX IF NOT EXISTS idx_context_subject_tenant
  ON context_entries(tenant_id, subject_type, subject_id, is_current, created_at DESC);

-- Semantic search base filter: tenant + is_current (pre-filter before vector scan)
CREATE INDEX IF NOT EXISTS idx_context_tenant_current
  ON context_entries(tenant_id, is_current)
  WHERE is_current = TRUE;

-- Full-text search support: tenant-scoped GIN on the tsvector column
-- (Only created if the column exists — depends on migration 013 or equivalent)
CREATE INDEX IF NOT EXISTS idx_context_fts_tenant
  ON context_entries(tenant_id, created_at DESC);

-- Source activity lookup: find all context entries from a given activity
CREATE INDEX IF NOT EXISTS idx_context_source_activity
  ON context_entries(source_activity_id)
  WHERE source_activity_id IS NOT NULL;

-- Authored-by index: find entries created by a specific actor
CREATE INDEX IF NOT EXISTS idx_context_authored_by
  ON context_entries(authored_by, created_at DESC)
  WHERE authored_by IS NOT NULL;

-- Activities extraction backlog: polling query hits this every 60 seconds
-- (Complements any existing index — safe if already present via IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_activities_extraction_pending
  ON activities(created_at ASC)
  WHERE extraction_status = 'pending';
