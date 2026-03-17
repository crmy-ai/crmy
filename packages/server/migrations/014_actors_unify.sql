-- Up: Unify actors with users — add user_id FK, phone column

-- Link actors to their auth user
ALTER TABLE actors ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE actors ADD COLUMN phone TEXT;
ALTER TABLE actors ADD COLUMN role TEXT;

-- Unique: one actor per user per tenant
CREATE UNIQUE INDEX idx_actors_user_id ON actors(tenant_id, user_id) WHERE user_id IS NOT NULL;

-- Backfill: link existing actors to users by matching tenant_id + email
UPDATE actors a
SET user_id = u.id, role = u.role
FROM users u
WHERE a.tenant_id = u.tenant_id
  AND a.email = u.email
  AND a.actor_type = 'human'
  AND a.user_id IS NULL;

-- Backfill: create actors for users that don't have one
INSERT INTO actors (tenant_id, actor_type, display_name, email, user_id, role, metadata)
SELECT u.tenant_id, 'human', u.name, u.email, u.id, u.role, '{}'::jsonb
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM actors a WHERE a.tenant_id = u.tenant_id AND a.user_id = u.id
);

-- Down:
-- ALTER TABLE actors DROP COLUMN user_id;
-- ALTER TABLE actors DROP COLUMN phone;
-- ALTER TABLE actors DROP COLUMN role;
