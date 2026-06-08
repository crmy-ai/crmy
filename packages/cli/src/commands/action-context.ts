// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';
import { resolveSubjectRef } from './subject-ref.js';

const ACTION_TYPES = new Set([
  'customer_outreach',
  'assignment_create',
  'memory_promote',
  'record_update',
  'external_writeback',
  'sequence_step',
  'workflow_action',
  'agent_task',
]);

function parseCsv(value?: string): string[] | undefined {
  return value?.split(',').map(part => part.trim()).filter(Boolean);
}

function parseJsonObject(value?: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--payload must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

interface ActionContextPrintData {
  operating_mode?: string;
  readiness?: { status?: string; risk_level?: string; review_required?: boolean };
  guidance?: {
    summary?: string;
    warning_reasons?: string[];
    review_reasons?: string[];
    recommended_next_steps?: string[];
  };
  proof?: { retrieval_event_id?: number | string; expected_receipts?: string[] };
}

function unwrapActionContext(value: unknown): ActionContextPrintData {
  if (!value || typeof value !== 'object') return {};
  const maybeWrapped = value as { action_context?: unknown };
  const data = maybeWrapped.action_context && typeof maybeWrapped.action_context === 'object'
    ? maybeWrapped.action_context
    : value;
  return data as ActionContextPrintData;
}

export function actionContextCommand(): Command {
  return new Command('action-context')
    .description('Get briefing plus action readiness for a customer record')
    .argument('<subject>', 'Subject as type:name or type:id, e.g. account:Northstar Labs')
    .option('--action <type>', 'Proposed action type, e.g. customer_outreach or external_writeback')
    .option('--object-type <type>', 'Target object type for the proposed action')
    .option('--fields <names>', 'Comma-separated field names affected by the proposed action')
    .option('--payload <json>', 'JSON object payload for the proposed action')
    .option('--radius <radius>', 'Context radius: direct, adjacent, or account_wide', 'direct')
    .option('--token-budget <tokens>', 'Approximate context token budget')
    .option('--include-stale', 'Include stale/superseded Memory in the briefing context')
    .option('--json', 'Print the full Action Context JSON')
    .action(async (subject, opts) => {
      const client = await getClient();
      try {
        const resolved = await resolveSubjectRef(client, subject);
        if (!resolved.subject_type || !resolved.subject_id) {
          throw new Error('Subject must be type:name or type:id, for example account:Northstar Labs.');
        }

        const proposed_action = opts.action ? {
          action_type: opts.action,
          object_type: opts.objectType,
          field_names: parseCsv(opts.fields),
          payload: parseJsonObject(opts.payload),
        } : undefined;
        if (proposed_action && !ACTION_TYPES.has(proposed_action.action_type)) {
          throw new Error(`Unsupported action type: ${proposed_action.action_type}`);
        }

        const result = await client.call('action_context_get', {
          subject_type: resolved.subject_type,
          subject_id: resolved.subject_id,
          context_radius: opts.radius,
          token_budget: opts.tokenBudget ? Number(opts.tokenBudget) : undefined,
          include_stale: Boolean(opts.includeStale),
          proposed_action,
        });
        const parsed = JSON.parse(result) as unknown;
        const data = unwrapActionContext(parsed);

        if (opts.json) {
          console.log(JSON.stringify(parsed, null, 2));
          return;
        }

        console.log(`Operating mode: ${data.operating_mode ?? 'unknown'}`);
        console.log(`Readiness: ${data.readiness?.status ?? 'unknown'} (${data.readiness?.risk_level ?? 'unknown'} risk)`);
        console.log(`Review required: ${data.readiness?.review_required ? 'yes' : 'no'}`);
        if (data.guidance?.summary) {
          console.log(`\nGuidance: ${data.guidance.summary}`);
        }
        const caveats = [
          ...(data.guidance?.warning_reasons ?? []),
          ...(data.guidance?.review_reasons ?? []),
        ];
        if (caveats.length) {
          console.log('\nReasons:');
          for (const item of caveats) console.log(`- ${item}`);
        }
        if (data.guidance?.recommended_next_steps?.length) {
          console.log('\nGuidance:');
          for (const item of data.guidance.recommended_next_steps) console.log(`- ${item}`);
        }
        if (data.proof?.expected_receipts?.length) {
          console.log(`\nExpected receipts: ${data.proof.expected_receipts.join(', ')}`);
        }
        if (data.proof?.retrieval_event_id) {
          console.log(`Retrieval event: ${data.proof.retrieval_event_id}`);
        }
      } finally {
        await client.close();
      }
    });
}
