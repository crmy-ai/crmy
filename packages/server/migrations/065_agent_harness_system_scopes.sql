-- Agent harness setup scopes for admin/owner API keys
-- Up:

UPDATE actors
SET scopes = ARRAY(
  SELECT DISTINCT added.scope
  FROM unnest(scopes || ARRAY['systems:read', 'systems:write', 'systems:admin']::text[]) AS added(scope)
)
WHERE actor_type = 'human'
  AND role IN ('admin', 'owner');

UPDATE api_keys ak
SET scopes = ARRAY(
  SELECT DISTINCT added.scope
  FROM unnest(ak.scopes || ARRAY['systems:read', 'systems:write', 'systems:admin']::text[]) AS added(scope)
)
FROM users u
WHERE ak.user_id = u.id
  AND u.role IN ('admin', 'owner');

UPDATE api_keys ak
SET scopes = ARRAY(
  SELECT DISTINCT added.scope
  FROM unnest(ak.scopes || ARRAY['systems:read', 'systems:write', 'systems:admin']::text[]) AS added(scope)
)
FROM actors a
WHERE ak.actor_id = a.id
  AND a.role IN ('admin', 'owner');

-- Down:
-- Keep granted scopes. Removing permissions automatically could break existing
-- local agent harnesses after rollback; admins can edit API key scopes manually.
