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
      description: 'Create a new contact record with their name, email, title, and company details. Link to an account with account_id to associate the contact with their organization. Set lifecycle_stage to reflect their current position in the sales funnel (lead, prospect, active, customer, churned, champion).',
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
      description: 'Retrieve a single contact by UUID including their profile, account association, lifecycle stage, and custom fields. For a comprehensive view with context entries, activities, and assignments, use briefing_get on the contact instead.',
      inputSchema: z.object({ id: z.string().uuid() }),
      handler: async (input: { id: string }, actor: ActorContext) => {
        const contact = await contactRepo.getContact(db, actor.tenant_id, input.id);
        if (!contact) throw notFound('Contact', input.id);
        return { contact };
      },
    },
    {
      name: 'contact_search',
      description: 'Search contacts with flexible filters. The query parameter searches across name, email, and company fields simultaneously. Filter by lifecycle_stage to find prospects or champions, account_id to see contacts at a specific company, owner_id for contacts owned by a specific rep, and tags for custom categorization. Returns paginated results.',
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
      description: 'Update a contact record by passing its id and a patch object with the fields to change. Supports all contact fields including name, email, title, phone, account_id, tags, and custom_fields.',
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
      description: 'Set the lifecycle stage of a contact to reflect their current position in the sales funnel. Valid stages: lead, prospect, active, customer, churned, champion. Use this when a contact progresses through the pipeline or changes status.',
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
      description: 'Log an activity directly against a contact record — a convenience wrapper that auto-sets the contact_id. For richer activity logging with polymorphic subjects, detail JSONB, and context engine integration, prefer activity_create instead.',
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
      description: 'Get a chronological activity timeline for a specific contact. Returns all activities linked to this contact sorted by occurred_at descending. For a more comprehensive view that includes context and assignments, use briefing_get on the contact.',
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
      description: 'Permanently delete a contact and all associated data. This is a destructive action that requires admin or owner role. Consider archiving or reassigning activities before deletion.',
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
