// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { accountCreate, accountUpdate, accountSearch, accountSetHealth } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { Account, ActorContext } from '@crmy/shared';
import * as accountRepo from '../../db/repos/accounts.js';
import * as contextRepo from '../../db/repos/context-entries.js';
import { emitEvent } from '../../events/emitter.js';
import { CrmyError, notFound, permissionDenied, duplicateError } from '@crmy/shared';
import { indexDocument, removeDocument } from '../../search/SearchIndexerService.js';
import { validateCustomFields } from '../../db/repos/custom-fields-validate.js';
import { checkAccountDuplicate } from '../../services/deduplication.js';
import { runIdempotent } from '../../db/repos/idempotency.js';
import { withTransaction } from '../../db/transaction.js';
import { mutationReceipt } from '../mutation-receipt.js';
import type { ToolDef } from '../server.js';
import { assertOwnedObjectAccess, defaultOwnerForCreate, resolveOwnerFilter } from '../../services/access-control.js';

function runAccountOperation<T>(
  db: DbPool,
  actor: ActorContext,
  operation: string,
  input: object,
  fn: () => Promise<T>,
): Promise<T> {
  const idempotencyKey = (input as { idempotency_key?: string }).idempotency_key;
  return runIdempotent(db, {
    tenantId: actor.tenant_id,
    actorId: actor.actor_id,
    operation,
    key: idempotencyKey,
    request: input,
  }, fn);
}

function concurrencyConflict(entity: string, id: string, expectedVersion: number): CrmyError {
  return new CrmyError(
    'CONFLICT',
    `${entity} ${id} was modified by another writer; refresh the object and retry with the latest row_version`,
    409,
    { expected_version: expectedVersion },
  );
}

export function accountTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'account_create',
      tier: 'extended',
      description: 'Create a new company record. Before calling this, prefer using entity_resolve to check if the company already exists. If a potential duplicate is detected (same domain or same name), a 409 is returned with ranked candidate records. Pass if_exists: "return_existing" to silently receive the best-matching existing record. Pass allow_duplicates: true to skip the check after confirming with the user.',
      inputSchema: accountCreate,
      handler: async (input: z.infer<typeof accountCreate>, actor: ActorContext) => {
        return runAccountOperation(db, actor, 'account_create', input, async () => {
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
          const owner_id = await defaultOwnerForCreate(db, actor, input.owner_id);
          const account = await accountRepo.createAccount(db, actor.tenant_id, { ...input, owner_id: owner_id ?? undefined, created_by: actor.actor_id });
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
            mutation: mutationReceipt(actor, {
              objectType: 'account',
              objectId: account.id,
              rowVersion: account.row_version,
              eventId: event_id,
              sideEffects: ['search_index:queued'],
            }),
            potential_duplicates: dedup.confidence === 'medium' ? dedup.candidates : undefined,
          };
        }

        // allow_duplicates=true — skip check
        if (input.custom_fields && Object.keys(input.custom_fields).length > 0) {
          input.custom_fields = await validateCustomFields(db, actor.tenant_id, 'account', input.custom_fields, { isCreate: true });
        }
        const owner_id = await defaultOwnerForCreate(db, actor, input.owner_id);
        const account = await accountRepo.createAccount(db, actor.tenant_id, { ...input, owner_id: owner_id ?? undefined, created_by: actor.actor_id });
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
          mutation: mutationReceipt(actor, {
            objectType: 'account',
            objectId: account.id,
            rowVersion: account.row_version,
            eventId: event_id,
            sideEffects: ['search_index:queued'],
          }),
        };
        });
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
        await assertOwnedObjectAccess(db, actor, 'account', input.id);

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
        const ownerFilter = await resolveOwnerFilter(db, actor, input.owner_id);
        const result = await accountRepo.searchAccounts(db, actor.tenant_id, {
          ...input,
          ...ownerFilter,
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
        return runAccountOperation(db, actor, 'account_update', input, async () => {
        const before = await accountRepo.getAccount(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Account', input.id);
        await assertOwnedObjectAccess(db, actor, 'account', input.id);

        if (input.patch.custom_fields && Object.keys(input.patch.custom_fields).length > 0) {
          input.patch.custom_fields = await validateCustomFields(db, actor.tenant_id, 'account', input.patch.custom_fields);
        }
        const account = await accountRepo.updateAccount(db, actor.tenant_id, input.id, input.patch, {
          expectedVersion: input.expected_version,
        });
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
        return {
          account,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'account',
            objectId: account.id,
            rowVersion: account.row_version,
            eventId: event_id,
            sideEffects: ['search_index:queued'],
          }),
        };
        });
      },
    },
    {
      name: 'account_set_health_score',
      tier: 'extended',
      description: 'Set the health score (0–100) for a company to reflect its current relationship health. Use this after evaluating engagement patterns, support tickets, NPS responses, or other health signals. Scores below 50 typically indicate at-risk companies that need attention.',
      inputSchema: accountSetHealth,
      handler: async (input: z.infer<typeof accountSetHealth>, actor: ActorContext) => {
        return runAccountOperation(db, actor, 'account_set_health_score', input, async () => {
        const before = await accountRepo.getAccount(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Account', input.id);
        await assertOwnedObjectAccess(db, actor, 'account', input.id);

        const account = await accountRepo.updateAccount(db, actor.tenant_id, input.id, {
          health_score: input.score,
        }, {
          expectedVersion: input.expected_version,
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
        return {
          account,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'account',
            objectId: account.id,
            rowVersion: account.row_version,
            eventId: event_id,
            sideEffects: ['search_index:queued'],
          }),
        };
        });
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
        await assertOwnedObjectAccess(db, actor, 'account', input.id);
        return result;
      },
    },
    {
      name: 'account_delete',
      tier: 'admin',
      description: 'Permanently delete a company and all associated data. This is a destructive action that requires admin or owner role. Consider archiving or reassigning contacts and opportunities before deletion.',
      inputSchema: z.object({
        id: z.string().uuid(),
        idempotency_key: z.string().max(128).optional(),
        expected_version: z.number().int().positive().optional(),
      }),
      handler: async (input: { id: string; idempotency_key?: string; expected_version?: number }, actor: ActorContext) => {
        return runAccountOperation(db, actor, 'account_delete', input, async () => {
        if (actor.role !== 'admin' && actor.role !== 'owner') {
          throw permissionDenied('Only admins and owners can delete companies');
        }
        const before = await accountRepo.getAccount(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Account', input.id);
        await assertOwnedObjectAccess(db, actor, 'account', input.id);

        await accountRepo.deleteAccount(db, actor.tenant_id, input.id, {
          expectedVersion: input.expected_version,
        });
        removeDocument(db, actor.tenant_id, 'account', input.id)
          .catch((err: unknown) => console.warn(`[search] account remove ${input.id}: ${(err as Error).message}`));
        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'account.deleted',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'account',
          objectId: input.id,
          beforeData: before,
        });
        return {
          deleted: true,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'account',
            objectId: input.id,
            rowVersion: before.row_version,
            eventId: event_id,
            sideEffects: ['search_remove:queued'],
          }),
        };
        });
      },
    },
    {
      name: 'account_merge',
      tier: 'extended',
      description: 'Merge a duplicate company (secondary) into a primary company. All contacts, opportunities, use cases, and activities linked to the secondary are reassigned to the primary. The secondary company is soft-deleted (merged_into set to primary_id). The primary retains its field values; the secondary\'s domain, name, and aliases are appended to the primary\'s aliases list. Use this to clean up duplicate company records.',
      inputSchema: z.object({
        primary_id: z.string().uuid().describe('The account to keep — its profile fields are preserved'),
        secondary_id: z.string().uuid().describe('The duplicate account to absorb — will be soft-deleted after merge'),
        idempotency_key: z.string().max(128).optional(),
        primary_expected_version: z.number().int().positive().optional(),
        secondary_expected_version: z.number().int().positive().optional(),
      }),
      handler: async (input: {
        primary_id: string;
        secondary_id: string;
        idempotency_key?: string;
        primary_expected_version?: number;
        secondary_expected_version?: number;
      }, actor: ActorContext) => {
        return runAccountOperation(db, actor, 'account_merge', input, async () => {
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
        await assertOwnedObjectAccess(db, actor, 'account', input.primary_id);
        await assertOwnedObjectAccess(db, actor, 'account', input.secondary_id);

        const sec = secondary as unknown as AccountRow;
        const pri = primary as unknown as AccountRow;
        if (sec.merged_into) {
          throw new Error('Secondary company has already been merged into another record');
        }
        if (input.primary_expected_version !== undefined && primary.row_version !== input.primary_expected_version) {
          throw concurrencyConflict('Account', input.primary_id, input.primary_expected_version);
        }
        if (input.secondary_expected_version !== undefined && secondary.row_version !== input.secondary_expected_version) {
          throw concurrencyConflict('Account', input.secondary_id, input.secondary_expected_version);
        }

        let merged: Record<string, number> = {};
        let updatedPrimary: Account | null = null;
        let event_id: number | undefined;
        await withTransaction(db, async (tx) => {
          const contacts = await tx.query('UPDATE contacts SET account_id=$1 WHERE account_id=$2 AND tenant_id=$3', [input.primary_id, input.secondary_id, actor.tenant_id]);
          const opps = await tx.query('UPDATE opportunities SET account_id=$1 WHERE account_id=$2 AND tenant_id=$3', [input.primary_id, input.secondary_id, actor.tenant_id]);
          const useCases = await tx.query('UPDATE use_cases SET account_id=$1 WHERE account_id=$2 AND tenant_id=$3', [input.primary_id, input.secondary_id, actor.tenant_id]);
          const acts = await tx.query('UPDATE activities SET account_id=$1 WHERE account_id=$2 AND tenant_id=$3', [input.primary_id, input.secondary_id, actor.tenant_id]);
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
          const primaryParams: unknown[] = [newAliases, input.primary_id, actor.tenant_id];
          const primaryVersionClause = input.primary_expected_version !== undefined ? ' AND row_version = $4' : '';
          if (input.primary_expected_version !== undefined) primaryParams.push(input.primary_expected_version);
          const primaryUpdate = await tx.query(
            `UPDATE accounts SET aliases=$1, updated_at=now(), row_version = row_version + 1
             WHERE id=$2 AND tenant_id=$3${primaryVersionClause}`,
            primaryParams,
          );
          if ((primaryUpdate.rowCount ?? 0) === 0 && input.primary_expected_version !== undefined) {
            throw concurrencyConflict('Account', input.primary_id, input.primary_expected_version);
          }

          const secondaryParams: unknown[] = [input.primary_id, input.secondary_id, actor.tenant_id];
          const secondaryVersionClause = input.secondary_expected_version !== undefined ? ' AND row_version = $4' : '';
          if (input.secondary_expected_version !== undefined) secondaryParams.push(input.secondary_expected_version);
          const secondaryUpdate = await tx.query(
            `UPDATE accounts SET merged_into=$1, updated_at=now(), row_version = row_version + 1
             WHERE id=$2 AND tenant_id=$3${secondaryVersionClause}`,
            secondaryParams,
          );
          if ((secondaryUpdate.rowCount ?? 0) === 0 && input.secondary_expected_version !== undefined) {
            throw concurrencyConflict('Account', input.secondary_id, input.secondary_expected_version);
          }

          updatedPrimary = await accountRepo.getAccount(tx, actor.tenant_id, input.primary_id);
          event_id = await emitEvent(tx, {
            tenantId: actor.tenant_id, eventType: 'account.merged',
            actorId: actor.actor_id, actorType: actor.actor_type,
            objectType: 'account', objectId: input.primary_id,
            afterData: { primary_id: input.primary_id, secondary_id: input.secondary_id, merged },
          });
        });

        indexDocument(db, 'account', updatedPrimary as unknown as Record<string, unknown>).catch(() => {});
        removeDocument(db, actor.tenant_id, 'account', input.secondary_id).catch(() => {});

        return {
          primary: updatedPrimary,
          secondary_id: input.secondary_id,
          merged_count: merged,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'account',
            objectId: input.primary_id,
            rowVersion: (updatedPrimary as Account | null)?.row_version,
            eventId: event_id,
            sideEffects: ['search_index:queued', 'search_remove:queued'],
          }),
        };
        });
      },
    },
  ];
}
