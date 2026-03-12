-- Up: Custom field definitions

CREATE TABLE custom_field_definitions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  object_type   TEXT NOT NULL,
  field_key     TEXT NOT NULL,
  label         TEXT NOT NULL,
  field_type    TEXT NOT NULL,
  options       JSONB,
  is_required   BOOLEAN NOT NULL DEFAULT false,
  is_filterable BOOLEAN NOT NULL DEFAULT false,
  sort_order    INT NOT NULL DEFAULT 0,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, object_type, field_key)
);

-- Down:
-- DROP TABLE custom_field_definitions;
