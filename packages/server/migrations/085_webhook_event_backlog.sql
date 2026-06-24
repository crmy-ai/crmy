-- Up: durable webhook event replay guardrails

DELETE FROM webhook_deliveries duplicate
USING webhook_deliveries keep
WHERE duplicate.endpoint_id = keep.endpoint_id
  AND duplicate.event_id = keep.event_id
  AND duplicate.event_id IS NOT NULL
  AND (
    duplicate.created_at > keep.created_at
    OR (duplicate.created_at = keep.created_at AND duplicate.id::text > keep.id::text)
  );

CREATE UNIQUE INDEX IF NOT EXISTS webhook_deliveries_endpoint_event_unique
  ON webhook_deliveries(endpoint_id, event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS webhook_deliveries_pending_retry_idx
  ON webhook_deliveries(status, next_retry_at, created_at)
  WHERE status IN ('pending', 'retrying');

-- Down:
-- DROP INDEX IF EXISTS webhook_deliveries_pending_retry_idx;
-- DROP INDEX IF EXISTS webhook_deliveries_endpoint_event_unique;
