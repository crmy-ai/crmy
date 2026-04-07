// File: packages/server/src/workers/context_ingestion_worker.service.ts

import { SearchIndexerService } from '../search/SearchIndexerService';
import * as ContextOutboxRepo from '../db/repos/context_outbox';

/**
 * Manages the batch processing loop for the context outbox.
 */
export class ContextIngestionWorkerService {

    public static async processNextBatch(): Promise<void> {
        console.log("[Worker] Starting context ingestion batch processing...");

        // 1. Fetch batch of pending jobs
        const pendingJobs = await ContextOutboxRepo.getPendingJobs(100);
        if (pendingJobs.length === 0) {
            console.log("[Worker] No pending jobs found in the outbox. Exiting.");
            return;
        }

        let successCount = 0;
        for (const job of pendingJobs) {
            // 2. Process job through the transaction boundary
            const success = await ContextOutboxRepo.processAndCommit(job.id);
            if (success) {
                successCount++;
            }
        }
        console.log(`[Worker] Batch processing complete. Successfully committed and indexed ${successCount} records.`);
    }
}