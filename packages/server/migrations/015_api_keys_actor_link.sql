-- Up: Link API keys to actors, add per-actor scopes

-- ============================================================
-- api_keys: add actor_id FK to bind keys to specific actors
-- ============================================================
ALTER TABLE api_keys ADD COLUMN actor_id UUID REFERENCES actors(id) ON DELETE SET NULL;

-- Index for looking up keys by actor
CREATE INDEX idx_api_keys_actor ON api_keys(actor_id) WHERE actor_id IS NOT NULL;

-- Backfill: link existing API keys to actors via user_id match
UPDATE api_keys ak
SET actor_id = a.id
FROM actors a
WHERE ak.user_id = a.user_id
  AND ak.tenant_id = a.tenant_id
  AND ak.actor_id IS NULL;

-- ============================================================
-- actors: add scopes column for per-actor permissions
-- ============================================================
ALTER TABLE actors ADD COLUMN scopes TEXT[] NOT NULL DEFAULT '{read}';

-- Backfill: humans linked to user accounts get full access
UPDATE actors
SET scopes = '{read,write,contacts:read,contacts:write,accounts:read,accounts:write,opportunities:read,opportunities:write,activities:read,activities:write,assignments:create,assignments:update,context:read,context:write}'
WHERE actor_type = 'human' AND user_id IS NOT NULL;

-- Backfill: agents get read + write (basic)
UPDATE actors
SET scopes = '{read,write}'
WHERE actor_type = 'agent';

-- Down:
-- ALTER TABLE actors DROP COLUMN scopes;
-- ALTER TABLE api_keys DROP COLUMN actor_id;
