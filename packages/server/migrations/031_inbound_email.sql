-- SPDX-License-Identifier: Apache-2.0
-- Up: Add inbound email webhook configuration to email_providers.

ALTER TABLE email_providers
  ADD COLUMN IF NOT EXISTS inbound_webhook_secret TEXT,
  ADD COLUMN IF NOT EXISTS inbound_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Down:
-- ALTER TABLE email_providers
--   DROP COLUMN IF EXISTS inbound_webhook_secret,
--   DROP COLUMN IF EXISTS inbound_enabled;
