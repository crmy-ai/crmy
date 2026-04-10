-- Copyright 2026 CRMy Contributors
-- SPDX-License-Identifier: Apache-2.0
-- Migration 028: Add auto_extract_context flag to agent_configs

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS auto_extract_context BOOLEAN NOT NULL DEFAULT TRUE;
