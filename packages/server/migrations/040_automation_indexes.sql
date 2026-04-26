-- Copyright 2026 CRMy Contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Performance indexes for the automation engine.
-- The sequence polling query runs every 60 seconds; without the first index it
-- performs a full table scan on sequence_enrollments.

-- Sequence step polling: WHERE status='active' AND next_send_at <= now()
CREATE INDEX IF NOT EXISTS seq_enrollments_due_idx
  ON sequence_enrollments(next_send_at)
  WHERE status = 'active';

-- Tenant-scoped enrollment listing (status filter + time order)
CREATE INDEX IF NOT EXISTS seq_enrollments_tenant_status_idx
  ON sequence_enrollments(tenant_id, status, created_at DESC);

-- Workflow run history listing by workflow + time (workflow_runs has no tenant_id column)
CREATE INDEX IF NOT EXISTS workflow_runs_workflow_time_idx
  ON workflow_runs(workflow_id, started_at DESC);

-- Sequences: listing active sequences per tenant
CREATE INDEX IF NOT EXISTS sequences_tenant_active_idx
  ON sequences(tenant_id, is_active);

-- Workflow runs: event_id lookup (find run that processed a given event)
CREATE INDEX IF NOT EXISTS workflow_runs_event_idx
  ON workflow_runs(event_id)
  WHERE event_id IS NOT NULL;
