-- Copyright 2026 CRMy Contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Sequence-level rate limiting and compliance columns.

ALTER TABLE sequences
  ADD COLUMN IF NOT EXISTS max_active_enrollments INT CHECK (max_active_enrollments > 0),
  ADD COLUMN IF NOT EXISTS exit_on_unsubscribe BOOLEAN NOT NULL DEFAULT true;

-- Opt-out / unsubscribe flag on contacts (CAN-SPAM / GDPR compliance)
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS email_opted_out BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_opted_out_at TIMESTAMPTZ;
