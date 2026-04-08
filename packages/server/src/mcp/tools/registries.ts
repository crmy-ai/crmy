// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import {
  activityTypeRegistryList, activityTypeRegistryAdd, activityTypeRegistryRemove,
  contextTypeRegistryList, contextTypeRegistryAdd, contextTypeRegistryRemove,
} from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as activityTypeRepo from '../../db/repos/activity-type-registry.js';
import * as contextTypeRepo from '../../db/repos/context-type-registry.js';
import { CrmyError } from '@crmy/shared';
import type { ToolDef } from '../server.js';

export function registryTools(db: DbPool): ToolDef[] {
  return [
    // --- Activity Type Registry ---
    {
      name: 'activity_type_list',
      tier: 'core',
      description: 'List all registered activity types available for use in activity_create. Returns types grouped by category (e.g. communication, meeting, internal, deal). Use this to discover valid type values before logging an activity.',
      inputSchema: activityTypeRegistryList,
      handler: async (input: z.infer<typeof activityTypeRegistryList>, actor: ActorContext) => {
        const types = await activityTypeRepo.listActivityTypes(db, actor.tenant_id, {
          category: input.category,
        });
        // Group by category
        const grouped: Record<string, typeof types> = {};
        for (const t of types) {
          if (!grouped[t.category]) grouped[t.category] = [];
          grouped[t.category].push(t);
        }
        return { activity_types: types, by_category: grouped };
      },
    },
    {
      name: 'activity_type_add',
      tier: 'admin',
      description: 'Register a new custom activity type to extend the built-in types. The type_name must be lowercase with underscores (e.g. "demo_given", "contract_signed"). Specify a category and optional description. Once registered, the type is available in activity_create.',
      inputSchema: activityTypeRegistryAdd,
      handler: async (input: z.infer<typeof activityTypeRegistryAdd>, actor: ActorContext) => {
        const entry = await activityTypeRepo.addActivityType(db, actor.tenant_id, input);
        return { activity_type: entry };
      },
    },
    {
      name: 'activity_type_remove',
      tier: 'admin',
      description: 'Remove a custom activity type from the registry. Built-in default types cannot be removed. Existing activities using this type are not affected.',
      inputSchema: activityTypeRegistryRemove,
      handler: async (input: z.infer<typeof activityTypeRegistryRemove>, actor: ActorContext) => {
        const removed = await activityTypeRepo.removeActivityType(db, actor.tenant_id, input.type_name);
        if (!removed) {
          throw new CrmyError(
            'VALIDATION_ERROR',
            `Cannot remove activity type '${input.type_name}'. It is either a default type or does not exist.`,
            400,
          );
        }
        return { removed: true, type_name: input.type_name };
      },
    },

    // --- Context Type Registry ---
    {
      name: 'context_type_list',
      tier: 'core',
      description: 'List all registered context types available for use in context_add. Returns types including the built-in taxonomy (objection, preference, competitive_intel, relationship_map, meeting_notes, research, summary, etc.) and any custom types.',
      inputSchema: contextTypeRegistryList,
      handler: async (_input: z.infer<typeof contextTypeRegistryList>, actor: ActorContext) => {
        const types = await contextTypeRepo.listContextTypes(db, actor.tenant_id);
        return { context_types: types };
      },
    },
    {
      name: 'context_type_add',
      tier: 'admin',
      description: 'Register a new custom context type to extend the built-in taxonomy. Specify a type name, optional description, and JSON Schema for structured_data validation. Once registered, the type is available in context_add.',
      inputSchema: contextTypeRegistryAdd,
      handler: async (input: z.infer<typeof contextTypeRegistryAdd>, actor: ActorContext) => {
        const entry = await contextTypeRepo.addContextType(db, actor.tenant_id, input);
        return { context_type: entry };
      },
    },
    {
      name: 'context_type_remove',
      tier: 'admin',
      description: 'Remove a custom context type from the registry. Built-in default types cannot be removed. Existing context entries using this type are not affected.',
      inputSchema: contextTypeRegistryRemove,
      handler: async (input: z.infer<typeof contextTypeRegistryRemove>, actor: ActorContext) => {
        const removed = await contextTypeRepo.removeContextType(db, actor.tenant_id, input.type_name);
        if (!removed) {
          throw new CrmyError(
            'VALIDATION_ERROR',
            `Cannot remove context type '${input.type_name}'. It is either a default type or does not exist.`,
            400,
          );
        }
        return { removed: true, type_name: input.type_name };
      },
    },
  ];
}
