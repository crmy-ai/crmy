// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Router, type Request, type Response } from 'express';
import pg from 'pg';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import crypto from 'node:crypto';
import type { DbPool } from '../db/pool.js';
import type { ActorContext, UUID } from '@crmy/shared';
import { CrmyError, workflowAction } from '@crmy/shared';
import * as contactRepo from '../db/repos/contacts.js';
import * as accountRepo from '../db/repos/accounts.js';
import * as oppRepo from '../db/repos/opportunities.js';
import * as activityRepo from '../db/repos/activities.js';
import * as rawContextRepo from '../db/repos/raw-context-sources.js';
import * as hitlRepo from '../db/repos/hitl.js';
import * as eventRepo from '../db/repos/events.js';
import * as searchRepo from '../db/repos/search.js';
import { entityResolve } from '../services/entity-resolve.js';
import { detectRawContextSubjects } from '../services/raw-context-subjects.js';
import * as ucRepo from '../db/repos/use-cases.js';
import * as actorRepo from '../db/repos/actors.js';
import { emitEvent } from '../events/emitter.js';
import { getAllTools } from '../mcp/server.js';
import { enforceToolScopes, requireScopes } from '../auth/scopes.js';
import * as governorLimits from '../db/repos/governor-limits.js';
import { getSpec } from '../openapi/spec.js';
import { extractTextFromBuffer } from '../lib/file-extract.js';
import { resumeEnrollmentAfterHITL } from '../services/sequence-executor.js';
import { getSampleDataStatus, seedSampleData } from '../services/sample-data.js';
import { hashPassword } from '../auth/password.js';
import { buildSetupUrl, createUserAuthToken, sendAuthLifecycleEmail } from '../services/auth-lifecycle.js';
import {
  assertActivityAccess,
  assertHITLAccess,
  assertHITLPayloadAccess,
  assertSubjectAccess,
  filterVisibleHITLRequests,
  resolveOwnerFilter,
} from '../services/access-control.js';
import { z } from 'zod';

function getActor(req: Request): ActorContext {
  return req.actor!;
}

function qs(val: unknown): string | undefined {
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val[0];
  return undefined;
}

function qn(val: unknown, def: number): number {
  const s = qs(val);
  return s ? parseInt(s, 10) || def : def;
}

function p(req: Request, name: string): string {
  const val = req.params[name];
  return typeof val === 'string' ? val : Array.isArray(val) ? val[0] : '';
}

function redactSensitive(value: string): string {
  return value
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+):([^@\s]+)@/gi, '$1:***@')
    .replace(/((?:password|token|secret|api[_-]?key)=)[^&\s]+/gi, '$1***');
}

function safeInternalDetail(err: unknown): string {
  if (process.env.NODE_ENV === 'production') {
    return 'An unexpected server error occurred. Check the server logs for details and try again.';
  }
  return redactSensitive(err instanceof Error ? err.message : 'Internal error');
}

function handleError(res: Response, err: unknown): void {
  if (err instanceof CrmyError) {
    res.status(err.status).json(err.toJSON());
    return;
  }
  res.status(500).json({
    type: 'https://crmy.ai/errors/internal',
    title: 'Internal Error',
    status: 500,
    detail: safeInternalDetail(err),
  });
}

// Helper: use tool handler from MCP tools for reuse (with scope enforcement)
function toolHandler(db: DbPool, toolName: string) {
  const tools = getAllTools(db);
  const tool = tools.find(t => t.name === toolName);
  if (!tool) throw new Error(`Tool ${toolName} not found`);
  return async (input: unknown, actor: ActorContext) => {
    enforceToolScopes(toolName, actor);
    return tool.handler(input, actor);
  };
}

function adminToolHandler(db: DbPool, toolName: string) {
  const tools = getAllTools(db);
  const tool = tools.find(t => t.name === toolName);
  if (!tool) throw new Error(`Tool ${toolName} not found`);
  return async (input: unknown, actor: ActorContext) => {
    if (actor.role !== 'admin' && actor.role !== 'owner') {
      throw new CrmyError(
        'PERMISSION_DENIED',
        'Admin or owner access is required',
        403,
      );
    }
    return tool.handler(input, actor);
  };
}

export function apiRouter(db: DbPool): Router {
  const router = Router();

  // --- OpenAPI spec (no auth required) ---
  router.get('/openapi.json', (_req, res) => {
    res.json(getSpec());
  });

  // --- Operations ---
  router.get('/ops/status', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = adminToolHandler(db, 'ops_status_get');
      const result = await handler({
        sample_limit: qn(req.query.sample_limit, 3),
        include_samples: req.query.include_samples !== 'false',
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/ops/data-quality', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = adminToolHandler(db, 'ops_data_quality_get');
      const result = await handler({
        sample_limit: qn(req.query.sample_limit, 10),
        include_clean: req.query.include_clean === 'true',
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // --- Contacts ---
  router.get('/contacts', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      requireScopes(actor, 'contacts:read');
      const ownerFilter = await resolveOwnerFilter(db, actor, qs(req.query.owner_id));
      const result = await contactRepo.searchContacts(db, actor.tenant_id, {
        query: qs(req.query.q),
        lifecycle_stage: qs(req.query.stage),
        account_id: qs(req.query.account_id),
        ...ownerFilter,
        limit: Math.min(qn(req.query.limit, 20), 100),
        cursor: qs(req.query.cursor),
      });
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/contacts', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'contact_create');
      const result = await handler(req.body, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/contacts/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'contact_get');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.patch('/contacts/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'contact_update');
      const result = await handler({ id: p(req, 'id'), patch: req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.delete('/contacts/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'contact_delete');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/contacts/:id/timeline', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'contact_get_timeline');
      const result = await handler({
        id: p(req, 'id'),
        limit: qn(req.query.limit, 50),
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/contacts/:id/score', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'contact_score');
      const result = await handler({ contact_id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // --- Accounts ---
  router.get('/accounts', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      requireScopes(actor, 'accounts:read');
      const ownerFilter = await resolveOwnerFilter(db, actor, qs(req.query.owner_id));
      const result = await accountRepo.searchAccounts(db, actor.tenant_id, {
        query: qs(req.query.q),
        industry: qs(req.query.industry),
        ...ownerFilter,
        limit: Math.min(qn(req.query.limit, 20), 100),
        cursor: qs(req.query.cursor),
      });
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/accounts', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'account_create');
      const result = await handler(req.body, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/accounts/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'account_get');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.patch('/accounts/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'account_update');
      const result = await handler({ id: p(req, 'id'), patch: req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.delete('/accounts/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'account_delete');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // --- Opportunities ---
  router.get('/opportunities', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      requireScopes(actor, 'opportunities:read');
      const ownerFilter = await resolveOwnerFilter(db, actor, qs(req.query.owner_id));
      const result = await oppRepo.searchOpportunities(db, actor.tenant_id, {
        query: qs(req.query.q),
        stage: qs(req.query.stage),
        forecast_cat: qs(req.query.forecast_cat),
        close_date_before: qs(req.query.close_date_before),
        close_date_after: qs(req.query.close_date_after),
        ...ownerFilter,
        account_id: qs(req.query.account_id),
        limit: Math.min(qn(req.query.limit, 20), 100),
        cursor: qs(req.query.cursor),
      });
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/opportunities', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'opportunity_create');
      const result = await handler(req.body, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/opportunities/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'opportunity_get');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.patch('/opportunities/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      // Only route to advance_stage when the body is exclusively a stage transition
      const bodyKeys = Object.keys(req.body);
      const isStageOnly = bodyKeys.length > 0 && bodyKeys.every(k => ['stage', 'lost_reason', 'note'].includes(k));
      if (isStageOnly && req.body.stage) {
        const handler = toolHandler(db, 'opportunity_advance_stage');
        const result = await handler({ id: p(req, 'id'), ...req.body }, actor);
        res.json(result);
      } else {
        const handler = toolHandler(db, 'opportunity_update');
        const result = await handler({ id: p(req, 'id'), patch: req.body }, actor);
        res.json(result);
      }
    } catch (err) { handleError(res, err); }
  });

  router.delete('/opportunities/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'opportunity_delete');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/opportunities/:id/health-score', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'opportunity_health_score');
      const result = await handler({ opportunity_id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // --- Activities ---
  router.get('/activities', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      requireScopes(actor, 'activities:read');
      const ownerFilter = await resolveOwnerFilter(db, actor);
      const result = await activityRepo.searchActivities(db, actor.tenant_id, {
        contact_id: qs(req.query.contact_id),
        account_id: qs(req.query.account_id),
        opportunity_id: qs(req.query.opportunity_id),
        type: qs(req.query.type),
        direction: qs(req.query.direction),
        subject_type: qs(req.query.subject_type),
        subject_id: qs(req.query.subject_id),
        performed_by: qs(req.query.performed_by),
        outcome: qs(req.query.outcome),
        owner_ids: ownerFilter.owner_ids,
        limit: Math.min(qn(req.query.limit, 20), 100),
        cursor: qs(req.query.cursor),
      });
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/activities/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      requireScopes(actor, 'activities:read');
      const activity = await activityRepo.getActivity(db, actor.tenant_id, p(req, 'id'));
      if (!activity) {
        res.status(404).json({ error: 'Activity not found' });
        return;
      }
      await assertActivityAccess(db, actor, p(req, 'id'));
      res.json({ data: activity });
    } catch (err) { handleError(res, err); }
  });

  router.post('/activities', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'activity_create');
      const result = await handler(req.body, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.patch('/activities/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'activity_update');
      const result = await handler({ id: p(req, 'id'), patch: req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // --- Analytics ---
  router.get('/analytics/pipeline', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'pipeline_summary');
      const ownerFilter = await resolveOwnerFilter(db, actor, qs(req.query.owner_id));
      const result = await handler({
        ...ownerFilter,
        group_by: qs(req.query.group_by) ?? 'stage',
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/analytics/forecast', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'pipeline_forecast');
      const ownerFilter = await resolveOwnerFilter(db, actor, qs(req.query.owner_id));
      const result = await handler({
        period: qs(req.query.period) ?? 'quarter',
        ...ownerFilter,
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // --- HITL ---
  router.get('/hitl', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const limit = qn(req.query.limit, 20);
      const statusParam = qs(req.query.status);
      const status = ['pending', 'approved', 'rejected', 'expired', 'auto_approved', 'all'].includes(statusParam ?? '')
        ? statusParam as 'pending' | 'approved' | 'rejected' | 'expired' | 'auto_approved' | 'all'
        : 'pending';
      const candidates = await hitlRepo.listHITLRequests(db, actor.tenant_id, {
        status,
        limit: Math.min(500, Math.max(limit * 10, limit)),
      });
      const requests = await filterVisibleHITLRequests(db, actor, candidates, limit);
      res.json({ data: requests });
    } catch (err) { handleError(res, err); }
  });

  router.post('/hitl', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      await assertHITLPayloadAccess(db, actor, req.body?.action_payload, req.body?.session_id);
      const handler = toolHandler(db, 'hitl_submit_request');
      const result = await handler(req.body, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/hitl/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const request = await hitlRepo.getHITLRequest(db, actor.tenant_id, p(req, 'id') as UUID);
      if (!request) return res.status(404).json({ error: 'Handoff not found' });
      await assertHITLAccess(db, actor, request);
      res.json({ status: request.status, review_note: request.review_note, request });
    } catch (err) { handleError(res, err); }
  });

  router.patch('/hitl/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const before = await hitlRepo.getHITLRequest(db, actor.tenant_id, p(req, 'id') as UUID);
      if (!before) return res.status(404).json({ error: 'Pending handoff not found or already resolved' });
      await assertHITLAccess(db, actor, before);
      const body = req.body ?? {};
      const priority = typeof body.priority === 'string' && ['low', 'normal', 'high', 'urgent'].includes(body.priority)
        ? body.priority as 'low' | 'normal' | 'high' | 'urgent'
        : undefined;
      const slaMinutes = body.sla_minutes === null
        ? null
        : Number.isFinite(Number(body.sla_minutes))
          ? Math.max(1, Math.round(Number(body.sla_minutes)))
          : undefined;
      const escalateToId = body.escalate_to_id === null
        ? null
        : typeof body.escalate_to_id === 'string' && body.escalate_to_id.trim()
          ? body.escalate_to_id.trim() as UUID
          : undefined;
      if (escalateToId) {
        const assignee = await actorRepo.getActor(db, actor.tenant_id, escalateToId);
        if (!assignee || !assignee.is_active) return res.status(400).json({ error: 'Choose an active reviewer for this handoff' });
      }
      const updated = await hitlRepo.updatePendingHITLRequest(db, actor.tenant_id, p(req, 'id'), {
        action_summary: typeof body.action_summary === 'string' && body.action_summary.trim()
          ? body.action_summary.trim()
          : undefined,
        priority,
        sla_minutes: slaMinutes,
        escalate_to_id: escalateToId,
      });
      if (!updated) return res.status(404).json({ error: 'Pending handoff not found or already resolved' });
      await emitEvent(db, {
        tenantId: actor.tenant_id,
        eventType: before.escalate_to_id !== updated.escalate_to_id ? 'hitl.reassigned' : 'hitl.updated',
        actorId: actor.actor_id,
        actorType: actor.actor_type,
        objectType: 'hitl_request',
        objectId: updated.id,
        beforeData: before,
        afterData: updated,
        metadata: {
          reassigned: before.escalate_to_id !== updated.escalate_to_id,
          previous_reviewer_id: before.escalate_to_id ?? null,
          reviewer_id: updated.escalate_to_id ?? null,
        },
      });
      res.json({ request: updated });
    } catch (err) { handleError(res, err); }
  });

  router.post('/hitl/:id/resolve', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const before = await hitlRepo.getHITLRequest(db, actor.tenant_id, p(req, 'id') as UUID);
      if (!before) return res.status(404).json({ error: 'Handoff not found' });
      await assertHITLAccess(db, actor, before);
      const handler = toolHandler(db, 'hitl_resolve');
      const result = await handler({ request_id: p(req, 'id'), ...req.body }, actor);

      // Auto-resume paused sequence enrollments after HITL approval/rejection
      const hitlReq = (result as any)?.request ?? result;
      if (hitlReq?.action_type === 'sequence.step.send') {
        resumeEnrollmentAfterHITL(db, hitlReq).catch((err) =>
          console.error('[router] resumeEnrollmentAfterHITL failed:', { id: hitlReq.id, err }),
        );
      }

      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // --- HITL Approval Rules ---
  router.get('/hitl/rules', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const rules = await hitlRepo.listApprovalRules(db, actor.tenant_id);
      res.json({ data: rules });
    } catch (err) { handleError(res, err); }
  });

  router.post('/hitl/rules', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const rule = await hitlRepo.createApprovalRule(db, actor.tenant_id, req.body);
      res.status(201).json(rule);
    } catch (err) { handleError(res, err); }
  });

  router.patch('/hitl/rules/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const rule = await hitlRepo.updateApprovalRule(db, actor.tenant_id, p(req, 'id'), req.body);
      if (!rule) { res.status(404).json({ error: 'Rule not found' }); return; }
      res.json(rule);
    } catch (err) { handleError(res, err); }
  });

  router.delete('/hitl/rules/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const deleted = await hitlRepo.deleteApprovalRule(db, actor.tenant_id, p(req, 'id'));
      if (!deleted) { res.status(404).json({ error: 'Rule not found' }); return; }
      res.status(204).end();
    } catch (err) { handleError(res, err); }
  });

  // --- Use Cases ---
  router.get('/use-cases', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const ownerFilter = await resolveOwnerFilter(db, actor, qs(req.query.owner_id));
      const result = await ucRepo.searchUseCases(db, actor.tenant_id, {
        account_id: qs(req.query.account_id),
        stage: qs(req.query.stage),
        ...ownerFilter,
        query: qs(req.query.q),
        limit: Math.min(qn(req.query.limit, 20), 100),
        cursor: qs(req.query.cursor),
      });
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/use-cases', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'use_case_create');
      const result = await handler(req.body, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/use-cases/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'use_case_get');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.patch('/use-cases/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      // Only route to advance_stage when the body is exclusively a stage transition
      const bodyKeys = Object.keys(req.body);
      const isStageOnly = bodyKeys.length > 0 && bodyKeys.every(k => ['stage', 'note'].includes(k));
      if (isStageOnly && req.body.stage) {
        const handler = toolHandler(db, 'use_case_advance_stage');
        const result = await handler({ id: p(req, 'id'), ...req.body }, actor);
        res.json(result);
      } else {
        const handler = toolHandler(db, 'use_case_update');
        const result = await handler({ id: p(req, 'id'), patch: req.body }, actor);
        res.json(result);
      }
    } catch (err) { handleError(res, err); }
  });

  router.delete('/use-cases/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'use_case_delete');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/use-cases/:id/consumption', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'use_case_update_consumption');
      const result = await handler({ id: p(req, 'id'), ...req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/use-cases/:id/health', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'use_case_set_health');
      const result = await handler({ id: p(req, 'id'), ...req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/use-cases/:id/contacts', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'use_case_list_contacts');
      const result = await handler({ use_case_id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/use-cases/:id/contacts', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'use_case_link_contact');
      const result = await handler({ use_case_id: p(req, 'id'), ...req.body }, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.delete('/use-cases/:ucId/contacts/:contactId', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'use_case_unlink_contact');
      const result = await handler({
        use_case_id: p(req, 'ucId'),
        contact_id: p(req, 'contactId'),
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/use-cases/:id/timeline', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'use_case_get_timeline');
      const result = await handler({
        id: p(req, 'id'),
        limit: qn(req.query.limit, 50),
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/analytics/use-cases', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'use_case_summary');
      const result = await handler({
        account_id: qs(req.query.account_id),
        group_by: qs(req.query.group_by) ?? 'stage',
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // --- Webhooks ---
  router.get('/webhooks', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'webhook_list');
      const result = await handler({
        active: req.query.active !== undefined ? req.query.active === 'true' : undefined,
        limit: Math.min(qn(req.query.limit, 20), 100),
        cursor: qs(req.query.cursor),
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/webhooks', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'webhook_create');
      const result = await handler(req.body, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/webhooks/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'webhook_get');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.patch('/webhooks/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'webhook_update');
      const result = await handler({ id: p(req, 'id'), patch: req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.delete('/webhooks/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'webhook_delete');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/webhooks/:id/deliveries', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'webhook_list_deliveries');
      const result = await handler({
        endpoint_id: p(req, 'id'),
        status: qs(req.query.status),
        limit: Math.min(qn(req.query.limit, 20), 100),
        cursor: qs(req.query.cursor),
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // --- Emails ---
  router.get('/emails', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'email_search');
      const result = await handler({
        contact_id: qs(req.query.contact_id),
        status: qs(req.query.status),
        limit: Math.min(qn(req.query.limit, 20), 100),
        cursor: qs(req.query.cursor),
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/emails', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'email_create');
      const result = await handler(req.body, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/emails/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'email_get');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // --- Email Provider ---
  router.get('/email-provider', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'email_provider_get');
      const result = await handler({}, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.put('/email-provider', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'email_provider_set');
      const result = await handler(req.body, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // --- Handoff snapshots (read-only, for UI) ---
  router.get('/handoff-snapshots/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const { getSnapshot } = await import('../db/repos/handoff-snapshots.js');
      const snapshot = await getSnapshot(db, actor.tenant_id, p(req, 'id'));
      if (!snapshot) { res.status(404).json({ error: 'Snapshot not found' }); return; }
      const request = await hitlRepo.getHITLRequestBySnapshot(db, actor.tenant_id, snapshot.id);
      if (request) {
        await assertHITLAccess(db, actor, request);
      } else if (snapshot.subject_type && snapshot.subject_id) {
        await assertSubjectAccess(db, actor, snapshot.subject_type, snapshot.subject_id);
      } else if (snapshot.actor_id !== actor.actor_id && actor.role !== 'admin' && actor.role !== 'owner') {
        res.status(404).json({ error: 'Snapshot not found' });
        return;
      }
      res.json(snapshot);
    } catch (err) { handleError(res, err); }
  });

  // Inbound email webhook config: get status and regenerate secret
  router.get('/email-provider/inbound', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const row = await db.query(
        'SELECT inbound_enabled, CASE WHEN inbound_webhook_secret IS NOT NULL THEN true ELSE false END as has_secret FROM email_providers WHERE tenant_id = $1',
        [actor.tenant_id],
      );
      if (row.rows.length === 0) { res.json({ configured: false }); return; }
      res.json({ configured: true, inbound_enabled: row.rows[0].inbound_enabled, has_secret: row.rows[0].has_secret });
    } catch (err) { handleError(res, err); }
  });

  router.post('/email-provider/inbound/secret', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const secret = crypto.randomBytes(32).toString('hex');
      await db.query(
        'UPDATE email_providers SET inbound_webhook_secret = $1, inbound_enabled = true WHERE tenant_id = $2',
        [secret, actor.tenant_id],
      );
      res.json({ secret, inbound_enabled: true });
    } catch (err) { handleError(res, err); }
  });

  // --- Messaging Channels ---
  router.get('/messaging-channels', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'message_channel_list');
      const result = await handler({
        provider: qs(req.query.provider),
        is_active: req.query.is_active !== undefined ? req.query.is_active === 'true' : undefined,
        limit: Math.min(qn(req.query.limit, 20), 100),
        cursor: qs(req.query.cursor),
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/messaging-channels', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'message_channel_create');
      const result = await handler(req.body, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/messaging-channels/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'message_channel_get');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.patch('/messaging-channels/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'message_channel_update');
      const result = await handler({ id: p(req, 'id'), patch: req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.delete('/messaging-channels/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'message_channel_delete');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // --- Email Sequences ---
  router.get('/email-sequences', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'email_sequence_list');
      const result = await handler({
        is_active: req.query.is_active !== undefined ? req.query.is_active === 'true' : undefined,
        limit: Math.min(qn(req.query.limit, 20), 100),
        cursor: qs(req.query.cursor),
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/email-sequences', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'email_sequence_create');
      const result = await handler(req.body, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/email-sequences/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'email_sequence_get');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.patch('/email-sequences/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'email_sequence_update');
      const result = await handler({ id: p(req, 'id'), patch: req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.delete('/email-sequences/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'email_sequence_delete');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/email-sequences/enroll', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'email_sequence_enroll');
      const result = await handler(req.body, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/email-sequences/unenroll', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'email_sequence_unenroll');
      const result = await handler(req.body, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/email-sequences/enrollments', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'email_sequence_enrollment_list');
      const result = await handler({
        sequence_id: qs(req.query.sequence_id),
        contact_id: qs(req.query.contact_id),
        status: qs(req.query.status),
        limit: Math.min(qn(req.query.limit, 20), 100),
        cursor: qs(req.query.cursor),
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // --- Sequences (new canonical routes) ---
  router.get('/sequences', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sequence_list');
      const result = await handler({
        is_active: req.query.is_active !== undefined ? req.query.is_active === 'true' : undefined,
        tags: req.query.tags ? String(req.query.tags).split(',') : undefined,
        limit: Math.min(qn(req.query.limit, 20), 100),
        cursor: qs(req.query.cursor),
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/sequences', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sequence_create');
      const result = await handler(req.body, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/sequences/enrollments', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sequence_enrollment_list');
      const result = await handler({
        sequence_id: qs(req.query.sequence_id),
        contact_id: qs(req.query.contact_id),
        status: qs(req.query.status),
        limit: Math.min(qn(req.query.limit, 50), 200),
        cursor: qs(req.query.cursor),
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/sequences/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sequence_get');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.patch('/sequences/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sequence_update');
      const result = await handler({ id: p(req, 'id'), patch: req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.delete('/sequences/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sequence_delete');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/sequences/:id/enroll', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sequence_enroll');
      const result = await handler({ sequence_id: p(req, 'id'), ...req.body }, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/sequences/:id/unenroll', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sequence_unenroll');
      const result = await handler(req.body, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/sequences/:id/analytics', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sequence_analytics');
      const result = await handler({
        sequence_id: p(req, 'id'),
        period_type: (qs(req.query.period_type) as 'day' | 'week' | 'month') ?? 'day',
        limit: Math.min(qn(req.query.limit, 30), 90),
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // AI draft preview — generate a sample draft for an email step without saving or enrolling.
  // Accepts the step config directly so it works for both new and existing sequences.
  router.post('/sequences/draft-preview', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const { subject = '', body_text = '', ai_prompt = '', ai_persona } = req.body as {
        subject?: string; body_text?: string; ai_prompt?: string; ai_persona?: string;
      };

      const { callLLM, requireTenantLLMConfig } = await import('../agent/providers/llm.js');
      await requireTenantLLMConfig(db, actor.tenant_id);
      const systemPrompt = ai_persona?.trim() ||
        'You are a sales assistant drafting personalized outreach emails. Return JSON: {"subject":"...","body_text":"..."}';
      const userPrompt = [
        `Template subject: ${subject || '(none)'}`,
        `Template body: ${body_text || '(none)'}`,
        `Instruction: ${ai_prompt || 'Write a short, personalized outreach email using the template above.'}`,
        '',
        'Return ONLY valid JSON: {"subject":"...","body_text":"..."}',
      ].join('\n');

      const raw = await callLLM(db, actor.tenant_id, { system: systemPrompt, user: userPrompt, maxTokens: 1024 });
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('LLM did not return valid JSON');
      const draft = JSON.parse(match[0]) as { subject?: string; body_text?: string };
      res.json({ subject: draft.subject ?? subject, body_text: draft.body_text ?? body_text });
    } catch (err) { handleError(res, err); }
  });

  // Enrollment collaboration sub-resources
  router.get('/sequences/enrollments/:enrollmentId/activities', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const enrollmentId = req.params.enrollmentId;
      // Validate enrollment belongs to tenant
      const enrollment = await import('../db/repos/email-sequences.js').then(m =>
        m.getEnrollment(db, actor.tenant_id, enrollmentId as import('@crmy/shared').UUID),
      );
      if (!enrollment) { res.status(404).json({ error: 'Enrollment not found' }); return; }

      const activityResult = await db.query(
        `SELECT * FROM activities
         WHERE tenant_id = $1 AND detail->>'enrollment_id' = $2
         ORDER BY occurred_at DESC, created_at DESC
         LIMIT 50`,
        [actor.tenant_id, enrollmentId],
      );
      res.json({ data: activityResult.rows });
    } catch (err) { handleError(res, err); }
  });

  router.get('/sequences/enrollments/:enrollmentId/context', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const enrollmentId = req.params.enrollmentId;
      const enrollment = await import('../db/repos/email-sequences.js').then(m =>
        m.getEnrollment(db, actor.tenant_id, enrollmentId as import('@crmy/shared').UUID),
      );
      if (!enrollment) { res.status(404).json({ error: 'Enrollment not found' }); return; }

      const contextResult = await db.query(
        `SELECT * FROM context_entries
         WHERE tenant_id = $1 AND source_ref = $2
         ORDER BY created_at DESC
         LIMIT 50`,
        [actor.tenant_id, enrollmentId],
      );
      res.json({ data: contextResult.rows });
    } catch (err) { handleError(res, err); }
  });

  // Also support POST /sequences/enroll (flat form without sequence id in path)
  router.post('/sequences/enroll', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sequence_enroll');
      const result = await handler(req.body, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  // --- Custom Fields ---
  router.get('/custom-fields', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const objectType = qs(req.query.object_type);
      if (!objectType) {
        res.status(400).json({
          type: 'https://crmy.ai/errors/validation',
          title: 'Validation Error',
          status: 400,
          detail: 'object_type parameter is required',
        });
        return;
      }
      const handler = toolHandler(db, 'custom_field_list');
      const result = await handler({ object_type: objectType }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/custom-fields', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'custom_field_create');
      const result = await handler(req.body, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.patch('/custom-fields/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'custom_field_update');
      const result = await handler({ id: p(req, 'id'), patch: req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.delete('/custom-fields/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'custom_field_delete');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // --- Workflows ---
  router.get('/workflows', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const actor = getActor(req);
      const handler = toolHandler(db, 'workflow_list');
      const result = await handler({
        trigger_event: qs(req.query.trigger_event),
        is_active: req.query.active !== undefined ? req.query.active === 'true' : undefined,
        limit: Math.min(qn(req.query.limit, 20), 100),
        cursor: qs(req.query.cursor),
      }, actor);
      // Normalize: the MCP tool returns { workflows: [...] } but REST clients
      // expect the standard { data: [...], next_cursor, total } envelope.
      const r = result as { workflows: unknown[]; next_cursor?: string; total: number };
      res.json({ data: r.workflows, next_cursor: r.next_cursor, total: r.total });
    } catch (err) { handleError(res, err); }
  });

  router.post('/workflows', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const actor = getActor(req);
      const handler = toolHandler(db, 'workflow_create');
      const result = await handler(req.body, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/workflows/test-draft', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const actor = getActor(req);
      requireScopes(actor, 'workflows:read');
      const draftSchema = z.object({
        workflow: z.object({
          name: z.string().optional(),
          trigger_event: z.string().min(1),
          trigger_filter: z.record(z.unknown()).default({}),
          actions: z.array(workflowAction).min(1).max(20),
          is_active: z.boolean().optional(),
        }),
        sample_payload: z.unknown().optional(),
      });
      const parsed = draftSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid draft trigger',
          details: parsed.error.flatten().fieldErrors,
        });
        return;
      }
      const { dryRunWorkflowDefinition } = await import('../workflows/engine.js');
      res.json(dryRunWorkflowDefinition(parsed.data.workflow, parsed.data.sample_payload ?? {}));
    } catch (err) { handleError(res, err); }
  });

  router.post('/workflows/draft-content-preview', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const actor = getActor(req);
      requireScopes(actor, 'workflows:read');
      const previewSchema = z.object({
        action_type: z.enum(['send_email', 'send_notification']),
        config: z.record(z.unknown()).default({}),
        sample_payload: z.unknown().optional(),
      });
      const parsed = previewSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid trigger content preview',
          details: parsed.error.flatten().fieldErrors,
        });
        return;
      }
      const { previewWorkflowContent } = await import('../workflows/engine.js');
      const draft = await previewWorkflowContent(db, actor.tenant_id, parsed.data);
      res.json(draft);
    } catch (err) { handleError(res, err); }
  });

  router.get('/workflows/:id', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const actor = getActor(req);
      const handler = toolHandler(db, 'workflow_get');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.patch('/workflows/:id', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const actor = getActor(req);
      const handler = toolHandler(db, 'workflow_update');
      const result = await handler({ id: p(req, 'id'), patch: req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.delete('/workflows/:id', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const actor = getActor(req);
      const handler = toolHandler(db, 'workflow_delete');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/workflows/:id/runs', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const actor = getActor(req);
      const handler = toolHandler(db, 'workflow_run_list');
      const result = await handler({
        workflow_id: p(req, 'id'),
        status: qs(req.query.status),
        limit: Math.min(qn(req.query.limit, 20), 100),
        cursor: qs(req.query.cursor),
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/workflows/:id/test', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const actor = getActor(req);
      const handler = toolHandler(db, 'workflow_test');
      const result = await handler({
        id: p(req, 'id'),
        sample_payload: req.body?.sample_payload ?? {},
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/workflows/:id/clone', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const actor = getActor(req);
      const handler = toolHandler(db, 'workflow_clone');
      const result = await handler({
        id: p(req, 'id'),
        name: req.body?.name,
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/workflows/:id/trigger', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const actor = getActor(req);

      // Validate the trigger body before handing off to the engine
      const triggerBodySchema = z.object({
        subject_type: z.enum(['contact', 'account', 'opportunity', 'use_case']).optional(),
        subject_id:   z.string().uuid('subject_id must be a valid UUID').optional(),
        objective:    z.string().max(500).optional(),
        variables:    z.record(z.unknown()).optional(),
        idempotency_key: z.string().max(128).optional(),
      }).passthrough();

      const parsed = triggerBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid trigger payload',
          details: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      const { executeWorkflowDirect } = await import('../workflows/engine.js');
      const result = await executeWorkflowDirect(
        db,
        actor.tenant_id,
        p(req, 'id'),
        parsed.data,
      );
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // --- Systems of Record ---
  router.get('/systems-of-record', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sor_system_list');
      const result = await handler({
        system_type: qs(req.query.system_type),
        status: qs(req.query.status),
        limit: Math.min(qn(req.query.limit, 20), 100),
        cursor: qs(req.query.cursor),
      }, actor);
      const r = result as { systems: unknown[]; next_cursor?: string; total: number };
      res.json({ data: r.systems, next_cursor: r.next_cursor, total: r.total });
    } catch (err) { handleError(res, err); }
  });

  router.post('/systems-of-record', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sor_system_create');
      const result = await handler(req.body, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/systems-of-record/:id([0-9a-fA-F-]{36})', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sor_system_get');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.patch('/systems-of-record/:id([0-9a-fA-F-]{36})', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sor_system_update');
      const result = await handler({ id: p(req, 'id'), patch: req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.delete('/systems-of-record/:id([0-9a-fA-F-]{36})', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sor_system_delete');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/systems-of-record/:id([0-9a-fA-F-]{36})/test', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sor_system_test');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/systems-of-record/:id([0-9a-fA-F-]{36})/discover', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sor_discover');
      const result = await handler({ system_id: p(req, 'id'), object_name: qs(req.query.object_name) }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/systems-of-record/mappings/list', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sor_mapping_list');
      const result = await handler({
        system_id: qs(req.query.system_id),
        object_type: qs(req.query.object_type),
        is_active: req.query.is_active !== undefined ? req.query.is_active === 'true' : undefined,
        limit: Math.min(qn(req.query.limit, 20), 100),
        cursor: qs(req.query.cursor),
      }, actor);
      const r = result as { mappings: unknown[]; next_cursor?: string; total: number };
      res.json({ data: r.mappings, next_cursor: r.next_cursor, total: r.total });
    } catch (err) { handleError(res, err); }
  });

  router.post('/systems-of-record/mappings', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sor_mapping_upsert');
      const result = await handler(req.body, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.delete('/systems-of-record/mappings/:id([0-9a-fA-F-]{36})', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sor_mapping_delete');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/systems-of-record/:id([0-9a-fA-F-]{36})/sync', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sor_sync_run');
      const result = await handler({ system_id: p(req, 'id'), ...req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/systems-of-record/sync-runs/list', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sor_sync_status');
      const result = await handler({
        system_id: qs(req.query.system_id),
        status: qs(req.query.status),
        limit: Math.min(qn(req.query.limit, 20), 100),
        cursor: qs(req.query.cursor),
      }, actor);
      const r = result as { runs: unknown[]; next_cursor?: string; total: number };
      res.json({ data: r.runs, next_cursor: r.next_cursor, total: r.total });
    } catch (err) { handleError(res, err); }
  });

  router.get('/systems-of-record/conflicts/list', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sor_conflict_list');
      const result = await handler({
        system_id: qs(req.query.system_id),
        status: qs(req.query.status),
        object_type: qs(req.query.object_type),
        object_id: qs(req.query.object_id),
        limit: Math.min(qn(req.query.limit, 20), 100),
        cursor: qs(req.query.cursor),
      }, actor);
      const r = result as { conflicts: unknown[]; next_cursor?: string; total: number };
      res.json({ data: r.conflicts, next_cursor: r.next_cursor, total: r.total });
    } catch (err) { handleError(res, err); }
  });

  router.post('/systems-of-record/conflicts/:id/resolve', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sor_conflict_resolve');
      const result = await handler({ id: p(req, 'id'), ...req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/systems-of-record/writebacks/preview', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sor_writeback_preview');
      const result = await handler(req.body, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/systems-of-record/writebacks', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sor_writeback_request');
      const result = await handler(req.body, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/systems-of-record/writebacks/:id/review', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sor_writeback_review');
      const result = await handler({ id: p(req, 'id'), ...req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/systems-of-record/writebacks/:id/execute', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sor_writeback_execute');
      const result = await handler({ id: p(req, 'id'), ...req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/systems-of-record/writebacks/list', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'sor_writeback_status');
      const result = await handler({
        system_id: qs(req.query.system_id),
        status: qs(req.query.status),
        limit: Math.min(qn(req.query.limit, 20), 100),
        cursor: qs(req.query.cursor),
      }, actor);
      const r = result as { writebacks: unknown[]; next_cursor?: string; total: number };
      res.json({ data: r.writebacks, next_cursor: r.next_cursor, total: r.total });
    } catch (err) { handleError(res, err); }
  });

  // --- Actors ---
  router.get('/actors', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      requireScopes(actor, 'read');
      const result = await actorRepo.searchActors(db, actor.tenant_id, {
        actor_type: qs(req.query.actor_type),
        query: qs(req.query.q),
        is_active: req.query.is_active !== undefined ? req.query.is_active === 'true' : undefined,
        limit: Math.min(qn(req.query.limit, 20), 200),
        cursor: qs(req.query.cursor),
      });
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/actors', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'actor_register');
      const result = await handler(req.body, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/actors/whoami', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'actor_whoami');
      const result = await handler({}, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/actors/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'actor_get');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.patch('/actors/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'actor_update');
      const result = await handler({ id: p(req, 'id'), patch: req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/actors/:id/specializations', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const specs = await actorRepo.findSpecialists
        ? await actorRepo.findSpecialists(db, actor.tenant_id, '', p(req, 'id'))
        : [];
      // Actually list specializations for a specific actor
      const result = await db.query(
        `SELECT * FROM agent_specializations WHERE tenant_id = $1 AND actor_id = $2 AND is_active = true ORDER BY created_at`,
        [actor.tenant_id, p(req, 'id')],
      );
      res.json({ data: result.rows });
    } catch (err) { handleError(res, err); }
  });

  router.post('/actors/:id/specializations', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const { skill_tag, proficiency, description } = req.body as {
        skill_tag: string;
        proficiency?: string;
        description?: string;
      };
      const spec = await actorRepo.upsertSpecialization(db, actor.tenant_id, p(req, 'id'), {
        skill_tag,
        proficiency: (proficiency as 'basic' | 'intermediate' | 'expert') ?? 'basic',
        description,
      });
      res.status(201).json(spec);
    } catch (err) { handleError(res, err); }
  });

  router.delete('/actors/:id/specializations/:skill_tag', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      await db.query(
        `UPDATE agent_specializations SET is_active = false WHERE tenant_id = $1 AND actor_id = $2 AND skill_tag = $3`,
        [actor.tenant_id, p(req, 'id'), decodeURIComponent(p(req, 'skill_tag'))],
      );
      res.status(204).end();
    } catch (err) { handleError(res, err); }
  });

  // --- Assignments ---
  router.get('/assignments', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'assignment_list');
      const result = await handler({
        assigned_to: qs(req.query.assigned_to),
        assigned_by: qs(req.query.assigned_by),
        status: qs(req.query.status),
        priority: qs(req.query.priority),
        subject_type: qs(req.query.subject_type),
        subject_id: qs(req.query.subject_id),
        limit: Math.min(qn(req.query.limit, 20), 100),
        cursor: qs(req.query.cursor),
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/assignments', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'assignment_create');
      const result = await handler(req.body, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/assignments/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'assignment_get');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.patch('/assignments/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'assignment_update');
      const result = await handler({ id: p(req, 'id'), patch: req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/assignments/:id/accept', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'assignment_accept');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/assignments/:id/complete', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'assignment_complete');
      const result = await handler({ id: p(req, 'id'), ...req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/assignments/:id/decline', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'assignment_decline');
      const result = await handler({ id: p(req, 'id'), ...req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // --- Context Entries ---
  router.get('/context', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_list');
      const result = await handler({
        subject_type: qs(req.query.subject_type),
        subject_id: qs(req.query.subject_id),
        context_type: qs(req.query.context_type),
        authored_by: qs(req.query.authored_by),
        memory_status: qs(req.query.memory_status),
        is_current: req.query.is_current !== undefined ? req.query.is_current === 'true' : undefined,
        query: qs(req.query.q),
        limit: Math.min(qn(req.query.limit, 20), 100),
        cursor: qs(req.query.cursor),
      }, actor);
      const r = result as { context_entries: unknown[]; next_cursor?: string; total: number };
      res.json({ data: r.context_entries, next_cursor: r.next_cursor, total: r.total });
    } catch (err) { handleError(res, err); }
  });

  router.post('/context', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_add');
      const result = await handler(req.body, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/context/:id/promote', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_signal_promote');
      const result = await handler({ id: p(req, 'id'), ...req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/context/:id/reject', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_signal_reject');
      const result = await handler({ id: p(req, 'id'), ...req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/context/lineage', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_lineage_get');
      const result = await handler({
        subject_type: qs(req.query.subject_type),
        subject_id: qs(req.query.subject_id),
        context_entry_id: qs(req.query.context_entry_id),
        signal_group_id: qs(req.query.signal_group_id),
        raw_context_source_id: qs(req.query.raw_context_source_id),
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/context/signal-groups', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_signal_group_list');
      const result = await handler({
        status: qs(req.query.status),
        subject_type: qs(req.query.subject_type),
        subject_id: qs(req.query.subject_id),
        context_type: qs(req.query.context_type),
        attention_only: req.query.attention_only === 'true',
        limit: Math.min(qn(req.query.limit, 20), 100),
        cursor: qs(req.query.cursor),
      }, actor);
      const r = result as { data?: unknown[]; signal_groups?: unknown[]; next_cursor?: string; total: number };
      res.json({ data: r.data ?? r.signal_groups ?? [], next_cursor: r.next_cursor, total: r.total });
    } catch (err) { handleError(res, err); }
  });

  router.get('/context/signal-groups/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_signal_group_get');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/context/signal-groups/:id/promote', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_signal_group_promote');
      const result = await handler({ id: p(req, 'id'), ...req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/context/signal-groups/:id/handoff', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_signal_handoff');
      const result = await handler({ id: p(req, 'id'), ...req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/context/signal-groups/:id/reject', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_signal_group_reject');
      const result = await handler({ id: p(req, 'id'), ...req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/context/raw-sources', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      requireScopes(actor, 'context:read');
      const ownerFilter = await resolveOwnerFilter(db, actor);
      const result = await rawContextRepo.listRawContextSources(db, actor.tenant_id, {
        source_type: qs(req.query.source_type),
        status: qs(req.query.status) as any,
        subject_type: qs(req.query.subject_type),
        subject_id: qs(req.query.subject_id),
        owner_ids: 'owner_ids' in ownerFilter ? ownerFilter.owner_ids : undefined,
        limit: Math.min(qn(req.query.limit, 50), 200),
        cursor: qs(req.query.cursor),
      });
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/context/raw-sources/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      requireScopes(actor, 'context:read');
      const source = await rawContextRepo.getRawContextSource(db, actor.tenant_id, p(req, 'id'));
      if (!source) throw new CrmyError('NOT_FOUND', 'Raw Context source not found', 404);
      await assertSubjectAccess(db, actor, source.subject_type, source.subject_id);
      res.json({ raw_context_source: source });
    } catch (err) { handleError(res, err); }
  });

  router.post('/context/raw-sources/:id/reprocess', async (req: Request, res: Response) => {
    let source: rawContextRepo.RawContextSource | null = null;
    try {
      const actor = getActor(req);
      requireScopes(actor, 'context:write');
      source = await rawContextRepo.getRawContextSource(db, actor.tenant_id, p(req, 'id'));
      if (!source) throw new CrmyError('NOT_FOUND', 'Raw Context source not found', 404);
      await assertSubjectAccess(db, actor, source.subject_type, source.subject_id);

      await rawContextRepo.updateRawContextSource(db, actor.tenant_id, source.source_type, source.source_ref, {
        status: 'processing',
        stage: 'reprocess',
        failure_reason: null,
        metadata: {
          reprocess_requested_at: new Date().toISOString(),
          reprocess_requested_by: actor.actor_id,
        },
      });

      const sourceRefLooksLikeActivity = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(source.source_ref);
      const canRetryActivity = sourceRefLooksLikeActivity
        && (source.source_type === 'activity' || source.source_type === 'add_context' || source.source_type.includes('email'));

      let result: unknown;
      if (canRetryActivity) {
        const handler = toolHandler(db, 'context_extract');
        result = await handler({ activity_id: source.source_ref }, actor);
      } else if (source.raw_excerpt?.trim()) {
        const handler = toolHandler(db, 'context_ingest_auto');
        result = await handler({
          document: source.raw_excerpt,
          source_label: source.source_label ?? 'Reprocessed Raw Context',
          confidence_threshold: 0.6,
        }, actor);

        const r = result as { extracted_count?: number; memory_created?: number; signals_created?: number; skipped?: number };
        await rawContextRepo.updateRawContextSource(db, actor.tenant_id, source.source_type, source.source_ref, {
          status: Number(r.signals_created ?? 0) > 0
            ? 'needs_review'
            : Number(r.extracted_count ?? 0) > 0
              ? 'processed'
              : 'skipped',
          stage: 'reprocessed',
          memory_created: Number(r.memory_created ?? 0),
          signals_created: Number(r.signals_created ?? 0),
          skipped: Number(r.skipped ?? 0),
          failure_reason: Number(r.extracted_count ?? 0) > 0 ? null : 'Reprocess completed but no extractable context was found.',
        });
      } else {
        throw new CrmyError(
          'VALIDATION_ERROR',
          'This Raw Context source cannot be reprocessed because CRMy does not have the original activity or source excerpt.',
          400,
        );
      }

      const updated = await rawContextRepo.getRawContextSource(db, actor.tenant_id, source.id);
      res.json({ raw_context_source: updated, result });
    } catch (err) {
      if (source) {
        const actor = req.actor;
        await rawContextRepo.updateRawContextSource(db, source.tenant_id, source.source_type, source.source_ref, {
          status: 'failed',
          stage: 'reprocess',
          failure_reason: err instanceof Error ? err.message : 'Reprocess failed.',
          metadata: actor ? { reprocess_failed_by: actor.actor_id } : undefined,
        }).catch(() => {});
      }
      handleError(res, err);
    }
  });

  // Specific read routes must be registered before /context/:id.
  router.get('/context/search', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_search');
      const result = await handler({
        query: qs(req.query.q) ?? '',
        subject_type: qs(req.query.subject_type),
        subject_id: qs(req.query.subject_id),
        context_type: qs(req.query.context_type),
        tag: qs(req.query.tag),
        current_only: req.query.current_only !== 'false',
        memory_status: qs(req.query.memory_status),
        limit: Math.min(qn(req.query.limit, 20), 100),
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/context/semantic-search', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_semantic_search');
      const result = await handler({
        query: qs(req.query.q) ?? '',
        subject_type: qs(req.query.subject_type),
        subject_id: qs(req.query.subject_id),
        context_type: qs(req.query.context_type),
        tag: qs(req.query.tag),
        current_only: req.query.current_only !== 'false',
        memory_status: qs(req.query.memory_status),
        limit: Math.min(qn(req.query.limit, 20), 100),
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/context/stale', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_stale');
      const result = await handler({
        subject_type: qs(req.query.subject_type),
        subject_id: qs(req.query.subject_id),
        limit: Math.min(qn(req.query.limit, 20), 100),
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/context/contradictions', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_detect_contradictions');
      const result = await handler({
        subject_type: qs(req.query.subject_type),
        subject_id: qs(req.query.subject_id),
        context_type: qs(req.query.context_type),
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/context/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_get');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/context/:id/supersede', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_supersede');
      const result = await handler({ id: p(req, 'id'), ...req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/context/ingest', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_ingest');
      const result = await handler({
        document:     req.body.text ?? req.body.document,
        subject_type: req.body.subject_type,
        subject_id:   req.body.subject_id,
        source_label: req.body.source ?? req.body.source_label,
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/context/ingest-auto', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_ingest_auto');
      const result = await handler({
        document: req.body.text ?? req.body.document,
        source_label: req.body.source ?? req.body.source_label,
        context_type: req.body.context_type,
        confidence_threshold: req.body.confidence_threshold,
        subjects: req.body.subjects,
        proposed_records: req.body.proposed_records,
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // Detect customer records mentioned in a block of free text.
  // The Workspace Agent extracts candidate people/companies, then entity resolution
  // grounds those candidates against contacts + accounts.
  router.post('/context/detect-subjects', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const text: string = req.body.text ?? '';
      if (!text.trim()) return res.json({ subjects: [] });
      const ownerFilter = await resolveOwnerFilter(db, actor);

      const detection = await detectRawContextSubjects(db, actor.tenant_id, text, {
        limit: 15,
        confidenceThreshold: 0.67,
        actorId: actor.actor_id,
        ownerIds: 'owner_ids' in ownerFilter ? ownerFilter.owner_ids : undefined,
      });

      return res.json({
        subjects: detection.subjects,
        skipped: detection.skipped,
        candidates: detection.candidates,
        proposed_records: detection.proposed_records ?? [],
        account_scope: detection.account_scope ?? [],
        records_examined: detection.records_examined,
        resolution_summary: detection.resolution_summary,
      });
    } catch (err) { handleError(res, err); }
  });

  // Accept a file upload (base64-encoded) and extract text, then detect subjects.
  // Body: { filename: string, data: string (base64), source_label?: string }
  // Returns: { text_preview, truncated, subjects, filename }
  router.post('/context/ingest-file', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const { filename, data, source_label } = req.body as {
        filename: string;
        data: string;
        source_label?: string;
      };

      if (!filename || !data) {
        return res.status(400).json({ error: 'filename and data (base64) are required' });
      }

      const buffer = Buffer.from(data, 'base64');
      const { text, truncated, format } = await extractTextFromBuffer(buffer, filename);

      if (!text.trim()) {
        return res.json({ text_preview: '', truncated: false, subjects: [], filename, format });
      }

      let detection: Awaited<ReturnType<typeof detectRawContextSubjects>> = { candidates: [], subjects: [], skipped: [] };
      let subjectDetectionError: string | undefined;
      try {
        const ownerFilter = await resolveOwnerFilter(db, actor);
        detection = await detectRawContextSubjects(db, actor.tenant_id, text, {
          limit: 15,
          confidenceThreshold: 0.67,
          actorId: actor.actor_id,
          ownerIds: 'owner_ids' in ownerFilter ? ownerFilter.owner_ids : undefined,
        });
      } catch (err) {
        subjectDetectionError = err instanceof Error
          ? err.message
          : 'Could not match this file to customer records automatically.';
      }

      return res.json({
        text_preview: text.slice(0, 600),
        full_text: text,
        truncated,
        subjects: detection.subjects,
        skipped: detection.skipped,
        candidates: detection.candidates,
        subject_detection_error: subjectDetectionError,
        proposed_records: detection.proposed_records ?? [],
        account_scope: detection.account_scope ?? [],
        records_examined: detection.records_examined,
        resolution_summary: detection.resolution_summary,
        filename,
        format,
        source_label: source_label ?? filename,
      });
    } catch (err) { handleError(res, err); }
  });

  router.post('/context/:id/review', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_review');
      const result = await handler({ id: p(req, 'id'), extend_days: req.body?.extend_days }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/context/review-batch', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_review_batch');
      const result = await handler(req.body, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/context/mark-stale', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_bulk_mark_stale');
      const result = await handler(req.body, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/context/consolidate', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_consolidate');
      const result = await handler(req.body, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/context/contradictions/assign', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_contradiction_assign');
      const result = await handler(req.body, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/context/contradictions/resolve', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_resolve_contradiction');
      const result = await handler(req.body, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // --- Activity Type Registry ---
  router.get('/activity-types', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'activity_type_list');
      const result = await handler({
        category: qs(req.query.category),
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/activity-types', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'activity_type_add');
      const result = await handler(req.body, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.delete('/activity-types/:type_name', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'activity_type_remove');
      const result = await handler({ type_name: p(req, 'type_name') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // --- Context Type Registry ---
  router.get('/context-types', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_type_list');
      const result = await handler({}, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/context-types', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_type_add');
      const result = await handler(req.body, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.delete('/context-types/:type_name', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_type_remove');
      const result = await handler({ type_name: p(req, 'type_name') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // --- Briefing ---
  router.get('/briefing/:subject_type/:subject_id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'briefing_get');
      const result = await handler({
        subject_type: p(req, 'subject_type'),
        subject_id: p(req, 'subject_id'),
        since: qs(req.query.since),
        context_types: req.query.context_types ? (qs(req.query.context_types) ?? '').split(',') : undefined,
        include_stale: req.query.include_stale === 'true',
        context_radius: qs(req.query.context_radius),
        token_budget: req.query.token_budget ? Number(qs(req.query.token_budget)) : undefined,
        format: qs(req.query.format) ?? 'json',
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // Generate a short AI summary of a briefing (requires configured LLM)
  router.post('/briefing/:subject_type/:subject_id/summary', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const subjectType = p(req, 'subject_type');
      const subjectId = p(req, 'subject_id');
      await assertSubjectAccess(db, actor, subjectType, subjectId);

      // Assemble briefing directly (same data as GET endpoint)
      const { assembleBriefing } = await import('../services/briefing.js');
      const briefing = await assembleBriefing(
        db,
        actor.tenant_id,
        subjectType as 'contact' | 'account' | 'opportunity' | 'use_case',
        subjectId,
        { include_stale: false },
      );

      // Build compact text representation for the LLM
      const lines: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sub = briefing.subject as Record<string, any>;
      const recordName = [sub.first_name, sub.last_name].filter(Boolean).join(' ') || String(sub.name ?? subjectId);
      lines.push(`Record type: ${subjectType} — ${recordName}`);
      if (sub.lifecycle_stage) lines.push(`Lifecycle: ${sub.lifecycle_stage}`);
      if (sub.stage) lines.push(`Stage: ${sub.stage}`);
      if (sub.company_name) lines.push(`Company: ${sub.company_name}`);
      if (sub.amount) lines.push(`Amount: ${sub.amount}`);
      if (sub.close_date) lines.push(`Close date: ${sub.close_date}`);
      if (briefing.activities?.length) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lines.push(`Recent activities (${briefing.activities.length}): ${briefing.activities.slice(0, 5).map((a: any) => a.type ?? a.activity_type).join(', ')}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lastAct = briefing.activities[0] as any;
        if (lastAct?.body) lines.push(`Last activity note: ${String(lastAct.body).slice(0, 300)}`);
      }
      if (briefing.open_assignments?.length) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lines.push(`Open assignments: ${briefing.open_assignments.map((a: any) => a.title).join('; ')}`);
      }
      if (briefing.context_entries) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const [type, entries] of Object.entries(briefing.context_entries as Record<string, any[]>)) {
          for (const e of entries.slice(0, 3)) {
            lines.push(`${type}: ${e.title ? `${e.title} — ` : ''}${String(e.body ?? '').slice(0, 200)}`);
          }
        }
      }

      // Need at least a few meaningful lines to generate a useful summary
      if (lines.length < 3) {
        res.json({ summary: null });
        return;
      }

      const { callLLM } = await import('../agent/providers/llm.js');
      const summary = await callLLM(db, actor.tenant_id, {
        system: 'You are a concise CRM assistant. Summarize the CRM record in 2–3 sentences. Focus on what matters most right now — current status, open items, risks, or relationship context. Be specific and actionable. No filler phrases.',
        user: lines.join('\n'),
        maxTokens: 200,
      });

      res.json({ summary: summary?.trim() || null });
    } catch (err) { handleError(res, err); }
  });

  // --- Assignment: Start, Block, Cancel ---
  router.post('/assignments/:id/start', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'assignment_start');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/assignments/:id/block', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'assignment_block');
      const result = await handler({ id: p(req, 'id'), ...req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/assignments/:id/cancel', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'assignment_cancel');
      const result = await handler({ id: p(req, 'id'), ...req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // --- Events ---
  router.get('/events', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const actor = getActor(req);
      const result = await eventRepo.searchEvents(db, actor.tenant_id, {
        object_type: qs(req.query.object_type),
        object_id: qs(req.query.object_id),
        event_type: qs(req.query.event_type),
        actor_id: qs(req.query.actor_id),
        limit: Math.min(qn(req.query.limit, 50), 100),
        cursor: qs(req.query.cursor),
      });
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // --- Admin: Database Config ---
  function requireAdmin(req: Request, res: Response): boolean {
    const actor = getActor(req);
    if (actor.role !== 'admin' && actor.role !== 'owner') {
      res.status(403).json({
        type: 'https://crmy.ai/errors/permission_denied',
        title: 'Permission Denied',
        status: 403,
        detail: 'Only admins can access this administrative area',
      });
      return false;
    }
    return true;
  }

  router.get('/admin/db-config', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const actor = getActor(req);
      const url = process.env.DATABASE_URL ?? '';
      const pgvectorResult = await db.query("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') as enabled");
      const sampleData = await getSampleDataStatus(db, actor.tenant_id);
      try {
        const parsed = new URL(url);
        res.json({
          host: parsed.hostname,
          port: parsed.port || '5432',
          database: parsed.pathname.slice(1),
          user: parsed.username,
          ssl: parsed.searchParams.get('sslmode') || null,
          pgvector_enabled: Boolean(pgvectorResult.rows[0]?.enabled),
          sample_data: sampleData,
        });
      } catch {
        res.json({ host: '', port: '5432', database: '', user: '', ssl: null, pgvector_enabled: Boolean(pgvectorResult.rows[0]?.enabled), sample_data: sampleData });
      }
    } catch (err) { handleError(res, err); }
  });

  router.post('/admin/db-config/test', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const { connection_string } = req.body as { connection_string?: string };
      if (!connection_string) {
        res.status(400).json({
          type: 'https://crmy.ai/errors/validation',
          title: 'Validation Error',
          status: 400,
          detail: 'connection_string is required',
        });
        return;
      }
      const { Pool } = pg;
      const testPool = new Pool({ connectionString: connection_string, max: 1, connectionTimeoutMillis: 5000 });
      try {
        const client = await testPool.connect();
        client.release();
        await testPool.end();
        res.json({ success: true });
      } catch (err) {
        await testPool.end().catch(() => {});
        res.status(400).json({
          type: 'https://crmy.ai/errors/connection_failed',
          title: 'Connection Failed',
          status: 400,
          detail: 'Could not connect to Postgres. Check the host, port, database, username, password, SSL mode, and network access.',
          hint: redactSensitive(err instanceof Error ? err.message : 'Database connection failed'),
        });
      }
    } catch (err) { handleError(res, err); }
  });

  router.patch('/admin/db-config', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const { connection_string } = req.body as { connection_string?: string };
      if (!connection_string) {
        res.status(400).json({
          type: 'https://crmy.ai/errors/validation',
          title: 'Validation Error',
          status: 400,
          detail: 'connection_string is required',
        });
        return;
      }
      const configPath = path.join(process.cwd(), '.env.db');
      await fs.writeFile(configPath, `DATABASE_URL=${connection_string}\n`, 'utf-8');
      res.json({ success: true, config_file: '.env.db', message: 'Saved to .env.db — restart the server to apply.' });
    } catch (err) { handleError(res, err); }
  });

  router.post('/admin/sample-data', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const actor = getActor(req);
      const status = await getSampleDataStatus(db, actor.tenant_id);
      if (!req.body?.confirm && (status.seeded || Object.values(status.counts).some(count => count > 0))) {
        res.status(409).json({
          type: 'https://crmy.ai/errors/confirmation_required',
          title: 'Confirmation Required',
          status: 409,
          detail: 'This workspace already has data. Confirm before adding sample records.',
          sample_data: status,
        });
        return;
      }
      const result = await seedSampleData(db, actor.tenant_id);
      res.json({ success: true, message: 'Sample data added. Demo records were refreshed; your existing records were left unchanged.', sample_data: result });
    } catch (err) { handleError(res, err); }
  });

  // --- Admin: User Management ---
  const VALID_ROLES = ['member', 'manager', 'admin', 'owner'];

  async function issueUserAuthLink(
    req: Request,
    actor: ActorContext,
    user: { id: string; tenant_id: string; email: string; name?: string | null },
    tokenType: 'invite' | 'password_reset',
  ): Promise<{ setup_url: string; expires_at: string; email_sent: boolean; email_error?: string }> {
    const token = await createUserAuthToken(db, {
      tenant_id: user.tenant_id as UUID,
      user_id: user.id as UUID,
      token_type: tokenType,
      created_by: actor.actor_id as UUID,
    });
    const setupUrl = buildSetupUrl(req, token.token);
    const delivery = await sendAuthLifecycleEmail(db, {
      tenant_id: user.tenant_id as UUID,
      to_email: user.email,
      to_name: user.name,
      token_type: tokenType,
      setup_url: setupUrl,
      expires_at: token.expires_at,
    });

    await emitEvent(db, {
      tenantId: actor.tenant_id,
      eventType: tokenType === 'invite' ? 'user.invite_sent' : 'user.password_reset_sent',
      actorId: actor.actor_id,
      actorType: actor.actor_type,
      objectType: 'user',
      objectId: user.id as UUID,
      metadata: { email_sent: delivery.sent, email_error: delivery.error },
    });

    return {
      setup_url: setupUrl,
      expires_at: token.expires_at,
      email_sent: delivery.sent,
      email_error: delivery.error,
    };
  }

  router.get('/admin/actors', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const actor = getActor(req);
      const result = await db.query(
        `SELECT a.*,
                u.email as user_email,
                u.name as user_name,
                u.role as user_role,
                u.is_active as user_is_active,
                u.invited_at as user_invited_at,
                u.password_set_at as user_password_set_at,
                u.last_login_at as user_last_login_at,
                EXISTS (
                  SELECT 1 FROM user_auth_tokens t
                  WHERE t.tenant_id = a.tenant_id
                    AND t.user_id = u.id
                    AND t.token_type = 'invite'
                    AND t.used_at IS NULL
                    AND t.expires_at > now()
                ) as invite_pending,
                (SELECT count(*)::int FROM api_keys ak WHERE ak.tenant_id = a.tenant_id AND ak.actor_id = a.id) as api_key_count,
                (SELECT max(e.created_at) FROM events e WHERE e.tenant_id = a.tenant_id AND e.actor_id = a.id::text) as last_activity_at
         FROM actors a
         LEFT JOIN users u ON u.id = a.user_id AND u.tenant_id = a.tenant_id
         WHERE a.tenant_id = $1
         ORDER BY
           CASE WHEN a.registration_status = 'pending_review' THEN 0 ELSE 1 END,
           a.created_at DESC`,
        [actor.tenant_id],
      );
      res.json({ data: result.rows });
    } catch (err) { handleError(res, err); }
  });

  router.get('/admin/users', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const actor = getActor(req);
      const result = await db.query(
        `SELECT id, email, name, role, manager_id, is_active, invited_at, password_set_at, last_login_at, created_at, updated_at
         FROM users WHERE tenant_id = $1 ORDER BY created_at ASC`,
        [actor.tenant_id],
      );
      res.json({ data: result.rows });
    } catch (err) { handleError(res, err); }
  });

  router.post('/admin/users', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const actor = getActor(req);
      const { name, email, phone, password, role, manager_id, send_invite, metadata } = req.body as {
        name?: string;
        email?: string;
        phone?: string;
        password?: string;
        role?: string;
        manager_id?: string | null;
        send_invite?: boolean;
        metadata?: Record<string, unknown>;
      };

      if (!name?.trim()) {
        res.status(400).json({ type: 'https://crmy.ai/errors/validation', title: 'Validation Error', status: 400, detail: 'Name is required' });
        return;
      }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ type: 'https://crmy.ai/errors/validation', title: 'Validation Error', status: 400, detail: 'Valid email is required' });
        return;
      }
      if (!send_invite && (!password || password.length < 8)) {
        res.status(400).json({ type: 'https://crmy.ai/errors/validation', title: 'Validation Error', status: 400, detail: 'Password must be at least 8 characters' });
        return;
      }
      if (!role || !VALID_ROLES.includes(role)) {
        res.status(400).json({ type: 'https://crmy.ai/errors/validation', title: 'Validation Error', status: 400, detail: 'Role must be member, manager, admin, or owner' });
        return;
      }
      if (role === 'owner' && actor.role !== 'owner') {
        res.status(403).json({ type: 'https://crmy.ai/errors/permission_denied', title: 'Permission Denied', status: 403, detail: 'Only owners can assign the owner role' });
        return;
      }

      if (manager_id) {
        const manager = await db.query(
          `SELECT id FROM users WHERE tenant_id = $1 AND id = $2 AND role IN ('manager', 'admin', 'owner') AND is_active IS NOT FALSE`,
          [actor.tenant_id, manager_id],
        );
        if (manager.rows.length === 0) {
          res.status(400).json({ type: 'https://crmy.ai/errors/validation', title: 'Validation Error', status: 400, detail: 'Manager must be an active manager, admin, or owner in this workspace' });
          return;
        }
      }

      const result = await db.query(
        `INSERT INTO users (tenant_id, email, name, role, manager_id, password_hash, is_active, invited_at, password_set_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $8 THEN now() ELSE NULL END, CASE WHEN $8 THEN NULL ELSE now() END)
         RETURNING id, tenant_id, email, name, role, manager_id, is_active, invited_at, password_set_at, created_at`,
        [actor.tenant_id, email.trim(), name.trim(), role, manager_id ?? null, send_invite ? null : hashPassword(password!), !send_invite, Boolean(send_invite)],
      );

      // Auto-create linked actor
      await actorRepo.ensureActor(db, actor.tenant_id, {
        actor_type: 'human',
        display_name: name.trim(),
        email: email.trim(),
        phone: phone?.trim() || undefined,
        user_id: result.rows[0].id,
        role: role,
        metadata: metadata ?? {},
        registration_source: 'admin',
        registration_status: 'approved',
      });

      await emitEvent(db, {
        tenantId: actor.tenant_id,
        eventType: 'user.created',
        actorId: actor.actor_id,
        actorType: actor.actor_type,
        objectType: 'user',
        objectId: result.rows[0].id,
        afterData: { email: email.trim(), name: name.trim(), role, manager_id: manager_id ?? null, invited: Boolean(send_invite) },
      });

      const invite = send_invite
        ? await issueUserAuthLink(req, actor, result.rows[0], 'invite')
        : null;

      res.status(201).json({ ...result.rows[0], invite });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('duplicate') || msg.includes('unique')) {
        res.status(409).json({ type: 'https://crmy.ai/errors/conflict', title: 'Conflict', status: 409, detail: 'A user with that email already exists' });
        return;
      }
      handleError(res, err);
    }
  });

  router.patch('/admin/users/:id', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const actor = getActor(req);
      const userId = p(req, 'id');
      const { name, email, role, manager_id, password, is_active } = req.body as {
        name?: string; email?: string; role?: string; manager_id?: string | null; password?: string; is_active?: boolean;
      };

      const existing = await db.query(
        'SELECT * FROM users WHERE id = $1 AND tenant_id = $2',
        [userId, actor.tenant_id],
      );
      if (existing.rows.length === 0) {
        res.status(404).json({ type: 'https://crmy.ai/errors/not_found', title: 'Not Found', status: 404, detail: 'User not found' });
        return;
      }

      if (role && !VALID_ROLES.includes(role)) {
        res.status(400).json({ type: 'https://crmy.ai/errors/validation', title: 'Validation Error', status: 400, detail: 'Role must be member, manager, admin, or owner' });
        return;
      }
      if (role === 'owner' && actor.role !== 'owner') {
        res.status(403).json({ type: 'https://crmy.ai/errors/permission_denied', title: 'Permission Denied', status: 403, detail: 'Only owners can assign the owner role' });
        return;
      }
      if (is_active === false && userId === actor.actor_id) {
        res.status(400).json({ type: 'https://crmy.ai/errors/validation', title: 'Invalid Operation', status: 400, detail: 'You cannot deactivate your own account' });
        return;
      }
      if (is_active === false && existing.rows[0].role === 'owner') {
        const ownerCount = await db.query(
          `SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND role = 'owner' AND is_active IS NOT FALSE`,
          [actor.tenant_id],
        );
        if (parseInt(ownerCount.rows[0].count) <= 1) {
          res.status(400).json({ type: 'https://crmy.ai/errors/validation', title: 'Invalid Operation', status: 400, detail: 'Cannot deactivate the last active owner account' });
          return;
        }
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ type: 'https://crmy.ai/errors/validation', title: 'Validation Error', status: 400, detail: 'Valid email is required' });
        return;
      }
      if (password && password.length < 8) {
        res.status(400).json({ type: 'https://crmy.ai/errors/validation', title: 'Validation Error', status: 400, detail: 'Password must be at least 8 characters' });
        return;
      }
      if (manager_id !== undefined && manager_id !== null) {
        if (manager_id === userId) {
          res.status(400).json({ type: 'https://crmy.ai/errors/validation', title: 'Validation Error', status: 400, detail: 'A user cannot report to themselves' });
          return;
        }
        const manager = await db.query(
          `SELECT id FROM users WHERE tenant_id = $1 AND id = $2 AND role IN ('manager', 'admin', 'owner') AND is_active IS NOT FALSE`,
          [actor.tenant_id, manager_id],
        );
        if (manager.rows.length === 0) {
          res.status(400).json({ type: 'https://crmy.ai/errors/validation', title: 'Validation Error', status: 400, detail: 'Manager must be an active manager, admin, or owner in this workspace' });
          return;
        }
      }

      const cols: string[] = ['updated_at = now()'];
      const vals: unknown[] = [];
      if (name?.trim()) { cols.push(`name = $${vals.length + 1}`); vals.push(name.trim()); }
      if (email) { cols.push(`email = $${vals.length + 1}`); vals.push(email.trim()); }
      if (role) { cols.push(`role = $${vals.length + 1}`); vals.push(role); }
      if (manager_id !== undefined) { cols.push(`manager_id = $${vals.length + 1}`); vals.push(manager_id); }
      if (is_active !== undefined) { cols.push(`is_active = $${vals.length + 1}`); vals.push(is_active); }
      if (password) {
        cols.push(`password_hash = $${vals.length + 1}`);
        vals.push(hashPassword(password));
        cols.push(`password_set_at = now()`);
      }

      vals.push(userId, actor.tenant_id);
      const result = await db.query(
        `UPDATE users SET ${cols.join(', ')}
         WHERE id = $${vals.length - 1} AND tenant_id = $${vals.length}
         RETURNING id, email, name, role, manager_id, is_active, invited_at, password_set_at, last_login_at, created_at, updated_at`,
        vals,
      );

      // Sync linked actor
      const linkedActor = await actorRepo.findByUserId(db, actor.tenant_id, userId);
      if (linkedActor) {
        const actorPatch: Record<string, unknown> = {};
        if (name?.trim()) actorPatch.display_name = name.trim();
        if (email) actorPatch.email = email.trim();
        if (role) actorPatch.role = role;
        if (is_active !== undefined) actorPatch.is_active = is_active;
        if (Object.keys(actorPatch).length > 0) {
          await actorRepo.updateActor(db, actor.tenant_id, linkedActor.id, actorPatch);
        }
      }

      res.json(result.rows[0]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('duplicate') || msg.includes('unique')) {
        res.status(409).json({ type: 'https://crmy.ai/errors/conflict', title: 'Conflict', status: 409, detail: 'A user with that email already exists' });
        return;
      }
      handleError(res, err);
    }
  });

  router.delete('/admin/users/:id', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const actor = getActor(req);
      const userId = p(req, 'id');

      if (userId === actor.actor_id) {
        res.status(400).json({ type: 'https://crmy.ai/errors/validation', title: 'Invalid Operation', status: 400, detail: 'You cannot delete your own account' });
        return;
      }

      const target = await db.query(
        'SELECT role FROM users WHERE id = $1 AND tenant_id = $2',
        [userId, actor.tenant_id],
      );
      if (target.rows.length === 0) {
        res.status(404).json({ type: 'https://crmy.ai/errors/not_found', title: 'Not Found', status: 404, detail: 'User not found' });
        return;
      }
      if (target.rows[0].role === 'owner') {
        const ownerCount = await db.query(
          `SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND role = 'owner'`,
          [actor.tenant_id],
        );
        if (parseInt(ownerCount.rows[0].count) <= 1) {
          res.status(400).json({ type: 'https://crmy.ai/errors/validation', title: 'Invalid Operation', status: 400, detail: 'Cannot delete the last owner account' });
          return;
        }
      }

      // Deactivate linked actor
      const linkedActor = await actorRepo.findByUserId(db, actor.tenant_id, userId);
      if (linkedActor) {
        await actorRepo.updateActor(db, actor.tenant_id, linkedActor.id, { is_active: false });
      }

      await db.query('DELETE FROM users WHERE id = $1 AND tenant_id = $2', [userId, actor.tenant_id]);
      res.json({ deleted: true });
    } catch (err) { handleError(res, err); }
  });

  router.post('/admin/users/:id/invite', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const actor = getActor(req);
      const userId = p(req, 'id');
      const result = await db.query(
        `UPDATE users
         SET invited_at = now(),
             is_active = CASE WHEN password_set_at IS NULL THEN false ELSE is_active END,
             updated_at = now()
         WHERE id = $1 AND tenant_id = $2
         RETURNING id, tenant_id, email, name`,
        [userId, actor.tenant_id],
      );
      if (result.rows.length === 0) {
        res.status(404).json({ type: 'https://crmy.ai/errors/not_found', title: 'Not Found', status: 404, detail: 'User not found' });
        return;
      }
      const invite = await issueUserAuthLink(req, actor, result.rows[0], 'invite');
      res.json({ success: true, invite });
    } catch (err) { handleError(res, err); }
  });

  router.post('/admin/users/:id/password-reset', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const actor = getActor(req);
      const userId = p(req, 'id');
      const result = await db.query(
        'SELECT id, tenant_id, email, name FROM users WHERE id = $1 AND tenant_id = $2',
        [userId, actor.tenant_id],
      );
      if (result.rows.length === 0) {
        res.status(404).json({ type: 'https://crmy.ai/errors/not_found', title: 'Not Found', status: 404, detail: 'User not found' });
        return;
      }
      const reset = await issueUserAuthLink(req, actor, result.rows[0], 'password_reset');
      res.json({ success: true, reset });
    } catch (err) { handleError(res, err); }
  });

  router.post('/admin/actors/:id/approve', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const actor = getActor(req);
      const actorId = p(req, 'id');
      const patch = {
        display_name: req.body?.display_name,
        agent_identifier: req.body?.agent_identifier,
        agent_model: req.body?.agent_model,
        scopes: Array.isArray(req.body?.scopes) ? req.body.scopes : undefined,
        metadata: req.body?.metadata,
        is_active: req.body?.is_active !== false,
        registration_status: 'approved',
      };
      const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
      const updated = await actorRepo.updateActor(db, actor.tenant_id, actorId, cleanPatch);
      if (!updated) {
        res.status(404).json({ type: 'https://crmy.ai/errors/not_found', title: 'Not Found', status: 404, detail: 'Actor not found' });
        return;
      }
      await emitEvent(db, {
        tenantId: actor.tenant_id,
        eventType: 'actor.approved',
        actorId: actor.actor_id,
        actorType: actor.actor_type,
        objectType: 'actor',
        objectId: actorId,
        afterData: cleanPatch,
      });
      res.json({ actor: updated });
    } catch (err) { handleError(res, err); }
  });

  router.post('/admin/actors/:id/reject', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const actor = getActor(req);
      const actorId = p(req, 'id');
      const rejectPatch: Record<string, unknown> = {
        is_active: false,
        registration_status: 'rejected',
      };
      if (req.body?.reason) rejectPatch.metadata = { rejection_reason: req.body.reason };
      const updated = await actorRepo.updateActor(db, actor.tenant_id, actorId, rejectPatch);
      if (!updated) {
        res.status(404).json({ type: 'https://crmy.ai/errors/not_found', title: 'Not Found', status: 404, detail: 'Actor not found' });
        return;
      }
      await emitEvent(db, {
        tenantId: actor.tenant_id,
        eventType: 'actor.rejected',
        actorId: actor.actor_id,
        actorType: actor.actor_type,
        objectType: 'actor',
        objectId: actorId,
        metadata: { reason: req.body?.reason },
      });
      res.json({ actor: updated });
    } catch (err) { handleError(res, err); }
  });

  // --- Entity resolution ---
  router.post('/resolve', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const { query, entity_type, context_hints, limit } = req.body as {
        query?: string;
        entity_type?: 'contact' | 'account' | 'any';
        context_hints?: Record<string, string>;
        limit?: number;
      };
      if (!query || !query.trim()) {
        res.status(400).json({
          type: 'https://crmy.ai/errors/validation',
          title: 'Validation Error',
          status: 400,
          detail: 'query is required',
        });
        return;
      }
      const ownerFilter = await resolveOwnerFilter(db, actor);
      const result = await entityResolve(db, actor.tenant_id, {
        query,
        entity_type: entity_type ?? 'any',
        context_hints,
        actor_id: actor.actor_id,
        owner_ids: 'owner_ids' in ownerFilter ? ownerFilter.owner_ids : undefined,
        limit: limit ? Math.min(Math.max(Number(limit), 1), 10) : 5,
      });
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // --- Search ---
  router.get('/search', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const q = qs(req.query.q);
      if (!q) {
        res.status(400).json({
          type: 'https://crmy.ai/errors/validation',
          title: 'Validation Error',
          status: 400,
          detail: 'q parameter is required',
        });
        return;
      }
      const result = await searchRepo.crmSearch(db, actor.tenant_id, q, qn(req.query.limit, 10));
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  return router;
}

/**
 * Router for inbound webhook routes that must NOT require JWT authentication.
 * Mount this BEFORE the auth middleware in the Express app.
 */
export function inboundRouter(db: DbPool): Router {
  const router = Router();

  // ── Inbound email webhook (no auth — HMAC-signed by provider) ─────────────
  router.post('/email/inbound', async (req: Request, res: Response) => {
    try {
      const { parseInboundEmail } = await import('../email/inbound-parser.js');
      const { extractContextFromActivity } = await import('../agent/extraction.js');
      const { emitEvent: emit } = await import('../events/emitter.js');

      // Determine tenant: single-tenant installs use the first tenant
      const tenantResult = await db.query('SELECT id FROM tenants LIMIT 1');
      if (tenantResult.rows.length === 0) {
        res.status(503).json({ error: 'No tenant configured' });
        return;
      }
      const tenantId: string = tenantResult.rows[0].id;

      // Optional HMAC verification using inbound_webhook_secret
      const providerRow = await db.query(
        'SELECT inbound_webhook_secret FROM email_providers WHERE tenant_id = $1',
        [tenantId],
      );
      const secret: string | null = providerRow.rows[0]?.inbound_webhook_secret ?? null;
      if (secret) {
        const sig = req.headers['x-webhook-signature'] as string | undefined;
        if (sig) {
          const expected = crypto
            .createHmac('sha256', secret)
            .update(JSON.stringify(req.body))
            .digest('hex');
          if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
            res.status(401).json({ error: 'Invalid webhook signature' });
            return;
          }
        }
      }

      const parsed = parseInboundEmail(req.body as Record<string, unknown>);
      if (!parsed) {
        res.status(400).json({ error: 'Unrecognised inbound email payload format' });
        return;
      }

      // Resolve sender to a contact (best-effort)
      let contactId: string | undefined;
      try {
        const resolved = await entityResolve(db, tenantId, {
          query: parsed.from_email,
          entity_type: 'contact',
          context_hints: { email: parsed.from_email },
        });
        if (resolved.resolved) {
          contactId = resolved.resolved.id;
        } else if (resolved.candidates?.length) {
          contactId = resolved.candidates[0].id;
        }
      } catch { /* entity resolve is best-effort */ }

      const activity = await activityRepo.createActivity(db, tenantId, {
        type: 'email',
        direction: 'inbound',
        subject: parsed.subject,
        body: parsed.text_body,
        contact_id: contactId,
        source_agent: 'inbound_webhook',
        occurred_at: parsed.received_at,
        detail: {
          from_email: parsed.from_email,
          from_name: parsed.from_name,
          to_email: parsed.to_email,
          html_body: parsed.html_body,
          in_reply_to: parsed.in_reply_to,
        },
      });

      // Trigger context extraction (async — fire and forget)
      extractContextFromActivity(db, tenantId, activity.id).catch((err) => {
        console.error('[inbound-email] extraction error:', err);
      });

      emit(db, {
        tenantId,
        eventType: 'activity.created',
        actorType: 'agent',
        objectType: 'activity',
        objectId: activity.id,
        afterData: activity,
      }).catch(() => {});

      res.status(200).json({ ok: true, activity_id: activity.id });
    } catch (err) { handleError(res, err); }
  });

  return router;
}
