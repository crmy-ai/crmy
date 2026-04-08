-- Context Outbox: durable queue for context entry indexing jobs.
--
-- Every time a context_entry is written (created or superseded), a corresponding
-- outbox row is inserted in the same logical operation. The background worker
-- (ContextIngestionWorkerService) drains this table asynchronously, forwarding
-- each payload to the SearchIndexerService (Phase 3). If indexing fails, the job
-- is retried up to 5 times with exponential back-off applied by the worker.

CREATE TABLE context_outbox (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type    TEXT        NOT NULL,
  entity_id      UUID        NOT NULL,
  payload        JSONB       NOT NULL DEFAULT '{}',
  status         TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  attempt_count  INTEGER     NOT NULL DEFAULT 0,
  last_error     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at   TIMESTAMPTZ
);

-- Fast path for the worker: grab pending jobs in insertion order.
CREATE INDEX idx_context_outbox_pending
  ON context_outbox (created_at ASC)
  WHERE status = 'pending';

-- Secondary index for retry pickup: failed jobs under the attempt cap.
CREATE INDEX idx_context_outbox_retryable
  ON context_outbox (created_at ASC)
  WHERE status = 'failed' AND attempt_count < 5;
