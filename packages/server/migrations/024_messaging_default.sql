-- Add default channel flag to messaging_channels

ALTER TABLE messaging_channels
  ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT false;

-- Only one default channel per tenant
CREATE UNIQUE INDEX idx_messaging_channels_default_per_tenant
  ON messaging_channels (tenant_id)
  WHERE is_default = true;
