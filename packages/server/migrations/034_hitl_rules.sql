-- SPDX-License-Identifier: Apache-2.0
-- Up: Conditional HITL auto-approval rules.

CREATE TABLE IF NOT EXISTS hitl_approval_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  name          TEXT NOT NULL,
  action_type   TEXT,                       -- NULL = matches all action types
  condition     JSONB NOT NULL DEFAULT '{}', -- {field, op, value} or {} for always-match
  decision      TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  priority      INT NOT NULL DEFAULT 0,     -- higher = evaluated first
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hitl_rules_tenant_active
  ON hitl_approval_rules (tenant_id, priority DESC)
  WHERE is_active = true;

-- Down:
-- DROP TABLE IF EXISTS hitl_approval_rules;
