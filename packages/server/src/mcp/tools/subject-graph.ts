// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import type { ActorContext } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import {
  resolveSubjectGraph,
  type CustomerSubjectType,
} from '../../services/subject-graph-resolver.js';
import type { ToolDef } from '../server.js';

export const customerRecordResolveInput = z.object({
  query: z.string().min(1).optional().describe(
    'A short customer reference to resolve, such as "Nike Pegasus expansion", "Maya at Nike", or "forecast automation for Acme".',
  ),
  text: z.string().min(1).optional().describe(
    'Longer source text to resolve against accounts, contacts, opportunities, and use cases.',
  ),
  subject_type: z.enum(['account', 'contact', 'opportunity', 'use_case', 'any']).default('any').describe(
    'Optional target record type. Opportunities and use cases resolve best inside account scope.',
  ),
  account_hint: z.string().optional().describe(
    'Known account/customer name, alias, or domain to narrow child-record resolution.',
  ),
  confidence_threshold: z.number().min(0).max(1).default(0.67).describe(
    'Minimum confidence threshold for model-assisted matches.',
  ),
  limit: z.number().int().min(1).max(20).default(15).describe(
    'Maximum number of records/candidates to return.',
  ),
});

export function subjectGraphTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'customer_record_resolve',
      tier: 'core',
      description:
        'Resolve customer-facing GTM references across accounts, contacts, opportunities, and use cases. ' +
        'This is account-first: child records such as opportunities and use cases are resolved inside a matched account whenever possible. ' +
        'Returns resolved subjects, account scope, ambiguity receipts, records examined, and reviewed record proposals. ' +
        'Use this for customer-record lookup before briefing or action. For messy transcripts, emails, notes, or research that should become Signals and Memory, call context_ingest_auto instead. entity_resolve is compatibility-only simple account/contact lookup.',
      inputSchema: customerRecordResolveInput,
      handler: async (input: z.infer<typeof customerRecordResolveInput>, actor: ActorContext) => {
        return resolveSubjectGraph(db, actor, {
          ...input,
          subject_type: input.subject_type as CustomerSubjectType,
        });
      },
    },
  ];
}
