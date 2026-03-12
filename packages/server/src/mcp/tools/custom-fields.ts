// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { customFieldCreate, customFieldUpdate, customFieldDelete, customFieldList } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as cfRepo from '../../db/repos/custom-fields.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound } from '@crmy/shared';
import type { ToolDef } from '../server.js';

export function customFieldTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'custom_field_create',
      description: 'Define a new custom field for an object type (contact, account, opportunity, activity, use_case)',
      inputSchema: customFieldCreate,
      handler: async (input: z.infer<typeof customFieldCreate>, actor: ActorContext) => {
        const field = await cfRepo.createCustomField(db, actor.tenant_id, {
          ...input,
          created_by: actor.actor_id,
        });
        await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'custom_field.created',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'custom_field',
          objectId: field.id,
          afterData: field,
        });
        return { field };
      },
    },
    {
      name: 'custom_field_update',
      description: 'Update a custom field definition (label, required, options, sort_order)',
      inputSchema: customFieldUpdate,
      handler: async (input: z.infer<typeof customFieldUpdate>, actor: ActorContext) => {
        const before = await cfRepo.getCustomField(db, actor.tenant_id, input.id);
        if (!before) throw notFound('CustomField', input.id);
        const field = await cfRepo.updateCustomField(db, actor.tenant_id, input.id, input.patch);
        return { field };
      },
    },
    {
      name: 'custom_field_delete',
      description: 'Delete a custom field definition',
      inputSchema: customFieldDelete,
      handler: async (input: z.infer<typeof customFieldDelete>, actor: ActorContext) => {
        const deleted = await cfRepo.deleteCustomField(db, actor.tenant_id, input.id);
        if (!deleted) throw notFound('CustomField', input.id);
        return { deleted: true };
      },
    },
    {
      name: 'custom_field_list',
      description: 'List all custom field definitions for an object type',
      inputSchema: customFieldList,
      handler: async (input: z.infer<typeof customFieldList>, actor: ActorContext) => {
        const fields = await cfRepo.listCustomFields(db, actor.tenant_id, input.object_type);
        return { fields };
      },
    },
  ];
}
