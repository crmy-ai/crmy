-- SPDX-License-Identifier: Apache-2.0
-- Up: supporting indexes for Memory freshness and review-due sweeps.

CREATE INDEX IF NOT EXISTS idx_context_memory_valid_until_due
  ON context_entries(tenant_id, valid_until)
  WHERE is_current = TRUE
    AND memory_status = 'active'
    AND valid_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_context_memory_undated_review_due
  ON context_entries(tenant_id, (COALESCE(reviewed_at, promoted_at, updated_at, created_at)))
  WHERE is_current = TRUE
    AND memory_status = 'active'
    AND valid_until IS NULL;
