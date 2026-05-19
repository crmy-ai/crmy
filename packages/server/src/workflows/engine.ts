// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../db/pool.js';
import type { UUID, Activity } from '@crmy/shared';
import * as wfRepo from '../db/repos/workflows.js';
import type { WorkflowRow } from '../db/repos/workflows.js';
import * as hitlRepo from '../db/repos/hitl.js';
import { emitEvent } from '../events/emitter.js';
import { interpolate, buildVariableContext, resolveConfig } from './variables.js';
import { resolveSequenceGoalContactId } from '../services/sequence-executor.js';

/** How many consecutive failures trigger a Handoffs alert (configurable via env) */
const FAILURE_ALERT_THRESHOLD = Number(process.env.WORKFLOW_FAILURE_ALERT_THRESHOLD ?? 3);

// ── Constants ────────────────────────────────────────────────────────────────

/** Default per-action execution timeout (30 seconds) */
const ACTION_TIMEOUT_MS = 30_000;

// ── In-memory workflow cache ─────────────────────────────────────────────────

const workflowCache = new Map<string, { workflows: WorkflowRow[]; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

async function getCachedWorkflows(
  db: DbPool, tenantId: string, eventType: string,
): Promise<WorkflowRow[]> {
  const key = `${tenantId}:${eventType}`;
  const cached = workflowCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.workflows;

  const workflows = await wfRepo.getActiveWorkflowsForEvent(db, tenantId as UUID, eventType);
  workflowCache.set(key, { workflows, expiresAt: Date.now() + CACHE_TTL_MS });
  return workflows;
}

/** Call after any workflow create/update/delete to keep cache fresh */
export function invalidateWorkflowCache(tenantId: string): void {
  for (const key of workflowCache.keys()) {
    if (key.startsWith(`${tenantId}:`)) workflowCache.delete(key);
  }
}

// ── Engine public interface ───────────────────────────────────────────────────

export interface WorkflowEngine {
  processEvent(tenantId: UUID, eventType: string, eventId: number, payload: unknown): Promise<void>;
}

export function createWorkflowEngine(db: DbPool): WorkflowEngine {
  return {
    async processEvent(tenantId, eventType, eventId, payload) {
      // Prevent recursive workflow triggers (workflow.* events don't re-trigger workflows)
      if (eventType.startsWith('workflow.')) return;
      const metadata = payload && typeof payload === 'object' && 'metadata' in payload
        ? (payload as { metadata?: unknown }).metadata
        : undefined;
      if (metadata && typeof metadata === 'object' && (metadata as { sync_mode?: unknown }).sync_mode === 'replay') {
        console.info(`[workflow] Skipping replayed sync event_id=${eventId} event_type=${eventType}`);
        return;
      }

      const workflows = await getCachedWorkflows(db, tenantId, eventType);

      for (const workflow of workflows) {
        // Check trigger filter
        if (!matchesFilter(workflow.trigger_filter, payload)) continue;

        // Deduplication: skip if this event was already processed by this workflow
        if (eventId) {
          const dup = await db.query(
            `SELECT id FROM workflow_runs WHERE workflow_id = $1 AND event_id = $2 LIMIT 1`,
            [workflow.id, eventId],
          );
          if (dup.rows.length > 0) {
            console.info(`[workflow:dedup] Skipping duplicate event_id=${eventId} for workflow ${workflow.id}`);
            continue;
          }
        }

        // Rate limiting: check runs in the last hour
        if (workflow.max_runs_per_hour) {
          const recentCount = await wfRepo.countRecentRuns(db, workflow.id, 1);
          if (recentCount >= workflow.max_runs_per_hour) {
            console.warn(`[workflow:rate-limit] Workflow ${workflow.id} (${workflow.name}) hit max_runs_per_hour=${workflow.max_runs_per_hour}`);
            continue;
          }
        }

        const run = await wfRepo.createRun(db, {
          workflow_id: workflow.id,
          event_id: eventId,
          actions_total: workflow.actions.length,
        });

        const variableContext = buildVariableContext(payload);
        let actionsRun = 0;

        try {
          for (const action of workflow.actions as { type: string; config: Record<string, unknown> }[]) {
            const actionStarted = new Date().toISOString();
            const actionStart = Date.now();

            try {
              await executeWithTimeout(
                () => executeAction(db, tenantId, action, payload, variableContext),
                ACTION_TIMEOUT_MS,
              );

              actionsRun++;
              const log = {
                index: actionsRun - 1,
                type: action.type,
                status: 'completed' as const,
                duration_ms: Date.now() - actionStart,
                started_at: actionStarted,
                resolved_config: resolveConfig(action.config, variableContext) as Record<string, unknown>,
              };
              await wfRepo.appendActionLog(db, run.id, log);
              await wfRepo.updateRun(db, run.id, { actions_run: actionsRun });
            } catch (actionErr) {
              const message = actionErr instanceof Error ? actionErr.message : 'Unknown error';
              const log = {
                index: actionsRun,
                type: action.type,
                status: 'failed' as const,
                error: message,
                duration_ms: Date.now() - actionStart,
                started_at: actionStarted,
              };
              await wfRepo.appendActionLog(db, run.id, log);
              throw actionErr; // re-throw to fail the run
            }
          }

          await wfRepo.updateRun(db, run.id, { status: 'completed', actions_run: actionsRun });
          await wfRepo.incrementRunCount(db, workflow.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          await wfRepo.updateRun(db, run.id, { status: 'failed', error: message });
          const newErrorCount = await wfRepo.incrementErrorCount(db, workflow.id);

          // Surface repeated failures as a HITL escalation so humans are notified
          if (newErrorCount >= FAILURE_ALERT_THRESHOLD) {
            hitlRepo.createHITLRequest(db, tenantId, {
              agent_id: 'system',
              action_type: 'workflow.repeated_failure',
              action_summary: `Workflow "${workflow.name}" has failed ${newErrorCount} consecutive time${newErrorCount !== 1 ? 's' : ''}`,
              action_payload: {
                workflow_id: workflow.id,
                workflow_name: workflow.name,
                error_count: newErrorCount,
                last_error: message,
                run_id: run.id,
              },
              priority: 'urgent',
              sla_minutes: 240,
            }).catch((e) => console.error('[workflow:failure-alert] Failed to create HITL request:', e));
          }
        }
      }
    },
  };
}

// ── Dry-run / test ────────────────────────────────────────────────────────────

export interface DryRunResult {
  would_trigger: boolean;
  filter_match_details: {
    filter: Record<string, unknown>;
    matched: boolean;
    mismatches: Array<{ field: string; expected: unknown; actual: unknown }>;
  };
  actions: Array<{
    index: number;
    type: string;
    resolved_config: Record<string, unknown>;
    would_execute: boolean;
    note?: string;
  }>;
}

export async function dryRunWorkflow(
  db: DbPool,
  tenantId: UUID,
  workflowId: UUID,
  samplePayload: unknown,
): Promise<DryRunResult> {
  const workflow = await wfRepo.getWorkflow(db, tenantId, workflowId);
  if (!workflow) {
    throw Object.assign(new Error(`Workflow ${workflowId} not found`), { status: 404 });
  }

  const filter = workflow.trigger_filter as Record<string, unknown>;
  const mismatches: Array<{ field: string; expected: unknown; actual: unknown }> = [];
  const payload = (samplePayload ?? {}) as Record<string, unknown>;

  if (filter && Object.keys(filter).length > 0) {
    for (const [key, expected] of Object.entries(filter)) {
      const condition = expected as Record<string, unknown>;
      const actual = getPathValue(payload, key);
      if (condition && typeof condition === 'object' && 'op' in condition) {
        const op = condition.op as string;
        let matched = false;
        switch (op) {
          case 'eq':          matched = actual === condition.value; break;
          case 'neq':         matched = actual !== condition.value; break;
          case 'contains':
            matched = Array.isArray(actual)
              ? actual.includes(condition.value)
              : String(actual ?? '').includes(String(condition.value ?? ''));
            break;
          case 'starts_with': matched = String(actual ?? '').startsWith(String(condition.value ?? '')); break;
          case 'gt':          matched = Number(actual) > Number(condition.value); break;
          case 'lt':          matched = Number(actual) < Number(condition.value); break;
          case 'exists':      matched = actual !== undefined && actual !== null; break;
          case 'not_exists':  matched = actual === undefined || actual === null; break;
        }
        if (!matched) mismatches.push({ field: key, expected: condition, actual });
      } else {
        // Legacy equality
        if (actual !== expected) {
          mismatches.push({ field: key, expected, actual });
        }
      }
    }
  }

  const matched = mismatches.length === 0;
  const variableContext = buildVariableContext(samplePayload);

  const actions = (workflow.actions as { type: string; config: Record<string, unknown> }[]).map((action, idx) => {
    const resolved = resolveConfig(action.config, variableContext) as Record<string, unknown>;
    let note: string | undefined;
    if (action.type === 'send_notification' && !resolved.channel_id) {
      note = 'No channel_id set — would use tenant default channel';
    }
    if (action.type === 'send_email' && resolved.require_approval !== false) {
      note = 'require_approval is true — would create a HITL request before sending';
    }
    return {
      index: idx,
      type: action.type,
      resolved_config: resolved,
      would_execute: matched,
      note,
    };
  });

  return {
    would_trigger: matched,
    filter_match_details: { filter, matched, mismatches },
    actions,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function executeWithTimeout(fn: () => Promise<void>, timeoutMs: number): Promise<void> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Action timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

function getPathValue(data: Record<string, unknown>, path: string): unknown {
  if (!path.includes('.')) return data[path];
  return path.split('.').reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, data);
}

// Extended filter matching with operator support
export function matchesFilter(filter: Record<string, unknown>, payload: unknown): boolean {
  if (!filter || Object.keys(filter).length === 0) return true;
  if (!payload || typeof payload !== 'object') return false;

  const data = payload as Record<string, unknown>;

  for (const [key, expected] of Object.entries(filter)) {
    const condition = expected as Record<string, unknown>;
    const actual = getPathValue(data, key);
    if (condition && typeof condition === 'object' && 'op' in condition) {
      const op = condition.op as string;
      switch (op) {
        case 'eq':          if (actual !== condition.value) return false; break;
        case 'neq':         if (actual === condition.value) return false; break;
        case 'contains':
          if (Array.isArray(actual)) {
            if (!actual.includes(condition.value)) return false;
          } else if (!String(actual ?? '').includes(String(condition.value ?? ''))) return false;
          break;
        case 'starts_with': if (!String(actual ?? '').startsWith(String(condition.value ?? ''))) return false; break;
        case 'gt':          if (!(Number(actual) > Number(condition.value))) return false; break;
        case 'lt':          if (!(Number(actual) < Number(condition.value))) return false; break;
        case 'exists':      if (actual === undefined || actual === null) return false; break;
        case 'not_exists':  if (actual !== undefined && actual !== null) return false; break;
        default:            if (actual !== expected) return false; break;
      }
    } else {
      // Legacy: plain equality
      if (actual !== expected) return false;
    }
  }
  return true;
}

async function executeAction(
  db: DbPool, tenantId: UUID,
  action: { type: string; config: Record<string, unknown> },
  payload: unknown,
  variableContext: Record<string, unknown>,
): Promise<void> {
  // Resolve template variables in all string config values
  const cfg = resolveConfig(action.config, variableContext) as Record<string, unknown>;
  const parseObject = (value: unknown): Record<string, unknown> => {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
      } catch {
        return { body: value };
      }
    }
    return {};
  };

  switch (action.type) {
    case 'create_context_entry':
    case 'create_note': {
      if (action.type === 'create_note') {
        console.warn('[workflow] Action type "create_note" is deprecated. Update workflow to use "create_context_entry".');
      }
      const { createContextEntry } = await import('../db/repos/context-entries.js');
      await createContextEntry(db, tenantId, {
        subject_type: cfg.object_type as string,
        subject_id: cfg.object_id as string,
        context_type: (cfg.context_type as string) ?? 'note',
        body: cfg.body as string,
        authored_by: 'system',
        visibility: (cfg.visibility as string) ?? 'internal',
      } as Parameters<typeof createContextEntry>[2]);
      break;
    }
    case 'create_activity': {
      const { createActivity } = await import('../db/repos/activities.js');
      await createActivity(db, tenantId, {
        type: (cfg.type as Activity['type']) ?? 'task',
        subject: cfg.subject as string,
        body: cfg.body as string | undefined,
        contact_id: cfg.contact_id as string | undefined,
        account_id: cfg.account_id as string | undefined,
      });
      break;
    }
    case 'send_notification': {
      let channelId = cfg.channel_id as string | undefined;

      if (!channelId) {
        const { getDefaultChannel } = await import('../db/repos/messaging.js');
        const defaultChannel = await getDefaultChannel(db, tenantId);
        if (defaultChannel) channelId = defaultChannel.id;
      }

      if (channelId) {
        const { sendMessage } = await import('../messaging/delivery.js');
        const delivery = await sendMessage(db, tenantId, {
          channel_id: channelId,
          recipient: cfg.recipient as string | undefined,
          subject: cfg.subject as string | undefined,
          body: cfg.message as string,
          metadata: { workflow_run: true },
        });

        await emitEvent(db, {
          tenantId,
          eventType: 'workflow.notification',
          actorType: 'system',
          objectType: 'message_delivery',
          objectId: delivery.id,
          afterData: {
            channel_id: channelId,
            delivery_id: delivery.id,
            status: delivery.status,
            message: cfg.message,
            recipient: cfg.recipient,
          },
        });
      } else {
        await emitEvent(db, {
          tenantId,
          eventType: 'workflow.notification',
          actorType: 'system',
          objectType: 'workflow',
          afterData: { channel: 'internal', message: cfg.message, recipient: cfg.recipient },
        });
      }
      break;
    }
    case 'send_email': {
      const emailRepo = await import('../db/repos/emails.js');
      const hitlRepo = await import('../db/repos/hitl.js');

      const toAddress = cfg.to_address as string;
      const subject = cfg.subject as string;
      const bodyText = cfg.body_text as string;
      const bodyHtml = cfg.body_html as string | undefined;
      // Support both boolean and legacy string "false"
      const requireApproval = cfg.require_approval !== false && cfg.require_approval !== 'false';

      let hitlRequestId: string | undefined;
      let status = 'draft';

      if (requireApproval) {
        const hitl = await hitlRepo.createHITLRequest(db, tenantId, {
          agent_id: 'system',
          action_type: 'email.send',
          action_summary: `Send email to ${toAddress}: "${subject}"`,
          action_payload: { to_address: toAddress, subject, body_preview: bodyText.slice(0, 200) },
        });
        hitlRequestId = hitl.id;
        status = 'pending_approval';
      }

      const email = await emailRepo.createEmail(db, tenantId, {
        contact_id: cfg.contact_id as string | undefined,
        account_id: cfg.account_id as string | undefined,
        opportunity_id: cfg.opportunity_id as string | undefined,
        use_case_id: cfg.use_case_id as string | undefined,
        to_email: toAddress,
        subject,
        body_text: bodyText,
        body_html: bodyHtml,
        status,
        hitl_request_id: hitlRequestId,
        created_by: 'system',
      });

      await emitEvent(db, {
        tenantId,
        eventType: 'email.created',
        actorType: 'system',
        objectType: 'email',
        objectId: email.id,
        afterData: { id: email.id, to: email.to_email, subject: email.subject, status: email.status },
      });

      if (!requireApproval) {
        const { deliverEmail } = await import('../email/delivery.js');
        await deliverEmail(db, tenantId, email.id);
      }
      break;
    }
    case 'update_field': {
      const objectType = (cfg.object_type as string) || (payload as Record<string, unknown>)?.object_type as string;
      const objectId = (cfg.object_id as string) || (payload as Record<string, unknown>)?.id as string;
      const field = cfg.field as string;
      const value = cfg.value;

      if (objectType && objectId && field) {
        const repoMap: Record<string, string> = {
          contact: '../db/repos/contacts.js',
          account: '../db/repos/accounts.js',
          opportunity: '../db/repos/opportunities.js',
        };
        const repoPath = repoMap[objectType];
        if (!repoPath) throw new Error(`update_field: unsupported object_type "${objectType}"`);
        const repo = await import(repoPath);
        const updateFn = repo[`update${objectType.charAt(0).toUpperCase() + objectType.slice(1)}`];
        if (updateFn) await updateFn(db, tenantId, objectId, { [field]: value });
      }

      await emitEvent(db, {
        tenantId, eventType: 'workflow.action.update_field', actorType: 'system',
        objectType: objectType || 'workflow', objectId, afterData: cfg,
      });
      break;
    }
    case 'add_tag':
    case 'remove_tag': {
      const tagPayload = payload as Record<string, unknown> | undefined;
      const objType = (cfg.object_type as string) || tagPayload?.object_type as string;
      const objId = (cfg.object_id as string) || tagPayload?.id as string;
      const tag = cfg.tag as string;

      if (objType && objId && tag) {
        const repoMap: Record<string, string> = {
          contact: '../db/repos/contacts.js',
          account: '../db/repos/accounts.js',
          opportunity: '../db/repos/opportunities.js',
        };
        const repoPath = repoMap[objType];
        if (repoPath) {
          const repo = await import(repoPath);
          const getFn = repo[`get${objType.charAt(0).toUpperCase() + objType.slice(1)}`];
          const updateFn = repo[`update${objType.charAt(0).toUpperCase() + objType.slice(1)}`];
          if (getFn && updateFn) {
            const record = await getFn(db, tenantId, objId);
            if (record) {
              const tags: string[] = Array.isArray(record.tags) ? [...record.tags] : [];
              if (action.type === 'add_tag' && !tags.includes(tag)) {
                tags.push(tag);
              } else if (action.type === 'remove_tag') {
                const idx = tags.indexOf(tag);
                if (idx >= 0) tags.splice(idx, 1);
              }
              await updateFn(db, tenantId, objId, { tags });
            }
          }
        }
      }

      await emitEvent(db, {
        tenantId, eventType: `workflow.action.${action.type}`, actorType: 'system',
        objectType: objType || 'workflow', objectId: objId, afterData: cfg,
      });
      break;
    }
    case 'assign_owner': {
      const ownerPayload = payload as Record<string, unknown> | undefined;
      const ownerObjType = (cfg.object_type as string) || ownerPayload?.object_type as string;
      const ownerObjId = (cfg.object_id as string) || ownerPayload?.id as string;
      const ownerId = cfg.owner_id as string;

      if (ownerObjType && ownerObjId && ownerId) {
        const repoMap: Record<string, string> = {
          contact: '../db/repos/contacts.js',
          account: '../db/repos/accounts.js',
          opportunity: '../db/repos/opportunities.js',
        };
        const repoPath = repoMap[ownerObjType];
        if (repoPath) {
          const repo = await import(repoPath);
          const updateFn = repo[`update${ownerObjType.charAt(0).toUpperCase() + ownerObjType.slice(1)}`];
          if (updateFn) await updateFn(db, tenantId, ownerObjId, { owner_id: ownerId });
        }
      }

      await emitEvent(db, {
        tenantId, eventType: 'workflow.action.assign_owner', actorType: 'system',
        objectType: ownerObjType || 'workflow', objectId: ownerObjId, afterData: cfg,
      });
      break;
    }
    case 'webhook': {
      const url = cfg.url as string;
      if (!url) throw new Error('webhook action requires a url');

      const body = JSON.stringify({
        event_type: 'workflow.action.webhook',
        payload,
        triggered_at: new Date().toISOString(),
        config: cfg,
      });

      const res = await Promise.race([
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Webhook HTTP request timed out')), ACTION_TIMEOUT_MS)
        ),
      ]);

      if (!res.ok) throw new Error(`Webhook returned HTTP ${res.status} ${res.statusText}`);
      break;
    }
    case 'wait': {
      const seconds = Math.min(Math.max(1, Number(cfg.seconds ?? 5)), 300);
      await new Promise<void>(resolve => setTimeout(resolve, seconds * 1000));
      break;
    }
    case 'enroll_in_sequence': {
      const sequenceId = String(cfg.sequence_id ?? '');
      const eventPayload = payload as Record<string, unknown>;
      const subjectId = (variableContext as Record<string, Record<string, unknown>>)?.subject?.id;
      const subjectType = eventPayload?.object_type;
      const metadata = eventPayload.metadata && typeof eventPayload.metadata === 'object'
        ? eventPayload.metadata as Record<string, unknown>
        : {};
      const resolvedContactId = resolveSequenceGoalContactId({
        objectType: typeof eventPayload.object_type === 'string' ? eventPayload.object_type : undefined,
        objectId: typeof eventPayload.object_id === 'string' ? eventPayload.object_id : undefined,
        afterData: eventPayload,
        metadata,
      });
      // Use explicit contact_id override, resolved contact relationship, or
      // subject.id only when the event subject itself is a contact.
      const contactId = String(
        cfg.contact_id ||
        (variableContext as Record<string, Record<string, unknown>>)?.contact?.id ||
        resolvedContactId ||
        eventPayload?.contact_id ||
        (subjectType === 'contact' ? subjectId : '') ||
        '',
      );
      if (!sequenceId || !contactId) {
        const origin = typeof metadata.origin === 'string' ? metadata.origin : undefined;
        const isExternalOrigin = origin === 'crm_sync' || origin === 'warehouse_sync';
        if (sequenceId && !contactId && isExternalOrigin) {
          const actorRepo = await import('../db/repos/actors.js');
          const assignmentRepo = await import('../db/repos/assignments.js');
          const systemActor = await actorRepo.ensureActor(db, tenantId, {
            actor_type: 'agent',
            display_name: 'System Sync',
            agent_identifier: 'system-sync',
            agent_model: 'crmy-sync',
            scopes: ['read', 'write'],
          } as Parameters<typeof actorRepo.ensureActor>[2]);
          const assignment = await assignmentRepo.createAssignment(db, tenantId, {
            title: 'Resolve external contact before sequence enrollment',
            description: 'An external system event matched this workflow, but CRMy could not resolve a contact to enroll. Review the source record, mapping, and external record reference.',
            assignment_type: 'data_quality',
            assigned_by: systemActor.id,
            assigned_to: systemActor.id,
            priority: 'normal',
            context: 'Created by workflow sequence enrollment guard.',
            metadata: {
              reason: 'unresolved_external_contact_for_sequence',
              sequence_id: sequenceId,
              event_type: eventPayload.event_type,
              object_type: eventPayload.object_type,
              object_id: eventPayload.object_id,
              metadata,
            },
          });
          await emitEvent(db, {
            tenantId,
            eventType: 'assignment.created',
            actorType: 'system',
            objectType: 'assignment',
            objectId: assignment.id,
            afterData: assignment,
            metadata: {
              origin: 'workflow',
              system_id: metadata.system_id,
              system_type: metadata.system_type,
              external_record_id: metadata.external_record_id,
              conflict_state: 'open',
            },
          });
        }
        console.warn('[workflow] enroll_in_sequence: missing sequence_id or resolvable contact_id — skipping');
        break;
      }
      const { enrollContact, getSequence } = await import('../db/repos/email-sequences.js');
      // Skip if contact already has an active or paused enrollment in this sequence (idempotent)
      const seq = await getSequence(db, tenantId, sequenceId);
      if (!seq) { console.warn(`[workflow] enroll_in_sequence: sequence ${sequenceId} not found`); break; }
      const existing = await db.query(
        `SELECT id FROM sequence_enrollments
         WHERE tenant_id=$1 AND sequence_id=$2 AND contact_id=$3
           AND status IN ('active','paused') LIMIT 1`,
        [tenantId, sequenceId, contactId],
      );
      if (existing.rows.length > 0) {
        console.info(`[workflow] enroll_in_sequence: contact ${contactId} already enrolled — skipping`);
        break;
      }
      await enrollContact(db, tenantId, {
        sequence_id: sequenceId,
        contact_id:  contactId,
        objective:   cfg.objective as string | undefined,
        enrolled_by: 'workflow',
      });
      await emitEvent(db, {
        tenantId,
        eventType: 'sequence.enrolled',
        actorType: 'system',
        objectType: 'sequence_enrollment',
        afterData: { sequence_id: sequenceId, contact_id: contactId, via: 'workflow' },
      });
      break;
    }
    case 'request_external_writeback': {
      const { requestExternalWriteback } = await import('../services/systems-of-record/index.js');
      if (!cfg.payload) {
        throw new Error('request_external_writeback requires a payload JSON object. Add a payload field instead of relying on action config values.');
      }
      const origin = (payload as Record<string, unknown>)?.metadata &&
        typeof (payload as Record<string, unknown>).metadata === 'object'
        ? ((payload as Record<string, unknown>).metadata as Record<string, unknown>).origin
        : undefined;
      const sourceSystemId = (payload as Record<string, unknown>)?.metadata &&
        typeof (payload as Record<string, unknown>).metadata === 'object'
        ? ((payload as Record<string, unknown>).metadata as Record<string, unknown>).system_id
        : undefined;
      if ((origin === 'crm_sync' || origin === 'warehouse_sync') && sourceSystemId === cfg.system_id && cfg.allow_source_loop !== true) {
        console.warn('[workflow] request_external_writeback skipped to prevent source loop');
        break;
      }
      const writeback = await requestExternalWriteback(db, tenantId, 'workflow', {
        system_id: cfg.system_id as UUID,
        mapping_id: cfg.mapping_id as UUID | undefined,
        object_type: String(cfg.object_type ?? (payload as Record<string, unknown>)?.object_type ?? 'unknown'),
        object_id: (cfg.object_id as UUID | undefined) ?? ((payload as Record<string, unknown>)?.id as UUID | undefined),
        external_object: String(cfg.external_object ?? ''),
        external_record_id: cfg.external_record_id as string | undefined,
        operation: (cfg.operation as 'create' | 'update' | 'upsert' | 'append_event' | 'stored_procedure') ?? 'upsert',
        writeback_mode: (cfg.writeback_mode as 'append_event' | 'mapped_upsert' | 'stored_procedure') ?? 'mapped_upsert',
        payload: parseObject(cfg.payload),
        require_approval: cfg.require_approval !== false,
        idempotency_key: (cfg.idempotency_key as string | undefined)
          ?? [
            'workflow',
            String((payload as Record<string, unknown>)?.event_id ?? 'manual'),
            String(cfg.system_id ?? 'system'),
            String(cfg.external_object ?? 'object'),
            String(cfg.operation ?? 'upsert'),
          ].join(':'),
      });
      await emitEvent(db, {
        tenantId,
        eventType: 'workflow.action.request_external_writeback',
        actorType: 'system',
        objectType: 'external_writeback',
        objectId: writeback.id,
        afterData: writeback,
        metadata: { origin: 'workflow', system_id: writeback.system_id, external_record_id: writeback.external_record_id },
      });
      break;
    }
    case 'run_system_sync': {
      const { runSystemSync } = await import('../services/systems-of-record/index.js');
      const run = await runSystemSync(db, tenantId, {
        system_id: cfg.system_id as UUID,
        mapping_id: cfg.mapping_id as UUID | undefined,
        mode: (cfg.mode as 'test' | 'full' | 'incremental' | 'replay') ?? 'incremental',
      });
      await emitEvent(db, {
        tenantId,
        eventType: 'workflow.action.run_system_sync',
        actorType: 'system',
        objectType: 'external_sync_run',
        objectId: run.id,
        afterData: run,
        metadata: { origin: 'workflow', system_id: run.system_id, sync_run_id: run.id },
      });
      break;
    }
    case 'create_sync_conflict_review': {
      const hitlRepo = await import('../db/repos/hitl.js');
      await hitlRepo.createHITLRequest(db, tenantId, {
        agent_id: 'workflow',
        action_type: 'sync.conflict.review',
        action_summary: String(cfg.title ?? 'Review system-of-record sync conflict'),
        action_payload: { ...cfg, event_payload: payload },
        priority: (cfg.priority as 'low' | 'normal' | 'high' | 'urgent' | undefined) ?? 'normal',
      });
      break;
    }
    case 'create_context_from_external_change': {
      const { createContextEntry } = await import('../db/repos/context-entries.js');
      const actorRepo = await import('../db/repos/actors.js');
      const systemActor = await actorRepo.ensureActor(db, tenantId, {
        actor_type: 'agent',
        display_name: 'System Sync',
        agent_identifier: 'system-sync',
        agent_model: 'crmy-sync',
        scopes: ['read', 'write'],
      } as Parameters<typeof actorRepo.ensureActor>[2]);
      await createContextEntry(db, tenantId, {
        subject_type: String(cfg.subject_type ?? (payload as Record<string, unknown>)?.object_type),
        subject_id: String(cfg.subject_id ?? (payload as Record<string, unknown>)?.id),
        context_type: String(cfg.context_type ?? 'external_update'),
        title: cfg.title as string | undefined,
        body: String(cfg.body ?? cfg.message ?? 'External system update received.'),
        confidence: Number(cfg.confidence ?? 0.8),
        source: 'external_sync',
        authored_by: systemActor.id,
      } as Parameters<typeof createContextEntry>[2]);
      break;
    }
    case 'hitl_checkpoint': {
      const hitlRepo = await import('../db/repos/hitl.js');
      const title        = interpolate(String(cfg.title ?? 'Human review requested'), variableContext);
      const instructions = cfg.instructions ? interpolate(String(cfg.instructions), variableContext) : undefined;
      const priority     = (cfg.priority as string | undefined) ?? 'normal';
      await hitlRepo.createHITLRequest(db, tenantId, {
        agent_id:       'workflow',
        action_type:    'workflow.checkpoint',
        action_summary: title,
        action_payload: {
          instructions,
          priority,
          subject_type: (payload as Record<string, unknown>)?.subject_type ?? undefined,
          subject_id:   (payload as Record<string, unknown>)?.id ?? undefined,
        },
        priority: priority as 'normal' | 'high' | 'urgent' | undefined,
      });
      break;
    }

    default:
      throw new Error(`Unknown workflow action type: ${action.type}`);
  }
}

// ── Direct execution (manual trigger) ────────────────────────────────────────

/**
 * Run a specific workflow directly without going through event dispatch.
 * Used by the manual trigger endpoint and the workflow_trigger MCP tool.
 */
export async function executeWorkflowDirect(
  db:         DbPool,
  tenantId:   UUID,
  workflowId: string,
  payload:    Record<string, unknown> = {},
): Promise<{ run_id: string; actions_run: number; actions_total: number; status: string }> {
  const workflow = await wfRepo.getWorkflow(db, tenantId, workflowId);
  if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

  const actions  = workflow.actions as { type: string; config: Record<string, unknown> }[];
  const run      = await wfRepo.createRun(db, {
    workflow_id:   workflow.id,
    event_id:      null as unknown as number,
    actions_total: actions.length,
  });

  const variableContext = buildVariableContext(payload);
  let actionsRun = 0;

  try {
    for (const action of actions) {
      const startMs = Date.now();
      try {
        await executeWithTimeout(
          () => executeAction(db, tenantId, action, payload, variableContext),
          ACTION_TIMEOUT_MS,
        );
        actionsRun++;
        await wfRepo.appendActionLog(db, run.id, {
          index:    actionsRun - 1,
          type:     action.type,
          status:   'completed',
          duration_ms: Date.now() - startMs,
          started_at: new Date().toISOString(),
          resolved_config: resolveConfig(action.config, variableContext) as Record<string, unknown>,
        });
        await wfRepo.updateRun(db, run.id, { actions_run: actionsRun });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        await wfRepo.appendActionLog(db, run.id, {
          index:    actionsRun,
          type:     action.type,
          status:   'failed',
          error:    message,
          duration_ms: Date.now() - startMs,
          started_at: new Date().toISOString(),
        });
        await wfRepo.updateRun(db, run.id, {
          status:     'failed',
          error:      message,
          actions_run: actionsRun,
        });
        return { run_id: run.id, actions_run: actionsRun, actions_total: actions.length, status: 'failed' };
      }
    }
    await wfRepo.updateRun(db, run.id, {
      status:     'completed',
      actions_run: actionsRun,
    });
    return { run_id: run.id, actions_run: actionsRun, actions_total: actions.length, status: 'completed' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await wfRepo.updateRun(db, run.id, { status: 'failed', error: message });
    return { run_id: run.id, actions_run: actionsRun, actions_total: actions.length, status: 'failed' };
  }
}

// Re-export interpolate for use in MCP tools
export { interpolate };
