// Inside context_outbox_repository.ts (conceptual addition/update to the repository methods)
async processAndCommit(jobId: string): Promise<boolean> {
    // ... (Existing logic to apply context_add logic) ...

    try {
        // STEP 1: Perform the actual context write (Success criteria)
        // await contextRepository.addContext(...);

        // STEP 2: Trigger the Indexing (Phase 3 Integration)
        // Assume the final, successful context object is available here.
        const successfulContextPayload = await this.fetchAndNormalizeContextPayload(jobId);
        const indexed = await SearchIndexerService.indexDocument(successfulContextPayload, 'context');

        if (!indexed) {
            // Handle case where context was written but indexing failed - might require a manual retry flag/alert
            return false;
        }

        // STEP 3: Finalize Outbox Record
        await this.updateJobStatus(jobId, 'SUCCESS');
        return true;

    } catch (error) {
        // Handle failure and increment retry count
        await this.updateJobStatus(jobId, 'FAILED', error.message);
        return false;
    }
}
