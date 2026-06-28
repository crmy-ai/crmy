-- Up: make default registries tenant-scoped
--
-- Earlier registry tables used type_name as a global primary key while most
-- reads were tenant-scoped. That meant only the first seeded tenant had
-- extractable context types, and Source ingestion in other tenants could
-- not produce Signals.

ALTER TABLE activity_type_registry
  DROP CONSTRAINT IF EXISTS activity_type_registry_pkey;

ALTER TABLE context_type_registry
  DROP CONSTRAINT IF EXISTS context_type_registry_pkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'activity_type_registry_tenant_type_pkey'
  ) THEN
    ALTER TABLE activity_type_registry
      ADD CONSTRAINT activity_type_registry_tenant_type_pkey
      PRIMARY KEY (tenant_id, type_name);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'context_type_registry_tenant_type_pkey'
  ) THEN
    ALTER TABLE context_type_registry
      ADD CONSTRAINT context_type_registry_tenant_type_pkey
      PRIMARY KEY (tenant_id, type_name);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_activity_type_registry_type_name
  ON activity_type_registry(type_name);

CREATE INDEX IF NOT EXISTS idx_context_type_registry_type_name
  ON context_type_registry(type_name);

-- Down:
-- ALTER TABLE activity_type_registry DROP CONSTRAINT IF EXISTS activity_type_registry_tenant_type_pkey;
-- ALTER TABLE context_type_registry DROP CONSTRAINT IF EXISTS context_type_registry_tenant_type_pkey;
-- DROP INDEX IF EXISTS idx_activity_type_registry_type_name;
-- DROP INDEX IF EXISTS idx_context_type_registry_type_name;
-- ALTER TABLE activity_type_registry ADD PRIMARY KEY (type_name);
-- ALTER TABLE context_type_registry ADD PRIMARY KEY (type_name);
