// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Router, type Request, type Response } from 'express';
import pg from 'pg';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import crypto from 'node:crypto';
import type { DbPool } from '../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import { CrmyError } from '@crmy/shared';
import * as contactRepo from '../db/repos/contacts.js';
import * as accountRepo from '../db/repos/accounts.js';
import * as oppRepo from '../db/repos/opportunities.js';
import * as activityRepo from '../db/repos/activities.js';
import * as hitlRepo from '../db/repos/hitl.js';
import * as eventRepo from '../db/repos/events.js';
import * as searchRepo from '../db/repos/search.js';
import { entityResolve } from '../services/entity-resolve.js';
import * as ucRepo from '../db/repos/use-cases.js';
import * as actorRepo from '../db/repos/actors.js';
import { emitEvent } from '../events/emitter.js';
import { getAllTools } from '../mcp/server.js';
import { enforceToolScopes, requireScopes } from '../auth/scopes.js';
import * as governorLimits from '../db/repos/governor-limits.js';
import { getSpec } from '../openapi/spec.js';
import { extractTextFromBuffer } from '../lib/file-extract.js';
import { resumeEnrollmentAfterHITL } from '../services/sequence-executor.js';
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

function handleError(res: Response, err: unknown): void {
  if (err instanceof CrmyError) {
    res.status(err.status).json(err.toJSON());
    return;
  }
  const message = err instanceof Error ? err.message : 'Internal error';
  res.status(500).json({
    type: 'https://crmy.ai/errors/internal',
    title: 'Internal Error',
    status: 500,
    detail: message,
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

export function apiRouter(db: DbPool): Router {
  const router = Router();

  // --- OpenAPI spec (no auth required) ---
  router.get('/openapi.json', (_req, res) => {
    res.json(getSpec());
  });

  // --- Contacts ---
  router.get('/contacts', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      requireScopes(actor, 'contacts:read');
      const result = await contactRepo.searchContacts(db, actor.tenant_id, {
        query: qs(req.query.q),
        lifecycle_stage: qs(req.query.stage),
        account_id: qs(req.query.account_id),
        owner_id: qs(req.query.owner_id),
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
      const result = await accountRepo.searchAccounts(db, actor.tenant_id, {
        query: qs(req.query.q),
        industry: qs(req.query.industry),
        owner_id: qs(req.query.owner_id),
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
      const result = await oppRepo.searchOpportunities(db, actor.tenant_id, {
        query: qs(req.query.q),
        stage: qs(req.query.stage),
        owner_id: qs(req.query.owner_id),
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
        limit: Math.min(qn(req.query.limit, 20), 100),
        cursor: qs(req.query.cursor),
      });
      res.json(result);
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
      const result = await handler({
        owner_id: qs(req.query.owner_id),
        group_by: qs(req.query.group_by) ?? 'stage',
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/analytics/forecast', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'pipeline_forecast');
      const result = await handler({
        period: qs(req.query.period) ?? 'quarter',
        owner_id: qs(req.query.owner_id),
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // --- HITL ---
  router.get('/hitl', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const requests = await hitlRepo.listPendingHITL(db, actor.tenant_id, qn(req.query.limit, 20));
      res.json({ data: requests });
    } catch (err) { handleError(res, err); }
  });

  router.post('/hitl', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'hitl_submit_request');
      const result = await handler(req.body, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/hitl/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'hitl_check_status');
      const result = await handler({ request_id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/hitl/:id/resolve', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
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
      const result = await ucRepo.searchUseCases(db, actor.tenant_id, {
        account_id: qs(req.query.account_id),
        stage: qs(req.query.stage),
        owner_id: qs(req.query.owner_id),
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

  // --- Notes (deprecated — proxied to context_entries with context_type=note) ---
  // These routes are preserved for backward compatibility. New clients should use /context-entries.
  router.get('/notes', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const objectType = qs(req.query.object_type);
      const objectId = qs(req.query.object_id);
      if (!objectType || !objectId) {
        res.status(400).json({
          type: 'https://crmy.ai/errors/validation',
          title: 'Validation Error',
          status: 400,
          detail: 'object_type and object_id parameters are required',
        });
        return;
      }
      const handler = toolHandler(db, 'context_list');
      const result = await handler({
        subject_type: objectType,
        subject_id: objectId,
        context_type: 'note',
        visibility: qs(req.query.visibility),
        pinned: req.query.pinned !== undefined ? req.query.pinned === 'true' : undefined,
        limit: Math.min(qn(req.query.limit, 20), 100),
        cursor: qs(req.query.cursor),
      }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.post('/notes', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_add');
      const body = req.body as Record<string, unknown>;
      // Map legacy note fields to context_entry fields
      const result = await handler({
        subject_type: body.object_type,
        subject_id: body.object_id,
        context_type: 'note',
        body: body.body,
        title: typeof body.body === 'string' ? (body.body as string).slice(0, 120) : undefined,
        parent_id: body.parent_id,
        visibility: body.visibility ?? 'internal',
        mentions: body.mentions ?? [],
        pinned: body.pinned ?? false,
      }, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/notes/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'context_get');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.patch('/notes/:id', async (req: Request, res: Response) => {
    try {
      res.status(410).json({
        type: 'https://crmy.ai/errors/gone',
        title: 'Notes API removed',
        status: 410,
        detail: 'The /notes PATCH endpoint has been removed. Use /context-entries/:id via context_supersede instead.',
      });
    } catch (err) { handleError(res, err); }
  });

  router.delete('/notes/:id', async (req: Request, res: Response) => {
    try {
      res.status(410).json({
        type: 'https://crmy.ai/errors/gone',
        title: 'Notes API removed',
        status: 410,
        detail: 'The /notes DELETE endpoint has been removed. Context entries are immutable — use context_supersede to replace content.',
      });
    } catch (err) { handleError(res, err); }
  });

  // --- Workflows ---
  router.get('/workflows', async (req: Request, res: Response) => {
    try {
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
      const actor = getActor(req);
      const handler = toolHandler(db, 'workflow_create');
      const result = await handler(req.body, actor);
      res.status(201).json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/workflows/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'workflow_get');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.patch('/workflows/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'workflow_update');
      const result = await handler({ id: p(req, 'id'), patch: req.body }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.delete('/workflows/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const handler = toolHandler(db, 'workflow_delete');
      const result = await handler({ id: p(req, 'id') }, actor);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  router.get('/workflows/:id/runs', async (req: Request, res: Response) => {
    try {
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

  // --- Context: Search, Review, Stale ---
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
        limit: Math.min(qn(req.query.limit, 20), 100),
      }, actor);
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

  // Detect entity subjects mentioned in a block of free text (no LLM required).
  // Extracts capitalized candidate names via regex, resolves each against the
  // contacts + accounts tables, and returns resolved matches above medium confidence.
  router.post('/context/detect-subjects', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const text: string = req.body.text ?? '';
      if (!text.trim()) return res.json({ subjects: [] });

      // Extract candidate names: capitalized 1–4 word phrases, email addresses, domains
      const candidates = new Set<string>();

      // Multi-word proper nouns (e.g. "Acme Corp", "John Smith", "Salesforce Inc")
      const phraseRe = /\b([A-Z][a-zA-Z]{1,}(?:\s+[A-Z][a-zA-Z]{1,}){0,3})\b/g;
      let m: RegExpExecArray | null;
      while ((m = phraseRe.exec(text)) !== null) {
        candidates.add(m[1]);
      }
      // Email addresses → resolve as contacts
      const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      while ((m = emailRe.exec(text)) !== null) {
        candidates.add(m[0]);
      }

      // Common English words to skip
      const STOP = new Set([
        'The', 'This', 'That', 'These', 'Those', 'With', 'From', 'They', 'Their',
        'There', 'Here', 'When', 'Where', 'What', 'Which', 'While', 'After',
        'Before', 'During', 'About', 'Above', 'Below', 'Between', 'Through',
        'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
        'January', 'February', 'March', 'April', 'June', 'July', 'August',
        'September', 'October', 'November', 'December',
        'Please', 'Thank', 'Thanks', 'Hello', 'Also', 'However', 'Therefore',
        'Because', 'Since', 'Until', 'Although', 'Unless',
        'CRM', 'CEO', 'CTO', 'CFO', 'COO', 'VP', 'SVP', 'EVP',
      ]);

      const filtered = [...candidates].filter(c => {
        if (c.length < 2) return false;
        const words = c.split(/\s+/);
        if (words.every(w => STOP.has(w))) return false;
        return true;
      }).slice(0, 15); // cap at 15 candidates to avoid N+1 overload

      // Resolve each candidate
      const settled = await Promise.allSettled(
        filtered.map(name =>
          entityResolve(db, actor.tenant_id, { query: name, entity_type: 'any', limit: 1 }),
        ),
      );

      const seen = new Set<string>();
      const subjects: { type: string; id: string; name: string; confidence: string; match_tier: string }[] = [];

      for (const result of settled) {
        if (result.status !== 'fulfilled') continue;
        const r = result.value;
        if (r.status !== 'resolved' || !r.resolved) continue;
        if (r.resolved.confidence === 'low') continue;
        if (seen.has(r.resolved.id)) continue;
        seen.add(r.resolved.id);
        subjects.push({
          type: r.resolved.entity_type,
          id: r.resolved.id,
          name: r.resolved.name,
          confidence: r.resolved.confidence,
          match_tier: r.resolved.match_reason,
        });
      }

      return res.json({ subjects });
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

      // Auto-detect subjects from the extracted text
      const candidates = new Set<string>();
      const phraseRe = /\b([A-Z][a-zA-Z]{1,}(?:\s+[A-Z][a-zA-Z]{1,}){0,3})\b/g;
      let m: RegExpExecArray | null;
      while ((m = phraseRe.exec(text)) !== null) candidates.add(m[1]);
      const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      while ((m = emailRe.exec(text)) !== null) candidates.add(m[0]);

      const STOP = new Set([
        'The', 'This', 'That', 'These', 'Those', 'With', 'From', 'They', 'Their',
        'There', 'Here', 'When', 'Where', 'What', 'Which', 'While', 'After',
        'Before', 'During', 'About', 'Above', 'Below', 'Between', 'Through',
        'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
        'January', 'February', 'March', 'April', 'June', 'July', 'August',
        'September', 'October', 'November', 'December',
        'Please', 'Thank', 'Thanks', 'Hello', 'Also', 'However', 'Therefore',
        'Because', 'Since', 'Until', 'Although', 'Unless',
      ]);
      const filtered = [...candidates].filter(c => {
        if (c.length < 2) return false;
        return !c.split(/\s+/).every(w => STOP.has(w));
      }).slice(0, 15);

      const settled = await Promise.allSettled(
        filtered.map(name => entityResolve(db, actor.tenant_id, { query: name, entity_type: 'any', limit: 1 })),
      );

      const seen = new Set<string>();
      const subjects: { type: string; id: string; name: string; confidence: string; match_tier: string }[] = [];
      for (const result of settled) {
        if (result.status !== 'fulfilled') continue;
        const r = result.value;
        if (r.status !== 'resolved' || !r.resolved) continue;
        if (r.resolved.confidence === 'low') continue;
        if (seen.has(r.resolved.id)) continue;
        seen.add(r.resolved.id);
        subjects.push({
          type: r.resolved.entity_type,
          id: r.resolved.id,
          name: r.resolved.name,
          confidence: r.resolved.confidence,
          match_tier: r.resolved.match_reason,
        });
      }

      return res.json({
        text_preview: text.slice(0, 600),
        full_text: text,
        truncated,
        subjects,
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
      const result = await handler({ id: p(req, 'id') }, actor);
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
        format: qs(req.query.format) ?? 'json',
      }, actor);
      res.json(result);
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
        detail: 'Only admins can access database configuration',
      });
      return false;
    }
    return true;
  }

  router.get('/admin/db-config', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const url = process.env.DATABASE_URL ?? '';
      try {
        const parsed = new URL(url);
        res.json({
          host: parsed.hostname,
          port: parsed.port || '5432',
          database: parsed.pathname.slice(1),
          user: parsed.username,
          ssl: parsed.searchParams.get('sslmode') || null,
        });
      } catch {
        res.json({ host: '', port: '5432', database: '', user: '', ssl: null });
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
          detail: err instanceof Error ? err.message : 'Failed to connect to database',
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
      res.json({ success: true, path: configPath, message: 'Saved to .env.db — restart the server to apply.' });
    } catch (err) { handleError(res, err); }
  });

  // --- Admin: User Management ---
  const VALID_ROLES = ['member', 'admin', 'owner'];

  router.get('/admin/users', async (req: Request, res: Response) => {
    try {
      if (!requireAdmin(req, res)) return;
      const actor = getActor(req);
      const result = await db.query(
        `SELECT id, email, name, role, created_at, updated_at
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
      const { name, email, password, role } = req.body as {
        name?: string; email?: string; password?: string; role?: string;
      };

      if (!name?.trim()) {
        res.status(400).json({ type: 'https://crmy.ai/errors/validation', title: 'Validation Error', status: 400, detail: 'Name is required' });
        return;
      }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ type: 'https://crmy.ai/errors/validation', title: 'Validation Error', status: 400, detail: 'Valid email is required' });
        return;
      }
      if (!password || password.length < 8) {
        res.status(400).json({ type: 'https://crmy.ai/errors/validation', title: 'Validation Error', status: 400, detail: 'Password must be at least 8 characters' });
        return;
      }
      if (!role || !VALID_ROLES.includes(role)) {
        res.status(400).json({ type: 'https://crmy.ai/errors/validation', title: 'Validation Error', status: 400, detail: 'Role must be member, admin, or owner' });
        return;
      }
      if (role === 'owner' && actor.role !== 'owner') {
        res.status(403).json({ type: 'https://crmy.ai/errors/permission_denied', title: 'Permission Denied', status: 403, detail: 'Only owners can assign the owner role' });
        return;
      }

      const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
      const result = await db.query(
        `INSERT INTO users (tenant_id, email, name, role, password_hash)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, name, role, created_at`,
        [actor.tenant_id, email.trim(), name.trim(), role, passwordHash],
      );

      // Auto-create linked actor
      await actorRepo.ensureActor(db, actor.tenant_id, {
        actor_type: 'human',
        display_name: name.trim(),
        email: email.trim(),
        user_id: result.rows[0].id,
        role: role,
      });

      res.status(201).json(result.rows[0]);
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
      const { name, email, role, password } = req.body as {
        name?: string; email?: string; role?: string; password?: string;
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
        res.status(400).json({ type: 'https://crmy.ai/errors/validation', title: 'Validation Error', status: 400, detail: 'Role must be member, admin, or owner' });
        return;
      }
      if (role === 'owner' && actor.role !== 'owner') {
        res.status(403).json({ type: 'https://crmy.ai/errors/permission_denied', title: 'Permission Denied', status: 403, detail: 'Only owners can assign the owner role' });
        return;
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ type: 'https://crmy.ai/errors/validation', title: 'Validation Error', status: 400, detail: 'Valid email is required' });
        return;
      }
      if (password && password.length < 8) {
        res.status(400).json({ type: 'https://crmy.ai/errors/validation', title: 'Validation Error', status: 400, detail: 'Password must be at least 8 characters' });
        return;
      }

      const cols: string[] = ['updated_at = now()'];
      const vals: unknown[] = [];
      if (name?.trim()) { cols.push(`name = $${vals.length + 1}`); vals.push(name.trim()); }
      if (email) { cols.push(`email = $${vals.length + 1}`); vals.push(email.trim()); }
      if (role) { cols.push(`role = $${vals.length + 1}`); vals.push(role); }
      if (password) {
        const hash = crypto.createHash('sha256').update(password).digest('hex');
        cols.push(`password_hash = $${vals.length + 1}`);
        vals.push(hash);
      }

      vals.push(userId, actor.tenant_id);
      const result = await db.query(
        `UPDATE users SET ${cols.join(', ')}
         WHERE id = $${vals.length - 1} AND tenant_id = $${vals.length}
         RETURNING id, email, name, role, created_at, updated_at`,
        vals,
      );

      // Sync linked actor
      const linkedActor = await actorRepo.findByUserId(db, actor.tenant_id, userId);
      if (linkedActor) {
        const actorPatch: Record<string, unknown> = {};
        if (name?.trim()) actorPatch.display_name = name.trim();
        if (email) actorPatch.email = email.trim();
        if (role) actorPatch.role = role;
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
      const result = await entityResolve(db, actor.tenant_id, {
        query,
        entity_type: entity_type ?? 'any',
        context_hints,
        actor_id: actor.actor_id,
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
