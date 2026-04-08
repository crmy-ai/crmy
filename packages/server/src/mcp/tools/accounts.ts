// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { accountCreate, accountUpdate, accountSearch, accountSetHealth } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as accountRepo from '../../db/repos/accounts.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound, permissionDenied } from '@crmy/shared';
import { indexDocument, removeDocument } from '../../search/SearchIndexerService.js';
import { validateCustomFields } from '../../db/repos/custom-fields-validate.js';
import type { ToolDef } from '../server.js';

export function accountTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'account_create',
      tier: 'extended',
      description: 'Create a new account representing a company or organization. Set name, industry, domain, website, annual_revenue, and employee_count to build a complete profile. Accounts are the top-level entity that contacts, opportunities, and use cases roll up to.',
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
        indexDocument(db, 'account', account as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[search] account index ${account.id}: ${(err as Error).message}`));
        return { account, event_id };
      },
    },
    {
      name: 'account_get',
      tier: 'core',
      description: 'Retrieve a single account by UUID, including its linked contacts and open opportunities. Returns the full account profile with health_score, annual_revenue, industry, and custom fields. For a comprehensive view with context entries and activity timeline, use briefing_get instead.',
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
      tier: 'core',
      description: 'Search accounts with flexible filters. Use query to search by name or domain, industry to filter by sector, owner_id for accounts owned by a specific user, min_revenue for revenue thresholds, and tags for custom categorization. Returns paginated results with cursor-based pagination.',
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
      tier: 'extended',
      description: 'Update an account by passing its id and a patch object with the fields to change. Supports all account fields including name, industry, domain, annual_revenue, tags, and custom_fields.',
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
        indexDocument(db, 'account', account as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[search] account index ${account.id}: ${(err as Error).message}`));
        return { account, event_id };
      },
    },
    {
      name: 'account_set_health_score',
      tier: 'extended',
      description: 'Set the health score (0–100) for an account to reflect its current relationship health. Use this after evaluating engagement patterns, support tickets, NPS responses, or other health signals. Scores below 50 typically indicate at-risk accounts that need attention.',
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
        indexDocument(db, 'account', account as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[search] account index ${account.id}: ${(err as Error).message}`));
        return { account, event_id };
      },
    },
    {
      name: 'account_get_hierarchy',
      tier: 'extended',
      description: 'Get the parent/child hierarchy for an account, showing its position in a corporate structure. Returns the parent account (if any) and all child accounts. Useful for understanding organizational relationships in enterprise deals.',
      inputSchema: z.object({ id: z.string().uuid() }),
      handler: async (input: { id: string }, actor: ActorContext) => {
        const result = await accountRepo.getAccountHierarchy(db, actor.tenant_id, input.id);
        if (!result) throw notFound('Account', input.id);
        return result;
      },
    },
    {
      name: 'account_delete',
      tier: 'admin',
      description: 'Permanently delete an account and all associated data. This is a destructive action that requires admin or owner role. Consider archiving or reassigning contacts and opportunities before deletion.',
      inputSchema: z.object({ id: z.string().uuid() }),
      handler: async (input: { id: string }, actor: ActorContext) => {
        if (actor.role !== 'admin' && actor.role !== 'owner') {
          throw permissionDenied('Only admins and owners can delete accounts');
        }
        const before = await accountRepo.getAccount(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Account', input.id);

        await accountRepo.deleteAccount(db, actor.tenant_id, input.id);
        removeDocument(db, actor.tenant_id, 'account', input.id)
          .catch((err: unknown) => console.warn(`[search] account remove ${input.id}: ${(err as Error).message}`));
        await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'account.deleted',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'account',
          objectId: input.id,
          beforeData: before,
        });
        return { deleted: true };
      },
    },
  ];
}
