-- SPDX-License-Identifier: Apache-2.0
-- Up: Agent specializations and availability status.

CREATE TABLE IF NOT EXISTS agent_specializations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  actor_id        UUID NOT NULL REFERENCES actors(id),
  skill_tag       TEXT NOT NULL,
  proficiency     TEXT NOT NULL DEFAULT 'intermediate'
                    CHECK (proficiency IN ('novice', 'intermediate', 'expert')),
  description     TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, actor_id, skill_tag)
);

CREATE INDEX IF NOT EXISTS idx_agent_specializations_tenant_skill
  ON agent_specializations (tenant_id, skill_tag)
  WHERE is_active = true;

-- Availability status on actors (agent/human)
ALTER TABLE actors
  ADD COLUMN IF NOT EXISTS availability_status TEXT DEFAULT 'available'
    CHECK (availability_status IN ('available', 'busy', 'offline'));

-- Down:
-- ALTER TABLE actors DROP COLUMN IF EXISTS availability_status;
-- DROP TABLE IF EXISTS agent_specializations;
