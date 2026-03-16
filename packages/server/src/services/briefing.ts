// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../db/pool.js';
import type { Briefing, UUID, SubjectType } from '@crmy/shared';
import * as contactRepo from '../db/repos/contacts.js';
import * as accountRepo from '../db/repos/accounts.js';
import * as oppRepo from '../db/repos/opportunities.js';
import * as ucRepo from '../db/repos/use-cases.js';
import * as activityRepo from '../db/repos/activities.js';
import * as assignmentRepo from '../db/repos/assignments.js';
import * as contextRepo from '../db/repos/context-entries.js';

/**
 * Parse a duration string like "7d", "24h", "30m" into an ISO timestamp.
 */
function parseSince(since?: string): string | undefined {
  if (!since) return undefined;

  // If it looks like an ISO date, return as-is
  if (since.includes('T') || since.includes('-')) return since;

  const match = since.match(/^(\d+)([dhm])$/);
  if (!match) return since;

  const [, num, unit] = match;
  const ms = parseInt(num, 10) * (unit === 'd' ? 86400000 : unit === 'h' ? 3600000 : 60000);
  return new Date(Date.now() - ms).toISOString();
}

/**
 * Assemble a unified briefing for any CRM object.
 */
export async function assembleBriefing(
  db: DbPool,
  tenantId: UUID,
  subjectType: SubjectType,
  subjectId: UUID,
  options?: {
    since?: string;
    context_types?: string[];
    include_stale?: boolean;
  },
): Promise<Briefing> {
  const sinceDate = parseSince(options?.since);

  // 1. Get the subject record
  const subject = await getSubjectRecord(db, tenantId, subjectType, subjectId);

  // 2. Get related objects
  const related_objects = await getRelatedObjects(db, tenantId, subjectType, subjectId, subject);

  // 3. Get activity timeline
  const activityFilters: { limit: number; types?: string[] } = { limit: 10 };
  const timelineResult = await activityRepo.getSubjectTimeline(
    db, tenantId, subjectType, subjectId, activityFilters,
  );
  let activities = timelineResult.activities;
  if (sinceDate) {
    activities = activities.filter(a => (a.occurred_at ?? a.created_at) >= sinceDate);
  }

  // 4. Get open assignments
  const assignmentResult = await assignmentRepo.searchAssignments(db, tenantId, {
    subject_type: subjectType,
    subject_id: subjectId,
    limit: 100,
  });
  const open_assignments = assignmentResult.data.filter(
    a => !['completed', 'declined', 'cancelled'].includes(a.status),
  );

  // 5. Get current context entries
  const allContext = await contextRepo.getContextForSubject(db, tenantId, subjectType, subjectId, {
    current_only: !options?.include_stale,
    limit: 200,
  });

  // Group by context_type, optionally filter
  const context_entries: Record<string, typeof allContext> = {};
  for (const entry of allContext) {
    if (options?.context_types?.length && !options.context_types.includes(entry.context_type)) {
      continue;
    }
    if (!context_entries[entry.context_type]) {
      context_entries[entry.context_type] = [];
    }
    context_entries[entry.context_type].push(entry);
  }

  // 6. Get staleness warnings
  const staleness_warnings = await contextRepo.listStaleEntries(db, tenantId, {
    subject_type: subjectType,
    subject_id: subjectId,
    limit: 50,
  });

  return {
    subject: subject as Record<string, unknown>,
    subject_type: subjectType,
    related_objects,
    activities,
    open_assignments,
    context_entries,
    staleness_warnings,
  };
}

async function getSubjectRecord(
  db: DbPool,
  tenantId: UUID,
  subjectType: SubjectType,
  subjectId: UUID,
): Promise<Record<string, unknown>> {
  switch (subjectType) {
    case 'contact': {
      const r = await contactRepo.getContact(db, tenantId, subjectId);
      if (!r) throw new Error(`Contact ${subjectId} not found`);
      return r as unknown as Record<string, unknown>;
    }
    case 'account': {
      const r = await accountRepo.getAccount(db, tenantId, subjectId);
      if (!r) throw new Error(`Account ${subjectId} not found`);
      return r as unknown as Record<string, unknown>;
    }
    case 'opportunity': {
      const r = await oppRepo.getOpportunity(db, tenantId, subjectId);
      if (!r) throw new Error(`Opportunity ${subjectId} not found`);
      return r as unknown as Record<string, unknown>;
    }
    case 'use_case': {
      const r = await ucRepo.getUseCase(db, tenantId, subjectId);
      if (!r) throw new Error(`Use Case ${subjectId} not found`);
      return r as unknown as Record<string, unknown>;
    }
    default:
      throw new Error(`Unknown subject type: ${subjectType}`);
  }
}

async function getRelatedObjects(
  db: DbPool,
  tenantId: UUID,
  subjectType: SubjectType,
  subjectId: UUID,
  subject: Record<string, unknown>,
): Promise<Record<string, unknown[]>> {
  const related: Record<string, unknown[]> = {};

  switch (subjectType) {
    case 'contact': {
      if (subject.account_id) {
        const account = await accountRepo.getAccount(db, tenantId, subject.account_id as UUID);
        if (account) related.accounts = [account];
        // Get open opportunities for the contact's account
        const opps = await oppRepo.searchOpportunities(db, tenantId, {
          account_id: subject.account_id as UUID,
          limit: 10,
        });
        if (opps.data.length) related.opportunities = opps.data;
      }
      break;
    }
    case 'account': {
      const contacts = await contactRepo.searchContacts(db, tenantId, {
        account_id: subjectId,
        limit: 20,
      });
      if (contacts.data.length) related.contacts = contacts.data;
      const opps = await oppRepo.searchOpportunities(db, tenantId, {
        account_id: subjectId,
        limit: 10,
      });
      if (opps.data.length) related.opportunities = opps.data;
      break;
    }
    case 'opportunity': {
      if (subject.account_id) {
        const account = await accountRepo.getAccount(db, tenantId, subject.account_id as UUID);
        if (account) related.accounts = [account];
      }
      if (subject.contact_id) {
        const contact = await contactRepo.getContact(db, tenantId, subject.contact_id as UUID);
        if (contact) related.contacts = [contact];
      }
      // Use Cases linked to this opportunity are queried by raw SQL since
      // searchUseCases doesn't support opportunity_id filter
      const ucResult = await db.query(
        `SELECT * FROM use_cases WHERE tenant_id = $1 AND opportunity_id = $2 LIMIT 10`,
        [tenantId, subjectId],
      );
      if (ucResult.rows.length) related.use_cases = ucResult.rows;
      break;
    }
    case 'use_case': {
      if (subject.opportunity_id) {
        const opp = await oppRepo.getOpportunity(db, tenantId, subject.opportunity_id as UUID);
        if (opp) related.opportunities = [opp];
      }
      const ucContacts = await ucRepo.listContacts(db, subjectId);
      if (ucContacts.length) related.contacts = ucContacts;
      break;
    }
  }

  return related;
}

/**
 * Format a briefing as human-readable text.
 */
export function formatBriefingText(briefing: Briefing): string {
  const lines: string[] = [];

  // Header
  const name = (briefing.subject as Record<string, unknown>).name
    ?? `${(briefing.subject as Record<string, unknown>).first_name} ${(briefing.subject as Record<string, unknown>).last_name}`;
  lines.push(`=== BRIEFING: ${name} (${briefing.subject_type}) ===`);
  lines.push('');

  // Staleness warnings
  if (briefing.staleness_warnings.length > 0) {
    lines.push(`⚠ ${briefing.staleness_warnings.length} stale context entries need review`);
    for (const w of briefing.staleness_warnings) {
      lines.push(`  - ${w.context_type}: ${w.title ?? w.body.slice(0, 60)}... (expired ${w.valid_until})`);
    }
    lines.push('');
  }

  // Related objects
  if (Object.keys(briefing.related_objects).length > 0) {
    lines.push('--- Related Objects ---');
    for (const [type, items] of Object.entries(briefing.related_objects)) {
      for (const item of items as Record<string, unknown>[]) {
        const itemName = item.name ?? `${item.first_name} ${item.last_name}`;
        lines.push(`  ${type}: ${itemName} (${(item.id as string).slice(0, 8)})`);
      }
    }
    lines.push('');
  }

  // Activity timeline
  if (briefing.activities.length > 0) {
    lines.push('--- Recent Activities ---');
    for (const a of briefing.activities) {
      const ts = a.occurred_at ?? a.created_at;
      lines.push(`  [${ts}] ${a.type}: ${a.subject}${a.outcome ? ` → ${a.outcome}` : ''}`);
    }
    lines.push('');
  }

  // Open assignments
  if (briefing.open_assignments.length > 0) {
    lines.push('--- Open Assignments ---');
    for (const a of briefing.open_assignments) {
      lines.push(`  [${a.priority}] ${a.title} (${a.status})${a.due_at ? ` due: ${a.due_at}` : ''}`);
    }
    lines.push('');
  }

  // Context entries
  if (Object.keys(briefing.context_entries).length > 0) {
    lines.push('--- Context ---');
    for (const [type, entries] of Object.entries(briefing.context_entries)) {
      lines.push(`  [${type}]`);
      for (const e of entries) {
        const conf = e.confidence != null ? ` (${Math.round(e.confidence * 100)}%)` : '';
        const title = e.title ? `${e.title}: ` : '';
        const body = e.body.length > 500 ? e.body.slice(0, 500) + '...' : e.body;
        lines.push(`    ${title}${body}${conf}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
