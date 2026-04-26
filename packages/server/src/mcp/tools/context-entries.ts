// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import {
  contextEntryCreate, contextEntryGet, contextEntrySearch, contextEntrySupersede,
  contextSearch, contextReview, contextStaleList, briefingGet,
  contextDiff, contextIngest, contextSemanticSearch, contextEmbedBackfill,
} from '@crmy/shared';
import { entityResolve } from '../../services/entity-resolve.js';
import { loadEmbeddingConfig, embedText } from '../../agent/providers/embeddings.js';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext, SubjectType, UUID } from '@crmy/shared';
import * as contextRepo from '../../db/repos/context-entries.js';
import * as activityRepo from '../../db/repos/activities.js';
import * as contextTypeRepo from '../../db/repos/context-type-registry.js';
import * as outboxRepo from '../../db/repos/context-outbox.js';
import * as governorLimits from '../../db/repos/governor-limits.js';
import { assembleBriefing, formatBriefingText } from '../../services/briefing.js';
import { processStaleEntriesForTenant } from '../../services/staleness.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound, validationError } from '@crmy/shared';
import { extractContextFromActivity } from '../../agent/extraction.js';
import { detectContradictions } from '../../services/contradictions.js';
import { consolidateContextEntries } from '../../services/consolidation.js';
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
      tier: 'core',
      description: 'Store a typed knowledge entry about a contact, account, opportunity, or use case — this is how agents write memory. Call this after every meaningful interaction to capture what you learned. Set context_type to the taxonomy key: objection, preference, competitive_intel, relationship_map, meeting_notes, research, summary, decision, sentiment_analysis, agent_reasoning, or transcript. Set confidence (0.0–1.0) for agent-authored entries: 1.0 for confirmed facts, 0.6–0.8 for inferences, below 0.5 for hypotheses. Set valid_until whenever the information has a shelf life (competitive pricing, org chart details, budget cycles). Use supersedes_id to replace an existing entry rather than creating a duplicate when updating a belief. Use context_type "note" for threaded comments — supports parent_id for replies, visibility ("internal"/"external"), @mentions, and pinned flag.',
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

        // Enqueue for search indexing — fire-and-forget, never blocks the write.
        outboxRepo.insertJob(db, actor.tenant_id, 'context_entry', entry.id, entry as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[outbox] context_add enqueue ${entry.id}: ${(err as Error).message}`));

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
      tier: 'core',
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
      tier: 'core',
      description: 'List context entries attached to a CRM object with flexible filters. Use subject_type and subject_id to scope to a specific record, context_type to filter by knowledge category (e.g. "objection", "preference"), authored_by to see what a specific actor has contributed, and is_current to exclude superseded entries. The structured_data_filter parameter supports typed JSONB queries for domain-specific searches like finding all open objections or critical deal risks. Returns entries sorted by recency.',
      inputSchema: contextEntrySearch,
      handler: async (input: z.infer<typeof contextEntrySearch>, actor: ActorContext) => {
        const result = await contextRepo.searchContextEntries(db, actor.tenant_id, {
          ...input,
          structured_data_filter: input.structured_data_filter as Record<string, unknown> | undefined,
          visibility: input.visibility,
          pinned: input.pinned,
          limit: input.limit ?? 20,
        });
        return { context_entries: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'context_supersede',
      tier: 'core',
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

        // Enqueue replacement entry for search re-indexing — fire-and-forget.
        outboxRepo.insertJob(db, actor.tenant_id, 'context_entry', result.new.id, result.new as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[outbox] context_supersede enqueue ${result.new.id}: ${(err as Error).message}`));

        return { context_entry: result.new, superseded: result.old, event_id };
      },
    },
    {
      name: 'context_search',
      tier: 'core',
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
      tier: 'admin',
      description: 'Mark a context entry as reviewed and still accurate. Resets reviewed_at to now and optionally extends valid_until by extend_days days (default: type half-life or 30 days). Use this after verifying an entry is still correct — prevents the staleness system from re-queuing it immediately.',
      inputSchema: contextReview,
      handler: async (input: z.infer<typeof contextReview>, actor: ActorContext) => {
        // Determine extend_days: use provided value, fall back to type half_life, then 30
        let extendDays = input.extend_days;
        if (!extendDays) {
          const typeRow = await db.query(
            'SELECT confidence_half_life_days FROM context_type_registry WHERE tenant_id = $1 AND type_name = (SELECT context_type FROM context_entries WHERE id = $2)',
            [actor.tenant_id, input.id],
          );
          extendDays = typeRow.rows[0]?.confidence_half_life_days ?? 30;
        }
        const entry = await contextRepo.reviewContextEntry(db, actor.tenant_id, input.id, extendDays);
        if (!entry) throw notFound('ContextEntry', input.id);
        return { context_entry: entry };
      },
    },
    {
      name: 'context_stale',
      tier: 'core',
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
      tier: 'admin',
      description: 'Re-run the automatic context extraction pipeline on a specific activity. Useful for backfilling entries on older activities or retrying after an error. Returns the number of context entries created.',
      inputSchema: z.object({ activity_id: z.string().uuid().describe('ID of the activity to extract context from') }),
      handler: async (input: { activity_id: string }, actor: ActorContext) => {
        const count = await extractContextFromActivity(db, actor.tenant_id, input.activity_id);
        return { extracted_count: count };
      },
    },
    {
      name: 'briefing_get',
      tier: 'core',
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
      tier: 'admin',
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
      tier: 'core',
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
          performed_by: actor.actor_type === 'agent' ? actor.actor_id : undefined,
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
      name: 'context_ingest_auto',
      tier: 'core',
      description: 'Ingest a document (transcript, email, meeting notes, etc.) and automatically resolve which contacts and accounts are mentioned — no subject IDs required. Extracts candidate entity names from the text using regex patterns, resolves each against the CRM via the entity resolution service (6-tier: exact name, alias, email, domain, substring, fuzzy), and runs the full context extraction pipeline for every resolved subject above the confidence threshold. Returns resolved subjects, entries created, and any names that could not be resolved. Ideal for agents processing inbound content when they do not know which CRM records are involved.',
      inputSchema: z.object({
        document: z.string().min(1).describe('The full text to ingest — transcript, email body, meeting notes, research, etc.'),
        source_label: z.string().optional().describe('Human-readable label for the source (e.g. "Discovery call 2026-04-09")'),
        context_type: z.string().optional().describe('Override the context type for all extracted entries (e.g. "meeting_notes")'),
        confidence_threshold: z.number().min(0).max(1).default(0.6)
          .describe('Minimum entity resolution confidence to link an entry. 0.6 = medium+high (default). Set lower to include more speculative matches.'),
      }),
      handler: async (
        input: { document: string; source_label?: string; context_type?: string; confidence_threshold: number },
        actor: ActorContext,
      ) => {
        // Step 1: extract candidate entity names from the document text
        const candidates = new Set<string>();
        const phraseRe = /\b([A-Z][a-zA-Z]{1,}(?:\s+[A-Z][a-zA-Z]{1,}){0,3})\b/g;
        let m: RegExpExecArray | null;
        while ((m = phraseRe.exec(input.document)) !== null) candidates.add(m[1]);
        const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        while ((m = emailRe.exec(input.document)) !== null) candidates.add(m[0]);

        const STOP = new Set([
          'The', 'This', 'That', 'These', 'Those', 'With', 'From', 'They', 'Their',
          'There', 'Here', 'When', 'Where', 'What', 'Which', 'While', 'After',
          'Before', 'During', 'About', 'Above', 'Below', 'Between', 'Through',
          'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
          'January', 'February', 'March', 'April', 'June', 'July', 'August',
          'September', 'October', 'November', 'December',
          'Please', 'Thank', 'Thanks', 'Hello', 'Also', 'However', 'Therefore',
          'Because', 'Since', 'Until', 'Although', 'Unless',
          'CRM', 'CEO', 'CTO', 'CFO', 'COO', 'VP', 'SVP', 'EVP',
        ]);
        const filtered = [...candidates].filter(c => {
          if (c.length < 2) return false;
          return !c.split(/\s+/).every(w => STOP.has(w));
        }).slice(0, 20);

        // Step 2: resolve each candidate
        const confThreshold = input.confidence_threshold;
        const CONF_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
        const settled = await Promise.allSettled(
          filtered.map(name => entityResolve(db, actor.tenant_id, { query: name, entity_type: 'any', limit: 1 })),
        );

        const resolvedSubjects: { entity_type: string; id: string; name: string; confidence: string }[] = [];
        const skipped: string[] = [];
        const seen = new Set<string>();

        for (let i = 0; i < settled.length; i++) {
          const result = settled[i];
          const candidateName = filtered[i];
          if (result.status !== 'fulfilled') { skipped.push(candidateName); continue; }
          const r = result.value;
          if (r.status !== 'resolved' || !r.resolved) { skipped.push(candidateName); continue; }
          const confScore = (CONF_RANK[r.resolved.confidence] ?? 0) / 3;
          if (confScore < confThreshold && r.resolved.confidence !== 'high' && r.resolved.confidence !== 'medium') {
            skipped.push(candidateName); continue;
          }
          if (r.resolved.confidence === 'low' && confThreshold > 0.4) { skipped.push(candidateName); continue; }
          if (seen.has(r.resolved.id)) continue;
          seen.add(r.resolved.id);
          resolvedSubjects.push({
            entity_type: r.resolved.entity_type,
            id: r.resolved.id,
            name: r.resolved.name,
            confidence: r.resolved.confidence,
          });
        }

        if (resolvedSubjects.length === 0) {
          return {
            subjects_resolved: [],
            entries_created: 0,
            low_confidence_skipped: skipped,
            message: 'No CRM entities could be confidently identified in the document. Try adding contacts/accounts with matching names or aliases, or lower confidence_threshold.',
          };
        }

        // Step 3: ingest for each resolved subject
        let totalCreated = 0;
        const subjectResults: { entity_type: string; id: string; name: string; entries_created: number; activity_id: string }[] = [];

        for (const subject of resolvedSubjects) {
          try {
            const activity = await activityRepo.createActivity(db, actor.tenant_id, {
              type: 'note',
              subject: input.source_label ?? 'Auto-ingested document',
              body: input.document,
              subject_type: subject.entity_type as 'contact' | 'account',
              subject_id: subject.id,
              performed_by: actor.actor_type === 'agent' ? actor.actor_id : undefined,
              occurred_at: new Date().toISOString(),
            });
            const extracted = await extractContextFromActivity(db, actor.tenant_id, activity.id);
            totalCreated += extracted;
            subjectResults.push({ ...subject, entries_created: extracted, activity_id: activity.id });
          } catch (err) {
            console.error(`[context_ingest_auto] Failed for subject ${subject.id}:`, err);
          }
        }

        return {
          subjects_resolved: subjectResults,
          entries_created: totalCreated,
          low_confidence_skipped: skipped.length > 0 ? skipped : undefined,
        };
      },
    },
    {
      name: 'context_stale_assign',
      tier: 'admin',
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
      tier: 'extended',
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
      name: 'context_detect_contradictions',
      tier: 'extended',
      description: 'Scan a subject\'s current context entries for conflicting facts — e.g. two entries that claim different budget amounts, different champions, or contradictory next steps. Returns contradiction warnings with the two conflicting entries, a description of the conflict, and a suggested resolution action. Call before important decisions to ensure you\'re not acting on contradictory beliefs. Use context_resolve_contradiction to fix them.',
      inputSchema: z.object({
        subject_type: z.enum(['contact', 'account', 'opportunity', 'use_case'])
          .describe('Type of the CRM subject to check'),
        subject_id: z.string().uuid()
          .describe('ID of the subject to check'),
        context_type: z.string().optional()
          .describe('If provided, only check entries of this context type. Omit to check all eligible types.'),
      }),
      handler: async (
        input: { subject_type: SubjectType; subject_id: string; context_type?: string },
        actor: ActorContext,
      ) => {
        const warnings = await detectContradictions(
          db, actor.tenant_id, input.subject_type, input.subject_id, input.context_type,
        );
        return {
          contradiction_warnings: warnings,
          total: warnings.length,
          subject_type: input.subject_type,
          subject_id: input.subject_id,
        };
      },
    },
    {
      name: 'context_resolve_contradiction',
      tier: 'extended',
      description: 'Resolve a contradiction between two context entries by superseding the incorrect one with the correct one. The kept entry is preserved as-is; the superseded entry is marked not current (full audit trail maintained). Provide a resolution_note explaining why you chose to keep one over the other. Find the entry IDs from context_detect_contradictions or briefing_get contradiction_warnings.',
      inputSchema: z.object({
        keep_entry_id: z.string().uuid()
          .describe('ID of the entry to keep as the authoritative fact'),
        supersede_entry_id: z.string().uuid()
          .describe('ID of the entry to supersede (mark as no longer current)'),
        resolution_note: z.string().min(1).max(500)
          .describe('Brief explanation of why the kept entry is correct'),
      }),
      handler: async (
        input: { keep_entry_id: string; supersede_entry_id: string; resolution_note: string },
        actor: ActorContext,
      ) => {
        // Fetch the entry to keep so we can supersede with its content
        const keepEntry = await contextRepo.getContextEntry(db, actor.tenant_id, input.keep_entry_id);
        if (!keepEntry) return notFound('context_entry', input.keep_entry_id);

        // Supersede the incorrect entry with the kept entry's content + resolution note
        const result = await contextRepo.supersedeContextEntry(
          db, actor.tenant_id, input.supersede_entry_id,
          {
            body: keepEntry.body,
            title: keepEntry.title,
            structured_data: {
              ...keepEntry.structured_data,
              resolved_by_entry_id: input.keep_entry_id,
              resolution_note: input.resolution_note,
            },
            confidence: keepEntry.confidence,
            tags: keepEntry.tags,
            authored_by: actor.actor_id,
          },
        );

        return {
          resolved: true,
          kept_entry: keepEntry,
          superseded_entry: result.old,
          resolution_entry: result.new,
          resolution_note: input.resolution_note,
        };
      },
    },
    {
      name: 'context_consolidate',
      tier: 'extended',
      description: 'Synthesise multiple current context entries of the same type for a subject into a single authoritative entry. Uses the tenant\'s configured LLM to merge bodies, resolve conflicts (preferring recent + high-confidence), and deduplicate. All source entries are superseded (is_current=false, audit trail preserved). Call when a subject has accumulated many redundant entries of the same type — e.g. 5 "next_step" entries that have piled up. If entry_ids is omitted, consolidates all current entries of context_type for the subject (up to max_entries).',
      inputSchema: z.object({
        subject_type: z.enum(['contact', 'account', 'opportunity', 'use_case'])
          .describe('Type of the CRM subject'),
        subject_id: z.string().uuid()
          .describe('ID of the CRM subject'),
        context_type: z.string().min(1)
          .describe('Context type to consolidate (e.g. "next_step", "objection")'),
        entry_ids: z.array(z.string().uuid()).min(2).optional()
          .describe('Specific entry IDs to consolidate. If omitted, uses all current entries of context_type.'),
        max_entries: z.number().int().min(2).max(20).default(10)
          .describe('Maximum number of entries to consolidate when entry_ids is omitted.'),
      }),
      handler: async (input: {
        subject_type: 'contact' | 'account' | 'opportunity' | 'use_case';
        subject_id: string;
        context_type: string;
        entry_ids?: string[];
        max_entries?: number;
      }, actor: ActorContext) => {
        const result = await consolidateContextEntries(
          db,
          actor.tenant_id,
          actor.actor_id,
          input.subject_type,
          input.subject_id,
          input.context_type,
          input.entry_ids as UUID[] | undefined,
          input.max_entries ?? 10,
        );
        return result;
      },
    },
    {
      name: 'context_embed_backfill',
      tier: 'admin',
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

    // ── Bulk operations ────────────────────────────────────────────────────────

    {
      name: 'context_review_batch',
      tier: 'core',
      description: 'Mark multiple stale context entries as reviewed in a single call — far more efficient than calling context_review for each one. Optionally extend valid_until by a number of days for all entries at once. Useful after a quarterly review or account health check where multiple facts have been re-verified. Returns counts of updated and not-found entries.',
      inputSchema: z.object({
        entry_ids:   z.array(z.string().uuid()).min(1).max(200)
          .describe('UUIDs of the context entries to mark reviewed (max 200 per call)'),
        extend_days: z.number().int().min(1).max(730).optional()
          .describe('Extend valid_until by this many days from now for all reviewed entries. Omit to clear staleness without extending.'),
      }),
      handler: async (
        input: { entry_ids: string[]; extend_days?: number },
        actor: ActorContext,
      ) => {
        let updated = 0;
        let not_found = 0;
        // Process in parallel batches of 20 to avoid overwhelming the DB
        const batchSize = 20;
        for (let i = 0; i < input.entry_ids.length; i += batchSize) {
          const batch = input.entry_ids.slice(i, i + batchSize);
          const results = await Promise.allSettled(
            batch.map(id =>
              contextRepo.reviewContextEntry(db, actor.tenant_id as UUID, id as UUID, input.extend_days),
            ),
          );
          for (const r of results) {
            if (r.status === 'fulfilled' && r.value) updated++;
            else not_found++;
          }
        }
        return {
          updated,
          not_found,
          extend_days: input.extend_days ?? null,
          message: `Marked ${updated} entr${updated !== 1 ? 'ies' : 'y'} as reviewed${input.extend_days ? `, extended by ${input.extend_days} days` : ''}.`,
        };
      },
    },

    {
      name: 'context_bulk_mark_stale',
      tier: 'core',
      description: 'Immediately mark multiple context entries as expired/stale by setting their valid_until to now. Use this after learning that previously recorded information is no longer accurate — for example, after a contact changes roles, a competitor announces a product change, or an org chart restructure. This flags entries for reverification without deleting them (history is preserved). Optionally supply a reason that gets appended to each entry\'s tags for audit purposes.',
      inputSchema: z.object({
        entry_ids: z.array(z.string().uuid()).min(1).max(200)
          .describe('UUIDs of the context entries to mark stale (max 200 per call)'),
        reason:    z.string().max(200).optional()
          .describe('Human-readable reason for marking stale, e.g. "Contact left the company" or "Competitor product discontinued". Added as a tag for audit purposes.'),
      }),
      handler: async (
        input: { entry_ids: string[]; reason?: string },
        actor: ActorContext,
      ) => {
        if (input.entry_ids.length === 0) return { updated: 0 };

        // Parameterized bulk UPDATE — sets valid_until = now() for all listed IDs
        const placeholders = input.entry_ids.map((_, i) => `$${i + 3}`).join(', ');
        const reasonTag = input.reason ? input.reason.slice(0, 200) : null;

        const result = await db.query(
          `UPDATE context_entries
           SET valid_until = now(),
               tags = CASE
                 WHEN $2::text IS NOT NULL
                 THEN tags || jsonb_build_array($2::text)
                 ELSE tags
               END,
               updated_at = now()
           WHERE tenant_id = $1
             AND id IN (${placeholders})
             AND is_current = TRUE
           RETURNING id`,
          [actor.tenant_id, reasonTag, ...input.entry_ids],
        );

        return {
          updated: result.rows.length,
          not_found_or_already_stale: input.entry_ids.length - result.rows.length,
          reason: input.reason ?? null,
          message: `Marked ${result.rows.length} entr${result.rows.length !== 1 ? 'ies' : 'y'} as stale.`,
        };
      },
    },
  ];
}
