-- Up: Bulk jobs

CREATE TABLE bulk_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  operation    TEXT NOT NULL,
  object_type  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued',
  total_rows   INT,
  processed    INT NOT NULL DEFAULT 0,
  succeeded    INT NOT NULL DEFAULT 0,
  failed       INT NOT NULL DEFAULT 0,
  input_url    TEXT,
  output_url   TEXT,
  error_log    JSONB NOT NULL DEFAULT '[]',
  hitl_request_id UUID REFERENCES hitl_requests(id),
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bulk_jobs_tenant_idx ON bulk_jobs(tenant_id, created_at DESC);
CREATE INDEX bulk_jobs_status_idx ON bulk_jobs(tenant_id, status);

-- Down:
-- DROP TABLE bulk_jobs;
