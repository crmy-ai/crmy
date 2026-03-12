-- Up: Email system

CREATE TABLE email_providers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
  provider    TEXT NOT NULL,
  config      JSONB NOT NULL,
  from_name   TEXT NOT NULL DEFAULT 'CRMy',
  from_email  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE emails (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
  account_id      UUID REFERENCES accounts(id) ON DELETE SET NULL,
  opportunity_id  UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  use_case_id     UUID REFERENCES use_cases(id) ON DELETE SET NULL,
  to_email        TEXT NOT NULL,
  to_name         TEXT,
  subject         TEXT NOT NULL,
  body_html       TEXT,
  body_text       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft',
  hitl_request_id UUID REFERENCES hitl_requests(id),
  sent_at         TIMESTAMPTZ,
  opened_at       TIMESTAMPTZ,
  clicked_at      TIMESTAMPTZ,
  bounced_at      TIMESTAMPTZ,
  provider_msg_id TEXT,
  source_agent    TEXT,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX emails_tenant_idx   ON emails(tenant_id, created_at DESC);
CREATE INDEX emails_contact_idx  ON emails(contact_id);
CREATE INDEX emails_status_idx   ON emails(tenant_id, status);
CREATE INDEX emails_usecase_idx  ON emails(use_case_id);

CREATE TABLE email_sequences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  steps       JSONB NOT NULL DEFAULT '[]',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sequence_enrollments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id  UUID NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  contact_id   UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL,
  current_step INT NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'active',
  next_send_at TIMESTAMPTZ,
  enrolled_by  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sequence_id, contact_id)
);

-- Down:
-- DROP TABLE sequence_enrollments;
-- DROP TABLE email_sequences;
-- DROP TABLE emails;
-- DROP TABLE email_providers;
