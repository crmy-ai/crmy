// File: src/search/SearchIndexerService.ts

import { SearchIndexSchema } from './search_index_schema';
import { getContextEntry } from '../context/context_service'; // Assume this utility exists

/**
 * Service responsible for normalizing source data and indexing it into the external search engine.
 * In a real implementation, this class would wrap the search engine client (e.g., Elasticsearch client).
 */
export class SearchIndexerService {

    /**
     * Ingests a raw payload object from any source write path, normalizes it against the schema,
     * and attempts to write/update the document in the search engine.
     * @param rawPayload The raw data object coming from the originating write transaction.
     * @param entityType The general type of the source (e.g., 'activity', 'contact').
     * @returns A boolean indicating success.
     */
    public static async indexDocument(rawPayload: Record<string, any>, entityType: 'contact' | 'account' | 'opportunity' | 'activity' | 'context' | 'use_case'): Promise<boolean> {

        // 1. CORE NORMALIZATION STEP: Map raw payload to the defined Schema
        const normalizedDoc: SearchIndexSchema = SearchIndexerService._normalize(rawPayload, entityType);

        // 2. Deduplication/Versioning Check (This assumes the DB layer provides the last_updated_at)
        // In a real scenario, we'd call searchEngine.getById(normalizedDoc.id) first.
        // For now, we assume the caller guarantees uniqueness or handles conflict resolution.

        console.log(`[Indexer] Attempting to index document for ${entityType}/${normalizedDoc.id}`);

        try {
            // 3. The actual write call to the external search engine
            // Placeholder for actual search engine client call:
            // searchEngineClient.index({ index: 'crm_unified_index', id: normalizedDoc.id, body: normalizedDoc });
            console.log(`[SUCCESS MOCK] Successfully indexed ${entityType}:${normalizedDoc.id} into the unified index.`);
            return true;

        } catch (error) {
            console.error(`[ERROR] Failed to index ${entityType}:${rawPayload.id}. Error:`, error);
            // Critical: Do NOT fail the calling transaction if indexing fails.
            return false;
        }
    }

    /**
     * Utility function to map a raw object into the canonical SearchIndexSchema.
     */
    private static _normalize(rawPayload: Record<string, any>, entityType: 'contact' | 'account' | 'opportunity' | 'activity' | 'context' | 'use_case'): SearchIndexSchema {
        // *** This method MUST be expanded for EVERY entity type (Contact, Account, etc.) ***
        const base: Partial<SearchIndexSchema> = {
            id: String(rawPayload.id || 'unknown'),
            entity_type: entityType,
            source_record_id: String(rawPayload.id || 'unknown'),
            last_updated_at: new Date().toISOString(),
            primary_name: rawPayload.name || rawPayload.primary_name || 'Unnamed Record',
            description: rawPayload.summary || JSON.stringify(rawPayload), // Use a summary field if available
            metadata: { /* ... */ },
            searchable_payload: { /* ... */ }
        };

        // Simple mapping for demonstration - this needs deep object traversal.
        if (entityType === 'contact') {
            return {
                ...base,
                searchable_payload: {
                    ...base.searchable_payload,
                    contact: {
                        title: rawPayload.title,
                        lifecycle_stage: rawPayload.lifecycle_stage
                    }
                }
            } as SearchIndexSchema;
        }

        // Default fallback for unhandled types
        return { ...base } as SearchIndexSchema;
    }
}
export { SearchIndexerService };