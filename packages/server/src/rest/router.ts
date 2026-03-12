// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Router, type Request, type Response } from 'express';
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
import * as ucRepo from '../db/repos/use-cases.js';
import { emitEvent } from '../events/emitter.js';
import { getAllTools } from '../mcp/server.js';

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

// Helper: use tool handler from MCP tools for reuse
function toolHandler(db: DbPool, toolName: string) {
  const tools = getAllTools(db);
  const tool = tools.find(t => t.name === toolName);
  if (!tool) throw new Error(`Tool ${toolName} not found`);
  return async (input: unknown, actor: ActorContext) => tool.handler(input, actor);
}

export function apiRouter(db: DbPool): Router {
  const router = Router();

  // --- Contacts ---
  router.get('/contacts', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
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
      if (actor.role !== 'admin' && actor.role !== 'owner') {
        res.status(403).json({
          type: 'https://crmy.ai/errors/permission_denied',
          title: 'Permission Denied',
          status: 403,
          detail: 'Only admins can delete contacts',
        });
        return;
      }
      const before = await contactRepo.getContact(db, actor.tenant_id, p(req, 'id'));
      if (!before) {
        res.status(404).json({ type: 'https://crmy.ai/errors/not_found', title: 'Not Found', status: 404, detail: 'Contact not found' });
        return;
      }
      await contactRepo.deleteContact(db, actor.tenant_id, p(req, 'id'));
      await emitEvent(db, {
        tenantId: actor.tenant_id,
        eventType: 'contact.deleted',
        actorId: actor.actor_id,
        actorType: actor.actor_type,
        objectType: 'contact',
        objectId: p(req, 'id'),
        beforeData: before,
      });
      res.json({ deleted: true });
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

  // --- Accounts ---
  router.get('/accounts', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
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

  // --- Opportunities ---
  router.get('/opportunities', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
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
      // Check if this is a stage advance (has 'stage' in body)
      if (req.body.stage && !req.body.patch) {
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

  // --- Activities ---
  router.get('/activities', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const result = await activityRepo.searchActivities(db, actor.tenant_id, {
        contact_id: qs(req.query.contact_id),
        account_id: qs(req.query.account_id),
        opportunity_id: qs(req.query.opportunity_id),
        type: qs(req.query.type),
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
      res.json(result);
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
      if (req.body.stage && !req.body.patch) {
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
