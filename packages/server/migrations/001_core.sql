-- Up: Core CRM tables

CREATE TABLE tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'free',
  settings    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',
  password_hash TEXT,
  custom_fields JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, email)
);

CREATE TABLE contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  first_name      TEXT NOT NULL DEFAULT '',
  last_name       TEXT NOT NULL DEFAULT '',
  email           TEXT,
  phone           TEXT,
  title           TEXT,
  company_name    TEXT,
  account_id      UUID,
  owner_id        UUID REFERENCES users(id),
  lifecycle_stage TEXT NOT NULL DEFAULT 'lead',
  source          TEXT,
  tags            TEXT[] NOT NULL DEFAULT '{}',
  custom_fields   JSONB NOT NULL DEFAULT '{}',
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contacts_tenant_idx  ON contacts(tenant_id);
CREATE INDEX contacts_email_idx   ON contacts(tenant_id, email);
CREATE INDEX contacts_account_idx ON contacts(account_id);
CREATE INDEX contacts_owner_idx   ON contacts(owner_id);

CREATE TABLE accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  domain          TEXT,
  industry        TEXT,
  employee_count  INT,
  annual_revenue  BIGINT,
  currency_code   TEXT NOT NULL DEFAULT 'USD',
  website         TEXT,
  parent_id       UUID REFERENCES accounts(id),
  owner_id        UUID REFERENCES users(id),
  health_score    INT,
  tags            TEXT[] NOT NULL DEFAULT '{}',
  custom_fields   JSONB NOT NULL DEFAULT '{}',
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX accounts_tenant_idx ON accounts(tenant_id);
CREATE INDEX accounts_name_idx   ON accounts(tenant_id, name);
CREATE INDEX accounts_owner_idx  ON accounts(owner_id);

ALTER TABLE contacts ADD CONSTRAINT contacts_account_fk
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;

CREATE TABLE opportunities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  account_id      UUID REFERENCES accounts(id) ON DELETE SET NULL,
  contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
  owner_id        UUID REFERENCES users(id),
  stage           TEXT NOT NULL DEFAULT 'prospecting',
  amount          BIGINT,
  currency_code   TEXT NOT NULL DEFAULT 'USD',
  close_date      DATE,
  probability     INT,
  forecast_cat    TEXT NOT NULL DEFAULT 'pipeline',
  description     TEXT,
  lost_reason     TEXT,
  custom_fields   JSONB NOT NULL DEFAULT '{}',
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX opps_tenant_idx  ON opportunities(tenant_id);
CREATE INDEX opps_account_idx ON opportunities(account_id);
CREATE INDEX opps_owner_idx   ON opportunities(owner_id);
CREATE INDEX opps_stage_idx   ON opportunities(tenant_id, stage);

CREATE TABLE activities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  subject         TEXT NOT NULL,
  body            TEXT,
  status          TEXT NOT NULL DEFAULT 'completed',
  direction       TEXT,
  due_at          TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
  account_id      UUID REFERENCES accounts(id) ON DELETE SET NULL,
  opportunity_id  UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  owner_id        UUID REFERENCES users(id),
  source_agent    TEXT,
  custom_fields   JSONB NOT NULL DEFAULT '{}',
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX activities_tenant_idx  ON activities(tenant_id);
CREATE INDEX activities_contact_idx ON activities(contact_id);
CREATE INDEX activities_opp_idx     ON activities(opportunity_id);
CREATE INDEX activities_type_idx    ON activities(tenant_id, type);

-- Down:
-- DROP TABLE activities;
-- DROP TABLE opportunities;
-- DROP TABLE accounts;
-- DROP TABLE contacts;
-- DROP TABLE users;
-- DROP TABLE tenants;
