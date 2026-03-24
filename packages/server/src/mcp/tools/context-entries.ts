// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import {
  contextEntryCreate, contextEntryGet, contextEntrySearch, contextEntrySupersede,
  contextSearch, contextReview, contextStaleList, briefingGet,
  contextDiff, contextIngest,
} from '@crmy/shared';
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
      description: 'Store context/knowledge about a CRM object (note, transcript, research, objection, competitive intel, etc.). Supports tags, source_activity_id, and valid_until for staleness tracking.',
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
      description: 'Get a context entry by ID',
      inputSchema: contextEntryGet,
      handler: async (input: z.infer<typeof contextEntryGet>, actor: ActorContext) => {
        const entry = await contextRepo.getContextEntry(db, actor.tenant_id, input.id);
        if (!entry) throw notFound('ContextEntry', input.id);
        return { context_entry: entry };
      },
    },
    {
      name: 'context_list',
      description: 'List context entries with filters. Supports subject_type, subject_id, context_type, authored_by, is_current, query, and structured_data_filter for typed queries (e.g. { "status": "open" } on objections).',
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
      description: 'Supersede an existing context entry with updated content. Marks the old entry as not current.',
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
      description: 'Full-text search across context entries using PostgreSQL GIN index. Returns results ranked by relevance. Supports structured_data_filter for typed queries (e.g. find all open objections, critical deal risks).',
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
      description: 'Mark a context entry as reviewed (still accurate). Sets reviewed_at = now().',
      inputSchema: contextReview,
      handler: async (input: z.infer<typeof contextReview>, actor: ActorContext) => {
        const entry = await contextRepo.reviewContextEntry(db, actor.tenant_id, input.id);
        if (!entry) throw notFound('ContextEntry', input.id);
        return { context_entry: entry };
      },
    },
    {
      name: 'context_stale',
      description: 'List stale context entries where valid_until has passed but is_current is still TRUE. These need review.',
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
      description: 'Get a unified briefing for any CRM object — assembles the object record, related objects, activity timeline, open assignments, context entries, and staleness warnings in one call. Use context_radius to pull context from related entities. Use token_budget to get a priority-ranked, budget-constrained context pack. This is the most important context engine tool.',
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
      description: 'Catch-up diff for a CRM subject: shows what changed since a given timestamp. Returns new context entries, superseded entries, freshly stale entries, and recently reviewed entries. Ideal for daily agent check-ins.',
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
  ];
}
