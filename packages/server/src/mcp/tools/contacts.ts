// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { contactCreate, contactUpdate, contactSearch, contactSetLifecycle, contactGetTimeline, contactLogActivity } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as contactRepo from '../../db/repos/contacts.js';
import * as activityRepo from '../../db/repos/activities.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound, permissionDenied } from '@crmy/shared';
import { validateCustomFields } from '../../db/repos/custom-fields-validate.js';
import type { ToolDef } from '../server.js';

export function contactTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'contact_create',
      description: 'Create a new contact in the CRM',
      inputSchema: contactCreate,
      handler: async (input: z.infer<typeof contactCreate>, actor: ActorContext) => {
        if (input.custom_fields && Object.keys(input.custom_fields).length > 0) {
          input.custom_fields = await validateCustomFields(db, actor.tenant_id, 'contact', input.custom_fields, { isCreate: true });
        }
        const contact = await contactRepo.createContact(db, actor.tenant_id, {
          ...input,
          created_by: actor.actor_id,
        });
        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'contact.created',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'contact',
          objectId: contact.id,
          afterData: contact,
        });
        return { contact, event_id };
      },
    },
    {
      name: 'contact_get',
      description: 'Get a contact by ID',
      inputSchema: z.object({ id: z.string().uuid() }),
      handler: async (input: { id: string }, actor: ActorContext) => {
        const contact = await contactRepo.getContact(db, actor.tenant_id, input.id);
        if (!contact) throw notFound('Contact', input.id);
        return { contact };
      },
    },
    {
      name: 'contact_search',
      description: 'Search contacts with filters. Supports query (searches name, email, company), lifecycle_stage, account_id, owner_id, and tags.',
      inputSchema: contactSearch,
      handler: async (input: z.infer<typeof contactSearch>, actor: ActorContext) => {
        const result = await contactRepo.searchContacts(db, actor.tenant_id, {
          ...input,
          limit: input.limit ?? 20,
        });
        return { contacts: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'contact_update',
      description: 'Update a contact. Pass id and a patch object with fields to update.',
      inputSchema: contactUpdate,
      handler: async (input: z.infer<typeof contactUpdate>, actor: ActorContext) => {
        const before = await contactRepo.getContact(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Contact', input.id);

        if (input.patch.custom_fields && Object.keys(input.patch.custom_fields).length > 0) {
          input.patch.custom_fields = await validateCustomFields(db, actor.tenant_id, 'contact', input.patch.custom_fields);
        }
        const contact = await contactRepo.updateContact(db, actor.tenant_id, input.id, input.patch);
        if (!contact) throw notFound('Contact', input.id);

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'contact.updated',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'contact',
          objectId: contact.id,
          beforeData: before,
          afterData: contact,
        });
        return { contact, event_id };
      },
    },
    {
      name: 'contact_set_lifecycle',
      description: 'Set the lifecycle stage of a contact (lead, prospect, customer, churned)',
      inputSchema: contactSetLifecycle,
      handler: async (input: z.infer<typeof contactSetLifecycle>, actor: ActorContext) => {
        const before = await contactRepo.getContact(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Contact', input.id);

        const contact = await contactRepo.updateContact(db, actor.tenant_id, input.id, {
          lifecycle_stage: input.lifecycle_stage,
        });
        if (!contact) throw notFound('Contact', input.id);

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'contact.stage_changed',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'contact',
          objectId: contact.id,
          beforeData: { lifecycle_stage: before.lifecycle_stage },
          afterData: { lifecycle_stage: contact.lifecycle_stage },
          metadata: input.reason ? { reason: input.reason } : {},
        });
        return { contact, event_id };
      },
    },
    {
      name: 'contact_log_activity',
      description: 'Log an activity (call, email, meeting, note, task) for a contact',
      inputSchema: contactLogActivity,
      handler: async (input: z.infer<typeof contactLogActivity>, actor: ActorContext) => {
        const contact = await contactRepo.getContact(db, actor.tenant_id, input.contact_id);
        if (!contact) throw notFound('Contact', input.contact_id);

        const activity = await activityRepo.createActivity(db, actor.tenant_id, {
          ...input,
          source_agent: actor.actor_type === 'agent' ? actor.actor_id : undefined,
          created_by: actor.actor_id,
        });

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'activity.created',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'activity',
          objectId: activity.id,
          afterData: activity,
        });
        return { activity, event_id };
      },
    },
    {
      name: 'contact_get_timeline',
      description: 'Get the activity timeline for a contact',
      inputSchema: contactGetTimeline,
      handler: async (input: z.infer<typeof contactGetTimeline>, actor: ActorContext) => {
        const contact = await contactRepo.getContact(db, actor.tenant_id, input.id);
        if (!contact) throw notFound('Contact', input.id);

        return activityRepo.getContactTimeline(db, actor.tenant_id, input.id, {
          limit: input.limit ?? 50,
          types: input.types,
        });
      },
    },
    {
      name: 'contact_delete',
      description: 'Permanently delete a contact. Requires admin or owner role.',
      inputSchema: z.object({ id: z.string().uuid() }),
      handler: async (input: { id: string }, actor: ActorContext) => {
        if (actor.role !== 'admin' && actor.role !== 'owner') {
          throw permissionDenied('Only admins and owners can delete contacts');
        }
        const before = await contactRepo.getContact(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Contact', input.id);

        await contactRepo.deleteContact(db, actor.tenant_id, input.id);
        await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'contact.deleted',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'contact',
          objectId: input.id,
          beforeData: before,
        });
        return { deleted: true };
      },
    },
  ];
}
