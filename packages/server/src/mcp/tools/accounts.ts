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
import { writeToolUx } from '../tool-ux.js';
import { assertOwnedObjectAccess, defaultOwnerForCreate, resolveOwnerFilter } from '../../services/access-control.js';
import { verifiedActionContextMetadataForReceipt } from '../../services/action-context.js';

function requireAdmin(actor: ActorContext): void {
  if (actor.role !== 'admin' && actor.role !== 'owner') {
    throw permissionDenied('Only admins and owners can perform this account data-governance action');
  }
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

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
      description: 'Create a new account record. Before calling this, use customer_record_resolve to check if the customer already exists; use entity_resolve only as a compatibility fallback for simple account/contact lookup. If a potential duplicate is detected (same domain or same name), a 409 is returned with ranked candidate records. Pass if_exists: "return_existing" to silently receive the best-matching existing record. Pass allow_duplicates: true to skip the check after confirming with the user.',
      inputSchema: accountCreate,
      ux: writeToolUx({
        displayName: 'Create account',
        actionPhrase: 'create the account',
        objectLabel: 'account',
      }),
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
      description: 'Retrieve a single account by ID, including its linked contacts and open opportunities. Returns the full account profile with health_score, annual_revenue, industry, and custom fields. Pass include_context_entries: true to also get current context entries without a full briefing. For a comprehensive view with activity timeline and staleness warnings, use briefing_get instead.',
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
      description: 'Search accounts with flexible filters. Use query to search by name or domain, industry to filter by sector, owner_id for accounts owned by a specific user, min_revenue for revenue thresholds, and tags for custom categorization. Returns paginated results with cursor-based pagination.',
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
      description: 'Update an account record by passing its id and a patch object with the fields to change. Supports all account fields including name, industry, domain, annual_revenue, tags, and custom_fields.',
      inputSchema: accountUpdate,
      ux: writeToolUx({
        displayName: 'Update account',
        actionPhrase: 'update the account',
        objectLabel: 'account',
      }),
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
        const actionContextMetadata = await verifiedActionContextMetadataForReceipt(db, actor, 'account', input.id, input.action_context);

        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'account.updated',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'account',
          objectId: account.id,
          beforeData: before,
          afterData: account,
          metadata: actionContextMetadata ? { action_context: actionContextMetadata } : undefined,
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
      description: 'Set the health score (0–100) for an account to reflect its current relationship health. Use this after evaluating engagement patterns, support tickets, NPS responses, or other health signals. Scores below 50 typically indicate at-risk accounts that need attention.',
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
      description: 'Get the parent/child hierarchy for an account, showing its position in a corporate structure. Returns the parent account (if any) and all child accounts. Useful for understanding organizational relationships in enterprise deals.',
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
      description: 'Archive an account while preserving evidence, lineage, Handoffs, and writeback anchors. This hides the account from active workflows and requires admin or owner role.',
      inputSchema: z.object({
        id: z.string().uuid(),
        idempotency_key: z.string().max(128).optional(),
        expected_version: z.number().int().positive().optional(),
      }),
      handler: async (input: { id: string; idempotency_key?: string; expected_version?: number }, actor: ActorContext) => {
        return runAccountOperation(db, actor, 'account_delete', input, async () => {
        requireAdmin(actor);
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
      name: 'account_split_domains',
      tier: 'admin',
      description: 'Move one or more domains from a source account to an existing target account. This resolves account-domain collisions and supports account splits when a mailbox/calendar domain was attached to the wrong account. Admin/owner only. Optionally moves contacts and domain-matched email/calendar records; account-level Memory remains on the source unless moved separately after review.',
      inputSchema: z.object({
        source_account_id: z.string().uuid().describe('The account currently holding the domain(s)'),
        target_account_id: z.string().uuid().describe('The account that should own the selected domain(s)'),
        domains: z.array(z.string().min(1)).min(1).max(25).describe('Domains to move, e.g. acquired-brand.com'),
        move_matching_records: z.boolean().optional().default(true).describe('Move contacts and domain-matched email/calendar records from source to target'),
        idempotency_key: z.string().max(128).optional(),
      }),
      handler: async (input: {
        source_account_id: string;
        target_account_id: string;
        domains: string[];
        move_matching_records?: boolean;
        idempotency_key?: string;
      }, actor: ActorContext) => {
        return runAccountOperation(db, actor, 'account_split_domains', input, async () => {
        requireAdmin(actor);
        if (input.source_account_id === input.target_account_id) {
          throw new Error('source_account_id and target_account_id must be different accounts');
        }
        const domains = [...new Set(input.domains.map(normalizeDomain).filter(Boolean))];
        if (domains.length === 0) throw new Error('At least one valid domain is required');
        const [source, target] = await Promise.all([
          accountRepo.getAccount(db, actor.tenant_id, input.source_account_id),
          accountRepo.getAccount(db, actor.tenant_id, input.target_account_id),
        ]);
        if (!source) throw notFound('Account', input.source_account_id);
        if (!target) throw notFound('Account', input.target_account_id);
        await assertOwnedObjectAccess(db, actor, 'account', input.source_account_id);
        await assertOwnedObjectAccess(db, actor, 'account', input.target_account_id);

        const externalConflicts = (await accountRepo.getAccountDomainConflicts(db, actor.tenant_id, domains, input.source_account_id))
          .filter(conflict => conflict.existing_account.id !== input.target_account_id);
        if (externalConflicts.length > 0) {
          throw new CrmyError('CONFLICT', `Domain ${externalConflicts[0].domain} belongs to another account. Resolve that conflict before splitting.`, 409, {
            domain_conflicts: externalConflicts,
            resolution_actions: ['choose_that_account_as_target', 'remove_domain_from_other_account', 'merge_accounts_if_duplicate'],
          });
        }

        let moved: Record<string, number> = {};
        let updatedSource: Account | null = null;
        let updatedTarget: Account | null = null;
        let event_id: number | undefined;
        await withTransaction(db, async (tx) => {
          const domainRows = await tx.query(
            `SELECT domain FROM account_domains
             WHERE tenant_id = $1 AND account_id = $2 AND lower(domain) = ANY($3::text[])`,
            [actor.tenant_id, input.source_account_id, domains],
          );
          const heldDomains = new Set(domainRows.rows.map(row => String(row.domain).toLowerCase()));
          const missing = domains.filter(domain => !heldDomains.has(domain) && normalizeDomain(source.domain ?? '') !== domain);
          if (missing.length > 0) {
            throw new CrmyError('VALIDATION_ERROR', `Domain ${missing[0]} is not associated with ${source.name}.`, 422, {
              errors: missing.map(domain => ({ field: 'domains', message: `${domain} is not on the source account` })),
            });
          }

          await tx.query(
            `UPDATE accounts SET domain = NULL, updated_at = now(), row_version = row_version + 1
             WHERE tenant_id = $1 AND id = $2 AND lower(domain) = ANY($3::text[])`,
            [actor.tenant_id, input.source_account_id, domains],
          );
          const movedDomains = await tx.query(
            `UPDATE account_domains
             SET account_id = $3, is_primary = FALSE, source = 'account_split', updated_at = now()
             WHERE tenant_id = $1 AND account_id = $2 AND lower(domain) = ANY($4::text[])`,
            [actor.tenant_id, input.source_account_id, input.target_account_id, domains],
          );
          for (const domain of domains) {
            await tx.query(
              `INSERT INTO account_domains (tenant_id, account_id, domain, source, is_primary)
               VALUES ($1,$2,$3,'account_split',FALSE)
               ON CONFLICT (tenant_id, lower(domain))
               DO UPDATE SET account_id = EXCLUDED.account_id, source = EXCLUDED.source, is_primary = FALSE, updated_at = now()
               WHERE account_domains.account_id IN ($4::uuid, $2::uuid)`,
              [actor.tenant_id, input.target_account_id, domain, input.source_account_id],
            );
          }

          let movedContactIds: string[] = [];
          if (input.move_matching_records !== false) {
            const contacts = await tx.query(
              `UPDATE contacts
               SET account_id = $3, updated_at = now(), row_version = row_version + 1
               WHERE tenant_id = $1 AND account_id = $2 AND lower(split_part(email, '@', 2)) = ANY($4::text[])
               RETURNING id`,
              [actor.tenant_id, input.source_account_id, input.target_account_id, domains],
            );
            movedContactIds = contacts.rows.map(row => row.id as string);
            const opps = movedContactIds.length
              ? await tx.query(
                `UPDATE opportunities
                 SET account_id = $3, updated_at = now(), row_version = row_version + 1
                 WHERE tenant_id = $1 AND account_id = $2 AND contact_id = ANY($4::uuid[])`,
                [actor.tenant_id, input.source_account_id, input.target_account_id, movedContactIds],
              )
              : { rowCount: 0 };
            const emailMessages = await tx.query(
              `UPDATE email_messages
               SET account_id = $3, updated_at = now()
               WHERE tenant_id = $1 AND account_id = $2 AND (
                 lower(split_part(from_email, '@', 2)) = ANY($4::text[])
                 OR EXISTS (SELECT 1 FROM unnest(to_emails || cc_emails) e WHERE lower(split_part(e, '@', 2)) = ANY($4::text[]))
               )`,
              [actor.tenant_id, input.source_account_id, input.target_account_id, domains],
            );
            const calendarEvents = await tx.query(
              `UPDATE calendar_events
               SET account_id = $3, updated_at = now()
               WHERE tenant_id = $1 AND account_id = $2 AND (
                 lower(split_part(organizer_email, '@', 2)) = ANY($4::text[])
                 OR EXISTS (SELECT 1 FROM unnest(attendee_emails) e WHERE lower(split_part(e, '@', 2)) = ANY($4::text[]))
               )`,
              [actor.tenant_id, input.source_account_id, input.target_account_id, domains],
            );
            const emails = await tx.query(
              `UPDATE emails
               SET account_id = $3, updated_at = now()
               WHERE tenant_id = $1 AND account_id = $2 AND lower(split_part(to_email, '@', 2)) = ANY($4::text[])`,
              [actor.tenant_id, input.source_account_id, input.target_account_id, domains],
            );
            moved = {
              domains: movedDomains.rowCount ?? 0,
              contacts: contacts.rowCount ?? 0,
              opportunities: opps.rowCount ?? 0,
              email_messages: emailMessages.rowCount ?? 0,
              calendar_events: calendarEvents.rowCount ?? 0,
              outbound_emails: emails.rowCount ?? 0,
            };
          } else {
            moved = { domains: movedDomains.rowCount ?? domains.length };
          }

          updatedSource = await accountRepo.getAccount(tx, actor.tenant_id, input.source_account_id);
          updatedTarget = await accountRepo.getAccount(tx, actor.tenant_id, input.target_account_id);
          event_id = await emitEvent(tx, {
            tenantId: actor.tenant_id,
            eventType: 'account.domains_split',
            actorId: actor.actor_id,
            actorType: actor.actor_type,
            objectType: 'account',
            objectId: input.target_account_id,
            beforeData: { source_account_id: input.source_account_id, target_account_id: input.target_account_id, domains },
            afterData: { moved },
          });
        });

        if (updatedSource) indexDocument(db, 'account', updatedSource as unknown as Record<string, unknown>).catch(() => {});
        if (updatedTarget) indexDocument(db, 'account', updatedTarget as unknown as Record<string, unknown>).catch(() => {});

        return {
          source_account: updatedSource,
          target_account: updatedTarget,
          moved_count: moved,
          event_id,
          note: 'Account-level Memory, Handoffs, and account-scoped context remain on the source account unless reviewed and moved separately.',
          mutation: mutationReceipt(actor, {
            objectType: 'account',
            objectId: input.target_account_id,
            rowVersion: (updatedTarget as Account | null)?.row_version,
            eventId: event_id,
            sideEffects: ['search_index:queued'],
          }),
        };
        });
      },
    },
    {
      name: 'account_merge',
      tier: 'admin',
      description: 'Merge a duplicate account (secondary) into a primary account. Admin/owner only. All contacts, opportunities, use cases, activities, account-scoped context, email/calendar records, assignments, signal groups, and Raw Context receipts linked to the secondary are reassigned to the primary. The secondary account is soft-deleted (merged_into set to primary_id). The primary retains its profile fields; the secondary domain, additional domains, name, and aliases are preserved on the primary as aliases/additional domains.',
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

        requireAdmin(actor);

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
          throw new Error('Secondary account has already been merged into another record');
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
          const activitySubjects = await tx.query("UPDATE activities SET subject_id=$1 WHERE subject_id=$2 AND subject_type='account' AND tenant_id=$3", [input.primary_id, input.secondary_id, actor.tenant_id]);
          const contextEntries = await tx.query("UPDATE context_entries SET subject_id=$1 WHERE subject_id=$2 AND subject_type='account' AND tenant_id=$3", [input.primary_id, input.secondary_id, actor.tenant_id]);
          const assignments = await tx.query("UPDATE assignments SET subject_id=$1 WHERE subject_id=$2 AND subject_type='account' AND tenant_id=$3", [input.primary_id, input.secondary_id, actor.tenant_id]);
          const rawSources = await tx.query("UPDATE raw_context_sources SET subject_id=$1 WHERE subject_id=$2 AND subject_type='account' AND tenant_id=$3", [input.primary_id, input.secondary_id, actor.tenant_id]);
          const signalGroups = await tx.query("UPDATE signal_groups SET subject_id=$1, updated_at=now() WHERE subject_id=$2 AND subject_type='account' AND tenant_id=$3", [input.primary_id, input.secondary_id, actor.tenant_id]);
          const emailMessages = await tx.query('UPDATE email_messages SET account_id=$1, updated_at=now() WHERE account_id=$2 AND tenant_id=$3', [input.primary_id, input.secondary_id, actor.tenant_id]);
          const emails = await tx.query('UPDATE emails SET account_id=$1, updated_at=now() WHERE account_id=$2 AND tenant_id=$3', [input.primary_id, input.secondary_id, actor.tenant_id]);
          const calendarEvents = await tx.query('UPDATE calendar_events SET account_id=$1, updated_at=now() WHERE account_id=$2 AND tenant_id=$3', [input.primary_id, input.secondary_id, actor.tenant_id]);
          const domains = await tx.query(
            `UPDATE account_domains
             SET account_id=$1, is_primary=FALSE, source='account_merge', updated_at=now()
             WHERE account_id=$2 AND tenant_id=$3`,
            [input.primary_id, input.secondary_id, actor.tenant_id],
          );
          const normalizedSecondaryDomain = normalizeDomain(sec.domain ?? '');
          if (normalizedSecondaryDomain && normalizedSecondaryDomain !== normalizeDomain(pri.domain ?? '')) {
            await tx.query(
              `INSERT INTO account_domains (tenant_id, account_id, domain, source, is_primary)
               VALUES ($1,$2,$3,'account_merge',FALSE)
               ON CONFLICT (tenant_id, lower(domain)) DO NOTHING`,
              [actor.tenant_id, input.primary_id, normalizedSecondaryDomain],
            );
          }
          merged = {
            contacts: contacts.rowCount ?? 0,
            opportunities: opps.rowCount ?? 0,
            use_cases: useCases.rowCount ?? 0,
            activities: acts.rowCount ?? 0,
            activity_subjects: activitySubjects.rowCount ?? 0,
            context_entries: contextEntries.rowCount ?? 0,
            assignments: assignments.rowCount ?? 0,
            raw_context_sources: rawSources.rowCount ?? 0,
            signal_groups: signalGroups.rowCount ?? 0,
            email_messages: emailMessages.rowCount ?? 0,
            outbound_emails: emails.rowCount ?? 0,
            calendar_events: calendarEvents.rowCount ?? 0,
            domains: domains.rowCount ?? 0,
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
