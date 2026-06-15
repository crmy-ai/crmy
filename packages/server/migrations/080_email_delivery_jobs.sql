-- Durable outbound email delivery jobs.
-- External provider sends must run after the email/send approval transaction commits.

CREATE TABLE IF NOT EXISTS email_delivery_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email_id     UUID NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',
  reason       TEXT NOT NULL DEFAULT 'email_delivery_requested',
  attempts     INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  last_error   TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS email_delivery_jobs_active_unique
  ON email_delivery_jobs(tenant_id, email_id)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS email_delivery_jobs_claim_idx
  ON email_delivery_jobs(status, available_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS email_delivery_jobs_email_idx
  ON email_delivery_jobs(tenant_id, email_id, created_at DESC);

-- DOWN
-- DROP INDEX IF EXISTS email_delivery_jobs_email_idx;
-- DROP INDEX IF EXISTS email_delivery_jobs_claim_idx;
-- DROP INDEX IF EXISTS email_delivery_jobs_active_unique;
-- DROP TABLE IF EXISTS email_delivery_jobs;
