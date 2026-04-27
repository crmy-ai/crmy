// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { accountCreate, accountUpdate, accountSearch, accountSetHealth } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as accountRepo from '../../db/repos/accounts.js';
import * as contextRepo from '../../db/repos/context-entries.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound, permissionDenied, duplicateError } from '@crmy/shared';
import { indexDocument, removeDocument } from '../../search/SearchIndexerService.js';
import { validateCustomFields } from '../../db/repos/custom-fields-validate.js';
import { checkAccountDuplicate } from '../../services/deduplication.js';
import type { ToolDef } from '../server.js';

export function accountTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'account_create',
      tier: 'extended',
      description: 'Create a new company record. Before calling this, prefer using entity_resolve to check if the company already exists. If a potential duplicate is detected (same domain or same name), a 409 is returned with ranked candidate records. Pass if_exists: "return_existing" to silently receive the best-matching existing record. Pass allow_duplicates: true to skip the check after confirming with the user.',
      inputSchema: accountCreate,
      handler: async (input: z.infer<typeof accountCreate>, actor: ActorContext) => {
        // ── Duplicate check ──
        if (!input.allow_duplicates) {
          const dedup = await checkAccountDuplicate(db, actor.tenant_id, {
            name: input.name,
            domain: input.domain,
            website: input.website,
          });

          if (dedup.confidence === 'definitive' || dedup.confidence === 'high') {
            if (input.if_exists === 'return_existing' && dedup.candidates[0]) {
              const existing = await accountRepo.getAccount(db, actor.tenant_id, dedup.candidates[0].id);
              return {
                account: existing,
                was_existing: true,
                duplicate_confidence: dedup.confidence,
                matched_by: dedup.candidates[0].reasons,
              };
            }
            throw duplicateError(
              `A similar account already exists (${dedup.candidates[0]?.reasons.join(', ')})`,
              dedup.candidates,
            );
          }

          if (input.custom_fields && Object.keys(input.custom_fields).length > 0) {
            input.custom_fields = await validateCustomFields(db, actor.tenant_id, 'account', input.custom_fields, { isCreate: true });
          }
          const account = await accountRepo.createAccount(db, actor.tenant_id, { ...input, created_by: actor.actor_id });
          const event_id = await emitEvent(db, {
            tenantId: actor.tenant_id, eventType: 'account.created',
            actorId: actor.actor_id, actorType: actor.actor_type,
            objectType: 'account', objectId: account.id, afterData: account,
          });
          indexDocument(db, 'account', account as unknown as Record<string, unknown>)
            .catch((err: unknown) => console.warn(`[search] account index ${account.id}: ${(err as Error).message}`));
          return {
            account,
            event_id,
            potential_duplicates: dedup.confidence === 'medium' ? dedup.candidates : undefined,
          };
        }

        // allow_duplicates=true — skip check
        if (input.custom_fields && Object.keys(input.custom_fields).length > 0) {
          input.custom_fields = await validateCustomFields(db, actor.tenant_id, 'account', input.custom_fields, { isCreate: true });
        }
        const account = await accountRepo.createAccount(db, actor.tenant_id, { ...input, created_by: actor.actor_id });
        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id, eventType: 'account.created',
          actorId: actor.actor_id, actorType: actor.actor_type,
          objectType: 'account', objectId: account.id, afterData: account,
        });
        indexDocument(db, 'account', account as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[search] account index ${account.id}: ${(err as Error).message}`));
        return { account, event_id };
      },
    },
    {
      name: 'account_get',
      tier: 'core',
      description: 'Retrieve a single company by UUID, including its linked contacts and open opportunities. Returns the full company profile with health_score, annual_revenue, industry, and custom fields. Pass include_context_entries: true to also get current context entries without a full briefing. For a comprehensive view with activity timeline and staleness warnings, use briefing_get instead.',
      inputSchema: z.object({
        id: z.string().uuid(),
        include_context_entries: z.boolean().optional().default(false).describe('If true, also return current context entries for this account'),
      }),
      handler: async (input: { id: string; include_context_entries?: boolean }, actor: ActorContext) => {
        const account = await accountRepo.getAccount(db, actor.tenant_id, input.id);
        if (!account) throw notFound('Account', input.id);

        const [contacts, open_opportunities] = await Promise.all([
          accountRepo.getAccountContacts(db, actor.tenant_id, input.id),
          accountRepo.getAccountOpenOpps(db, actor.tenant_id, input.id),
        ]);

        if (input.include_context_entries) {
          const context_entries = await contextRepo.getContextForSubject(db, actor.tenant_id, 'account', input.id);
          return { account, contacts, open_opportunities, context_entries };
        }
        return { account, contacts, open_opportunities };
      },
    },
    {
      name: 'account_search',
      tier: 'core',
      description: 'Search companies with flexible filters. Use query to search by name or domain, industry to filter by sector, owner_id for companies owned by a specific user, min_revenue for revenue thresholds, and tags for custom categorization. Returns paginated results with cursor-based pagination.',
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
      description: 'Update a company record by passing its id and a patch object with the fields to change. Supports all company fields including name, industry, domain, annual_revenue, tags, and custom_fields.',
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
      description: 'Set the health score (0–100) for a company to reflect its current relationship health. Use this after evaluating engagement patterns, support tickets, NPS responses, or other health signals. Scores below 50 typically indicate at-risk companies that need attention.',
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
      description: 'Get the parent/child hierarchy for a company, showing its position in a corporate structure. Returns the parent company (if any) and all child companies. Useful for understanding organizational relationships in enterprise deals.',
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
      description: 'Permanently delete a company and all associated data. This is a destructive action that requires admin or owner role. Consider archiving or reassigning contacts and opportunities before deletion.',
      inputSchema: z.object({ id: z.string().uuid() }),
      handler: async (input: { id: string }, actor: ActorContext) => {
        if (actor.role !== 'admin' && actor.role !== 'owner') {
          throw permissionDenied('Only admins and owners can delete companies');
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
    {
      name: 'account_merge',
      tier: 'extended',
      description: 'Merge a duplicate company (secondary) into a primary company. All contacts, opportunities, use cases, and activities linked to the secondary are reassigned to the primary. The secondary company is soft-deleted (merged_into set to primary_id). The primary retains its field values; the secondary\'s domain, name, and aliases are appended to the primary\'s aliases list. Use this to clean up duplicate company records.',
      inputSchema: z.object({
        primary_id: z.string().uuid().describe('The account to keep — its profile fields are preserved'),
        secondary_id: z.string().uuid().describe('The duplicate account to absorb — will be soft-deleted after merge'),
      }),
      handler: async (input: { primary_id: string; secondary_id: string }, actor: ActorContext) => {
        type AccountRow = { merged_into?: string; domain?: string; name?: string; aliases?: string[] };

        if (input.primary_id === input.secondary_id) {
          throw new Error('primary_id and secondary_id must be different companies');
        }

        const [primary, secondary] = await Promise.all([
          accountRepo.getAccount(db, actor.tenant_id, input.primary_id),
          accountRepo.getAccount(db, actor.tenant_id, input.secondary_id),
        ]);
        if (!primary) throw notFound('Account', input.primary_id);
        if (!secondary) throw notFound('Account', input.secondary_id);

        const sec = secondary as unknown as AccountRow;
        const pri = primary as unknown as AccountRow;
        if (sec.merged_into) {
          throw new Error('Secondary company has already been merged into another record');
        }

        let merged: Record<string, number> = {};
        await db.query('BEGIN');
        try {
          const [contacts, opps, useCases, acts] = await Promise.all([
            db.query('UPDATE contacts SET account_id=$1 WHERE account_id=$2 AND tenant_id=$3', [input.primary_id, input.secondary_id, actor.tenant_id]),
            db.query('UPDATE opportunities SET account_id=$1 WHERE account_id=$2 AND tenant_id=$3', [input.primary_id, input.secondary_id, actor.tenant_id]),
            db.query('UPDATE use_cases SET account_id=$1 WHERE account_id=$2 AND tenant_id=$3', [input.primary_id, input.secondary_id, actor.tenant_id]),
            db.query('UPDATE activities SET account_id=$1 WHERE account_id=$2 AND tenant_id=$3', [input.primary_id, input.secondary_id, actor.tenant_id]),
          ]);
          merged = {
            contacts: contacts.rowCount ?? 0,
            opportunities: opps.rowCount ?? 0,
            use_cases: useCases.rowCount ?? 0,
            activities: acts.rowCount ?? 0,
          };

          // Merge aliases: add secondary domain, name, and aliases into primary
          const newAliases = [...(pri.aliases ?? [])];
          const toAdd: string[] = [];
          if (sec.domain) toAdd.push(sec.domain);
          if (sec.name) toAdd.push(sec.name);
          for (const a of (sec.aliases ?? [])) toAdd.push(a);
          for (const a of toAdd) {
            if (!newAliases.includes(a)) newAliases.push(a);
          }
          await db.query(
            'UPDATE accounts SET aliases=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3',
            [JSON.stringify(newAliases), input.primary_id, actor.tenant_id],
          );

          await db.query(
            'UPDATE accounts SET merged_into=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3',
            [input.primary_id, input.secondary_id, actor.tenant_id],
          );

          await db.query('COMMIT');
        } catch (err) {
          await db.query('ROLLBACK');
          throw err;
        }

        const updatedPrimary = await accountRepo.getAccount(db, actor.tenant_id, input.primary_id);
        indexDocument(db, 'account', updatedPrimary as unknown as Record<string, unknown>).catch(() => {});
        removeDocument(db, actor.tenant_id, 'account', input.secondary_id).catch(() => {});

        await emitEvent(db, {
          tenantId: actor.tenant_id, eventType: 'account.merged',
          actorId: actor.actor_id, actorType: actor.actor_type,
          objectType: 'account', objectId: input.primary_id,
          afterData: { primary_id: input.primary_id, secondary_id: input.secondary_id, merged },
        });

        return { primary: updatedPrimary, secondary_id: input.secondary_id, merged_count: merged };
      },
    },
  ];
}
