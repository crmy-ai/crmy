// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { uuid } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import { entityResolve } from '../../services/entity-resolve.js';
import type { ToolDef } from '../server.js';

// ─── Input schema ──────────────────────────────────────────────────────────

export const entityResolveInput = z.object({
  query: z.string().min(1).describe(
    'The name, alias, abbreviation, email, or domain to resolve. ' +
    'Examples: "JPMC", "John Smith", "alice@acme.com", "acme.com".',
  ),
  entity_type: z.enum(['contact', 'account', 'any']).default('any').describe(
    'Constrain the search to a specific entity type, or "any" to search both.',
  ),
  context_hints: z.object({
    company_name: z.string().optional().describe(
      'Company or account name to narrow contact results. ' +
      'Use when the query is a person name that appears at multiple companies.',
    ),
    email_domain: z.string().optional().describe(
      'Domain suffix to narrow account results, e.g. "jpmorgan.com".',
    ),
    title: z.string().optional().describe(
      'Job title to narrow contact results, e.g. "CRO" or "VP Sales".',
    ),
    email: z.string().email().optional().describe(
      'Exact email address — shortcut to a high-confidence contact match.',
    ),
  }).optional(),
  actor_id: uuid.optional().describe(
    'ID of the actor making the request. When provided, entities that the actor ' +
    'has previously interacted with (activities, context entries, assignments) ' +
    'are ranked higher, reflecting their working set.',
  ),
  limit: z.number().int().min(1).max(10).default(5).describe(
    'Maximum number of candidates to return when the result is ambiguous.',
  ),
});

// ─── Tool definition ───────────────────────────────────────────────────────

export function entityResolveTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'entity_resolve',
      description:
        'Resolve a natural-language entity reference to a canonical CRM record. ' +
        'Handles abbreviations (e.g. "JPMC" → JP Morgan Chase), aliases, typos, ' +
        'and ambiguous names (e.g. multiple "John Smith" contacts). ' +
        'Returns status="resolved" with a single match, status="ambiguous" with ' +
        'ranked candidates (use context_hints or create an Approval request to disambiguate), ' +
        'or status="not_found". ' +
        'Always call this tool before any contact_get/account_get when you have a name ' +
        'but not a UUID — never guess an ID.',
      inputSchema: entityResolveInput,
      handler: async (input: z.infer<typeof entityResolveInput>, actor: ActorContext) => {
        // Use the requesting actor's ID for affinity scoring unless overridden
        const actorId = input.actor_id ?? actor.actor_id;
        return entityResolve(db, actor.tenant_id, {
          ...input,
          actor_id: actorId,
        });
      },
    },
  ];
}
