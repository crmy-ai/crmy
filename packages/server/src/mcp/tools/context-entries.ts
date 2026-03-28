// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import {
  contextEntryCreate, contextEntryGet, contextEntrySearch, contextEntrySupersede,
  contextSearch, contextReview, contextStaleList, briefingGet,
  contextDiff, contextIngest, contextSemanticSearch, contextEmbedBackfill,
} from '@crmy/shared';
import { loadEmbeddingConfig, embedText } from '../../agent/providers/embeddings.js';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext, SubjectType } from '@crmy/shared';
import * as contextRepo from '../../db/repos/context-entries.js';
import * as activityRepo from '../../db/repos/activities.js';
import * as contextTypeRepo from '../../db/repos/context-type-registry.js';
import * as governorLimits from '../../db/repos/governor-limits.js';
import { assembleBriefing, formatBriefingText } from '../../services/briefing.js';
import { processStaleEntriesForTenant } from '../../services/staleness.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound, validationError } from '@crmy/shared';
import { extractContextFromActivity } from '../../agent/extraction.js';
import type { ToolDef } from '../server.js';

/**
 * Soft-validate structured_data against a JSON Schema.
 * Returns a list of warning strings (missing required fields).
 * Does not throw — agents get warnings, not errors, so they can iterate.
 */
function validateAgainstSchema(
  data: Record<string, unknown>,
  schema: Record<string, unknown>,
): string[] {
  const warnings: string[] = [];
  const props = schema.properties as Record<string, unknown> | undefined;
  const required = schema.required as string[] | undefined;

  if (!props || !required) return warnings;

  for (const field of required) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      warnings.push(`structured_data is missing required field '${field}'`);
    }
  }

  for (const [key] of Object.entries(data)) {
    if (!props[key]) {
      warnings.push(`structured_data contains unknown field '${key}' (not in schema)`);
    }
  }

  return warnings;
}

export function contextEntryTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'context_add',
      description: 'Store a typed knowledge entry about a contact, account, opportunity, or use case — this is how agents write memory. Call this after every meaningful interaction to capture what you learned. Set context_type to the taxonomy key: objection, preference, competitive_intel, relationship_map, meeting_notes, research, summary, decision, sentiment_analysis, agent_reasoning, or transcript. Set confidence (0.0–1.0) for agent-authored entries: 1.0 for confirmed facts, 0.6–0.8 for inferences, below 0.5 for hypotheses. Set valid_until whenever the information has a shelf life (competitive pricing, org chart details, budget cycles). Use supersedes_id to replace an existing entry rather than creating a duplicate when updating a belief.',
      inputSchema: contextEntryCreate,
      handler: async (input: z.infer<typeof contextEntryCreate>, actor: ActorContext) => {
        // Enforce governor limit on context entry count
        const entryCount = await governorLimits.countContextEntries(db, actor.tenant_id);
        await governorLimits.enforceLimit(db, actor.tenant_id, 'context_entries_max', entryCount);

        // Enforce body length limit
        if (input.body) {
          const maxChars = await governorLimits.getLimit(db, actor.tenant_id, 'context_body_max_chars');
          if (input.body.length > maxChars) {
            throw validationError(`Context body exceeds maximum length (${input.body.length} > ${maxChars} chars)`);
          }
        }

        const entry = await contextRepo.createContextEntry(db, actor.tenant_id, {
          ...input,
          authored_by: actor.actor_id,
        });

        // Fire-and-forget embedding — never delays context_add; failures are isolated.
        const _embCfg = loadEmbeddingConfig();
        if (_embCfg && entry.body) {
          embedText(entry.body, _embCfg)
            .then(vec => contextRepo.updateEmbedding(db, entry.id, actor.tenant_id, vec))
            .catch((err: unknown) => console.warn(`[embedding] context_add ${entry.id}: ${(err as Error).message}`));
        }

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'context.added',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'context_entry',
          objectId: entry.id,
          afterData: entry,
        });

        // Soft-validate structured_data against the context type's JSON Schema
        const schema = await contextTypeRepo.getContextTypeSchema(db, input.context_type);
        const validation_warnings = schema && input.structured_data
          ? validateAgainstSchema(input.structured_data as Record<string, unknown>, schema)
          : [];
        return {
          context_entry: entry,
          event_id,
          ...(validation_warnings.length > 0 ? { validation_warnings } : {}),
        };
      },
    },
    {
      name: 'context_get',
      description: 'Retrieve a single context entry by its UUID. Returns the full entry including body, structured_data, confidence score, authorship, and staleness metadata. Use this when you have a specific entry ID from a briefing, search result, or stale warning and need the complete details.',
      inputSchema: contextEntryGet,
      handler: async (input: z.infer<typeof contextEntryGet>, actor: ActorContext) => {
        const entry = await contextRepo.getContextEntry(db, actor.tenant_id, input.id);
        if (!entry) throw notFound('ContextEntry', input.id);
        return { context_entry: entry };
      },
    },
    {
      name: 'context_list',
      description: 'List context entries attached to a CRM object with flexible filters. Use subject_type and subject_id to scope to a specific record, context_type to filter by knowledge category (e.g. "objection", "preference"), authored_by to see what a specific actor has contributed, and is_current to exclude superseded entries. The structured_data_filter parameter supports typed JSONB queries for domain-specific searches like finding all open objections or critical deal risks. Returns entries sorted by recency.',
      inputSchema: contextEntrySearch,
      handler: async (input: z.infer<typeof contextEntrySearch>, actor: ActorContext) => {
        const result = await contextRepo.searchContextEntries(db, actor.tenant_id, {
          ...input,
          structured_data_filter: input.structured_data_filter as Record<string, unknown> | undefined,
          limit: input.limit ?? 20,
        });
        return { context_entries: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'context_supersede',
      description: 'Replace an existing context entry with updated information — use this instead of context_add when you have new information that contradicts or updates an existing belief. Marks the old entry as not current (preserving the full audit trail) and creates a new entry that references it. Find the entry to supersede with context_list or context_search first, then pass its ID along with the updated body and confidence. This is the correct way to update beliefs — never create a duplicate entry with context_add when you mean to revise.',
      inputSchema: contextEntrySupersede,
      handler: async (input: z.infer<typeof contextEntrySupersede>, actor: ActorContext) => {
        const existing = await contextRepo.getContextEntry(db, actor.tenant_id, input.id);
        if (!existing) throw notFound('ContextEntry', input.id);

        const result = await contextRepo.supersedeContextEntry(
          db,
          actor.tenant_id,
          input.id,
          {
            body: input.body,
            title: input.title,
            structured_data: input.structured_data as Record<string, unknown> | undefined,
            confidence: input.confidence ?? undefined,
            tags: input.tags,
            authored_by: actor.actor_id,
          },
        );

        // Fire-and-forget embedding for the new entry created by supersession.
        const _embCfgSup = loadEmbeddingConfig();
        if (_embCfgSup && result.new.body) {
          embedText(result.new.body, _embCfgSup)
            .then(vec => contextRepo.updateEmbedding(db, result.new.id, actor.tenant_id, vec))
            .catch((err: unknown) => console.warn(`[embedding] context_supersede ${result.new.id}: ${(err as Error).message}`));
        }

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'context.superseded',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'context_entry',
          objectId: result.new.id,
          beforeData: { superseded_id: input.id },
          afterData: result.new,
        });
        return { context_entry: result.new, superseded: result.old, event_id };
      },
    },
    {
      name: 'context_search',
      description: 'Full-text search across all context entries using PostgreSQL GIN index — useful for cross-cutting queries like "what do we know about procurement concerns across all accounts" or "find every competitive intel mention of HubSpot." Returns results ranked by relevance with highlighted matches. Supports structured_data_filter for typed JSONB queries. Use this when you need to find information across multiple subjects rather than within a single record.',
      inputSchema: contextSearch,
      handler: async (input: z.infer<typeof contextSearch>, actor: ActorContext) => {
        const entries = await contextRepo.fullTextSearch(db, actor.tenant_id, input.query, {
          subject_type: input.subject_type,
          subject_id: input.subject_id,
          context_type: input.context_type,
          tag: input.tag,
          current_only: input.current_only,
          limit: input.limit,
          structured_data_filter: input.structured_data_filter as Record<string, unknown> | undefined,
        });
        return { context_entries: entries, total: entries.length };
      },
    },
    {
      name: 'context_review',
      description: 'Mark a context entry as reviewed and still accurate, resetting its reviewed_at timestamp to now. Use this after verifying that a flagged or aging entry is still correct — it signals to other agents and the staleness system that a human or agent has confirmed the information. Does not modify the entry content.',
      inputSchema: contextReview,
      handler: async (input: z.infer<typeof contextReview>, actor: ActorContext) => {
        const entry = await contextRepo.reviewContextEntry(db, actor.tenant_id, input.id);
        if (!entry) throw notFound('ContextEntry', input.id);
        return { context_entry: entry };
      },
    },
    {
      name: 'context_stale',
      description: 'List all stale context entries where valid_until has passed but is_current is still true — these contain potentially outdated information that should be reverified before acting on. Use this as a recurring agent hygiene check to identify competitive intel, org chart details, or research that may have expired. Returns entries grouped by subject with staleness duration. Optionally filter by subject_type to scope the check to a specific entity type.',
      inputSchema: contextStaleList,
      handler: async (input: z.infer<typeof contextStaleList>, actor: ActorContext) => {
        const entries = await contextRepo.listStaleEntries(db, actor.tenant_id, {
          subject_type: input.subject_type,
          subject_id: input.subject_id,
          limit: input.limit,
        });
        return { stale_entries: entries, total: entries.length };
      },
    },
    {
      name: 'context_extract',
      description: 'Re-run the automatic context extraction pipeline on a specific activity. Useful for backfilling entries on older activities or retrying after an error. Returns the number of context entries created.',
      inputSchema: z.object({ activity_id: z.string().uuid().describe('ID of the activity to extract context from') }),
      handler: async (input: { activity_id: string }, actor: ActorContext) => {
        const count = await extractContextFromActivity(db, actor.tenant_id, input.activity_id);
        return { extracted_count: count };
      },
    },
    {
      name: 'briefing_get',
      description: 'Get a unified briefing for any CRM object — the single most important tool in CRMy. Call this before every agent action, not just the first one. It assembles the full record, related entities, recent activity timeline, open assignments, typed context entries, and stale warnings in one response. Set context_radius to "direct" for single-contact outreach, "adjacent" to include related accounts and opportunities, or "account_wide" for deal reviews that need the full picture. Set token_budget (integer, token count) to tell CRMy how much space you have — it packs the highest-priority context to fit. Check stale_warnings in the response before acting — they identify context entries past their valid_until date that should be reverified. Works on contacts, accounts, opportunities, and use_cases.',
      inputSchema: briefingGet,
      handler: async (input: z.infer<typeof briefingGet>, actor: ActorContext) => {
        const briefing = await assembleBriefing(
          db,
          actor.tenant_id,
          input.subject_type as SubjectType,
          input.subject_id,
          {
            since: input.since,
            context_types: input.context_types,
            include_stale: input.include_stale,
            context_radius: input.context_radius,
            token_budget: input.token_budget,
          },
        );

        if (input.format === 'text') {
          return { briefing_text: formatBriefingText(briefing) };
        }
        return { briefing };
      },
    },
    {
      name: 'context_diff',
      description: 'Get a catch-up diff for a CRM subject showing everything that changed since a given timestamp. Returns four lists: new context entries added, entries that were superseded, entries that became stale, and entries that were recently reviewed. Ideal for daily agent check-ins or resuming work after a gap — call this instead of a full briefing when you already have baseline context and just need the delta.',
      inputSchema: contextDiff,
      handler: async (input: z.infer<typeof contextDiff>, actor: ActorContext) => {
        // Parse relative durations ("7d", "24h", "30m") into ISO timestamps
        let since = input.since;
        if (!since.includes('T') && !since.includes('-')) {
          const match = since.match(/^(\d+)([dhm])$/);
          if (match) {
            const [, num, unit] = match;
            const ms = parseInt(num, 10) * (unit === 'd' ? 86400000 : unit === 'h' ? 3600000 : 60000);
            since = new Date(Date.now() - ms).toISOString();
          }
        }
        const diff = await contextRepo.diffContextEntries(
          db, actor.tenant_id,
          input.subject_type as SubjectType,
          input.subject_id,
          since,
        );
        return {
          subject_type: input.subject_type,
          subject_id: input.subject_id,
          since,
          ...diff,
          summary: {
            new: diff.new_entries.length,
            superseded: diff.superseded_entries.length,
            newly_stale: diff.newly_stale.length,
            resolved: diff.resolved_entries.length,
          },
        };
      },
    },
    {
      name: 'context_ingest',
      description: 'Ingest a raw document (transcript, email, meeting notes, etc.) and auto-extract all structured context entries from it. Creates an activity as provenance and runs the full extraction pipeline. Returns all context entries produced.',
      inputSchema: contextIngest,
      handler: async (input: z.infer<typeof contextIngest>, actor: ActorContext) => {
        // Enforce body length limit
        const maxChars = await governorLimits.getLimit(db, actor.tenant_id, 'context_body_max_chars');
        if (input.document.length > maxChars * 2) {
          // Allow up to 2× the per-entry limit for ingest documents
          throw validationError(`Document exceeds maximum ingest length (${input.document.length} chars)`);
        }

        // Create an activity as provenance for the ingested content
        const activity = await activityRepo.createActivity(db, actor.tenant_id, {
          type: 'note',
          subject: input.source_label ?? 'Ingested document',
          body: input.document,
          subject_type: input.subject_type,
          subject_id: input.subject_id,
          performed_by: actor.actor_id,
          occurred_at: new Date().toISOString(),
        });

        // Run the extraction pipeline
        const extracted_count = await extractContextFromActivity(db, actor.tenant_id, activity.id);

        // Fetch the entries produced by this activity
        const entries = await contextRepo.getContextForSubject(
          db, actor.tenant_id, input.subject_type, input.subject_id,
          { source_activity_id: activity.id, current_only: true, limit: 50 },
        );

        return { extracted_count, context_entries: entries, activity_id: activity.id };
      },
    },
    {
      name: 'context_stale_assign',
      description: 'Trigger the stale context review loop for the current tenant: finds all expired context entries and creates review assignments for the most knowledgeable actors. Normally runs automatically in the background every 60 seconds. Use this to trigger it on-demand.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(20)
          .describe('Maximum number of stale entries to process in this call'),
      }),
      handler: async (input: { limit: number }, actor: ActorContext) => {
        const assignments_created = await processStaleEntriesForTenant(
          db, actor.tenant_id, input.limit,
        );
        return { assignments_created };
      },
    },
    {
      name: 'context_semantic_search',
      description: 'Semantic (vector) search over context entries using embedding similarity — finds entries that are conceptually related to your query even when no keywords match. Use this when context_search returns poor results for natural language queries like "budget concerns", "team friction", or "implementation challenges". Requires ENABLE_PGVECTOR=true and EMBEDDING_PROVIDER to be configured on the server. Returns entries ranked by similarity score (0.0–1.0). If embeddings are not configured, returns a structured error with fallback_available: true — retry with context_search in that case.',
      inputSchema: contextSemanticSearch,
      handler: async (input: z.infer<typeof contextSemanticSearch>, actor: ActorContext) => {
        const embConfig = loadEmbeddingConfig();
        if (!embConfig) {
          return {
            error: 'Semantic search is not enabled on this server. Set ENABLE_PGVECTOR=true and EMBEDDING_PROVIDER to enable vector search.',
            fallback_available: true,
            fallback_tool: 'context_search',
          };
        }

        let queryEmbedding: number[];
        try {
          queryEmbedding = await embedText(input.query, embConfig);
        } catch (err) {
          return {
            error: `Embedding generation failed: ${(err as Error).message}. Use context_search for full-text search instead.`,
            fallback_available: true,
            fallback_tool: 'context_search',
          };
        }

        const entries = await contextRepo.semanticSearch(db, actor.tenant_id, queryEmbedding, {
          subject_type: input.subject_type,
          subject_id: input.subject_id,
          context_type: input.context_type,
          tag: input.tag,
          current_only: input.current_only,
          limit: input.limit,
          structured_data_filter: input.structured_data_filter as Record<string, unknown> | undefined,
        });

        return { context_entries: entries, total: entries.length, semantic_search: true };
      },
    },
    {
      name: 'context_embed_backfill',
      description: 'Admin tool: generate embeddings for context entries that have not yet been embedded. Call with dry_run: true first to see how many entries are pending, then with dry_run: false to process a batch. Loop calls until pending reaches 0. Requires ENABLE_PGVECTOR=true and EMBEDDING_PROVIDER to be configured.',
      inputSchema: contextEmbedBackfill,
      handler: async (input: z.infer<typeof contextEmbedBackfill>, actor: ActorContext) => {
        const embConfig = loadEmbeddingConfig();
        if (!embConfig) {
          return { error: 'EMBEDDING_PROVIDER is not configured. Set ENABLE_PGVECTOR=true and EMBEDDING_PROVIDER to enable semantic search.' };
        }

        const stats = await contextRepo.backfillEmbeddings(
          db,
          actor.tenant_id,
          embConfig,
          input.batch_size,
          input.subject_type,
          input.dry_run,
        );
        return { ...stats, dry_run: input.dry_run };
      },
    },
  ];
}
