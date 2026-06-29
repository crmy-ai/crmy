// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import {
  actionContextGet,
  actionContextHumanUnblock,
  validationError,
  type ActionContext,
  type ActorContext,
  type UUID,
} from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import { getActionContext } from '../../services/action-context.js';
import type { ToolDef } from '../server.js';
import { runToolOperation } from '../tool-operation.js';
import { mutationReceipt } from '../mutation-receipt.js';
import { withTransaction } from '../../db/transaction.js';
import { emitEvent } from '../../events/emitter.js';
import * as snapshotRepo from '../../db/repos/handoff-snapshots.js';
import * as hitlRepo from '../../db/repos/hitl.js';
import * as assignmentRepo from '../../db/repos/assignments.js';
import * as governorLimits from '../../db/repos/governor-limits.js';
import { assertSubjectAccess } from '../../services/access-control.js';
import { indexDocument } from '../../search/SearchIndexerService.js';

type HumanUnblockInput = z.infer<typeof actionContextHumanUnblock>;

async function assertActiveActor(db: DbPool, tenantId: UUID, actorId: UUID, field: string) {
  const result = await db.query(
    'SELECT 1 FROM actors WHERE tenant_id = $1 AND id = $2 AND is_active = TRUE LIMIT 1',
    [tenantId, actorId],
  );
  if (result.rowCount === 0) {
    throw validationError('Choose an active actor for this human unblock request', [
      { field, message: 'Choose an active actor in this workspace' },
    ]);
  }
}

function actionContextMetadata(actionContext: ActionContext) {
  return {
    contract_version: actionContext.contract_version,
    subject_type: actionContext.subject_type,
    subject_id: actionContext.subject_id,
    operating_mode: actionContext.operating_mode,
    readiness_status: actionContext.readiness.status,
    risk_level: actionContext.readiness.risk_level,
    review_required: actionContext.readiness.review_required,
    guidance_summary: actionContext.guidance.summary,
    warning_reasons: actionContext.guidance.warning_reasons,
    review_reasons: actionContext.guidance.review_reasons,
    action_packet: actionContext.action_packet,
    proof: actionContext.proof,
  };
}

function compactList(items: string[], fallback: string): string {
  const clean = items.map(item => item.trim()).filter(Boolean);
  if (!clean.length) return fallback;
  return clean.slice(0, 6).map(item => `- ${item}`).join('\n');
}

function unblockTitle(input: HumanUnblockInput, actionContext: ActionContext): string {
  return input.title
    ?? actionContext.action_packet.human_unblock?.question
    ?? `Review ${actionContext.subject_type} action boundary`;
}

function unblockQuestion(input: HumanUnblockInput, actionContext: ActionContext): string {
  return input.question
    ?? actionContext.action_packet.human_unblock?.question
    ?? 'Can this action proceed, or what needs to change before the agent acts?';
}

function unblockReasoning(input: HumanUnblockInput, actionContext: ActionContext): string {
  if (input.reasoning) return input.reasoning;
  const packet = actionContext.action_packet;
  const reasons = [
    ...actionContext.readiness.blockers,
    ...actionContext.guidance.review_reasons,
    ...actionContext.guidance.warning_reasons,
    ...(packet.human_unblock?.reasons ?? []),
  ];
  return [
    actionContext.guidance.summary,
    '',
    'Decision needed:',
    unblockQuestion(input, actionContext),
    '',
    'Why the agent stopped:',
    compactList(reasons, 'No blockers were returned, but the agent requested review before acting.'),
  ].join('\n');
}

function uuidOrUndefined(value: unknown): UUID | undefined {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value as UUID
    : undefined;
}

function keyFindings(actionContext: ActionContext) {
  const packet = actionContext.action_packet;
  return [
    ...packet.use_as_truth.slice(0, 4).map(item => ({
      finding: `${item.title}: ${item.summary}`,
      confidence: item.confidence ?? undefined,
      entry_id: uuidOrUndefined(item.id),
    })),
    ...packet.use_with_caution.slice(0, 3).map(item => ({
      finding: `Use with caution — ${item.title}: ${item.summary}`,
      confidence: item.confidence ?? undefined,
      entry_id: uuidOrUndefined(item.id),
    })),
  ].filter(item => item.finding.trim().length > 0);
}

function chooseRequestType(input: HumanUnblockInput, actionContext: ActionContext): 'approval' | 'assignment' {
  if (input.request_type === 'approval' || input.request_type === 'assignment') return input.request_type;
  const handoffType = actionContext.action_packet.human_unblock?.handoff_type;
  if ((handoffType === 'assignment' || handoffType === 'source_conflict') && input.assignee_id) return 'assignment';
  return 'approval';
}

export function actionContextTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'action_context_get',
      tier: 'core',
      description: 'Assemble action-aware customer context before an agent prepares work. Returns the briefing, operating_mode (inform, warn, require_review), readiness, policy/source-authority checks, allowed actions, required handoffs, guidance, and a compact retrieval proof event. It can use token_budget_profile and evidence_mode to keep agent packets small, action-ranked, and proof-on-demand. This does not mutate CRM records or execute writebacks.',
      inputSchema: actionContextGet,
      handler: async (input: z.infer<typeof actionContextGet>, actor: ActorContext) => {
        return {
          action_context: await getActionContext(db, actor, input),
        };
      },
    },
    {
      name: 'action_context_request_human_unblock',
      tier: 'core',
      description: 'Turn Action Context human_unblock guidance into a durable human request. This composes action_context_get + agent_capture_handoff + hitl_submit_request or assignment_create in one idempotent operation, preserving the action packet, proof, and agent reasoning so a human can approve, correct, or take over without guesswork. Use this when action_context_get returns operating_mode=require_review or action_packet.human_unblock.required=true.',
      inputSchema: actionContextHumanUnblock,
      handler: async (input: HumanUnblockInput, actor: ActorContext) => {
        return runToolOperation(db, actor, 'action_context_request_human_unblock', input, async () => {
          await assertSubjectAccess(db, actor, input.subject_type, input.subject_id);
          if (input.assignee_id) await assertActiveActor(db, actor.tenant_id, input.assignee_id, 'assignee_id');
          if (input.reviewer_id) await assertActiveActor(db, actor.tenant_id, input.reviewer_id, 'reviewer_id');

          const actionContext = await getActionContext(db, actor, {
            subject_type: input.subject_type,
            subject_id: input.subject_id,
            context_radius: input.subject_type === 'account' ? 'account_wide' : 'adjacent',
            token_budget: 2200,
            proposed_action: input.proposed_action,
          });

          if (
            input.request_type === 'auto'
            && !actionContext.action_packet.human_unblock?.required
            && actionContext.operating_mode !== 'require_review'
          ) {
            throw validationError('Action Context does not currently require a human unblock', [
              { field: 'request_type', message: 'Use request_type=approval or assignment if you still want a human review.' },
            ]);
          }

          const requestType = chooseRequestType(input, actionContext);
          if (requestType === 'assignment' && !input.assignee_id) {
            throw validationError('Choose an assignee for an assignment unblock request', [
              { field: 'assignee_id', message: 'Assignments need a specific actor to take ownership.' },
            ]);
          }

          const title = unblockTitle(input, actionContext);
          const question = unblockQuestion(input, actionContext);
          const reasoning = unblockReasoning(input, actionContext);
          const metadata = actionContextMetadata(actionContext);

          const result = await withTransaction(db, async tx => {
            const snapshot = await snapshotRepo.createSnapshot(tx, actor.tenant_id, {
              actor_id: actor.actor_id,
              subject_type: input.subject_type,
              subject_id: input.subject_id,
              reasoning,
              key_findings: keyFindings(actionContext),
              tools_called: [
                { tool_name: 'action_context_get', args_summary: `${input.subject_type}:${input.subject_id}`, result_summary: actionContext.guidance.summary },
                ...input.tools_called,
              ],
              confidence: actionContext.readiness.status === 'ready' ? 0.85 : actionContext.readiness.status === 'blocked' ? 0.35 : 0.6,
              handoff_type: requestType === 'assignment' ? 'assignment' : 'hitl',
            });

            if (requestType === 'assignment') {
              const activeCount = await governorLimits.countActiveAssignments(tx, actor.tenant_id);
              await governorLimits.enforceLimit(tx, actor.tenant_id, 'assignments_active', activeCount);
              const assignment = await assignmentRepo.createAssignment(tx, actor.tenant_id, {
                title,
                description: question,
                assignment_type: actionContext.action_packet.human_unblock?.handoff_type ?? 'action_unblock',
                assigned_by: actor.actor_id,
                assigned_to: input.assignee_id,
                subject_type: input.subject_type,
                subject_id: input.subject_id,
                priority: input.priority,
                due_at: input.due_at,
                context: reasoning,
                metadata: {
                  source: 'action_context_human_unblock',
                  action_context: metadata,
                },
              });
              await snapshotRepo.linkToAssignment(tx, snapshot.id, assignment.id);
              const event_id = await emitEvent(tx, {
                tenantId: actor.tenant_id,
                eventType: 'assignment.created',
                actorId: actor.actor_id,
                actorType: actor.actor_type,
                objectType: 'assignment',
                objectId: assignment.id,
                afterData: assignment,
                metadata: { action_context: metadata, handoff_snapshot_id: snapshot.id },
              });
              return { created_type: 'assignment' as const, snapshot, assignment, event_id };
            }

            const request = await hitlRepo.createHITLRequest(tx, actor.tenant_id, {
              agent_id: actor.actor_id,
              action_type: input.proposed_action?.action_type ?? 'action_context.human_unblock',
              action_summary: title,
              action_payload: {
                subject_type: input.subject_type,
                subject_id: input.subject_id,
                proposed_action: input.proposed_action ?? null,
                question,
                action_context: metadata,
              },
              priority: input.priority,
              sla_minutes: input.sla_minutes,
              escalate_to_id: input.reviewer_id,
              handoff_snapshot_id: snapshot.id,
            });
            const event_id = await emitEvent(tx, {
              tenantId: actor.tenant_id,
              eventType: 'hitl.submitted',
              actorId: actor.actor_id,
              actorType: actor.actor_type,
              objectType: 'hitl_request',
              objectId: request.id,
              afterData: request,
              metadata: { action_context: metadata, handoff_snapshot_id: snapshot.id },
            });
            return { created_type: 'approval' as const, snapshot, request, event_id };
          });

          if (result.created_type === 'assignment') {
            indexDocument(db, 'assignment', result.assignment as unknown as Record<string, unknown>).catch(() => {});
            return {
              created_type: result.created_type,
              assignment_id: result.assignment.id,
              assignment: result.assignment,
              snapshot_id: result.snapshot.id,
              event_id: result.event_id,
              action_packet: actionContext.action_packet,
              mutation: mutationReceipt(actor, {
                objectType: 'assignment',
                objectId: result.assignment.id,
                eventId: result.event_id,
              }),
            };
          }

          return {
            created_type: result.created_type,
            request_id: result.request.id,
            status: result.request.status,
            snapshot_id: result.snapshot.id,
            event_id: result.event_id,
            action_packet: actionContext.action_packet,
            mutation: mutationReceipt(actor, {
              objectType: 'hitl_request',
              objectId: result.request.id,
              eventId: result.event_id,
            }),
          };
        });
      },
    },
  ];
}
