-- SPDX-License-Identifier: Apache-2.0
-- Up: Context priority weights + confidence decay half-lives per context type

-- priority_weight: multiplier applied to effective_confidence when ranking entries
--   in briefings. Higher = more prominent. Defaults to 1.0.
ALTER TABLE context_type_registry
  ADD COLUMN IF NOT EXISTS priority_weight REAL NOT NULL DEFAULT 1.0;

-- confidence_half_life_days: how quickly confidence decays with age.
--   effective_confidence = stored_confidence * 0.5^(age_days / half_life_days)
--   NULL means no decay (confidence stays constant regardless of age).
ALTER TABLE context_type_registry
  ADD COLUMN IF NOT EXISTS confidence_half_life_days INTEGER;

-- Seed sensible defaults for the built-in types.
-- High-stakes, time-sensitive types decay fast. Structural facts decay slowly.
UPDATE context_type_registry SET
  priority_weight            = 2.0,
  confidence_half_life_days  = 90
WHERE type_name = 'commitment';

UPDATE context_type_registry SET
  priority_weight            = 2.0,
  confidence_half_life_days  = 60
WHERE type_name = 'deal_risk';

UPDATE context_type_registry SET
  priority_weight            = 1.8,
  confidence_half_life_days  = 30
WHERE type_name = 'next_step';

UPDATE context_type_registry SET
  priority_weight            = 1.8,
  confidence_half_life_days  = 45
WHERE type_name = 'objection';

UPDATE context_type_registry SET
  priority_weight            = 1.5,
  confidence_half_life_days  = 180
WHERE type_name = 'stakeholder';

UPDATE context_type_registry SET
  priority_weight            = 1.5,
  confidence_half_life_days  = 60
WHERE type_name = 'competitive_intel';

UPDATE context_type_registry SET
  priority_weight            = 1.3,
  confidence_half_life_days  = NULL   -- key facts don't decay
WHERE type_name = 'key_fact';

UPDATE context_type_registry SET
  priority_weight            = 1.3,
  confidence_half_life_days  = 365
WHERE type_name = 'relationship_map';

UPDATE context_type_registry SET
  priority_weight            = 1.2,
  confidence_half_life_days  = NULL
WHERE type_name = 'meeting_notes';

UPDATE context_type_registry SET
  priority_weight            = 1.2,
  confidence_half_life_days  = NULL
WHERE type_name = 'summary';

UPDATE context_type_registry SET
  priority_weight            = 1.0,
  confidence_half_life_days  = 30
WHERE type_name = 'sentiment_analysis';

UPDATE context_type_registry SET
  priority_weight            = 1.0,
  confidence_half_life_days  = NULL
WHERE type_name = 'decision';

UPDATE context_type_registry SET
  priority_weight            = 1.0,
  confidence_half_life_days  = 180
WHERE type_name = 'preference';

UPDATE context_type_registry SET
  priority_weight            = 0.8,
  confidence_half_life_days  = NULL
WHERE type_name = 'research';

UPDATE context_type_registry SET
  priority_weight            = 0.7,
  confidence_half_life_days  = NULL
WHERE type_name = 'note';

UPDATE context_type_registry SET
  priority_weight            = 0.5,
  confidence_half_life_days  = NULL
WHERE type_name = 'transcript';

UPDATE context_type_registry SET
  priority_weight            = 0.6,
  confidence_half_life_days  = NULL
WHERE type_name = 'agent_reasoning';

-- Down:
-- ALTER TABLE context_type_registry DROP COLUMN IF EXISTS confidence_half_life_days;
-- ALTER TABLE context_type_registry DROP COLUMN IF EXISTS priority_weight;
