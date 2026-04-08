-- Unified Search Index
--
-- A single, denormalised table that consolidates the searchable surface of every
-- CRM entity. SearchIndexerService upserts into this table after every write so
-- the index stays within one transaction of the source record.
--
-- crmSearch() queries this table with plainto_tsquery instead of issuing six
-- parallel ILIKE scans against the raw entity tables.
--
-- Rows are keyed by (tenant_id, entity_type, entity_id) so an upsert is safe to
-- call on every create/update without risk of duplicates.

CREATE TABLE search_index (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type    TEXT        NOT NULL,
  entity_id      UUID        NOT NULL,
  primary_name   TEXT        NOT NULL DEFAULT '',
  secondary_text TEXT        NOT NULL DEFAULT '',
  status         TEXT,
  owner_id       UUID,
  metadata       JSONB       NOT NULL DEFAULT '{}',
  search_vector  TSVECTOR,
  indexed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_search_index_entity UNIQUE (tenant_id, entity_type, entity_id)
);

-- Full-text search — the primary access pattern.
CREATE INDEX idx_search_index_fts ON search_index USING GIN (search_vector);

-- Tenant + type filter applied before FTS so the planner can narrow the scan.
CREATE INDEX idx_search_index_tenant_type ON search_index (tenant_id, entity_type);

-- Trigger to keep search_vector in sync with primary_name + secondary_text.
CREATE OR REPLACE FUNCTION trg_search_index_vector()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
    to_tsvector('english', coalesce(NEW.primary_name, '') || ' ' || coalesce(NEW.secondary_text, ''));
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_search_index_vector_upd
BEFORE INSERT OR UPDATE OF primary_name, secondary_text
ON search_index
FOR EACH ROW EXECUTE FUNCTION trg_search_index_vector();
