-- Copyright 2026 CRMy Contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Optional migration: pgvector semantic search on context_entries.body
--
-- This migration is skipped unless ENABLE_PGVECTOR=true is set in the environment.
-- Supported on: Supabase, Neon, RDS (pgvector enabled), local Docker (pgvector/pgvector:pg16).
-- NOT supported on: standard Railway/Render managed PostgreSQL (no pgvector extension).
--
-- EMBEDDING_DIMENSIONS defaults to 1536 (text-embedding-3-small).
-- The dimension value is substituted by migrate.ts before execution.

-- Up:

CREATE EXTENSION IF NOT EXISTS vector;

-- Nullable embedding column: NULL until embedding provider is configured and entry is embedded.
-- Existing entries remain NULL and continue to be served by FTS (search_vector / GIN index).
ALTER TABLE context_entries
  ADD COLUMN IF NOT EXISTS embedding vector(${EMBEDDING_DIMENSIONS});

-- HNSW approximate nearest-neighbor index (cosine distance).
-- Partial index on non-NULL rows keeps the index lean during gradual backfill.
-- m=16, ef_construction=64: pgvector defaults, appropriate for up to ~1M rows.
CREATE INDEX IF NOT EXISTS idx_context_embedding_hnsw
  ON context_entries
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding IS NOT NULL;

-- Down:
-- DROP INDEX IF EXISTS idx_context_embedding_hnsw;
-- ALTER TABLE context_entries DROP COLUMN IF EXISTS embedding;
-- DROP EXTENSION IF EXISTS vector;
