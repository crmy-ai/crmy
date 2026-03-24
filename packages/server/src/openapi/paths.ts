// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0
// Side-effect module: calling registry.registerPath() for every REST route.

import { z } from 'zod';
import * as S from '@crmy/shared';
import {
  registry,
  Req,
  ProblemDetail,
  ContactRecord,
  PaginatedContacts,
  AccountRecord,
  OpportunityRecord,
  UseCaseRecord,
  ContextEntryRecord,
  AssignmentRecord,
  ActorRecord,
  GenericList,
  GenericObject,
  SuccessResult,
} from './registry.js';

const idParam = z.object({ id: S.uuid.openapi({ description: 'Record UUID' }) });
const bearer = [{ BearerAuth: [] }];
const err400 = { description: 'Validation error', content: { 'application/json': { schema: ProblemDetail } } };
const err401 = { description: 'Unauthorized', content: { 'application/json': { schema: ProblemDetail } } };
const err403 = { description: 'Forbidden — missing scope', content: { 'application/json': { schema: ProblemDetail } } };
const err404 = { description: 'Not found', content: { 'application/json': { schema: ProblemDetail } } };

function ok(schema: z.ZodTypeAny, description = 'Success') {
  return { description, content: { 'application/json': { schema } } };
}

function created(schema: z.ZodTypeAny) {
  return { description: 'Created', content: { 'application/json': { schema } } };
}

function jsonBody(schema: z.ZodTypeAny, required = true) {
  return { required, content: { 'application/json': { schema } } };
}

// -- Auth (no bearer required for register/login) --

registry.registerPath({
  method: 'post', path: '/auth/register',
  tags: ['Auth'],
  summary: 'Register a new user and tenant',
  request: { body: jsonBody(Req.AuthRegister) },
  responses: { 201: ok(z.object({ token: z.string(), tenant_id: S.uuid }), 'JWT token'), 400: err400 },
});

registry.registerPath({
  method: 'post', path: '/auth/login',
  tags: ['Auth'],
  summary: 'Login and receive a JWT',
  request: { body: jsonBody(Req.AuthLogin) },
  responses: { 200: ok(z.object({ token: z.string() }), 'JWT token'), 401: err401 },
});

registry.registerPath({
  method: 'post', path: '/auth/register-agent',
  tags: ['Auth'],
  summary: 'Agent self-registration — idempotent, returns actor + bound API key',
  security: bearer,
  request: { body: jsonBody(Req.ActorCreate) },
  responses: {
    201: ok(z.object({ actor: ActorRecord, api_key: z.object({ id: S.uuid, label: z.string(), key: z.string(), scopes: z.array(z.string()) }) })),
    400: err400,
  },
});

registry.registerPath({
  method: 'get', path: '/auth/api-keys',
  tags: ['Auth'],
  summary: 'List API keys for the current tenant',
  security: bearer,
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'post', path: '/auth/api-keys',
  tags: ['Auth'],
  summary: 'Create a scoped API key',
  security: bearer,
  request: { body: jsonBody(Req.ApiKeyCreate) },
  responses: {
    201: ok(z.object({ id: S.uuid, label: z.string(), key: z.string(), scopes: z.array(z.string()) }), 'Key shown once'),
    400: err400,
  },
});

registry.registerPath({
  method: 'patch', path: '/auth/api-keys/{id}',
  tags: ['Auth'],
  summary: 'Update API key label, scopes, or expiry',
  security: bearer,
  request: { params: idParam, body: jsonBody(z.object({ label: z.string().optional(), scopes: z.array(z.string()).optional(), expires_at: z.string().optional() })) },
  responses: { 200: ok(GenericObject), 404: err404 },
});

registry.registerPath({
  method: 'delete', path: '/auth/api-keys/{id}',
  tags: ['Auth'],
  summary: 'Revoke an API key',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(SuccessResult), 404: err404 },
});

// -- Contacts --

registry.registerPath({
  method: 'get', path: '/contacts',
  tags: ['Contacts'],
  summary: 'List and search contacts',
  security: bearer,
  request: { query: Req.ContactSearch },
  responses: { 200: ok(PaginatedContacts), 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/contacts',
  tags: ['Contacts'],
  summary: 'Create a contact',
  security: bearer,
  request: { body: jsonBody(Req.ContactCreate) },
  responses: { 201: created(ContactRecord), 400: err400, 403: err403 },
});

registry.registerPath({
  method: 'get', path: '/contacts/{id}',
  tags: ['Contacts'],
  summary: 'Get a contact by ID',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(ContactRecord), 404: err404 },
});

registry.registerPath({
  method: 'patch', path: '/contacts/{id}',
  tags: ['Contacts'],
  summary: 'Update a contact',
  security: bearer,
  request: { params: idParam, body: jsonBody(Req.ContactUpdate) },
  responses: { 200: ok(ContactRecord), 400: err400, 404: err404 },
});

registry.registerPath({
  method: 'delete', path: '/contacts/{id}',
  tags: ['Contacts'],
  summary: 'Delete a contact (admin/owner only)',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(SuccessResult), 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'get', path: '/contacts/{id}/timeline',
  tags: ['Contacts'],
  summary: 'Get activity timeline for a contact',
  security: bearer,
  request: {
    params: idParam,
    query: z.object({ limit: z.number().int().optional(), types: z.array(z.string()).optional() }),
  },
  responses: { 200: ok(GenericList), 404: err404 },
});

// -- Accounts --

registry.registerPath({
  method: 'get', path: '/accounts',
  tags: ['Accounts'],
  summary: 'List and search accounts',
  security: bearer,
  request: { query: Req.AccountSearch },
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'post', path: '/accounts',
  tags: ['Accounts'],
  summary: 'Create an account',
  security: bearer,
  request: { body: jsonBody(Req.AccountCreate) },
  responses: { 201: created(AccountRecord), 400: err400 },
});

registry.registerPath({
  method: 'get', path: '/accounts/{id}',
  tags: ['Accounts'],
  summary: 'Get account with contacts and open opportunities',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(AccountRecord), 404: err404 },
});

registry.registerPath({
  method: 'patch', path: '/accounts/{id}',
  tags: ['Accounts'],
  summary: 'Update an account',
  security: bearer,
  request: { params: idParam, body: jsonBody(Req.AccountUpdate) },
  responses: { 200: ok(AccountRecord), 400: err400, 404: err404 },
});

registry.registerPath({
  method: 'delete', path: '/accounts/{id}',
  tags: ['Accounts'],
  summary: 'Delete an account (admin/owner only)',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(SuccessResult), 403: err403, 404: err404 },
});

// -- Opportunities --

registry.registerPath({
  method: 'get', path: '/opportunities',
  tags: ['Opportunities'],
  summary: 'List and search opportunities',
  security: bearer,
  request: { query: Req.OpportunitySearch },
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'post', path: '/opportunities',
  tags: ['Opportunities'],
  summary: 'Create an opportunity',
  security: bearer,
  request: { body: jsonBody(Req.OpportunityCreate) },
  responses: { 201: created(OpportunityRecord), 400: err400 },
});

registry.registerPath({
  method: 'get', path: '/opportunities/{id}',
  tags: ['Opportunities'],
  summary: 'Get an opportunity with recent activities',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(OpportunityRecord), 404: err404 },
});

registry.registerPath({
  method: 'patch', path: '/opportunities/{id}',
  tags: ['Opportunities'],
  summary: 'Update or advance stage. When body is only {stage, note?, lost_reason?} advances stage; otherwise patches fields.',
  security: bearer,
  request: { params: idParam, body: jsonBody(Req.OpportunityUpdate) },
  responses: { 200: ok(OpportunityRecord), 400: err400, 404: err404 },
});

registry.registerPath({
  method: 'delete', path: '/opportunities/{id}',
  tags: ['Opportunities'],
  summary: 'Delete an opportunity (admin/owner only)',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(SuccessResult), 403: err403, 404: err404 },
});

// -- Activities --

registry.registerPath({
  method: 'get', path: '/activities',
  tags: ['Activities'],
  summary: 'List and search activities',
  security: bearer,
  request: { query: Req.ActivitySearch },
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'post', path: '/activities',
  tags: ['Activities'],
  summary: 'Create an activity',
  security: bearer,
  request: { body: jsonBody(Req.ActivityCreate) },
  responses: { 201: created(GenericObject), 400: err400 },
});

registry.registerPath({
  method: 'patch', path: '/activities/{id}',
  tags: ['Activities'],
  summary: 'Update an activity',
  security: bearer,
  request: { params: idParam, body: jsonBody(Req.ActivityUpdate) },
  responses: { 200: ok(GenericObject), 404: err404 },
});

// -- Use Cases --

registry.registerPath({
  method: 'get', path: '/use-cases',
  tags: ['Use Cases'],
  summary: 'List and search use cases',
  security: bearer,
  request: { query: Req.UseCaseSearch },
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'post', path: '/use-cases',
  tags: ['Use Cases'],
  summary: 'Create a use case',
  security: bearer,
  request: { body: jsonBody(Req.UseCaseCreate) },
  responses: { 201: created(UseCaseRecord), 400: err400 },
});

registry.registerPath({
  method: 'get', path: '/use-cases/{id}',
  tags: ['Use Cases'],
  summary: 'Get a use case',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(UseCaseRecord), 404: err404 },
});

registry.registerPath({
  method: 'patch', path: '/use-cases/{id}',
  tags: ['Use Cases'],
  summary: 'Update or advance stage. When body is only {stage, note?} advances stage; otherwise patches fields.',
  security: bearer,
  request: { params: idParam, body: jsonBody(Req.UseCaseUpdate) },
  responses: { 200: ok(UseCaseRecord), 400: err400, 404: err404 },
});

registry.registerPath({
  method: 'delete', path: '/use-cases/{id}',
  tags: ['Use Cases'],
  summary: 'Delete a use case (admin/owner only)',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(SuccessResult), 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/use-cases/{id}/consumption',
  tags: ['Use Cases'],
  summary: 'Update consumption for a use case',
  security: bearer,
  request: { params: idParam, body: jsonBody(Req.UseCaseUpdateConsumption) },
  responses: { 200: ok(UseCaseRecord), 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/use-cases/{id}/health',
  tags: ['Use Cases'],
  summary: 'Set health score for a use case',
  security: bearer,
  request: { params: idParam, body: jsonBody(Req.UseCaseSetHealth) },
  responses: { 200: ok(UseCaseRecord), 404: err404 },
});

registry.registerPath({
  method: 'get', path: '/use-cases/{id}/contacts',
  tags: ['Use Cases'],
  summary: 'List contacts linked to a use case',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericList), 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/use-cases/{id}/contacts',
  tags: ['Use Cases'],
  summary: 'Link a contact to a use case',
  security: bearer,
  request: { params: idParam, body: jsonBody(Req.UseCaseLinkContact) },
  responses: { 201: created(GenericObject), 400: err400 },
});

registry.registerPath({
  method: 'delete', path: '/use-cases/{ucId}/contacts/{contactId}',
  tags: ['Use Cases'],
  summary: 'Unlink a contact from a use case',
  security: bearer,
  request: { params: z.object({ ucId: S.uuid, contactId: S.uuid }) },
  responses: { 200: ok(SuccessResult), 404: err404 },
});

registry.registerPath({
  method: 'get', path: '/use-cases/{id}/timeline',
  tags: ['Use Cases'],
  summary: 'Get activity timeline for a use case',
  security: bearer,
  request: { params: idParam, query: z.object({ limit: z.number().int().optional() }) },
  responses: { 200: ok(GenericList), 404: err404 },
});

// -- HITL --

registry.registerPath({
  method: 'get', path: '/hitl',
  tags: ['HITL'],
  summary: 'List pending HITL requests',
  security: bearer,
  request: { query: z.object({ limit: z.number().int().optional() }) },
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'post', path: '/hitl',
  tags: ['HITL'],
  summary: 'Submit a HITL approval request',
  security: bearer,
  request: { body: jsonBody(Req.HitlSubmit) },
  responses: { 201: created(GenericObject), 400: err400 },
});

registry.registerPath({
  method: 'get', path: '/hitl/{id}',
  tags: ['HITL'],
  summary: 'Check status of a HITL request',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/hitl/{id}/resolve',
  tags: ['HITL'],
  summary: 'Approve or reject a HITL request',
  security: bearer,
  request: { params: idParam, body: jsonBody(Req.HitlResolve) },
  responses: { 200: ok(GenericObject), 400: err400, 404: err404 },
});

// -- Actors --

registry.registerPath({
  method: 'get', path: '/actors',
  tags: ['Actors'],
  summary: 'List actors (humans and agents)',
  security: bearer,
  request: { query: Req.ActorSearch },
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'post', path: '/actors',
  tags: ['Actors'],
  summary: 'Register an actor',
  security: bearer,
  request: { body: jsonBody(Req.ActorCreate) },
  responses: { 201: created(ActorRecord), 400: err400 },
});

registry.registerPath({
  method: 'get', path: '/actors/whoami',
  tags: ['Actors'],
  summary: 'Return the current actor identity (no scope required)',
  security: bearer,
  responses: { 200: ok(ActorRecord), 401: err401 },
});

registry.registerPath({
  method: 'get', path: '/actors/{id}',
  tags: ['Actors'],
  summary: 'Get an actor by ID',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(ActorRecord), 404: err404 },
});

registry.registerPath({
  method: 'patch', path: '/actors/{id}',
  tags: ['Actors'],
  summary: 'Update actor scopes, active status, or display name',
  security: bearer,
  request: { params: idParam, body: jsonBody(Req.ActorUpdate) },
  responses: { 200: ok(ActorRecord), 400: err400, 404: err404 },
});

// -- Assignments --

registry.registerPath({
  method: 'get', path: '/assignments',
  tags: ['Assignments'],
  summary: 'List assignments',
  security: bearer,
  request: { query: Req.AssignmentSearch },
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'post', path: '/assignments',
  tags: ['Assignments'],
  summary: 'Create an assignment',
  security: bearer,
  request: { body: jsonBody(Req.AssignmentCreate) },
  responses: { 201: created(AssignmentRecord), 400: err400 },
});

registry.registerPath({
  method: 'get', path: '/assignments/{id}',
  tags: ['Assignments'],
  summary: 'Get an assignment',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(AssignmentRecord), 404: err404 },
});

registry.registerPath({
  method: 'patch', path: '/assignments/{id}',
  tags: ['Assignments'],
  summary: 'Update assignment fields',
  security: bearer,
  request: { params: idParam, body: jsonBody(Req.AssignmentUpdate) },
  responses: { 200: ok(AssignmentRecord), 400: err400, 404: err404 },
});

for (const [action, schema, summary] of [
  ['accept',   undefined,                'Accept a pending assignment'] as const,
  ['start',    undefined,                'Transition assignment to in_progress'] as const,
  ['complete', Req.AssignmentComplete,   'Mark an assignment as completed'] as const,
  ['decline',  Req.AssignmentDecline,    'Decline an assignment'] as const,
  ['block',    Req.AssignmentBlock,      'Mark an assignment as blocked'] as const,
  ['cancel',   Req.AssignmentCancel,     'Cancel an assignment'] as const,
] as const) {
  registry.registerPath({
    method: 'post', path: `/assignments/{id}/${action}`,
    tags: ['Assignments'],
    summary,
    security: bearer,
    request: {
      params: idParam,
      ...(schema ? { body: jsonBody(schema, false) } : {}),
    },
    responses: { 200: ok(AssignmentRecord), 404: err404 },
  });
}

// -- Context Entries --

registry.registerPath({
  method: 'get', path: '/context',
  tags: ['Context'],
  summary: 'List context entries',
  security: bearer,
  request: { query: Req.ContextEntrySearch },
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'post', path: '/context',
  tags: ['Context'],
  summary: 'Add a context entry',
  security: bearer,
  request: { body: jsonBody(Req.ContextEntryCreate) },
  responses: { 201: created(ContextEntryRecord), 400: err400 },
});

registry.registerPath({
  method: 'get', path: '/context/search',
  tags: ['Context'],
  summary: 'Full-text search across context entries',
  security: bearer,
  request: { query: Req.ContextSearch },
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'get', path: '/context/stale',
  tags: ['Context'],
  summary: 'List context entries past their valid_until date',
  security: bearer,
  request: { query: Req.ContextStaleList },
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'get', path: '/context/{id}',
  tags: ['Context'],
  summary: 'Get a context entry by ID',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(ContextEntryRecord), 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/context/{id}/supersede',
  tags: ['Context'],
  summary: 'Supersede a context entry with updated content',
  security: bearer,
  request: { params: idParam, body: jsonBody(Req.ContextEntrySupersede) },
  responses: { 200: ok(ContextEntryRecord), 400: err400, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/context/{id}/review',
  tags: ['Context'],
  summary: 'Mark a context entry as still accurate (bumps reviewed_at)',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(ContextEntryRecord), 404: err404 },
});

// -- Briefing --

registry.registerPath({
  method: 'get', path: '/briefing/{subject_type}/{subject_id}',
  tags: ['Briefing'],
  summary: 'Get a full briefing for a CRM object — record + activities + assignments + context + stale warnings',
  security: bearer,
  request: {
    params: z.object({ subject_type: S.subjectType, subject_id: S.uuid }),
    query: Req.BriefingGet,
  },
  responses: {
    200: ok(z.object({
      record: z.record(z.unknown()),
      related: z.record(z.unknown()),
      activities: z.array(z.record(z.unknown())),
      open_assignments: z.array(z.record(z.unknown())),
      context: z.record(z.array(ContextEntryRecord)),
      stale_warnings: z.array(z.object({
        id: S.uuid, context_type: z.string(), valid_until: z.string(), body: z.string(),
      })),
    })),
    404: err404,
  },
});

// -- Webhooks --

registry.registerPath({
  method: 'get', path: '/webhooks',
  tags: ['Webhooks'],
  summary: 'List webhook endpoints',
  security: bearer,
  request: { query: Req.WebhookList },
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'post', path: '/webhooks',
  tags: ['Webhooks'],
  summary: 'Register a webhook endpoint',
  security: bearer,
  request: { body: jsonBody(Req.WebhookCreate) },
  responses: { 201: created(GenericObject), 400: err400 },
});

registry.registerPath({
  method: 'get', path: '/webhooks/{id}',
  tags: ['Webhooks'],
  summary: 'Get a webhook endpoint (includes signing secret)',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 404: err404 },
});

registry.registerPath({
  method: 'patch', path: '/webhooks/{id}',
  tags: ['Webhooks'],
  summary: 'Update a webhook endpoint',
  security: bearer,
  request: { params: idParam, body: jsonBody(Req.WebhookUpdate) },
  responses: { 200: ok(GenericObject), 400: err400, 404: err404 },
});

registry.registerPath({
  method: 'delete', path: '/webhooks/{id}',
  tags: ['Webhooks'],
  summary: 'Delete a webhook endpoint',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(SuccessResult), 404: err404 },
});

registry.registerPath({
  method: 'get', path: '/webhooks/{id}/deliveries',
  tags: ['Webhooks'],
  summary: 'List delivery attempts for a webhook endpoint',
  security: bearer,
  request: { params: idParam, query: Req.WebhookListDeliveries },
  responses: { 200: ok(GenericList), 404: err404 },
});

// -- Emails --

registry.registerPath({
  method: 'get', path: '/emails',
  tags: ['Emails'],
  summary: 'Search emails',
  security: bearer,
  request: { query: Req.EmailSearch },
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'post', path: '/emails',
  tags: ['Emails'],
  summary: 'Create/draft an email — auto-submits HITL request when require_approval is true',
  security: bearer,
  request: { body: jsonBody(Req.EmailCreate) },
  responses: { 201: created(GenericObject), 400: err400 },
});

registry.registerPath({
  method: 'get', path: '/emails/{id}',
  tags: ['Emails'],
  summary: 'Get an email by ID',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 404: err404 },
});

// -- Custom Fields --

registry.registerPath({
  method: 'get', path: '/custom-fields',
  tags: ['Custom Fields'],
  summary: 'List custom field definitions for an object type',
  security: bearer,
  request: { query: z.object({ object_type: z.enum(['contact', 'account', 'opportunity', 'activity', 'use_case']) }) },
  responses: { 200: ok(GenericList), 400: err400 },
});

registry.registerPath({
  method: 'post', path: '/custom-fields',
  tags: ['Custom Fields'],
  summary: 'Create a custom field definition',
  security: bearer,
  request: { body: jsonBody(Req.CustomFieldCreate) },
  responses: { 201: created(GenericObject), 400: err400 },
});

registry.registerPath({
  method: 'patch', path: '/custom-fields/{id}',
  tags: ['Custom Fields'],
  summary: 'Update a custom field definition',
  security: bearer,
  request: { params: idParam, body: jsonBody(Req.CustomFieldUpdate) },
  responses: { 200: ok(GenericObject), 404: err404 },
});

registry.registerPath({
  method: 'delete', path: '/custom-fields/{id}',
  tags: ['Custom Fields'],
  summary: 'Delete a custom field definition',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(SuccessResult), 404: err404 },
});

// -- Notes --

registry.registerPath({
  method: 'get', path: '/notes',
  tags: ['Notes'],
  summary: 'List notes for a CRM object (object_type and object_id required)',
  security: bearer,
  request: { query: Req.NoteList },
  responses: { 200: ok(GenericList), 400: err400 },
});

registry.registerPath({
  method: 'post', path: '/notes',
  tags: ['Notes'],
  summary: 'Create a note',
  security: bearer,
  request: { body: jsonBody(Req.NoteCreate) },
  responses: { 201: created(GenericObject), 400: err400 },
});

registry.registerPath({
  method: 'get', path: '/notes/{id}',
  tags: ['Notes'],
  summary: 'Get a note with threaded replies',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 404: err404 },
});

registry.registerPath({
  method: 'patch', path: '/notes/{id}',
  tags: ['Notes'],
  summary: 'Update a note',
  security: bearer,
  request: { params: idParam, body: jsonBody(Req.NoteUpdate) },
  responses: { 200: ok(GenericObject), 404: err404 },
});

registry.registerPath({
  method: 'delete', path: '/notes/{id}',
  tags: ['Notes'],
  summary: 'Delete a note and its replies',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(SuccessResult), 404: err404 },
});

// -- Workflows --

registry.registerPath({
  method: 'get', path: '/workflows',
  tags: ['Workflows'],
  summary: 'List automation workflows',
  security: bearer,
  request: { query: Req.WorkflowList },
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'post', path: '/workflows',
  tags: ['Workflows'],
  summary: 'Create a workflow',
  security: bearer,
  request: { body: jsonBody(Req.WorkflowCreate) },
  responses: { 201: created(GenericObject), 400: err400 },
});

registry.registerPath({
  method: 'get', path: '/workflows/{id}',
  tags: ['Workflows'],
  summary: 'Get a workflow with 5 most recent runs',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 404: err404 },
});

registry.registerPath({
  method: 'patch', path: '/workflows/{id}',
  tags: ['Workflows'],
  summary: 'Update a workflow',
  security: bearer,
  request: { params: idParam, body: jsonBody(Req.WorkflowUpdate) },
  responses: { 200: ok(GenericObject), 404: err404 },
});

registry.registerPath({
  method: 'delete', path: '/workflows/{id}',
  tags: ['Workflows'],
  summary: 'Delete a workflow',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(SuccessResult), 404: err404 },
});

registry.registerPath({
  method: 'get', path: '/workflows/{id}/runs',
  tags: ['Workflows'],
  summary: 'List execution history for a workflow',
  security: bearer,
  request: { params: idParam, query: Req.WorkflowRunList },
  responses: { 200: ok(GenericList), 404: err404 },
});

// -- Analytics --

registry.registerPath({
  method: 'get', path: '/analytics/pipeline',
  tags: ['Analytics'],
  summary: 'Pipeline summary grouped by stage, owner, or forecast category',
  security: bearer,
  request: { query: z.object({ owner_id: S.uuid.optional(), group_by: z.enum(['stage', 'owner', 'forecast_cat']).optional() }) },
  responses: { 200: ok(GenericObject), 401: err401 },
});

registry.registerPath({
  method: 'get', path: '/analytics/forecast',
  tags: ['Analytics'],
  summary: 'Pipeline forecast for month, quarter, or year',
  security: bearer,
  request: { query: z.object({ period: z.enum(['month', 'quarter', 'year']).optional(), owner_id: S.uuid.optional() }) },
  responses: { 200: ok(GenericObject), 401: err401 },
});

registry.registerPath({
  method: 'get', path: '/analytics/use-cases',
  tags: ['Analytics'],
  summary: 'Use case summary grouped by stage, product line, or owner',
  security: bearer,
  request: { query: z.object({ account_id: S.uuid.optional(), group_by: z.enum(['stage', 'product_line', 'owner']).optional() }) },
  responses: { 200: ok(GenericObject), 401: err401 },
});

// -- Registries --

registry.registerPath({
  method: 'get', path: '/activity-types',
  tags: ['Registries'],
  summary: 'List registered activity types',
  security: bearer,
  request: { query: z.object({ category: S.activityTypeCategory.optional() }) },
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'post', path: '/activity-types',
  tags: ['Registries'],
  summary: 'Add a custom activity type',
  security: bearer,
  request: { body: jsonBody(Req.ActivityTypeAdd) },
  responses: { 201: created(GenericObject), 400: err400 },
});

registry.registerPath({
  method: 'delete', path: '/activity-types/{type_name}',
  tags: ['Registries'],
  summary: 'Remove a custom activity type',
  security: bearer,
  request: { params: z.object({ type_name: z.string() }) },
  responses: { 200: ok(SuccessResult), 404: err404 },
});

registry.registerPath({
  method: 'get', path: '/context-types',
  tags: ['Registries'],
  summary: 'List registered context types',
  security: bearer,
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'post', path: '/context-types',
  tags: ['Registries'],
  summary: 'Add a custom context type',
  security: bearer,
  request: { body: jsonBody(Req.ContextTypeAdd) },
  responses: { 201: created(GenericObject), 400: err400 },
});

registry.registerPath({
  method: 'delete', path: '/context-types/{type_name}',
  tags: ['Registries'],
  summary: 'Remove a custom context type',
  security: bearer,
  request: { params: z.object({ type_name: z.string() }) },
  responses: { 200: ok(SuccessResult), 404: err404 },
});

// -- Events --

registry.registerPath({
  method: 'get', path: '/events',
  tags: ['Events'],
  summary: 'Audit log — append-only event stream',
  security: bearer,
  request: {
    query: z.object({
      object_type: z.string().optional(),
      object_id: S.uuid.optional(),
      event_type: z.string().optional(),
      actor_id: S.uuid.optional(),
      limit: z.number().int().optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: { 200: ok(GenericList), 401: err401 },
});

// -- Search --

registry.registerPath({
  method: 'get', path: '/search',
  tags: ['Search'],
  summary: 'Cross-entity full-text search across contacts, accounts, and opportunities',
  security: bearer,
  request: { query: z.object({ q: z.string().min(1), limit: z.number().int().optional() }) },
  responses: { 200: ok(GenericList), 400: err400 },
});
