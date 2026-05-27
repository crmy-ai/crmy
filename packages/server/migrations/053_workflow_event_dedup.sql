-- Up: make workflow event processing retry-safe across live delivery and catch-up

DELETE FROM workflow_runs wr
USING workflow_runs keep
WHERE wr.workflow_id = keep.workflow_id
  AND wr.event_id = keep.event_id
  AND wr.event_id IS NOT NULL
  AND (
    wr.started_at > keep.started_at
    OR (wr.started_at = keep.started_at AND wr.id::text > keep.id::text)
  );

CREATE UNIQUE INDEX IF NOT EXISTS workflow_runs_workflow_event_unique_idx
  ON workflow_runs(workflow_id, event_id)
  WHERE event_id IS NOT NULL;

-- Down:
-- DROP INDEX IF EXISTS workflow_runs_workflow_event_unique_idx;
