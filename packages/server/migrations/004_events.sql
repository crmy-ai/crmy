-- Up: Append-only event log

CREATE TABLE events (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  event_type  TEXT NOT NULL,
  actor_id    TEXT,
  actor_type  TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id   UUID,
  before_data JSONB,
  after_data  JSONB,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX events_tenant_idx  ON events(tenant_id, created_at DESC);
CREATE INDEX events_object_idx  ON events(object_type, object_id);
CREATE INDEX events_type_idx    ON events(tenant_id, event_type);

-- Down:
-- DROP TABLE events;
