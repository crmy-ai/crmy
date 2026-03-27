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
      description: 'Define a new custom field for a CRM object type (contact, account, opportunity, activity, or use_case). Specify the field name, label, data type, whether it is required, and any enum options. Custom fields appear in all API responses and can be used in search filters.',
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
      description: 'Update an existing custom field definition. Supports changing the label, required flag, available options for enum fields, and sort_order for display ordering. Does not affect existing data values.',
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
      description: 'Delete a custom field definition. Removes the field schema — existing data in records is not affected but will no longer be validated or displayed. Use with caution in production.',
      inputSchema: customFieldDelete,
      handler: async (input: z.infer<typeof customFieldDelete>, actor: ActorContext) => {
        const deleted = await cfRepo.deleteCustomField(db, actor.tenant_id, input.id);
        if (!deleted) throw notFound('CustomField', input.id);
        return { deleted: true };
      },
    },
    {
      name: 'custom_field_list',
      description: 'List all custom field definitions for a specific object type. Returns field names, types, labels, required constraints, and options. Use this alongside schema_get to understand the complete data model for a CRM entity.',
      inputSchema: customFieldList,
      handler: async (input: z.infer<typeof customFieldList>, actor: ActorContext) => {
        const fields = await cfRepo.listCustomFields(db, actor.tenant_id, input.object_type);
        return { fields };
      },
    },
  ];
}
