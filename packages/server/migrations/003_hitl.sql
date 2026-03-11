-- Up: HITL (Human-in-the-Loop) tables

CREATE TABLE hitl_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id           TEXT NOT NULL,
  session_id         TEXT,
  action_type        TEXT NOT NULL,
  action_summary     TEXT NOT NULL,
  action_payload     JSONB NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending',
  reviewer_id        UUID REFERENCES users(id),
  review_note        TEXT,
  auto_approve_after TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at        TIMESTAMPTZ
);
CREATE INDEX hitl_tenant_status_idx ON hitl_requests(tenant_id, status);
CREATE INDEX hitl_expires_idx       ON hitl_requests(expires_at) WHERE status = 'pending';

-- Down:
-- DROP TABLE hitl_requests;
