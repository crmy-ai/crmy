// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { hitlSubmit, hitlCheckStatus, hitlListPending, hitlResolve } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext, UUID } from '@crmy/shared';
import * as hitlRepo from '../../db/repos/hitl.js';
import { emitEvent } from '../../events/emitter.js';
import { notFound } from '@crmy/shared';
import type { ToolDef } from '../server.js';

export function hitlTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'hitl_submit_request',
      tier: 'core',
      description: 'Submit a human-in-the-loop approval request before executing any high-stakes action that should not be taken autonomously: sending proposals, making commitments, escalating pricing, or contacting executives for the first time. Set auto_approve_after_seconds to enable time-boxed autonomy (e.g. 3600 for "proceed in 1 hour if no human response"). Set priority ("low"|"normal"|"high"|"urgent") and sla_minutes to control notification urgency and escalation timing. Always poll hitl_check_status before proceeding — never assume approval. The human sees the request in the HITL Queue in the web UI and can approve, reject, or add a note.',
      inputSchema: hitlSubmit,
      handler: async (input: z.infer<typeof hitlSubmit>, actor: ActorContext) => {
        const request = await hitlRepo.createHITLRequest(db, actor.tenant_id, {
          agent_id: actor.actor_id,
          action_type: input.action_type,
          action_summary: input.action_summary,
          action_payload: input.action_payload,
          auto_approve_after_seconds: input.auto_approve_after_seconds,
          priority: input.priority,
          sla_minutes: input.sla_minutes,
          escalate_to_id: input.escalate_to_id,
        });

        await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: 'hitl.submitted',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'hitl_request',
          objectId: request.id,
          afterData: request,
        });

        return { request_id: request.id, status: request.status };
      },
    },
    {
      name: 'hitl_check_status',
      tier: 'core',
      description: 'Check the current status of a HITL approval request by its request_id. Returns "pending", "approved", or "rejected" along with any review_note the human added. Call this in a poll loop before proceeding with the gated action — never assume approval without checking. Typically poll every 30–60 seconds for time-sensitive actions.',
      inputSchema: hitlCheckStatus,
      handler: async (input: z.infer<typeof hitlCheckStatus>, actor: ActorContext) => {
        const request = await hitlRepo.getHITLRequest(db, actor.tenant_id, input.request_id);
        if (!request) throw notFound('HITL Request', input.request_id);
        return { status: request.status, review_note: request.review_note };
      },
    },
    {
      name: 'hitl_list_pending',
      tier: 'admin',
      description: 'List all pending HITL approval requests awaiting human review. Use this to check your queue of outstanding requests or to see what other agents are waiting on. Returns requests sorted by creation time with action summaries and auto-approve deadlines.',
      inputSchema: hitlListPending,
      handler: async (input: z.infer<typeof hitlListPending>, actor: ActorContext) => {
        const requests = await hitlRepo.listPendingHITL(db, actor.tenant_id, input.limit ?? 20);
        return { requests };
      },
    },
    {
      name: 'hitl_resolve',
      tier: 'admin',
      description: 'Approve or reject a pending HITL request as a human reviewer. Pass the request_id, decision ("approved" or "rejected"), and an optional note explaining your reasoning. The requesting agent will see the decision when it next polls hitl_check_status. Typically called from the web UI or by a human actor through the CLI.',
      inputSchema: hitlResolve,
      handler: async (input: z.infer<typeof hitlResolve>, actor: ActorContext) => {
        const request = await hitlRepo.resolveHITLRequest(
          db,
          actor.tenant_id,
          input.request_id,
          input.decision,
          actor.actor_id,
          input.note,
        );
        if (!request) throw notFound('HITL Request (or already resolved)', input.request_id);

        await emitEvent(db, {
          tenantId: actor.tenant_id,
          eventType: input.decision === 'approved' ? 'hitl.approved' : 'hitl.rejected',
          actorId: actor.actor_id,
          actorType: actor.actor_type,
          objectType: 'hitl_request',
          objectId: request.id,
          afterData: request,
        });

        return { request };
      },
    },
    // ── Auto-approval rule management ────────────────────────────────────────
    {
      name: 'hitl_rule_create',
      tier: 'admin',
      description: 'Create an auto-approval rule that automatically approves or rejects HITL requests matching the specified criteria without human review. Rules are evaluated in descending priority order; first match wins. condition is a JSON object {field, op, value} or array of conditions (all must match). Operators: <, >, =, !=, contains, not_contains. field is a dot-path into action_payload. Use this to automate routine low-risk actions like small email drafts or research tasks.',
      inputSchema: z.object({
        name: z.string().min(1).max(100).describe('Human-readable name for the rule'),
        action_type: z.string().optional().describe('action_type to match. Omit to match all types.'),
        condition: z.union([
          z.object({
            field: z.string(),
            op: z.enum(['<', '>', '=', '!=', 'contains', 'not_contains']),
            value: z.unknown(),
          }),
          z.array(z.object({
            field: z.string(),
            op: z.enum(['<', '>', '=', '!=', 'contains', 'not_contains']),
            value: z.unknown(),
          })),
          z.record(z.never()),
        ]).default({}).describe('Condition expression (empty = always match)'),
        decision: z.enum(['approved', 'rejected']).describe('Decision to apply when rule matches'),
        priority: z.number().int().default(0).describe('Higher priority rules are evaluated first'),
      }),
      handler: async (input: {
        name: string;
        action_type?: string;
        condition: unknown;
        decision: 'approved' | 'rejected';
        priority?: number;
      }, actor: ActorContext) => {
        const result = await db.query(
          `INSERT INTO hitl_approval_rules (tenant_id, name, action_type, condition, decision, priority)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [
            actor.tenant_id,
            input.name,
            input.action_type ?? null,
            JSON.stringify(input.condition ?? {}),
            input.decision,
            input.priority ?? 0,
          ],
        );
        return { rule: result.rows[0] };
      },
    },
    {
      name: 'hitl_rule_list',
      tier: 'admin',
      description: 'List all auto-approval rules for this tenant, sorted by priority. Use this to audit what rules are active and may be automatically approving or rejecting agent requests.',
      inputSchema: z.object({}),
      handler: async (_input: Record<never, never>, actor: ActorContext) => {
        const result = await db.query(
          'SELECT * FROM hitl_approval_rules WHERE tenant_id = $1 ORDER BY priority DESC, created_at ASC',
          [actor.tenant_id],
        );
        return { rules: result.rows, total: result.rows.length };
      },
    },
    {
      name: 'hitl_rule_delete',
      tier: 'admin',
      description: 'Delete an auto-approval rule by ID. The rule is permanently removed. Use hitl_rule_list to find rule IDs.',
      inputSchema: z.object({
        id: z.string().uuid().describe('ID of the rule to delete'),
      }),
      handler: async (input: { id: string }, actor: ActorContext) => {
        const result = await db.query(
          'DELETE FROM hitl_approval_rules WHERE id = $1 AND tenant_id = $2 RETURNING id',
          [input.id, actor.tenant_id],
        );
        if (result.rows.length === 0) throw notFound('HITL approval rule', input.id as UUID);
        return { deleted: true, id: input.id };
      },
    },
  ];
}
