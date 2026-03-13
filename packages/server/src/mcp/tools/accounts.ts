// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { accountCreate, accountUpdate, accountSearch, accountSetHealth } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as accountRepo from '../../db/repos/accounts.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound } from '@crmy/shared';
import { validateCustomFields } from '../../db/repos/custom-fields-validate.js';
import type { ToolDef } from '../server.js';

export function accountTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'account_create',
      description: 'Create a new account (company/organization)',
      inputSchema: accountCreate,
      handler: async (input: z.infer<typeof accountCreate>, actor: ActorContext) => {
        if (input.custom_fields && Object.keys(input.custom_fields).length > 0) {
          input.custom_fields = await validateCustomFields(db, actor.tenant_id, 'account', input.custom_fields, { isCreate: true });
        }
        const account = await accountRepo.createAccount(db, actor.tenant_id, {
          ...input,
          created_by: actor.actor_id,
        });
        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'account.created',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'account',
          objectId: account.id,
          afterData: account,
        });
        return { account, event_id };
      },
    },
    {
      name: 'account_get',
      description: 'Get an account by ID, including its contacts and open opportunities',
      inputSchema: z.object({ id: z.string().uuid() }),
      handler: async (input: { id: string }, actor: ActorContext) => {
        const account = await accountRepo.getAccount(db, actor.tenant_id, input.id);
        if (!account) throw notFound('Account', input.id);

        const [contacts, open_opportunities] = await Promise.all([
          accountRepo.getAccountContacts(db, actor.tenant_id, input.id),
          accountRepo.getAccountOpenOpps(db, actor.tenant_id, input.id),
        ]);

        return { account, contacts, open_opportunities };
      },
    },
    {
      name: 'account_search',
      description: 'Search accounts with filters. Supports query, industry, owner_id, min_revenue, and tags.',
      inputSchema: accountSearch,
      handler: async (input: z.infer<typeof accountSearch>, actor: ActorContext) => {
        const result = await accountRepo.searchAccounts(db, actor.tenant_id, {
          ...input,
          limit: input.limit ?? 20,
        });
        return { accounts: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'account_update',
      description: 'Update an account. Pass id and a patch object with fields to update.',
      inputSchema: accountUpdate,
      handler: async (input: z.infer<typeof accountUpdate>, actor: ActorContext) => {
        const before = await accountRepo.getAccount(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Account', input.id);

        if (input.patch.custom_fields && Object.keys(input.patch.custom_fields).length > 0) {
          input.patch.custom_fields = await validateCustomFields(db, actor.tenant_id, 'account', input.patch.custom_fields);
        }
        const account = await accountRepo.updateAccount(db, actor.tenant_id, input.id, input.patch);
        if (!account) throw notFound('Account', input.id);

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'account.updated',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'account',
          objectId: account.id,
          beforeData: before,
          afterData: account,
        });
        return { account, event_id };
      },
    },
    {
      name: 'account_set_health_score',
      description: 'Set the health score (0-100) for an account',
      inputSchema: accountSetHealth,
      handler: async (input: z.infer<typeof accountSetHealth>, actor: ActorContext) => {
        const before = await accountRepo.getAccount(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Account', input.id);

        const account = await accountRepo.updateAccount(db, actor.tenant_id, input.id, {
          health_score: input.score,
        });
        if (!account) throw notFound('Account', input.id);

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'account.health_updated',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'account',
          objectId: account.id,
          beforeData: { health_score: before.health_score },
          afterData: { health_score: account.health_score },
          metadata: input.rationale ? { rationale: input.rationale } : {},
        });
        return { account, event_id };
      },
    },
    {
      name: 'account_get_hierarchy',
      description: 'Get the parent/child hierarchy for an account',
      inputSchema: z.object({ id: z.string().uuid() }),
      handler: async (input: { id: string }, actor: ActorContext) => {
        const result = await accountRepo.getAccountHierarchy(db, actor.tenant_id, input.id);
        if (!result) throw notFound('Account', input.id);
        return result;
      },
    },
  ];
}
