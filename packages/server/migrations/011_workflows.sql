-- Up: Workflow automation — event-driven triggers and actions

CREATE TABLE workflows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  trigger_event   TEXT NOT NULL,               -- e.g. contact.created, opportunity.stage_changed
  trigger_filter  JSONB NOT NULL DEFAULT '{}', -- optional conditions on event payload
  actions         JSONB NOT NULL DEFAULT '[]', -- ordered list of action definitions
  is_active       BOOLEAN NOT NULL DEFAULT true,
  run_count       BIGINT NOT NULL DEFAULT 0,
  last_run_at     TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workflows_tenant_idx   ON workflows(tenant_id);
CREATE INDEX workflows_trigger_idx  ON workflows(tenant_id, trigger_event) WHERE is_active = true;

CREATE TABLE workflow_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id     UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  event_id        BIGINT,
  status          TEXT NOT NULL DEFAULT 'running',  -- running | completed | failed
  actions_run     INT NOT NULL DEFAULT 0,
  actions_total   INT NOT NULL DEFAULT 0,
  error           TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX workflow_runs_workflow_idx ON workflow_runs(workflow_id);
CREATE INDEX workflow_runs_status_idx   ON workflow_runs(status) WHERE status = 'running';

-- Down:
-- DROP TABLE workflow_runs;
-- DROP TABLE workflows;
