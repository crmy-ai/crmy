-- Context source drop active job dedupe
-- Up:

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id, connection_id, job_type
           ORDER BY
             CASE status WHEN 'processing' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
             created_at DESC
         ) AS rn
  FROM context_source_sync_jobs
  WHERE status IN ('pending', 'processing', 'failed')
)
DELETE FROM context_source_sync_jobs j
USING ranked r
WHERE j.id = r.id
  AND r.rn > 1;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id, source_object_id
           ORDER BY
             CASE status WHEN 'processing' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
             created_at DESC
         ) AS rn
  FROM context_source_processing_jobs
  WHERE status IN ('pending', 'processing', 'failed')
)
DELETE FROM context_source_processing_jobs j
USING ranked r
WHERE j.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS context_source_sync_jobs_active_unique_idx
  ON context_source_sync_jobs(tenant_id, connection_id, job_type)
  WHERE status IN ('pending', 'processing', 'failed');

CREATE UNIQUE INDEX IF NOT EXISTS context_source_processing_jobs_active_unique_idx
  ON context_source_processing_jobs(tenant_id, source_object_id)
  WHERE status IN ('pending', 'processing', 'failed');

-- Down:
-- DROP INDEX IF EXISTS context_source_processing_jobs_active_unique_idx;
-- DROP INDEX IF EXISTS context_source_sync_jobs_active_unique_idx;
