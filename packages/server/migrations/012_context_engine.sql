-- Up: Context Engine — actors, enhanced activities, assignments, context_entries

-- ============================================================
-- actors — first-class identity for humans and agents
-- ============================================================
CREATE TABLE actors (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_type        TEXT NOT NULL CHECK (actor_type IN ('human', 'agent')),
  display_name      TEXT NOT NULL,
  email             TEXT,
  agent_identifier  TEXT,
  agent_model       TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_actors_email ON actors(tenant_id, email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX idx_actors_agent_id ON actors(tenant_id, agent_identifier) WHERE agent_identifier IS NOT NULL;
CREATE INDEX idx_actors_tenant ON actors(tenant_id);

-- ============================================================
-- activities evolution — add new columns alongside existing ones
-- ============================================================

-- Who performed it (links to actors table, nullable for existing data)
ALTER TABLE activities ADD COLUMN performed_by UUID REFERENCES actors(id);

-- Polymorphic subject (what this activity is about)
ALTER TABLE activities ADD COLUMN subject_type TEXT;
ALTER TABLE activities ADD COLUMN subject_id UUID;

-- Optional secondary association
ALTER TABLE activities ADD COLUMN related_type TEXT;
ALTER TABLE activities ADD COLUMN related_id UUID;

-- Structured payload per activity type
ALTER TABLE activities ADD COLUMN detail JSONB NOT NULL DEFAULT '{}';

-- When it actually happened (vs created_at)
ALTER TABLE activities ADD COLUMN occurred_at TIMESTAMPTZ;

-- Outcome/disposition
ALTER TABLE activities ADD COLUMN outcome TEXT;

-- New indexes for context engine queries
CREATE INDEX idx_activities_subject ON activities(subject_type, subject_id, occurred_at DESC)
  WHERE subject_type IS NOT NULL;
CREATE INDEX idx_activities_performed_by ON activities(performed_by, occurred_at DESC)
  WHERE performed_by IS NOT NULL;
CREATE INDEX idx_activities_related ON activities(related_type, related_id)
  WHERE related_id IS NOT NULL;

-- Backfill subject_type + subject_id from existing FK columns
UPDATE activities SET subject_type = 'contact', subject_id = contact_id
  WHERE contact_id IS NOT NULL AND subject_type IS NULL;
UPDATE activities SET subject_type = 'account', subject_id = account_id
  WHERE account_id IS NOT NULL AND subject_type IS NULL;
UPDATE activities SET subject_type = 'opportunity', subject_id = opportunity_id
  WHERE opportunity_id IS NOT NULL AND subject_type IS NULL;

-- Backfill occurred_at from created_at
UPDATE activities SET occurred_at = created_at WHERE occurred_at IS NULL;

-- ============================================================
-- assignments — coordination primitive
-- ============================================================
CREATE TABLE assignments (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title                   TEXT NOT NULL,
  description             TEXT,
  assignment_type         TEXT NOT NULL,
  assigned_by             UUID NOT NULL REFERENCES actors(id),
  assigned_to             UUID NOT NULL REFERENCES actors(id),
  subject_type            TEXT NOT NULL CHECK (subject_type IN (
                            'contact', 'account', 'opportunity', 'use_case'
                          )),
  subject_id              UUID NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN (
                            'pending', 'accepted', 'in_progress', 'blocked',
                            'completed', 'declined', 'cancelled'
                          )),
  priority                TEXT NOT NULL DEFAULT 'normal'
                          CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  due_at                  TIMESTAMPTZ,
  accepted_at             TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  completed_by_activity_id UUID REFERENCES activities(id),
  context                 TEXT,
  metadata                JSONB NOT NULL DEFAULT '{}',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_assignments_assignee ON assignments(assigned_to, status, due_at);
CREATE INDEX idx_assignments_assigner ON assignments(assigned_by, status);
CREATE INDEX idx_assignments_subject ON assignments(subject_type, subject_id, status);
CREATE INDEX idx_assignments_tenant ON assignments(tenant_id);

-- ============================================================
-- context_entries — memory / knowledge layer
-- ============================================================
CREATE TABLE context_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_type      TEXT NOT NULL CHECK (subject_type IN (
                      'contact', 'account', 'opportunity', 'use_case'
                    )),
  subject_id        UUID NOT NULL,
  context_type      TEXT NOT NULL,
  authored_by       UUID NOT NULL REFERENCES actors(id),
  title             TEXT,
  body              TEXT NOT NULL,
  structured_data   JSONB NOT NULL DEFAULT '{}',
  confidence        REAL CHECK (confidence IS NULL OR (confidence BETWEEN 0.0 AND 1.0)),
  is_current        BOOLEAN NOT NULL DEFAULT TRUE,
  supersedes_id     UUID REFERENCES context_entries(id),
  source            TEXT,
  source_ref        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_context_subject ON context_entries(subject_type, subject_id, is_current, created_at DESC);
CREATE INDEX idx_context_author ON context_entries(authored_by, created_at DESC);
CREATE INDEX idx_context_type ON context_entries(context_type, is_current);
CREATE INDEX idx_context_tenant ON context_entries(tenant_id);

-- Down:
-- DROP TABLE context_entries;
-- DROP TABLE assignments;
-- ALTER TABLE activities DROP COLUMN performed_by, DROP COLUMN subject_type, DROP COLUMN subject_id,
--   DROP COLUMN related_type, DROP COLUMN related_id, DROP COLUMN detail,
--   DROP COLUMN occurred_at, DROP COLUMN outcome;
-- DROP TABLE actors;
