// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ActorContext, HITLRequest, UUID } from '@crmy/shared';
import { validationError } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import * as accountRepo from '../db/repos/accounts.js';
import * as contactRepo from '../db/repos/contacts.js';
import * as opportunityRepo from '../db/repos/opportunities.js';
import * as useCaseRepo from '../db/repos/use-cases.js';
import { emitEvent } from '../events/emitter.js';
import { defaultOwnerForCreate } from './access-control.js';
import { entityResolve } from './entity-resolve.js';

type ProposedRecordType = 'contact' | 'account' | 'opportunity' | 'use_case';

interface ProposedRecordPayload {
  proposed_record?: {
    record_type?: ProposedRecordType;
    name?: string;
    fields?: Record<string, unknown>;
  };
  raw_context_source_id?: string;
}

function stringField(fields: Record<string, unknown>, key: string): string | undefined {
  const value = fields[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function splitName(name: string): { first_name: string; last_name: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: '', last_name: '' };
  if (parts.length === 1) return { first_name: parts[0], last_name: '' };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

function opportunityStage(value: string | undefined): 'prospecting' | 'qualification' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost' {
  const normalized = value?.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (
    normalized === 'prospecting' ||
    normalized === 'qualification' ||
    normalized === 'proposal' ||
    normalized === 'negotiation' ||
    normalized === 'closed_won' ||
    normalized === 'closed_lost'
  ) {
    return normalized;
  }
  return 'prospecting';
}

function useCaseStage(value: string | undefined): 'discovery' | 'poc' | 'production' | 'scaling' | 'sunset' {
  const normalized = value?.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (
    normalized === 'discovery' ||
    normalized === 'poc' ||
    normalized === 'production' ||
    normalized === 'scaling' ||
    normalized === 'sunset'
  ) {
    return normalized;
  }
  return 'discovery';
}

async function ensureNoAccountDuplicate(db: DbPool, tenantId: UUID, name: string, domain?: string): Promise<void> {
  if (domain) {
    const existingByDomain = await accountRepo.getAccountByDomain(db, tenantId, domain);
    if (existingByDomain) throw validationError(`Account already exists for domain ${domain}: ${existingByDomain.name}`);
  }
	  const existingByName = await db.query(
	    `SELECT id, name FROM accounts WHERE tenant_id = $1 AND lower(name) = lower($2) AND merged_into IS NULL AND archived_at IS NULL LIMIT 1`,
    [tenantId, name],
  );
  if (existingByName.rows[0]) throw validationError(`Account already exists: ${existingByName.rows[0].name}`);
}

async function ensureNoContactDuplicate(db: DbPool, tenantId: UUID, name: string, email?: string): Promise<void> {
  if (email) {
    const existingByEmail = await contactRepo.getContactByEmail(db, tenantId, email);
    if (existingByEmail) throw validationError(`Contact already exists for ${email}`);
  }
  const { first_name, last_name } = splitName(name);
  const existingByName = await db.query(
    `SELECT id, first_name, last_name
     FROM contacts
	     WHERE tenant_id = $1
	       AND lower(first_name) = lower($2)
	       AND lower(last_name) = lower($3)
	       AND merged_into IS NULL
	       AND archived_at IS NULL
	     LIMIT 1`,
    [tenantId, first_name, last_name],
  );
  if (existingByName.rows[0]) throw validationError(`Contact already exists: ${name}`);
}

async function resolveAccountId(db: DbPool, actor: ActorContext, fields: Record<string, unknown>): Promise<string | undefined> {
  const accountId = stringField(fields, 'account_id');
  if (accountId) return accountId;
  const accountName = stringField(fields, 'account_name') ?? stringField(fields, 'company_name');
  if (!accountName) return undefined;
  const resolved = await entityResolve(db, actor.tenant_id, {
    query: accountName,
    entity_type: 'account',
    actor_id: actor.actor_id,
    limit: 3,
  });
  return resolved.status === 'resolved' ? resolved.resolved?.id : undefined;
}

async function ensureNoNamedDuplicate(
  db: DbPool,
  tenantId: UUID,
  table: 'opportunities' | 'use_cases',
  name: string,
  accountId?: string,
): Promise<void> {
  const result = await db.query(
    `SELECT id, name FROM ${table}
     WHERE tenant_id = $1
       AND lower(name) = lower($2)
       AND ($3::uuid IS NULL OR account_id = $3::uuid)
     LIMIT 1`,
    [tenantId, name, accountId ?? null],
  );
  if (result.rows[0]) throw validationError(`${table === 'opportunities' ? 'Opportunity' : 'Use Case'} already exists: ${result.rows[0].name}`);
}

export async function applyApprovedRecordCreation(
  db: DbPool,
  actor: ActorContext,
  request: HITLRequest,
): Promise<{ object_type: ProposedRecordType; object_id: string } | null> {
  if (request.action_type !== 'record.create.review' || request.status !== 'approved') return null;
  const payload = request.action_payload as ProposedRecordPayload;
  const proposed = payload.proposed_record;
  if (!proposed?.record_type) throw validationError('Approved record proposal is missing a record type.');
  const fields = proposed.fields ?? {};
  const name = stringField(fields, 'name') ?? proposed.name;
  if (!name) throw validationError('Approved record proposal is missing a name.');
  const ownerId = await defaultOwnerForCreate(db, actor);

  let objectId: string;
  if (proposed.record_type === 'account') {
    const domain = stringField(fields, 'domain');
    await ensureNoAccountDuplicate(db, actor.tenant_id, name, domain);
    const account = await accountRepo.createAccount(db, actor.tenant_id, {
      name,
      domain,
      owner_id: ownerId ?? undefined,
      created_by: ownerId ?? undefined,
      custom_fields: { raw_context_source_id: payload.raw_context_source_id },
    });
    objectId = account.id;
  } else if (proposed.record_type === 'contact') {
    const email = stringField(fields, 'email');
    await ensureNoContactDuplicate(db, actor.tenant_id, name, email);
    const { first_name, last_name } = splitName(name);
    const contact = await contactRepo.createContact(db, actor.tenant_id, {
      first_name,
      last_name,
      email,
      title: stringField(fields, 'title'),
      company_name: stringField(fields, 'company_name') ?? stringField(fields, 'account_name'),
      account_id: await resolveAccountId(db, actor, fields),
      source: 'raw_context',
      owner_id: ownerId ?? undefined,
      created_by: ownerId ?? undefined,
      custom_fields: { raw_context_source_id: payload.raw_context_source_id },
    });
    objectId = contact.id;
  } else if (proposed.record_type === 'opportunity') {
    const accountId = await resolveAccountId(db, actor, fields);
    await ensureNoNamedDuplicate(db, actor.tenant_id, 'opportunities', name, accountId);
    const opportunity = await opportunityRepo.createOpportunity(db, actor.tenant_id, {
      name,
      account_id: accountId,
      stage: opportunityStage(stringField(fields, 'stage')),
      description: stringField(fields, 'description'),
      owner_id: ownerId ?? undefined,
      created_by: ownerId ?? undefined,
      custom_fields: { raw_context_source_id: payload.raw_context_source_id },
    });
    objectId = opportunity.id;
  } else {
    const accountId = await resolveAccountId(db, actor, fields);
    if (!accountId) throw validationError('Use Case proposals require a matched account before CRMy can create the record.');
    await ensureNoNamedDuplicate(db, actor.tenant_id, 'use_cases', name, accountId);
    const useCase = await useCaseRepo.createUseCase(db, actor.tenant_id, {
      name,
      account_id: accountId,
      stage: useCaseStage(stringField(fields, 'stage')),
      description: stringField(fields, 'description'),
      owner_id: ownerId ?? undefined,
      created_by: ownerId ?? undefined,
      custom_fields: { raw_context_source_id: payload.raw_context_source_id },
    });
    objectId = useCase.id;
  }

  await emitEvent(db, {
    tenantId: actor.tenant_id,
    eventType: `${proposed.record_type}.created`,
    actorId: actor.actor_id,
    actorType: actor.actor_type,
    objectType: proposed.record_type,
    objectId,
    afterData: {
      created_from: 'raw_context_record_proposal',
      hitl_request_id: request.id,
      raw_context_source_id: payload.raw_context_source_id,
    },
  });
  return { object_type: proposed.record_type, object_id: objectId };
}
