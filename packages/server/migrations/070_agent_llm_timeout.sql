-- Workspace Agent LLM request timeout
-- Up:

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS llm_timeout_ms INTEGER NOT NULL DEFAULT 60000;

UPDATE agent_configs
SET llm_timeout_ms = 60000
WHERE llm_timeout_ms IS NULL;

ALTER TABLE agent_configs
  ADD CONSTRAINT agent_configs_llm_timeout_ms_range
  CHECK (llm_timeout_ms BETWEEN 5000 AND 300000);

-- Down:
ALTER TABLE agent_configs
  DROP CONSTRAINT IF EXISTS agent_configs_llm_timeout_ms_range,
  DROP COLUMN IF EXISTS llm_timeout_ms;
