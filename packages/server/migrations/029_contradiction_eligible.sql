-- SPDX-License-Identifier: Apache-2.0
-- Up: Mark which context types are eligible for contradiction detection.
-- Contradiction detection only runs on factual/scalar types where two entries
-- for the same subject can genuinely conflict (budget, next step, deal risk, etc.).
-- Narrative types (transcripts, notes, summaries) can legitimately coexist.

ALTER TABLE context_type_registry
  ADD COLUMN IF NOT EXISTS is_contradiction_eligible BOOLEAN NOT NULL DEFAULT FALSE;

-- Mark built-in factual types as eligible
UPDATE context_type_registry SET is_contradiction_eligible = TRUE
WHERE type_name IN (
  'commitment',
  'deal_risk',
  'next_step',
  'stakeholder',
  'competitive_intel',
  'objection',
  'key_fact',
  'decision',
  'preference'
);

-- Down:
-- ALTER TABLE context_type_registry DROP COLUMN IF EXISTS is_contradiction_eligible;
