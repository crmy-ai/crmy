-- Up: Webhooks

CREATE TABLE webhook_endpoints (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  secret       TEXT NOT NULL,
  event_types  TEXT[] NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  description  TEXT,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX webhooks_tenant_idx ON webhook_endpoints(tenant_id);

CREATE TABLE webhook_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id     UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_id        BIGINT REFERENCES events(id),
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  response_status INT,
  response_body   TEXT,
  attempt_count   INT NOT NULL DEFAULT 0,
  next_retry_at   TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX deliveries_endpoint_idx ON webhook_deliveries(endpoint_id, created_at DESC);
CREATE INDEX deliveries_retry_idx    ON webhook_deliveries(next_retry_at) WHERE status = 'retrying';

-- Down:
-- DROP TABLE webhook_deliveries;
-- DROP TABLE webhook_endpoints;
