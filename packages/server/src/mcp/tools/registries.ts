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
      description: 'List all registered activity types, optionally filtered by category. Returns types grouped by category.',
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
      description: 'Register a new custom activity type. The type_name must be lowercase with underscores.',
      inputSchema: activityTypeRegistryAdd,
      handler: async (input: z.infer<typeof activityTypeRegistryAdd>, actor: ActorContext) => {
        const entry = await activityTypeRepo.addActivityType(db, actor.tenant_id, input);
        return { activity_type: entry };
      },
    },
    {
      name: 'activity_type_remove',
      description: 'Remove a custom activity type. Cannot remove default (built-in) types.',
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
      description: 'List all registered context types.',
      inputSchema: contextTypeRegistryList,
      handler: async (_input: z.infer<typeof contextTypeRegistryList>, actor: ActorContext) => {
        const types = await contextTypeRepo.listContextTypes(db, actor.tenant_id);
        return { context_types: types };
      },
    },
    {
      name: 'context_type_add',
      description: 'Register a new custom context type.',
      inputSchema: contextTypeRegistryAdd,
      handler: async (input: z.infer<typeof contextTypeRegistryAdd>, actor: ActorContext) => {
        const entry = await contextTypeRepo.addContextType(db, actor.tenant_id, input);
        return { context_type: entry };
      },
    },
    {
      name: 'context_type_remove',
      description: 'Remove a custom context type. Cannot remove default (built-in) types.',
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
