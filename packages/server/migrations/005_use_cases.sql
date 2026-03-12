-- Up: Use Cases + contacts join table + activities link

CREATE TABLE use_cases (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  opportunity_id   UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  owner_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  stage            TEXT NOT NULL DEFAULT 'discovery',
  unit_label            TEXT,
  consumption_current   BIGINT,
  consumption_capacity  BIGINT,
  consumption_unit      TEXT,
  attributed_arr      BIGINT,
  currency_code       TEXT NOT NULL DEFAULT 'USD',
  expansion_potential BIGINT,
  health_score        INT,
  health_note         TEXT,
  started_at          TIMESTAMPTZ,
  target_prod_date    DATE,
  sunset_date         DATE,
  tags             TEXT[] NOT NULL DEFAULT '{}',
  custom_fields    JSONB NOT NULL DEFAULT '{}',
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX use_cases_tenant_idx      ON use_cases(tenant_id);
CREATE INDEX use_cases_account_idx     ON use_cases(account_id);
CREATE INDEX use_cases_opportunity_idx ON use_cases(opportunity_id);
CREATE INDEX use_cases_owner_idx       ON use_cases(owner_id);
CREATE INDEX use_cases_stage_idx       ON use_cases(tenant_id, stage);

CREATE TABLE use_case_contacts (
  use_case_id UUID NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  role        TEXT,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (use_case_id, contact_id)
);

CREATE INDEX use_case_contacts_contact_idx ON use_case_contacts(contact_id);

ALTER TABLE activities
  ADD COLUMN use_case_id UUID REFERENCES use_cases(id) ON DELETE SET NULL;
CREATE INDEX activities_usecase_idx ON activities(use_case_id);

-- Down:
-- DROP INDEX activities_usecase_idx;
-- ALTER TABLE activities DROP COLUMN use_case_id;
-- DROP TABLE use_case_contacts;
-- DROP TABLE use_cases;
