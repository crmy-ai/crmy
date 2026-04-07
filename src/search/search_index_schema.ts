// File: src/search/search_index_schema.ts

/**
 * Defines the strict, canonical schema for the Unified Search Index.
 * All incoming data MUST be mapped to this structure.
 */
export interface SearchIndexSchema {
    // Core Identifiers
    id: string;               // Canonical UUID of the record
    entity_type: 'contact' | 'account' | 'opportunity' | 'activity' | 'context' | 'use_case';
    source_record_id: string; // The UUID used in the backend (redundant but safe)
    last_updated_at: string;  // ISO Date string for versioning

    // Searchable Content
    primary_name: string;     // Best guess for "What is this thing?"
    description: string;      // A concatenated summary of key fields.

    // Metadata for Filtering/Sorting
    metadata: {
        created_by_type?: string;
        owner_id?: string;
        last_modified_by_id?: string;
    };

    // Structured Payload - Contains all raw, searchable fields for deep querying
    searchable_payload: {
        // Common fields visible across many objects
        email?: string;
        phone?: string;
        industry?: string;

        // Type-specific fields
        contact?: {
            title?: string;
            lifecycle_stage?: 'lead' | 'prospect' | 'customer' | 'churned';
        };
        account?: {
            domain?: string;
            annual_revenue?: number;
            website?: string;
        };
        opportunity?: {
            stage?: string;
            amount?: number;
            close_date?: string;
        };
        context?: {
            context_type?: string;
            title?: string;
            body?: string;
            confidence?: number;
        };
        // ... add fields for other types as needed
    };
}