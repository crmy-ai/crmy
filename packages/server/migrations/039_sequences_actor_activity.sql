-- Copyright 2026 CRMy Contributors
-- SPDX-License-Identifier: Apache-2.0

-- Migration 039: Sequences — Actor tracking, Activity back-links, Objective
--
-- Wires sequence tables into the actor and activity systems so that:
--   • Every sequence has an owner (who runs this campaign)
--   • Every enrollment tracks who enrolled the contact + why (objective)
--   • Every step execution links to the Activity record created for it
--   • Every email sent by a sequence back-links to the enrollment for analytics

-- ── Sequences: owner actor ─────────────────────────────────────────────────────

ALTER TABLE sequences
  ADD COLUMN IF NOT EXISTS owner_actor_id UUID REFERENCES actors(id) ON DELETE SET NULL;

-- ── Sequence enrollments: actor FK + objective ────────────────────────────────

ALTER TABLE sequence_enrollments
  ADD COLUMN IF NOT EXISTS enrolled_by_actor_id UUID REFERENCES actors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS objective TEXT;

-- ── Step executions: activity back-link ───────────────────────────────────────

ALTER TABLE sequence_step_executions
  ADD COLUMN IF NOT EXISTS activity_id UUID REFERENCES activities(id) ON DELETE SET NULL;

-- ── Emails: enrollment + sequence back-links ──────────────────────────────────

ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS enrollment_id UUID REFERENCES sequence_enrollments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sequence_id   UUID REFERENCES sequences(id) ON DELETE SET NULL;

-- ── Indices ────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_emails_enrollment_id
  ON emails(enrollment_id) WHERE enrollment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_seq_exec_activity_id
  ON sequence_step_executions(activity_id) WHERE activity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_seq_enrollments_actor
  ON sequence_enrollments(enrolled_by_actor_id) WHERE enrolled_by_actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sequences_owner_actor
  ON sequences(owner_actor_id) WHERE owner_actor_id IS NOT NULL;
