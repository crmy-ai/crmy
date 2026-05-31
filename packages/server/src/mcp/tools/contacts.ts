// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { contactCreate, contactUpdate, contactSearch, contactSetLifecycle, contactGetTimeline } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext, Contact } from '@crmy/shared';
import * as contactRepo from '../../db/repos/contacts.js';
import * as activityRepo from '../../db/repos/activities.js';
import * as contextRepo from '../../db/repos/context-entries.js';
import * as oppRepo from '../../db/repos/opportunities.js';
import { emitEvent } from '../../events/emitter.js';
import { CrmyError, notFound, permissionDenied, duplicateError } from '@crmy/shared';
import { indexDocument, removeDocument } from '../../search/SearchIndexerService.js';
import { validateCustomFields } from '../../db/repos/custom-fields-validate.js';
import { computeLeadScore } from '../../services/scoring.js';
import { checkContactDuplicate } from '../../services/deduplication.js';
import { runIdempotent } from '../../db/repos/idempotency.js';
import { withTransaction } from '../../db/transaction.js';
import { mutationReceipt } from '../mutation-receipt.js';
import type { ToolDef } from '../server.js';
import { assertOwnedObjectAccess, defaultOwnerForCreate, resolveOwnerFilter } from '../../services/access-control.js';

function runContactOperation<T>(
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

export function contactTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'contact_create',
      tier: 'core',
      description: 'Create a new contact record. Contact names are stored as first_name (required) and last_name (optional) separately. Before calling this tool, use customer_record_resolve with the contact name, email, and account context to check if the contact already exists; use entity_resolve only as a compatibility fallback for simple account/contact lookup. If a potential duplicate is detected (same email, or same name + account), a 409 is returned with ranked candidate records. Pass if_exists: "return_existing" to silently receive the best-matching existing record instead of erroring. Pass allow_duplicates: true to skip the check entirely after confirming with the user.',
      inputSchema: contactCreate,
      handler: async (input: z.infer<typeof contactCreate>, actor: ActorContext) => {
        return runContactOperation(db, actor, 'contact_create', input, async () => {
        // ── Duplicate check ──
        if (!input.allow_duplicates) {
          const dedup = await checkContactDuplicate(db, actor.tenant_id, {
            first_name: input.first_name,
            last_name: input.last_name,
            email: input.email,
            phone: input.phone,
            company_name: input.company_name,
            account_id: input.account_id,
          });

          if (dedup.confidence === 'definitive' || dedup.confidence === 'high') {
            if (input.if_exists === 'return_existing' && dedup.candidates[0]) {
              const existing = await contactRepo.getContact(db, actor.tenant_id, dedup.candidates[0].id);
              return {
                contact: existing,
                was_existing: true,
                duplicate_confidence: dedup.confidence,
                matched_by: dedup.candidates[0].reasons,
              };
            }
            throw duplicateError(
              `A similar contact already exists (${dedup.candidates[0]?.reasons.join(', ')})`,
              dedup.candidates,
            );
          }

          if (input.custom_fields && Object.keys(input.custom_fields).length > 0) {
            input.custom_fields = await validateCustomFields(db, actor.tenant_id, 'contact', input.custom_fields, { isCreate: true });
          }
          const owner_id = await defaultOwnerForCreate(db, actor, input.owner_id);
          const contact = await contactRepo.createContact(db, actor.tenant_id, { ...input, owner_id: owner_id ?? undefined, created_by: actor.actor_id });
          const event_id = await emitEvent(db, {
            tenantId: actor.tenant_id, eventType: 'contact.created',
            actorId: actor.actor_id, actorType: actor.actor_type,
            objectType: 'contact', objectId: contact.id, afterData: contact,
          });
          indexDocument(db, 'contact', contact as unknown as Record<string, unknown>)
            .catch((err: unknown) => console.warn(`[search] contact index ${contact.id}: ${(err as Error).message}`));
          return {
            contact,
            event_id,
            mutation: mutationReceipt(actor, {
              objectType: 'contact',
              objectId: contact.id,
              rowVersion: contact.row_version,
              eventId: event_id,
              sideEffects: ['search_index:queued'],
            }),
            potential_duplicates: dedup.confidence === 'medium' ? dedup.candidates : undefined,
          };
        }

        // allow_duplicates=true — skip check
        if (input.custom_fields && Object.keys(input.custom_fields).length > 0) {
          input.custom_fields = await validateCustomFields(db, actor.tenant_id, 'contact', input.custom_fields, { isCreate: true });
        }
        const owner_id = await defaultOwnerForCreate(db, actor, input.owner_id);
        const contact = await contactRepo.createContact(db, actor.tenant_id, { ...input, owner_id: owner_id ?? undefined, created_by: actor.actor_id });
        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id, eventType: 'contact.created',
          actorId: actor.actor_id, actorType: actor.actor_type,
          objectType: 'contact', objectId: contact.id, afterData: contact,
        });
        indexDocument(db, 'contact', contact as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[search] contact index ${contact.id}: ${(err as Error).message}`));
        return {
          contact,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'contact',
            objectId: contact.id,
            rowVersion: contact.row_version,
            eventId: event_id,
            sideEffects: ['search_index:queued'],
          }),
        };
        });
      },
    },
    {
      name: 'contact_get',
      tier: 'core',
      description: 'Retrieve a single contact by UUID including their profile, account association, lifecycle stage, and custom fields. Pass include_context_entries: true to also get current context entries without a full briefing. For a comprehensive view with activities, assignments, and staleness warnings, use briefing_get on the contact instead.',
      inputSchema: z.object({
        id: z.string().uuid(),
        include_context_entries: z.boolean().optional().default(false).describe('If true, also return current context entries for this contact'),
      }),
      handler: async (input: { id: string; include_context_entries?: boolean }, actor: ActorContext) => {
        const contact = await contactRepo.getContact(db, actor.tenant_id, input.id);
        if (!contact) throw notFound('Contact', input.id);
        await assertOwnedObjectAccess(db, actor, 'contact', input.id);
        if (input.include_context_entries) {
          const context_entries = await contextRepo.getContextForSubject(db, actor.tenant_id, 'contact', input.id);
          return { contact, context_entries };
        }
        return { contact };
      },
    },
    {
      name: 'contact_get_opportunities',
      tier: 'core',
      description: 'Get all opportunities linked to a contact. Returns active and closed deals for this contact sorted by created_at descending. Useful for quickly understanding deal history without navigating account-level pipeline.',
      inputSchema: z.object({
        contact_id: z.string().uuid().describe('UUID of the contact'),
        stage: z.string().optional().describe('Filter to a specific stage (e.g. "prospecting", "closed_won")'),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      handler: async (input: { contact_id: string; stage?: string; limit?: number }, actor: ActorContext) => {
        const contact = await contactRepo.getContact(db, actor.tenant_id, input.contact_id);
        if (!contact) throw notFound('Contact', input.contact_id);
        await assertOwnedObjectAccess(db, actor, 'contact', input.contact_id);
        const result = await oppRepo.searchOpportunities(db, actor.tenant_id, {
          contact_id: input.contact_id as never,
          stage: input.stage,
          limit: input.limit ?? 20,
        });
        return { contact_id: input.contact_id, opportunities: result.data, total: result.total };
      },
    },
    {
      name: 'contact_search',
      tier: 'core',
      description: 'Search contacts with flexible filters. The query parameter searches across name, email, and linked account fields simultaneously. Filter by lifecycle_stage to find prospects or champions, account_id to see contacts at a specific account, owner_id for contacts owned by a specific rep, and tags for custom categorization. Returns paginated results.',
      inputSchema: contactSearch,
      handler: async (input: z.infer<typeof contactSearch>, actor: ActorContext) => {
        const ownerFilter = await resolveOwnerFilter(db, actor, input.owner_id);
        const result = await contactRepo.searchContacts(db, actor.tenant_id, {
          ...input,
          ...ownerFilter,
          limit: input.limit ?? 20,
        });
        return { contacts: result.data, next_cursor: result.next_cursor, total: result.total };
      },
    },
    {
      name: 'contact_update',
      tier: 'extended',
      description: 'Update a contact record. Pass the contact ID and a patch object containing only the fields to change. Contact names are stored as first_name and last_name separately — to rename a contact pass { first_name: "Thomas" } or { last_name: "Rivera" } or both. Other patchable fields: email, phone, title, company_name, account_id, lifecycle_stage, tags, custom_fields. Example: { id: "<contact-id>", patch: { first_name: "Thomas", last_name: "Rivera" } }',
      inputSchema: contactUpdate,
      handler: async (input: z.infer<typeof contactUpdate>, actor: ActorContext) => {
        return runContactOperation(db, actor, 'contact_update', input, async () => {
        const before = await contactRepo.getContact(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Contact', input.id);
        await assertOwnedObjectAccess(db, actor, 'contact', input.id);

        if (input.patch.custom_fields && Object.keys(input.patch.custom_fields).length > 0) {
          input.patch.custom_fields = await validateCustomFields(db, actor.tenant_id, 'contact', input.patch.custom_fields);
        }
        const contact = await contactRepo.updateContact(db, actor.tenant_id, input.id, input.patch, {
          expectedVersion: input.expected_version,
        });
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
        indexDocument(db, 'contact', contact as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[search] contact index ${contact.id}: ${(err as Error).message}`));
        return {
          contact,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'contact',
            objectId: contact.id,
            rowVersion: contact.row_version,
            eventId: event_id,
            sideEffects: ['search_index:queued'],
          }),
        };
        });
      },
    },
    {
      name: 'contact_set_lifecycle',
      tier: 'core',
      description: 'Set the lifecycle stage of a contact to reflect their current position in the funnel. Valid stages: lead, prospect, customer, churned. Use this when a contact progresses through the pipeline or changes status.',
      inputSchema: contactSetLifecycle,
      handler: async (input: z.infer<typeof contactSetLifecycle>, actor: ActorContext) => {
        return runContactOperation(db, actor, 'contact_set_lifecycle', input, async () => {
        const before = await contactRepo.getContact(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Contact', input.id);
        await assertOwnedObjectAccess(db, actor, 'contact', input.id);

        const contact = await contactRepo.updateContact(db, actor.tenant_id, input.id, {
          lifecycle_stage: input.lifecycle_stage,
        }, {
          expectedVersion: input.expected_version,
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
        indexDocument(db, 'contact', contact as unknown as Record<string, unknown>)
          .catch((err: unknown) => console.warn(`[search] contact index ${contact.id}: ${(err as Error).message}`));
        return {
          contact,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'contact',
            objectId: contact.id,
            rowVersion: contact.row_version,
            eventId: event_id,
            sideEffects: ['search_index:queued'],
          }),
        };
        });
      },
    },
    {
      name: 'contact_get_timeline',
      tier: 'extended',
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
      tier: 'admin',
      description: 'Permanently delete a contact and all associated data. This is a destructive action that requires admin or owner role. Consider archiving or reassigning activities before deletion.',
      inputSchema: z.object({
        id: z.string().uuid(),
        idempotency_key: z.string().max(128).optional(),
        expected_version: z.number().int().positive().optional(),
      }),
      handler: async (input: { id: string; idempotency_key?: string; expected_version?: number }, actor: ActorContext) => {
        return runContactOperation(db, actor, 'contact_delete', input, async () => {
        if (actor.role !== 'admin' && actor.role !== 'owner') {
          throw permissionDenied('Only admins and owners can delete contacts');
        }
        const before = await contactRepo.getContact(db, actor.tenant_id, input.id);
        if (!before) throw notFound('Contact', input.id);

        await contactRepo.deleteContact(db, actor.tenant_id, input.id, {
          expectedVersion: input.expected_version,
        });
        removeDocument(db, actor.tenant_id, 'contact', input.id)
          .catch((err: unknown) => console.warn(`[search] contact remove ${input.id}: ${(err as Error).message}`));
        const event_id = await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'contact.deleted',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'contact',
          objectId: input.id,
          beforeData: before,
        });
        return {
          deleted: true,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'contact',
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
      name: 'contact_score',
      tier: 'core',
      description: 'Compute or retrieve the lead score (0–100) for a contact. The score reflects recency and volume of activities, quality of context entries, lifecycle stage, and engagement quality (calls/meetings weighted higher than emails). Returns the score with a breakdown by component so you can understand what\'s driving it. Use this before prioritising which contacts to follow up on.',
      inputSchema: z.object({
        contact_id: z.string().uuid().describe('ID of the contact to score'),
        idempotency_key: z.string().max(128).optional(),
        expected_version: z.number().int().positive().optional(),
      }),
      handler: async (input: { contact_id: string; idempotency_key?: string; expected_version?: number }, actor: ActorContext) => {
        return runContactOperation(db, actor, 'contact_score', input, async () => {
        const before = await contactRepo.getContact(db, actor.tenant_id, input.contact_id);
        if (!before) throw notFound('Contact', input.contact_id);
        const { score, breakdown } = await computeLeadScore(db, actor.tenant_id, input.contact_id);
        // Persist score
        const params: unknown[] = [score, input.contact_id, actor.tenant_id];
        const versionClause = input.expected_version !== undefined ? ' AND row_version = $4' : '';
        if (input.expected_version !== undefined) params.push(input.expected_version);
        const updated = await db.query(
          `UPDATE contacts
           SET lead_score = $1, lead_score_updated_at = now(), row_version = row_version + 1, updated_at = now()
           WHERE id = $2 AND tenant_id = $3${versionClause}
           RETURNING row_version`,
          params,
        );
        if (updated.rows.length === 0 && input.expected_version !== undefined) {
          throw concurrencyConflict('Contact', input.contact_id, input.expected_version);
        }
        return {
          contact_id: input.contact_id,
          lead_score: score,
          score_breakdown: breakdown,
          last_updated: new Date().toISOString(),
          mutation: mutationReceipt(actor, {
            objectType: 'contact',
            objectId: input.contact_id,
            rowVersion: updated.rows[0]?.row_version,
          }),
        };
        });
      },
    },
    {
      name: 'contact_merge',
      tier: 'extended',
      description: 'Merge a duplicate contact (secondary) into a primary contact. All activities, context entries, opportunities, assignments, and sequence enrollments are reassigned to the primary. The secondary contact is soft-deleted (merged_into set to primary_id). The primary retains its own field values; the secondary\'s email, phone, and aliases are appended to the primary\'s aliases list. Use this to clean up duplicate records after identifying them.',
      inputSchema: z.object({
        primary_id: z.string().uuid().describe('The contact to keep — its profile fields are preserved'),
        secondary_id: z.string().uuid().describe('The duplicate contact to absorb — will be soft-deleted after merge'),
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
        return runContactOperation(db, actor, 'contact_merge', input, async () => {
        if (input.primary_id === input.secondary_id) {
          throw new Error('primary_id and secondary_id must be different contacts');
        }

        type ContactRow = { merged_into?: string; email?: string; phone?: string; first_name?: string; last_name?: string; aliases?: string[] };
        const [primary, secondary] = await Promise.all([
          contactRepo.getContact(db, actor.tenant_id, input.primary_id),
          contactRepo.getContact(db, actor.tenant_id, input.secondary_id),
        ]);
        if (!primary) throw notFound('Contact', input.primary_id);
        if (!secondary) throw notFound('Contact', input.secondary_id);
        await assertOwnedObjectAccess(db, actor, 'contact', input.primary_id);
        await assertOwnedObjectAccess(db, actor, 'contact', input.secondary_id);
        const sec = secondary as unknown as ContactRow;
        const pri = primary as unknown as ContactRow;
        if (sec.merged_into) {
          throw new Error('Secondary contact has already been merged into another record');
        }
        if (input.primary_expected_version !== undefined && primary.row_version !== input.primary_expected_version) {
          throw concurrencyConflict('Contact', input.primary_id, input.primary_expected_version);
        }
        if (input.secondary_expected_version !== undefined && secondary.row_version !== input.secondary_expected_version) {
          throw concurrencyConflict('Contact', input.secondary_id, input.secondary_expected_version);
        }

        let merged: Record<string, number> = {};
        let updatedPrimary: Contact | null = null;
        let event_id: number | undefined;
        await withTransaction(db, async (tx) => {
          // Reassign child records
          const acts = await tx.query('UPDATE activities SET contact_id=$1 WHERE contact_id=$2 AND tenant_id=$3', [input.primary_id, input.secondary_id, actor.tenant_id]);
          const ctx = await tx.query('UPDATE context_entries SET subject_id=$1 WHERE subject_id=$2 AND subject_type=$3 AND tenant_id=$4', [input.primary_id, input.secondary_id, 'contact', actor.tenant_id]);
          const opps = await tx.query('UPDATE opportunities SET contact_id=$1 WHERE contact_id=$2 AND tenant_id=$3', [input.primary_id, input.secondary_id, actor.tenant_id]);
          const asgn = await tx.query('UPDATE assignments SET subject_id=$1 WHERE subject_id=$2 AND subject_type=$3 AND tenant_id=$4', [input.primary_id, input.secondary_id, 'contact', actor.tenant_id]);
          const seqEnr = await tx.query('UPDATE sequence_enrollments SET contact_id=$1 WHERE contact_id=$2 AND tenant_id=$3', [input.primary_id, input.secondary_id, actor.tenant_id]);
          merged = {
            activities: acts.rowCount ?? 0,
            context_entries: ctx.rowCount ?? 0,
            opportunities: opps.rowCount ?? 0,
            assignments: asgn.rowCount ?? 0,
            sequence_enrollments: seqEnr.rowCount ?? 0,
          };

          // Merge aliases: add secondary email, phone, name, and aliases to primary
          const newAliases = [...(pri.aliases ?? [])];
          const toAdd: string[] = [];
          if (sec.email) toAdd.push(sec.email);
          if (sec.phone) toAdd.push(sec.phone);
          const secName = `${sec.first_name ?? ''} ${sec.last_name ?? ''}`.trim();
          if (secName) toAdd.push(secName);
          for (const a of (sec.aliases ?? [])) toAdd.push(a);
          for (const a of toAdd) {
            if (!newAliases.includes(a)) newAliases.push(a);
          }
          const primaryParams: unknown[] = [newAliases, input.primary_id, actor.tenant_id];
          const primaryVersionClause = input.primary_expected_version !== undefined ? ' AND row_version = $4' : '';
          if (input.primary_expected_version !== undefined) primaryParams.push(input.primary_expected_version);
          const primaryUpdate = await tx.query(
            `UPDATE contacts SET aliases=$1, updated_at=now(), row_version = row_version + 1
             WHERE id=$2 AND tenant_id=$3${primaryVersionClause}`,
            primaryParams,
          );
          if ((primaryUpdate.rowCount ?? 0) === 0 && input.primary_expected_version !== undefined) {
            throw concurrencyConflict('Contact', input.primary_id, input.primary_expected_version);
          }

          const secondaryParams: unknown[] = [input.primary_id, input.secondary_id, actor.tenant_id];
          const secondaryVersionClause = input.secondary_expected_version !== undefined ? ' AND row_version = $4' : '';
          if (input.secondary_expected_version !== undefined) secondaryParams.push(input.secondary_expected_version);
          const secondaryUpdate = await tx.query(
            `UPDATE contacts SET merged_into=$1, updated_at=now(), row_version = row_version + 1
             WHERE id=$2 AND tenant_id=$3${secondaryVersionClause}`,
            secondaryParams,
          );
          if ((secondaryUpdate.rowCount ?? 0) === 0 && input.secondary_expected_version !== undefined) {
            throw concurrencyConflict('Contact', input.secondary_id, input.secondary_expected_version);
          }

          updatedPrimary = await contactRepo.getContact(tx, actor.tenant_id, input.primary_id);
          event_id = await emitEvent(tx, {
            tenantId: actor.tenant_id, eventType: 'contact.merged',
            actorId: actor.actor_id, actorType: actor.actor_type,
            objectType: 'contact', objectId: input.primary_id,
            afterData: { primary_id: input.primary_id, secondary_id: input.secondary_id, merged },
          });
        });

        // Re-index primary, remove secondary from search
        indexDocument(db, 'contact', updatedPrimary as unknown as Record<string, unknown>)
          .catch(() => {});
        removeDocument(db, actor.tenant_id, 'contact', input.secondary_id)
          .catch(() => {});

        return {
          primary: updatedPrimary,
          secondary_id: input.secondary_id,
          merged_count: merged,
          event_id,
          mutation: mutationReceipt(actor, {
            objectType: 'contact',
            objectId: input.primary_id,
            rowVersion: (updatedPrimary as Contact | null)?.row_version,
            eventId: event_id,
            sideEffects: ['search_index:queued', 'search_remove:queued'],
          }),
        };
        });
      },
    },
  ];
}
