-- Copyright 2026 CRMy Contributors
-- SPDX-License-Identifier: Apache-2.0

-- Keep Context review/search surfaces responsive as Raw Context, Signals, and
-- Memory grow into large operational archives.

CREATE INDEX IF NOT EXISTS context_entries_list_idx
  ON context_entries(tenant_id, memory_status, is_current, created_at DESC);

CREATE INDEX IF NOT EXISTS context_entries_subject_list_idx
  ON context_entries(tenant_id, subject_type, subject_id, memory_status, created_at DESC);

CREATE INDEX IF NOT EXISTS signal_groups_search_idx
  ON signal_groups USING GIN (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(normalized_claim, '') || ' ' || coalesce(context_type, ''))
  );

CREATE INDEX IF NOT EXISTS raw_context_sources_search_idx
  ON raw_context_sources USING GIN (
    to_tsvector('english', coalesce(source_label, '') || ' ' || coalesce(source_ref, '') || ' ' || coalesce(source_type, '') || ' ' || coalesce(raw_excerpt, ''))
  );

-- Down
-- DROP INDEX IF EXISTS raw_context_sources_search_idx;
-- DROP INDEX IF EXISTS signal_groups_search_idx;
-- DROP INDEX IF EXISTS context_entries_subject_list_idx;
-- DROP INDEX IF EXISTS context_entries_list_idx;
