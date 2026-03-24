-- Copyright 2026 CRMy Contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Migration 018: Identity Resolution
--
-- Adds:
--   • aliases column on contacts and accounts — curated alternate names /
--     abbreviations (e.g. ["JPMC", "J.P. Morgan"] on the JP Morgan Chase account)
--   • pg_trgm extension + trigram GIN indexes for fuzzy / typo-tolerant search
--
-- These two additions power the entity_resolve MCP tool:
--   1. Exact-alias lookup — highest-confidence match path
--   2. Substring search already extended to search aliases arrays
--   3. pg_trgm similarity fallback for typos when ILIKE finds nothing

-- ── Trigram extension ─────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── aliases column ────────────────────────────────────────────────────────────
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}';

-- GIN index for fast array-containment queries (LOWER($q) = ANY(aliases))
CREATE INDEX IF NOT EXISTS idx_contacts_aliases ON contacts USING GIN (aliases);
CREATE INDEX IF NOT EXISTS idx_accounts_aliases  ON accounts  USING GIN (aliases);

-- ── Trigram indexes on name fields ────────────────────────────────────────────
-- Used by entity_resolve fuzzy fallback: similarity(name, $query) > threshold
CREATE INDEX IF NOT EXISTS idx_contacts_first_name_trgm ON contacts USING GIN (first_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contacts_last_name_trgm  ON contacts USING GIN (last_name  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_accounts_name_trgm        ON accounts  USING GIN (name       gin_trgm_ops);
