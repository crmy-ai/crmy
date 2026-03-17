-- Migration: Make assignment subject_type and subject_id optional
-- Allows human-created assignments that aren't tied to a specific CRM record

ALTER TABLE assignments
  ALTER COLUMN subject_type DROP NOT NULL,
  ALTER COLUMN subject_id DROP NOT NULL;
