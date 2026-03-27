// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { noteCreate, noteUpdate, noteGet, noteDelete, noteList } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as noteRepo from '../../db/repos/notes.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound } from '@crmy/shared';
import type { ToolDef } from '../server.js';

export function noteTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'note_create',
      description: 'Add a note or comment to any CRM object (contact, account, opportunity, or use_case). Notes support threading via parent_id for conversations and @mentions for notifications. Set visibility to "internal" for team-only notes or "external" for client-visible ones. Pin important notes with pinned: true so they appear first.',
      inputSchema: noteCreate,
      handler: async (input: z.infer<typeof noteCreate>, actor: ActorContext) => {
        const note = await noteRepo.createNote(db, actor.tenant_id, {
          ...input,
          author_id: actor.actor_id,
          author_type: actor.actor_type,
        });
        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'note.created',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: input.object_type,
          objectId: input.object_id,
          afterData: { note_id: note.id, body_preview: note.body.slice(0, 100) },
        });
        return { note, event_id };
      },
    },
    {
      name: 'note_get',
      description: 'Retrieve a single note by UUID including its body, author, visibility, pinned status, and all threaded replies. Use this to read a complete note conversation.',
      inputSchema: noteGet,
      handler: async (input: z.infer<typeof noteGet>, actor: ActorContext) => {
        const note = await noteRepo.getNote(db, actor.tenant_id, input.id);
        if (!note) throw notFound('Note', input.id);
        const replies = await noteRepo.getReplies(db, actor.tenant_id, input.id);
        return { note, replies };
      },
    },
    {
      name: 'note_update',
      description: 'Update an existing note by changing its body, visibility, or pinned status. Use this to correct or expand note content or to pin/unpin important notes.',
      inputSchema: noteUpdate,
      handler: async (input: z.infer<typeof noteUpdate>, actor: ActorContext) => {
        const before = await noteRepo.getNote(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Note', input.id);
        const note = await noteRepo.updateNote(db, actor.tenant_id, input.id, input.patch);
        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'note.updated',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: before.object_type,
          objectId: before.object_id,
          beforeData: { body: before.body, visibility: before.visibility, pinned: before.pinned },
          afterData: input.patch,
        });
        return { note, event_id };
      },
    },
    {
      name: 'note_delete',
      description: 'Delete a note and all its threaded replies. This is a destructive action — the note and its entire conversation thread are permanently removed.',
      inputSchema: noteDelete,
      handler: async (input: z.infer<typeof noteDelete>, actor: ActorContext) => {
        const note = await noteRepo.getNote(db, actor.tenant_id, input.id);
        if (!note) throw notFound('Note', input.id);
        await noteRepo.deleteNote(db, actor.tenant_id, input.id);
        await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'note.deleted',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: note.object_type,
          objectId: note.object_id,
          beforeData: { note_id: note.id },
        });
        return { deleted: true };
      },
    },
    {
      name: 'note_list',
      description: 'List notes attached to a CRM object (contact, account, opportunity, or use_case). Pinned notes always appear first, followed by recent notes. Filter by visibility to see only internal or external notes.',
      inputSchema: noteList,
      handler: async (input: z.infer<typeof noteList>, actor: ActorContext) => {
        const result = await noteRepo.listNotes(db, actor.tenant_id, {
          object_type: input.object_type,
          object_id: input.object_id,
          visibility: input.visibility,
          pinned: input.pinned,
          limit: input.limit ?? 20,
          cursor: input.cursor,
        });
        return { notes: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
  ];
}
