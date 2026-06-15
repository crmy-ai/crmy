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
  action_packet?: {
    objective?: string;
    agent_instructions?: string[];
    use_as_truth?: Array<{ title?: string; summary?: string }>;
    use_with_caution?: Array<{ title?: string; summary?: string; status?: string }>;
    source_posture?: {
      summary?: string;
      dominant_source?: string;
      instructions?: string[];
    };
    recommended_actions?: Array<{
      label?: string;
      description?: string;
      priority?: string;
      next_tool?: string;
      requires_human_review?: boolean;
    }>;
    action_boundaries?: {
      warnings?: string[];
      blocked?: string[];
      required_review?: string[];
    };
    human_unblock?: { question?: string; reasons?: string[] };
    next_tools?: string[];
  };
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
  const command = new Command('action-context')
    .description('Get briefing plus action readiness for a customer record')
    .argument('<subject>', 'Subject as type:name or type:id, e.g. account:Northstar Labs')
    .option('--action <type>', 'Proposed action type, e.g. customer_outreach or external_writeback')
    .option('--object-type <type>', 'Target object type for the proposed action')
    .option('--fields <names>', 'Comma-separated field names affected by the proposed action')
    .option('--payload <json>', 'JSON object payload for the proposed action')
    .option('--radius <radius>', 'Context radius: direct, adjacent, or account_wide', 'direct')
    .option('--token-budget <tokens>', 'Approximate context token budget')
    .option('--token-profile <profile>', 'Token budget profile: tiny, standard, deep, or evidence_heavy')
    .option('--evidence-mode <mode>', 'Evidence detail: summary, full, or none', 'summary')
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
          token_budget_profile: opts.tokenProfile,
          evidence_mode: opts.evidenceMode,
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
        if (data.action_packet?.objective) {
          console.log(`\nAction packet: ${data.action_packet.objective}`);
        }
        if (data.action_packet?.agent_instructions?.length) {
          console.log('\nAgent instructions:');
          for (const item of data.action_packet.agent_instructions.slice(0, 4)) console.log(`- ${item}`);
        }
        if (data.action_packet?.source_posture?.summary) {
          console.log(`\nSource posture: ${data.action_packet.source_posture.summary}`);
          if (data.action_packet.source_posture.dominant_source) {
            console.log(`Dominant source: ${data.action_packet.source_posture.dominant_source}`);
          }
          for (const item of data.action_packet.source_posture.instructions?.slice(0, 3) ?? []) {
            console.log(`- ${item}`);
          }
        }
        if (data.action_packet?.recommended_actions?.length) {
          console.log('\nRecommended actions:');
          for (const item of data.action_packet.recommended_actions.slice(0, 4)) {
            const suffix = item.next_tool ? ` (next: ${item.next_tool})` : '';
            console.log(`- ${item.label ?? 'Action'}${item.priority ? ` [${item.priority}]` : ''}${suffix}: ${item.description ?? ''}`);
          }
        }
        if (data.action_packet?.use_as_truth?.length) {
          console.log('\nUse as truth:');
          for (const item of data.action_packet.use_as_truth.slice(0, 5)) {
            console.log(`- ${item.title ?? 'Memory'}: ${item.summary ?? ''}`);
          }
        }
        if (data.action_packet?.use_with_caution?.length) {
          console.log('\nUse with caution:');
          for (const item of data.action_packet.use_with_caution.slice(0, 5)) {
            console.log(`- ${item.title ?? 'Context'}${item.status ? ` (${item.status})` : ''}: ${item.summary ?? ''}`);
          }
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
        const packetBoundaries = data.action_packet?.action_boundaries;
        const boundaryItems = [
          ...(packetBoundaries?.blocked ?? []),
          ...(packetBoundaries?.required_review ?? []),
          ...(packetBoundaries?.warnings ?? []),
        ];
        if (boundaryItems.length) {
          console.log('\nAction boundaries:');
          for (const item of boundaryItems.slice(0, 8)) console.log(`- ${item}`);
        }
        if (data.action_packet?.human_unblock?.question) {
          console.log(`\nHuman unblock: ${data.action_packet.human_unblock.question}`);
        }
        if (data.action_packet?.next_tools?.length) {
          console.log(`Next tools: ${data.action_packet.next_tools.join(', ')}`);
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

  command.command('unblock')
    .description('Create a human approval or assignment from Action Context review guidance')
    .argument('<subject>', 'Subject as type:name or type:id, e.g. account:Northstar Labs')
    .option('--action <type>', 'Proposed action type, e.g. customer_outreach or external_writeback')
    .option('--object-type <type>', 'Target object type for the proposed action')
    .option('--fields <names>', 'Comma-separated field names affected by the proposed action')
    .option('--payload <json>', 'JSON object payload for the proposed action')
    .option('--type <type>', 'Request type: auto, approval, or assignment', 'auto')
    .option('--title <title>', 'Human-facing title')
    .option('--question <text>', 'Specific question for the human reviewer')
    .option('--assignee <actor-id>', 'Actor ID to assign when creating an assignment')
    .option('--reviewer <actor-id>', 'Actor ID to notify/escalate when creating an approval')
    .option('--priority <priority>', 'low, normal, high, or urgent', 'normal')
    .option('--sla-minutes <minutes>', 'SLA minutes before escalation for approval requests')
    .option('--due-at <iso>', 'Due date/time for assignment requests')
    .option('--reasoning <text>', 'Agent summary of what it found and why it stopped')
    .option('--json', 'Print full JSON response')
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

        const result = await client.call('action_context_request_human_unblock', {
          subject_type: resolved.subject_type,
          subject_id: resolved.subject_id,
          proposed_action,
          request_type: opts.type,
          title: opts.title,
          question: opts.question,
          assignee_id: opts.assignee,
          reviewer_id: opts.reviewer,
          priority: opts.priority,
          sla_minutes: opts.slaMinutes ? Number(opts.slaMinutes) : undefined,
          due_at: opts.dueAt,
          reasoning: opts.reasoning,
        });
        const parsed = JSON.parse(result) as {
          created_type?: string;
          request_id?: string;
          assignment_id?: string;
          snapshot_id?: string;
          status?: string;
        };

        if (opts.json) {
          console.log(JSON.stringify(parsed, null, 2));
          return;
        }

        console.log(`Created: ${parsed.created_type ?? 'human_unblock'}`);
        if (parsed.request_id) console.log(`HITL request: ${parsed.request_id}`);
        if (parsed.assignment_id) console.log(`Assignment: ${parsed.assignment_id}`);
        if (parsed.status) console.log(`Status: ${parsed.status}`);
        if (parsed.snapshot_id) console.log(`Handoff snapshot: ${parsed.snapshot_id}`);
      } finally {
        await client.close();
      }
    });

  return command;
}
