// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import {
  contextEntryCreate, contextEntryGet, contextEntrySearch, contextEntrySupersede,
  contextSearch, contextReview, contextStaleList, briefingGet,
} from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext, SubjectType } from '@crmy/shared';
import * as contextRepo from '../../db/repos/context-entries.js';
import { assembleBriefing, formatBriefingText } from '../../services/briefing.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound } from '@crmy/shared';
import type { ToolDef } from '../server.js';

export function contextEntryTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'context_add',
      description: 'Store context/knowledge about a CRM object (note, transcript, research, objection, competitive intel, etc.). Supports tags, source_activity_id, and valid_until for staleness tracking.',
      inputSchema: contextEntryCreate,
      handler: async (input: z.infer<typeof contextEntryCreate>, actor: ActorContext) => {
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
        return { context_entry: entry, event_id };
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
      description: 'List context entries with filters. Supports subject_type, subject_id, context_type, authored_by, is_current, query.',
      inputSchema: contextEntrySearch,
      handler: async (input: z.infer<typeof contextEntrySearch>, actor: ActorContext) => {
        const result = await contextRepo.searchContextEntries(db, actor.tenant_id, {
          ...input,
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
      description: 'Full-text search across context entries using PostgreSQL GIN index. Returns results ranked by relevance.',
      inputSchema: contextSearch,
      handler: async (input: z.infer<typeof contextSearch>, actor: ActorContext) => {
        const entries = await contextRepo.fullTextSearch(db, actor.tenant_id, input.query, {
          subject_type: input.subject_type,
          subject_id: input.subject_id,
          context_type: input.context_type,
          tag: input.tag,
          current_only: input.current_only,
          limit: input.limit,
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
      name: 'briefing_get',
      description: 'Get a unified briefing for any CRM object — assembles the object record, related objects, activity timeline, open assignments, context entries, and staleness warnings in one call. This is the most important context engine tool.',
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
          },
        );

        if (input.format === 'text') {
          return { briefing_text: formatBriefingText(briefing) };
        }
        return { briefing };
      },
    },
  ];
}
