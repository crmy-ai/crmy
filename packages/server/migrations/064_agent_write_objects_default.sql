-- Workspace Agent revenue-object write default
-- Up:

ALTER TABLE agent_configs
  ALTER COLUMN can_write_objects SET DEFAULT true;

-- Preserve any enabled tenant that explicitly disabled writes. For untouched or
-- disabled configs, align the saved default with the product default.
UPDATE agent_configs
SET can_write_objects = true,
    updated_at = now()
WHERE can_write_objects = false
  AND enabled = false;

-- Down:
ALTER TABLE agent_configs
  ALTER COLUMN can_write_objects SET DEFAULT false;
