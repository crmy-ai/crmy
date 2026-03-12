-- Up: Threaded notes / comments on any CRM entity

CREATE TABLE notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  object_type     TEXT NOT NULL,        -- contact, account, opportunity, use_case, etc.
  object_id       UUID NOT NULL,
  parent_id       UUID REFERENCES notes(id) ON DELETE CASCADE,  -- threading
  body            TEXT NOT NULL,
  visibility      TEXT NOT NULL DEFAULT 'internal',  -- internal | external
  mentions        TEXT[] NOT NULL DEFAULT '{}',       -- @user_id references
  pinned          BOOLEAN NOT NULL DEFAULT false,
  author_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  author_type     TEXT NOT NULL DEFAULT 'user',       -- user | agent | system
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notes_tenant_idx     ON notes(tenant_id);
CREATE INDEX notes_object_idx     ON notes(tenant_id, object_type, object_id);
CREATE INDEX notes_parent_idx     ON notes(parent_id);
CREATE INDEX notes_author_idx     ON notes(author_id);
CREATE INDEX notes_pinned_idx     ON notes(tenant_id, object_type, object_id, pinned) WHERE pinned = true;

-- Down:
-- DROP TABLE notes;
