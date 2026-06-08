// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { DbPool } from '../db/pool.js';
import type { ActionContext, ActorContext, SubjectType, UUID, Activity } from '@crmy/shared';
import * as wfRepo from '../db/repos/workflows.js';
import type { WorkflowRow } from '../db/repos/workflows.js';
import * as hitlRepo from '../db/repos/hitl.js';
import { emitEvent } from '../events/emitter.js';
import { interpolate, buildVariableContext, resolveConfig } from './variables.js';
import { resolveSequenceGoalContactId } from '../services/sequence-executor.js';
import { evaluateActionPolicy } from '../services/action-policy.js';
import { getActionContext } from '../services/action-context.js';

/** How many consecutive failures trigger a Handoffs alert (configurable via env) */
const FAILURE_ALERT_THRESHOLD = Number(process.env.WORKFLOW_FAILURE_ALERT_THRESHOLD ?? 3);

// ── Constants ────────────────────────────────────────────────────────────────

/** Default per-action execution timeout (30 seconds) */
const ACTION_TIMEOUT_MS = 30_000;

function workflowActionActor(tenantId: UUID): ActorContext {
  return {
    tenant_id: tenantId,
    actor_id: 'workflow',
    actor_type: 'system',
    role: 'owner',
    scopes: [
      'read',
      'write',
      'context:read',
      'activities:write',
      'systems:write',
      'assignments:write',
    ],
  };
}

function workflowSubject(input: {
  contact_id?: unknown;
  account_id?: unknown;
  opportunity_id?: unknown;
  use_case_id?: unknown;
  subject_type?: unknown;
  subject_id?: unknown;
  object_type?: unknown;
  object_id?: unknown;
}): { subject_type?: SubjectType; subject_id?: UUID } {
  if (typeof input.subject_type === 'string' && typeof input.subject_id === 'string') {
    const type = input.subject_type === 'use-case' ? 'use_case' : input.subject_type;
    if (type === 'contact' || type === 'account' || type === 'opportunity' || type === 'use_case') {
      return { subject_type: type, subject_id: input.subject_id as UUID };
    }
  }
  if (typeof input.object_type === 'string' && typeof input.object_id === 'string') {
    const type = input.object_type === 'use-case' ? 'use_case' : input.object_type;
    if (type === 'contact' || type === 'account' || type === 'opportunity' || type === 'use_case') {
      return { subject_type: type, subject_id: input.object_id as UUID };
    }
  }
  if (typeof input.opportunity_id === 'string') return { subject_type: 'opportunity', subject_id: input.opportunity_id as UUID };
  if (typeof input.use_case_id === 'string') return { subject_type: 'use_case', subject_id: input.use_case_id as UUID };
  if (typeof input.contact_id === 'string') return { subject_type: 'contact', subject_id: input.contact_id as UUID };
  if (typeof input.account_id === 'string') return { subject_type: 'account', subject_id: input.account_id as UUID };
  return {};
}

function summarizeWorkflowActionContext(actionContext: ActionContext) {
  return {
    subject_type: actionContext.subject_type,
    subject_id: actionContext.subject_id,
    operating_mode: actionContext.operating_mode,
    readiness_status: actionContext.readiness.status,
    risk_level: actionContext.readiness.risk_level,
    review_required: actionContext.readiness.review_required,
    guidance_summary: actionContext.guidance.summary,
    warning_reasons: actionContext.guidance.warning_reasons,
    review_reasons: actionContext.guidance.review_reasons,
    proof: actionContext.proof,
  };
}

async function getWorkflowActionContextSummary(
  db: DbPool,
  tenantId: UUID,
  actionType: string,
  cfg: Record<string, unknown>,
  payload: unknown,
  extraPayload: Record<string, unknown> = {},
): Promise<Record<string, unknown> | undefined> {
  const eventPayload = payload as Record<string, unknown> | undefined;
  const subjectRef = workflowSubject({
    contact_id: cfg.contact_id ?? eventPayload?.contact_id,
    account_id: cfg.account_id ?? eventPayload?.account_id,
    opportunity_id: cfg.opportunity_id ?? eventPayload?.opportunity_id,
    use_case_id: cfg.use_case_id ?? eventPayload?.use_case_id,
    subject_type: cfg.subject_type ?? eventPayload?.subject_type,
    subject_id: cfg.subject_id ?? eventPayload?.subject_id,
    object_type: cfg.object_type ?? eventPayload?.object_type,
    object_id: cfg.object_id ?? eventPayload?.object_id ?? eventPayload?.id,
  });
  if (!subjectRef.subject_type || !subjectRef.subject_id) return undefined;
  const actionContext = await getActionContext(db, workflowActionActor(tenantId), {
    subject_type: subjectRef.subject_type,
    subject_id: subjectRef.subject_id,
    context_radius: subjectRef.subject_type === 'account' ? 'account_wide' : 'adjacent',
    proposed_action: {
      action_type: actionType === 'create_activity' ? 'customer_outreach' : 'workflow_action',
      object_type: subjectRef.subject_type,
      payload: {
        workflow_action: actionType,
        ...extraPayload,
      },
    },
  }).catch(() => null);
  return actionContext ? summarizeWorkflowActionContext(actionContext) : undefined;
}

async function generateWorkflowContent(
  db: DbPool,
  tenantId: UUID,
  kind: 'email' | 'notification',
  cfg: Record<string, unknown>,
  payload: unknown,
  variableContext: Record<string, unknown>,
): Promise<{ subject?: string; body_text?: string; message?: string }> {
  const { callLLM, requireTenantLLMConfig } = await import('../agent/providers/llm.js');
  await requireTenantLLMConfig(db, tenantId);
  const prompt = interpolate(
    String(cfg.ai_prompt || (
      kind === 'email'
        ? 'Draft concise, context-aware customer email content.'
        : 'Draft a concise internal notification message.'
    )),
    variableContext,
  );
  const subject = String(cfg.subject ?? '');
  const body = kind === 'email' ? String(cfg.body_text ?? '') : String(cfg.message ?? '');
  const system = kind === 'email'
    ? 'You draft concise, evidence-aware revenue workflow emails. Return only valid JSON: {"subject":"...","body_text":"..."}'
    : 'You draft concise internal workflow notifications for revenue teams. Return only valid JSON: {"message":"..."}';
  const user = [
    `Event payload: ${JSON.stringify(payload ?? {}).slice(0, 4000)}`,
    `Template subject: ${subject || '(none)'}`,
    `Template ${kind === 'email' ? 'body' : 'message'}: ${body || '(none)'}`,
    `Instruction: ${prompt}`,
    '',
    kind === 'email'
      ? 'Return ONLY valid JSON: {"subject":"...","body_text":"..."}'
      : 'Return ONLY valid JSON: {"message":"..."}',
  ].join('\n');

  const raw = await callLLM(db, tenantId, { system, user, maxTokens: 1024 });
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI generation did not return valid JSON.');
  const parsed = JSON.parse(match[0]) as { subject?: string; body_text?: string; message?: string };
  return parsed;
}

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
  processBacklog(limit?: number): Promise<{ processed: number; skipped: number; failed: number }>;
}

export function createWorkflowEngine(db: DbPool): WorkflowEngine {
  async function executeWorkflowForEvent(
    workflow: WorkflowRow,
    tenantId: UUID,
    eventType: string,
    eventId: number,
    payload: unknown,
  ): Promise<'processed' | 'skipped'> {
    // Events created before a workflow existed are historical context, not
    // missed automation work. Catch-up uses this same helper as live delivery.
    if (workflow.created_at && eventId) {
      const eventResult = await db.query(
        'SELECT created_at FROM events WHERE id = $1 AND tenant_id = $2 LIMIT 1',
        [eventId, tenantId],
      );
      const eventCreatedAt = eventResult.rows[0]?.created_at;
      if (eventCreatedAt && new Date(eventCreatedAt).getTime() < new Date(workflow.created_at).getTime()) {
        return 'skipped';
      }
    }

    if (!matchesFilter(workflow.trigger_filter, payload)) return 'skipped';

    if (eventId) {
      const dup = await db.query(
        `SELECT id FROM workflow_runs WHERE workflow_id = $1 AND event_id = $2 LIMIT 1`,
        [workflow.id, eventId],
      );
      if (dup.rows.length > 0) {
        console.info(`[workflow:dedup] Skipping duplicate event_id=${eventId} for workflow ${workflow.id}`);
        return 'skipped';
      }
    }

    if (workflow.max_runs_per_hour) {
      const recentCount = await wfRepo.countRecentRuns(db, workflow.id, 1);
      if (recentCount >= workflow.max_runs_per_hour) {
        console.warn(`[workflow:rate-limit] Workflow ${workflow.id} (${workflow.name}) hit max_runs_per_hour=${workflow.max_runs_per_hour}`);
        return 'skipped';
      }
    }

    let run: wfRepo.WorkflowRunRow;
    try {
      run = await wfRepo.createRun(db, {
        workflow_id: workflow.id,
        event_id: eventId,
        actions_total: workflow.actions.length,
      });
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === '23505') {
        console.info(`[workflow:dedup] Skipping concurrently processed event_id=${eventId} for workflow ${workflow.id}`);
        return 'skipped';
      }
      throw err;
    }

    await emitEvent(db, {
      tenantId,
      eventType: 'workflow.run.started',
      actorType: 'system',
      objectType: 'workflow_run',
      objectId: run.id,
      afterData: {
        workflow_id: workflow.id,
        workflow_name: workflow.name,
        run_id: run.id,
        event_id: eventId,
        event_type: eventType,
        actions_total: workflow.actions.length,
      },
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
          throw actionErr;
        }
      }

      await wfRepo.updateRun(db, run.id, { status: 'completed', actions_run: actionsRun });
      await wfRepo.incrementRunCount(db, workflow.id);
      await emitEvent(db, {
        tenantId,
        eventType: 'workflow.run.completed',
        actorType: 'system',
        objectType: 'workflow_run',
        objectId: run.id,
        afterData: {
          workflow_id: workflow.id,
          workflow_name: workflow.name,
          run_id: run.id,
          event_id: eventId,
          event_type: eventType,
          actions_run: actionsRun,
          actions_total: workflow.actions.length,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      await wfRepo.updateRun(db, run.id, { status: 'failed', error: message });
      const newErrorCount = await wfRepo.incrementErrorCount(db, workflow.id);
      await emitEvent(db, {
        tenantId,
        eventType: 'workflow.run.failed',
        actorType: 'system',
        objectType: 'workflow_run',
        objectId: run.id,
        afterData: {
          workflow_id: workflow.id,
          workflow_name: workflow.name,
          run_id: run.id,
          event_id: eventId,
          event_type: eventType,
          actions_run: actionsRun,
          actions_total: workflow.actions.length,
          error: message,
        },
      });

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

    return 'processed';
  }

  return {
    async processEvent(tenantId, eventType, eventId, payload) {
      // Prevent recursive workflow triggers (workflow.* events don't re-trigger workflows)
      if (eventType.startsWith('workflow.')) return;
      const metadata = payload && typeof payload === 'object' && 'metadata' in payload
        ? (payload as { metadata?: unknown }).metadata
        : undefined;
      if (metadata && typeof metadata === 'object' && (metadata as { origin?: unknown }).origin === 'workflow') {
        console.info(`[workflow] Skipping workflow-originated event_id=${eventId} event_type=${eventType}`);
        return;
      }
      if (metadata && typeof metadata === 'object' && (metadata as { sync_mode?: unknown }).sync_mode === 'replay') {
        console.info(`[workflow] Skipping replayed sync event_id=${eventId} event_type=${eventType}`);
        return;
      }

      const workflows = await getCachedWorkflows(db, tenantId, eventType);

      for (const workflow of workflows) {
        await executeWorkflowForEvent(workflow, tenantId, eventType, eventId, payload);
      }
    },
    async processBacklog(limit = 100) {
      const result = await db.query(
        `SELECT
            e.id AS event_id,
            e.tenant_id,
            e.event_type,
            e.object_type,
            e.object_id,
            e.after_data,
            e.metadata,
            w.id AS workflow_id
         FROM events e
         JOIN workflows w
           ON w.tenant_id = e.tenant_id
          AND w.trigger_event = e.event_type
          AND w.is_active = true
          AND e.created_at >= w.created_at
         LEFT JOIN workflow_runs wr
           ON wr.workflow_id = w.id
          AND wr.event_id = e.id
         WHERE wr.id IS NULL
           AND e.event_type NOT LIKE 'workflow.%'
           AND COALESCE(e.metadata->>'origin', '') <> 'workflow'
           AND COALESCE(e.metadata->>'sync_mode', '') <> 'replay'
         ORDER BY e.id ASC
         LIMIT $1`,
        [limit],
      );

      let processed = 0;
      let skipped = 0;
      let failed = 0;

      for (const row of result.rows as Array<{
        event_id: number; tenant_id: UUID; event_type: string; object_type?: string; object_id?: UUID;
        after_data?: unknown; metadata?: Record<string, unknown>; workflow_id: UUID;
      }>) {
        const workflow = await wfRepo.getWorkflow(db, row.tenant_id, row.workflow_id);
        if (!workflow || !workflow.is_active) {
          skipped++;
          continue;
        }
        const payload = {
          ...((row.after_data && typeof row.after_data === 'object') ? row.after_data as Record<string, unknown> : { value: row.after_data }),
          event_type: row.event_type,
          event_id: row.event_id,
          object_type: row.object_type,
          object_id: row.object_id,
          metadata: row.metadata ?? {},
        };
        try {
          const outcome = await executeWorkflowForEvent(workflow, row.tenant_id, row.event_type, row.event_id, payload);
          if (outcome === 'processed') processed++;
          else skipped++;
        } catch (err) {
          failed++;
          console.error('[workflow:catchup] Failed to process missed event:', {
            eventId: row.event_id,
            workflowId: row.workflow_id,
            error: err instanceof Error ? err.message : err,
          });
        }
      }

      return { processed, skipped, failed };
    },
  };
}

export async function previewWorkflowContent(
  db: DbPool,
  tenantId: UUID,
  input: {
    action_type: 'send_email' | 'send_notification';
    config: Record<string, unknown>;
    sample_payload?: unknown;
  },
): Promise<{ subject?: string; body_text?: string; message?: string }> {
  const variableContext = buildVariableContext(input.sample_payload ?? {});
  const resolved = resolveConfig(input.config, variableContext) as Record<string, unknown>;
  return generateWorkflowContent(
    db,
    tenantId,
    input.action_type === 'send_email' ? 'email' : 'notification',
    resolved,
    input.sample_payload ?? {},
    variableContext,
  );
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

export interface WorkflowDryRunDefinition {
  trigger_filter?: Record<string, unknown>;
  actions: Array<{ type: string; config: Record<string, unknown> }>;
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

  return dryRunWorkflowDefinition({
    trigger_filter: workflow.trigger_filter as Record<string, unknown>,
    actions: workflow.actions as Array<{ type: string; config: Record<string, unknown> }>,
  }, samplePayload);
}

export function dryRunWorkflowDefinition(
  workflow: WorkflowDryRunDefinition,
  samplePayload: unknown,
): DryRunResult {
  const filter = workflow.trigger_filter ?? {};
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

  const actions = workflow.actions.map((action, idx) => {
    const resolved = resolveConfig(action.config, variableContext) as Record<string, unknown>;
    let note: string | undefined;
    if (action.type === 'send_notification' && !resolved.channel_id) {
      note = 'No channel_id set — would use tenant default channel';
    }
    if (action.type === 'send_email' && resolved.require_approval !== false) {
      note = 'require_approval is true — would create a HITL request before sending';
    }
    if (action.type === 'request_external_writeback') {
      note = 'Creates a governed writeback request; execution follows system policy and may require approval.';
    }
    if (action.type === 'run_system_sync') {
      note = 'Starts a governed sync run for the configured system of record.';
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
    case 'create_context_entry': {
      const { createContextEntry } = await import('../db/repos/context-entries.js');
      const actorRepo = await import('../db/repos/actors.js');
      const rawContextRepo = await import('../db/repos/raw-context-sources.js');
      const workflowActor = await actorRepo.ensureActor(db, tenantId, {
        actor_type: 'agent',
        display_name: 'Workflow Automation',
        agent_identifier: 'workflow-automation',
        agent_model: 'crmy-workflow',
        scopes: ['read', 'write'],
      } as Parameters<typeof actorRepo.ensureActor>[2]);
      const entry = await createContextEntry(db, tenantId, {
        subject_type: cfg.object_type as string,
        subject_id: cfg.object_id as string,
        context_type: (cfg.context_type as string) ?? 'note',
        title: cfg.title as string | undefined,
        body: cfg.body as string,
        confidence: Number(cfg.confidence ?? 0.75),
        memory_status: (cfg.memory_status as 'signal' | 'active' | undefined) ?? 'signal',
        evidence: [{
          source_type: 'workflow',
          source_ref: String((payload as Record<string, unknown>)?.id ?? 'event'),
          source_label: String(action.type),
          snippet: String(cfg.body ?? '').slice(0, 1000),
          captured_at: new Date().toISOString(),
          confidence: Number(cfg.confidence ?? 0.75),
          rationale: 'Created by workflow action from an event payload.',
        }],
        source: 'workflow',
        source_ref: String((payload as Record<string, unknown>)?.id ?? action.type),
        authored_by: workflowActor.id,
        visibility: (cfg.visibility as string) ?? 'internal',
      } as Parameters<typeof createContextEntry>[2]);
      await rawContextRepo.upsertRawContextSource(db, tenantId, {
        source_type: 'workflow',
        source_ref: `workflow:${entry.id}`,
        source_label: String(cfg.title ?? action.type),
        subject_type: entry.subject_type,
        subject_id: entry.subject_id,
        actor_id: workflowActor.id,
        status: entry.memory_status === 'signal' ? 'needs_review' : 'processed',
        stage: entry.memory_status === 'signal' ? 'review_signals' : 'confirmed_memory',
        raw_excerpt: entry.body.slice(0, 1000),
        signals_created: entry.memory_status === 'signal' ? 1 : 0,
        memory_created: entry.memory_status === 'active' ? 1 : 0,
        metadata: { context_entry_id: entry.id, workflow_action: action.type },
      });
      break;
    }
    case 'create_activity': {
      const { createActivity } = await import('../db/repos/activities.js');
      const actionContextSummary = await getWorkflowActionContextSummary(db, tenantId, action.type, cfg, payload, {
        activity_type: cfg.type,
        subject: cfg.subject,
      });
      const activity = await createActivity(db, tenantId, {
        type: (cfg.type as Activity['type']) ?? 'task',
        subject: cfg.subject as string,
        body: cfg.body as string | undefined,
        contact_id: cfg.contact_id as string | undefined,
        account_id: cfg.account_id as string | undefined,
      });
      await emitEvent(db, {
        tenantId,
        eventType: 'workflow.action.create_activity',
        actorType: 'system',
        objectType: 'activity',
        objectId: activity.id,
        afterData: activity,
        metadata: { origin: 'workflow', action_context: actionContextSummary },
      });
      break;
    }
    case 'send_notification': {
      let channelId = cfg.channel_id as string | undefined;
      let notificationSubject = cfg.subject as string | undefined;
      let notificationBody = (cfg.message as string | undefined) ?? '';

      if (cfg.ai_generate === true) {
        const generated = await generateWorkflowContent(db, tenantId, 'notification', cfg, payload, variableContext);
        notificationBody = generated.message || notificationBody;
      }

      if (!channelId) {
        const { getDefaultChannel } = await import('../db/repos/messaging.js');
        const defaultChannel = await getDefaultChannel(db, tenantId);
          if (defaultChannel) channelId = defaultChannel.id;
      }

      const actionContextSummary = await getWorkflowActionContextSummary(db, tenantId, action.type, cfg, payload, {
        channel_id: channelId,
        recipient: cfg.recipient,
        subject: notificationSubject,
        message_preview: notificationBody.slice(0, 200),
      });

      if (channelId) {
        const { sendMessage } = await import('../messaging/delivery.js');
        const delivery = await sendMessage(db, tenantId, {
          channel_id: channelId,
          recipient: cfg.recipient as string | undefined,
          subject: notificationSubject,
          body: notificationBody,
          metadata: { workflow_run: true, action_context: actionContextSummary },
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
            message: notificationBody,
            recipient: cfg.recipient,
          },
          metadata: { origin: 'workflow', action_context: actionContextSummary },
        });
      } else {
        await emitEvent(db, {
          tenantId,
          eventType: 'workflow.notification',
          actorType: 'system',
          objectType: 'workflow',
          afterData: { channel: 'internal', message: notificationBody, recipient: cfg.recipient },
          metadata: { origin: 'workflow', action_context: actionContextSummary },
        });
      }
      break;
    }
    case 'send_email': {
      const emailRepo = await import('../db/repos/emails.js');
      const hitlRepo = await import('../db/repos/hitl.js');

      const toAddress = cfg.to_address as string;
      let subject = cfg.subject as string;
      let bodyText = (cfg.body_text as string | undefined) ?? '';
      const bodyHtml = cfg.body_html as string | undefined;
      const requireApproval = cfg.require_approval !== false;

      if (cfg.ai_generate === true) {
        const generated = await generateWorkflowContent(db, tenantId, 'email', cfg, payload, variableContext);
        subject = generated.subject || subject;
        bodyText = generated.body_text || bodyText;
      }

      const subjectRef = workflowSubject({
        contact_id: cfg.contact_id,
        account_id: cfg.account_id,
        opportunity_id: cfg.opportunity_id,
        use_case_id: cfg.use_case_id,
        object_type: cfg.object_type ?? (payload as Record<string, unknown> | undefined)?.object_type,
        object_id: cfg.object_id ?? (payload as Record<string, unknown> | undefined)?.object_id,
      });
      const actionContext = subjectRef.subject_type && subjectRef.subject_id
        ? await getActionContext(db, workflowActionActor(tenantId), {
          subject_type: subjectRef.subject_type,
          subject_id: subjectRef.subject_id,
          context_radius: subjectRef.subject_type === 'account' ? 'account_wide' : 'adjacent',
          proposed_action: {
            action_type: 'customer_outreach',
            object_type: subjectRef.subject_type,
            payload: {
              to_address: toAddress,
              subject,
              workflow_action: 'send_email',
            },
          },
        }).catch(() => null)
        : null;
      const actionContextSummary = actionContext ? summarizeWorkflowActionContext(actionContext) : undefined;
      const effectiveRequireApproval = requireApproval || actionContext?.guidance.can_execute === false;

      let hitlRequestId: string | undefined;
      let status = 'draft';

      if (effectiveRequireApproval) {
        const hitl = await hitlRepo.createHITLRequest(db, tenantId, {
          agent_id: 'system',
          action_type: 'email.send',
          action_summary: `Send email to ${toAddress}: "${subject}"`,
          action_payload: {
            to_address: toAddress,
            subject,
            body_preview: bodyText.slice(0, 200),
            action_context: actionContextSummary,
          },
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
        generation_metadata: {
          origin: 'workflow',
          ai_generated: cfg.ai_generate === true,
          action_context: actionContextSummary,
        },
      });

      await emitEvent(db, {
        tenantId,
        eventType: 'email.created',
        actorType: 'system',
        objectType: 'email',
        objectId: email.id,
        afterData: { id: email.id, to: email.to_email, subject: email.subject, status: email.status },
        metadata: { origin: 'workflow', action_context: actionContextSummary },
      });

      if (!effectiveRequireApproval) {
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
      const actionContextSummary = objectType && objectId
        ? await getWorkflowActionContextSummary(db, tenantId, action.type, {
          ...cfg,
          object_type: objectType,
          object_id: objectId,
        }, payload, {
          field,
          value,
        })
        : undefined;

      if (objectType && objectId && field) {
        const policy = evaluateActionPolicy({
          action_type: 'workflow.update_field',
          object_type: objectType,
          field_names: [field],
          actor: {
            tenant_id: tenantId,
            actor_id: 'workflow',
            actor_type: 'system',
            role: 'member',
            scopes: ['workflows:write'],
          },
        });
        if (policy.decision === 'blocked') {
          throw new Error(`workflow update_field blocked by Action Policy: ${policy.reasons.join(' ')}`);
        }
        if (policy.decision === 'approval_required' && cfg.approved !== true) {
          await hitlRepo.createHITLRequest(db, tenantId, {
            agent_id: 'system',
            action_type: 'workflow.update_field',
            action_summary: `Approve workflow update to ${objectType}.${field}`,
            action_payload: { object_type: objectType, object_id: objectId, field, value, policy, action_context: actionContextSummary },
            priority: policy.risk_level === 'high' ? 'high' : 'normal',
            sla_minutes: 1440,
          });
          await emitEvent(db, {
            tenantId,
            eventType: 'workflow.action.approval_required',
            actorType: 'system',
            objectType,
            objectId,
            afterData: { action: 'update_field', field, policy },
            metadata: { origin: 'workflow', action_context: actionContextSummary },
          });
          break;
        }
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
        metadata: { origin: 'workflow', action_context: actionContextSummary },
      });
      break;
    }
    case 'add_tag':
    case 'remove_tag': {
      const tagPayload = payload as Record<string, unknown> | undefined;
      const objType = (cfg.object_type as string) || tagPayload?.object_type as string;
      const objId = (cfg.object_id as string) || tagPayload?.id as string;
      const tag = cfg.tag as string;
      const actionContextSummary = objType && objId
        ? await getWorkflowActionContextSummary(db, tenantId, action.type, {
          ...cfg,
          object_type: objType,
          object_id: objId,
        }, payload, { tag })
        : undefined;

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
        metadata: { origin: 'workflow', action_context: actionContextSummary },
      });
      break;
    }
    case 'assign_owner': {
      const ownerPayload = payload as Record<string, unknown> | undefined;
      const ownerObjType = (cfg.object_type as string) || ownerPayload?.object_type as string;
      const ownerObjId = (cfg.object_id as string) || ownerPayload?.id as string;
      const ownerId = cfg.owner_id as string;
      const actionContextSummary = ownerObjType && ownerObjId
        ? await getWorkflowActionContextSummary(db, tenantId, action.type, {
          ...cfg,
          object_type: ownerObjType,
          object_id: ownerObjId,
        }, payload, { owner_id: ownerId })
        : undefined;

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
        metadata: { origin: 'workflow', action_context: actionContextSummary },
      });
      break;
    }
    case 'webhook': {
      const url = cfg.url as string;
      if (!url) throw new Error('webhook action requires a url');
      const actionContextSummary = await getWorkflowActionContextSummary(db, tenantId, action.type, cfg, payload, {
        url,
      });

      const body = JSON.stringify({
        event_type: 'workflow.action.webhook',
        payload,
        triggered_at: new Date().toISOString(),
        config: cfg,
      });

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
      }).catch((err) => {
        if (err instanceof Error && err.name === 'TimeoutError') {
          throw new Error('Webhook HTTP request timed out');
        }
        throw err;
      });

      if (!res.ok) throw new Error(`Webhook returned HTTP ${res.status} ${res.statusText}`);
      await emitEvent(db, {
        tenantId,
        eventType: 'workflow.action.webhook',
        actorType: 'system',
        objectType: 'workflow',
        afterData: { url, status: res.status },
        metadata: { origin: 'workflow', action_context: actionContextSummary },
      });
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
      const actionContextSummary = await getWorkflowActionContextSummary(db, tenantId, action.type, {
        ...cfg,
        contact_id: contactId,
      }, payload, {
        sequence_id: sequenceId,
        objective: cfg.objective,
      });
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
        metadata: { origin: 'workflow', action_context: actionContextSummary },
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
      const objectType = String(cfg.object_type ?? (payload as Record<string, unknown>)?.object_type ?? 'unknown');
      const objectId = (cfg.object_id as UUID | undefined) ?? ((payload as Record<string, unknown>)?.id as UUID | undefined);
      const writebackPayload = parseObject(cfg.payload);
      const subjectRef = workflowSubject({
        object_type: objectType,
        object_id: objectId,
      });
      const actionContext = subjectRef.subject_type && subjectRef.subject_id
        ? await getActionContext(db, workflowActionActor(tenantId), {
          subject_type: subjectRef.subject_type,
          subject_id: subjectRef.subject_id,
          context_radius: subjectRef.subject_type === 'account' ? 'account_wide' : 'adjacent',
          proposed_action: {
            action_type: 'external_writeback',
            object_type: subjectRef.subject_type,
            system_id: cfg.system_id as UUID | undefined,
            mapping_id: cfg.mapping_id as UUID | undefined,
            external_object: typeof cfg.external_object === 'string' ? cfg.external_object : undefined,
            payload: writebackPayload,
          },
        }).catch(() => null)
        : null;
      const actionContextSummary = actionContext ? summarizeWorkflowActionContext(actionContext) : undefined;
      const writeback = await requestExternalWriteback(db, tenantId, 'workflow', {
        system_id: cfg.system_id as UUID,
        mapping_id: cfg.mapping_id as UUID | undefined,
        object_type: objectType,
        object_id: objectId,
        external_object: String(cfg.external_object ?? ''),
        external_record_id: cfg.external_record_id as string | undefined,
        operation: (cfg.operation as 'create' | 'update' | 'upsert' | 'append_event' | 'stored_procedure') ?? 'upsert',
        writeback_mode: (cfg.writeback_mode as 'append_event' | 'mapped_upsert' | 'stored_procedure') ?? 'mapped_upsert',
        payload: writebackPayload,
        require_approval: cfg.require_approval !== false || actionContext?.guidance.can_execute === false,
        action_context: actionContextSummary,
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
        metadata: {
          origin: 'workflow',
          system_id: writeback.system_id,
          external_record_id: writeback.external_record_id,
          action_context: actionContextSummary,
        },
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
      const actionContextSummary = await getWorkflowActionContextSummary(db, tenantId, action.type, cfg, payload, {
        title: cfg.title,
        priority: cfg.priority,
      });
      await hitlRepo.createHITLRequest(db, tenantId, {
        agent_id: 'workflow',
        action_type: 'sync.conflict.review',
        action_summary: String(cfg.title ?? 'Review system-of-record sync conflict'),
        action_payload: { ...cfg, event_payload: payload, action_context: actionContextSummary },
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
      const metadata = payload && typeof payload === 'object' && 'metadata' in payload
        ? ((payload as { metadata?: unknown }).metadata as Record<string, unknown> | undefined)
        : undefined;
      const entry = await createContextEntry(db, tenantId, {
        subject_type: String(cfg.subject_type ?? (payload as Record<string, unknown>)?.object_type),
        subject_id: String(cfg.subject_id ?? (payload as Record<string, unknown>)?.id),
        context_type: String(cfg.context_type ?? 'external_update'),
        title: cfg.title as string | undefined,
        body: String(cfg.body ?? cfg.message ?? 'External system update received.'),
        confidence: Number(cfg.confidence ?? 0.8),
        memory_status: 'signal',
        evidence: [{
          source_type: String(metadata?.origin ?? 'external_sync'),
          source_id: String(metadata?.external_record_id ?? metadata?.system_id ?? ''),
          source_ref: String(metadata?.sync_run_id ?? metadata?.external_record_id ?? ''),
          source_label: String(metadata?.system_type ?? 'System of Record'),
          snippet: String(cfg.body ?? cfg.message ?? 'External system update received.').slice(0, 1000),
          captured_at: new Date().toISOString(),
          confidence: Number(cfg.confidence ?? 0.8),
          rationale: 'Created from an external system change and requires review before becoming Memory.',
        }],
        source: 'external_sync',
        source_ref: String(metadata?.sync_run_id ?? metadata?.external_record_id ?? 'external_change'),
        authored_by: systemActor.id,
      } as Parameters<typeof createContextEntry>[2]);
      const rawContextRepo = await import('../db/repos/raw-context-sources.js');
      await rawContextRepo.upsertRawContextSource(db, tenantId, {
        source_type: String(metadata?.origin ?? 'external_sync'),
        source_ref: `workflow-external:${entry.id}`,
        source_label: String(metadata?.system_type ?? cfg.title ?? 'External system update'),
        subject_type: entry.subject_type,
        subject_id: entry.subject_id,
        actor_id: systemActor.id,
        status: 'needs_review',
        stage: 'review_signals',
        raw_excerpt: entry.body.slice(0, 1000),
        signals_created: 1,
        metadata: {
          context_entry_id: entry.id,
          system_id: metadata?.system_id,
          system_type: metadata?.system_type,
          external_record_id: metadata?.external_record_id,
          sync_run_id: metadata?.sync_run_id,
        },
      });
      break;
    }
    case 'hitl_checkpoint': {
      const hitlRepo = await import('../db/repos/hitl.js');
      const title        = interpolate(String(cfg.title ?? 'Human review requested'), variableContext);
      const instructions = cfg.instructions ? interpolate(String(cfg.instructions), variableContext) : undefined;
      const priority     = (cfg.priority as string | undefined) ?? 'normal';
      const eventPayload = payload as Record<string, unknown> | undefined;
      const actionContextSummary = await getWorkflowActionContextSummary(db, tenantId, action.type, {
        ...cfg,
        subject_type: cfg.subject_type ?? eventPayload?.subject_type ?? eventPayload?.object_type,
        subject_id: cfg.subject_id ?? eventPayload?.subject_id ?? eventPayload?.object_id ?? eventPayload?.id,
      }, payload, {
        title,
        priority,
      });
      await hitlRepo.createHITLRequest(db, tenantId, {
        agent_id:       'workflow',
        action_type:    'workflow.checkpoint',
        action_summary: title,
        action_payload: {
          instructions,
          priority,
          subject_type: (payload as Record<string, unknown>)?.subject_type ?? undefined,
          subject_id:   (payload as Record<string, unknown>)?.id ?? undefined,
          action_context: actionContextSummary,
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
