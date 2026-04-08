-- Copyright 2026 CRMy Contributors
-- SPDX-License-Identifier: Apache-2.0
-- Migration 027: Eliminate notes table — migrate to context_entries

-- 1. Extend context_entries to absorb note-specific fields
ALTER TABLE context_entries
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES context_entries(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'internal'
      CHECK (visibility IN ('internal', 'external')),
  ADD COLUMN IF NOT EXISTS mentions TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Migrate all existing notes → context_entries
INSERT INTO context_entries (
  id, tenant_id, subject_type, subject_id, context_type,
  title, body, confidence, is_current,
  metadata, authored_by, created_at, updated_at,
  visibility, mentions, pinned
)
SELECT
  n.id,
  n.tenant_id,
  n.object_type                                             AS subject_type,
  n.object_id                                               AS subject_id,
  'note'                                                    AS context_type,
  LEFT(n.body, 120)                                         AS title,
  n.body,
  1.0                                                       AS confidence,
  TRUE                                                      AS is_current,
  jsonb_build_object(
    'author_type', n.author_type,
    'migrated_from_notes', TRUE
  )                                                         AS metadata,
  COALESCE(n.author_id, 'system'::text)                    AS authored_by,
  n.created_at,
  n.updated_at,
  n.visibility,
  COALESCE(n.mentions, '{}'),
  COALESCE(n.pinned, FALSE)
FROM notes n
ON CONFLICT (id) DO NOTHING;

-- 3. Wire up threaded reply links (second pass — all rows exist now)
UPDATE context_entries ce
SET parent_id = n.parent_id
FROM notes n
WHERE ce.id = n.id AND n.parent_id IS NOT NULL;

-- 4. Drop the notes table
DROP TABLE IF EXISTS notes;
