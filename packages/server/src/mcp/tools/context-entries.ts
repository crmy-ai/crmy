// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import {
  contextEntryCreate, contextEntryGet, contextEntrySearch, contextEntrySupersede,
} from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as contextRepo from '../../db/repos/context-entries.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound } from '@crmy/shared';
import type { ToolDef } from '../server.js';

export function contextEntryTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'context_add',
      description: 'Store context/knowledge about a CRM object (note, transcript, research, objection, competitive intel, etc.).',
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
  ];
}
