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
  MessagingChannelRecord,
  SequenceRecord,
  SequenceEnrollmentRecord,
  GenericList,
  GenericObject,
  SuccessResult,
  OAuthReadinessResponse,
  OAuthConnectionStartResponse,
  TenantOAuthAppRecord,
  ActorConnectionSummary,
  MailboxConnectionListResponse,
  CalendarConnectionListResponse,
  ActionContextResponse,
  ActionContextHumanUnblockResponse,
  ContextLineageResponse,
  BriefingResponse,
} from './registry.js';

const idParam = z.object({ id: S.uuid.openapi({ description: 'Record UUID' }) });
const enrollmentIdParam = z.object({ enrollmentId: S.uuid.openapi({ description: 'Sequence enrollment UUID' }) });
const setupTokenParam = z.object({ token: z.string().min(1).openapi({ description: 'One-time invite or password-reset token' }) });
const toolNameParam = z.object({ tool_name: z.string().regex(/^[a-z0-9_]+$/).openapi({ description: 'MCP tool name' }) });
const checkNameParam = z.object({ check_name: z.string().min(1).openapi({ description: 'Data-quality check name' }) });
const oauthProviderParam = z.object({ provider: z.enum(['google', 'microsoft']) });
const tenantOAuthAppUpsert = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(1).optional(),
  microsoft_tenant_id: z.string().optional(),
  enabled: z.boolean().optional(),
});
const providerParam = z.object({ provider: z.enum(['google', 'microsoft']) });
const bearer = [{ BearerAuth: [] }];
const rootServer = [{ url: '/', description: 'Server root; auth endpoints are not mounted under /api/v1' }];
const err400 = { description: 'Validation error', content: { 'application/json': { schema: ProblemDetail } } };
const err401 = { description: 'Unauthorized', content: { 'application/json': { schema: ProblemDetail } } };
const err403 = { description: 'Forbidden — missing scope', content: { 'application/json': { schema: ProblemDetail } } };
const err404 = { description: 'Not found', content: { 'application/json': { schema: ProblemDetail } } };
const err409 = { description: 'Conflict', content: { 'application/json': { schema: ProblemDetail } } };

const AgentRegisterRequest = z.object({
  display_name: z.string().min(1).max(200),
  agent_identifier: z.string().min(1).max(200),
  agent_model: z.string().max(200).optional(),
  requested_scopes: z.array(z.string()).optional(),
});

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
  servers: rootServer,
  request: { body: jsonBody(Req.AuthRegister) },
  responses: { 201: ok(z.object({ token: z.string(), tenant_id: S.uuid }), 'JWT token'), 400: err400 },
});

registry.registerPath({
  method: 'post', path: '/auth/login',
  tags: ['Auth'],
  summary: 'Login and receive a JWT',
  servers: rootServer,
  request: { body: jsonBody(Req.AuthLogin) },
  responses: { 200: ok(z.object({ token: z.string() }), 'JWT token'), 401: err401 },
});

registry.registerPath({
  method: 'get', path: '/auth/setup/{token}',
  tags: ['Auth'],
  summary: 'Inspect an invite or password-reset setup token',
  servers: rootServer,
  request: { params: setupTokenParam },
  responses: { 200: ok(GenericObject), 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/auth/setup/{token}',
  tags: ['Auth'],
  summary: 'Complete invite or password-reset setup',
  servers: rootServer,
  request: {
    params: setupTokenParam,
    body: jsonBody(z.object({ password: z.string().min(12) })),
  },
  responses: { 200: ok(SuccessResult), 400: err400, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/auth/register-agent',
  tags: ['Auth'],
  summary: 'Agent self-registration — creates or reuses a pending agent actor and returns a bound read-only API key',
  security: bearer,
  servers: rootServer,
  request: { body: jsonBody(AgentRegisterRequest) },
  responses: {
    201: ok(z.object({ actor: ActorRecord, api_key: z.object({ id: S.uuid, label: z.string(), key: z.string(), scopes: z.array(z.string()) }) })),
    400: err400,
    403: err403,
    409: err409,
  },
});

registry.registerPath({
  method: 'get', path: '/auth/api-keys',
  tags: ['Auth'],
  summary: 'List API keys for the current tenant',
  security: bearer,
  servers: rootServer,
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'post', path: '/auth/api-keys',
  tags: ['Auth'],
  summary: 'Create a scoped API key',
  security: bearer,
  servers: rootServer,
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
  servers: rootServer,
  request: { params: idParam, body: jsonBody(z.object({ label: z.string().optional(), scopes: z.array(z.string()).optional(), expires_at: z.string().optional() })) },
  responses: { 200: ok(GenericObject), 404: err404 },
});

registry.registerPath({
  method: 'delete', path: '/auth/api-keys/{id}',
  tags: ['Auth'],
  summary: 'Revoke an API key',
  security: bearer,
  servers: rootServer,
  request: { params: idParam },
  responses: { 200: ok(SuccessResult), 404: err404 },
});

registry.registerPath({
  method: 'patch', path: '/auth/profile',
  tags: ['Auth'],
  summary: "Update the authenticated user's profile",
  security: bearer,
  servers: rootServer,
  request: {
    body: jsonBody(z.object({
      name: z.string().optional(),
      email: z.string().email().optional(),
      current_password: z.string().optional(),
      new_password: z.string().min(12).optional(),
    })),
  },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 404: err404 },
});

// -- Tool bridge --

registry.registerPath({
  method: 'get', path: '/tools',
  tags: ['Tools'],
  summary: 'List MCP tools available to the current actor',
  security: bearer,
  responses: {
    200: ok(z.object({
      data: z.array(z.object({
        name: z.string(),
        tier: z.string().optional(),
        description: z.string().optional(),
      })),
      total: z.number().int(),
    })),
    401: err401,
  },
});

registry.registerPath({
  method: 'get', path: '/tools/{tool_name}',
  tags: ['Tools'],
  summary: 'Describe one actor-scoped MCP tool and its input shape',
  security: bearer,
  request: { params: toolNameParam },
  responses: {
    200: ok(GenericObject),
    400: err400,
    401: err401,
    403: err403,
    404: err404,
  },
});

registry.registerPath({
  method: 'post', path: '/tools/{tool_name}/call',
  tags: ['Tools'],
  summary: 'Call an actor-scoped MCP tool by name',
  security: bearer,
  request: {
    params: toolNameParam,
    body: jsonBody(z.record(z.unknown()), false),
  },
  responses: {
    200: ok(GenericObject),
    400: err400,
    401: err401,
    403: err403,
    404: err404,
  },
});

// -- Operations --

registry.registerPath({
  method: 'get', path: '/ops/status',
  tags: ['Operations'],
  summary: 'Get tenant-scoped operational health for durable queues and async jobs',
  security: bearer,
  request: {
    query: z.object({
      sample_limit: z.coerce.number().int().min(0).max(50).optional(),
      include_samples: z.coerce.boolean().optional(),
    }),
  },
  responses: { 200: ok(GenericObject), 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'get', path: '/ops/data-quality',
  tags: ['Operations'],
  summary: 'List tenant data-quality checks and repair candidates',
  security: bearer,
  request: {
    query: z.object({
      sample_limit: z.coerce.number().int().min(0).max(100).optional(),
      include_clean: z.coerce.boolean().optional(),
    }),
  },
  responses: { 200: ok(GenericObject), 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/ops/data-quality/{check_name}/repair',
  tags: ['Operations'],
  summary: 'Run or preview a data-quality repair action',
  security: bearer,
  request: {
    params: checkNameParam,
    body: jsonBody(z.object({
      dry_run: z.boolean().optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    }), false),
  },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403, 404: err404 },
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

registry.registerPath({
  method: 'post', path: '/contacts/{id}/score',
  tags: ['Contacts'],
  summary: 'Score a contact and update scoring metadata',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(ContactRecord), 400: err400, 403: err403, 404: err404 },
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
  responses: { 201: created(AccountRecord), 400: err400, 409: err409 },
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
  responses: { 200: ok(AccountRecord), 400: err400, 404: err404, 409: err409 },
});

registry.registerPath({
  method: 'delete', path: '/accounts/{id}',
  tags: ['Accounts'],
  summary: 'Delete an account (admin/owner only)',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(SuccessResult), 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/accounts/{id}/merge',
  tags: ['Accounts'],
  summary: 'Merge a duplicate account into this account (admin/owner only)',
  security: bearer,
  request: {
    params: idParam,
    body: jsonBody(z.object({
      secondary_id: S.uuid.openapi({ description: 'Duplicate account UUID to merge into the path account' }),
      idempotency_key: z.string().optional(),
    })),
  },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403, 404: err404, 409: err409 },
});

registry.registerPath({
  method: 'post', path: '/accounts/{id}/split-domains',
  tags: ['Accounts'],
  summary: 'Move one or more domains from this account to another account (admin/owner only)',
  security: bearer,
  request: {
    params: idParam,
    body: jsonBody(z.object({
      target_account_id: S.uuid.openapi({ description: 'Account UUID that should own the moved domains' }),
      domains: z.array(z.string().min(1)).min(1),
      move_matching_records: z.boolean().optional(),
      idempotency_key: z.string().optional(),
    })),
  },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403, 404: err404, 409: err409 },
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

registry.registerPath({
  method: 'post', path: '/opportunities/{id}/health-score',
  tags: ['Opportunities'],
  summary: 'Calculate and persist an opportunity health score',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(OpportunityRecord), 400: err400, 403: err403, 404: err404 },
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
  method: 'get', path: '/activities/{id}',
  tags: ['Activities'],
  summary: 'Get an activity by ID',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 404: err404 },
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

registry.registerPath({
  method: 'post', path: '/activities/{id}/context',
  tags: ['Activities'],
  summary: 'Extract or attach Source from an activity',
  security: bearer,
  request: {
    params: idParam,
    body: jsonBody(z.object({
      document: z.string().optional(),
      text: z.string().optional(),
      source_label: z.string().optional(),
    }), false),
  },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403, 404: err404 },
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
  method: 'get', path: '/hitl/rules',
  tags: ['HITL'],
  summary: 'List HITL approval rules',
  security: bearer,
  responses: { 200: ok(GenericList), 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/hitl/rules',
  tags: ['HITL'],
  summary: 'Create a HITL approval rule',
  security: bearer,
  request: { body: jsonBody(GenericObject) },
  responses: { 201: created(GenericObject), 400: err400, 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'patch', path: '/hitl/rules/{id}',
  tags: ['HITL'],
  summary: 'Update a HITL approval rule',
  security: bearer,
  request: { params: idParam, body: jsonBody(GenericObject) },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'delete', path: '/hitl/rules/{id}',
  tags: ['HITL'],
  summary: 'Delete a HITL approval rule',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(SuccessResult), 401: err401, 403: err403, 404: err404 },
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
  method: 'patch', path: '/hitl/{id}',
  tags: ['HITL'],
  summary: 'Update HITL request metadata or assignment state',
  security: bearer,
  request: { params: idParam, body: jsonBody(GenericObject) },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403, 404: err404 },
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

registry.registerPath({
  method: 'get', path: '/actors/{id}/specializations',
  tags: ['Actors'],
  summary: 'List an actor’s skill specializations',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericList), 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/actors/{id}/specializations',
  tags: ['Actors'],
  summary: 'Create or update an actor skill specialization',
  security: bearer,
  request: {
    params: idParam,
    body: jsonBody(z.object({
      skill_tag: z.string().min(1),
      proficiency: z.enum(['novice', 'intermediate', 'expert']).optional(),
      description: z.string().optional(),
    })),
  },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'delete', path: '/actors/{id}/specializations/{skill_tag}',
  tags: ['Actors'],
  summary: 'Remove an actor skill specialization',
  security: bearer,
  request: { params: z.object({ id: S.uuid, skill_tag: z.string().min(1) }) },
  responses: { 200: ok(SuccessResult), 403: err403, 404: err404 },
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
  summary: 'List Current Memory and reviewable Signals',
  security: bearer,
  request: { query: Req.ContextEntrySearch },
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'post', path: '/context',
  tags: ['Context'],
  summary: 'Advanced direct Memory or evidence-backed Signal write',
  security: bearer,
  request: { body: jsonBody(Req.ContextEntryCreate) },
  responses: { 201: created(ContextEntryRecord), 400: err400 },
});

registry.registerPath({
  method: 'get', path: '/context/sources',
  tags: ['Context'],
  summary: 'List Source processing records',
  security: bearer,
  request: {
    query: z.object({
      source_type: z.string().optional(),
      status: z.enum(['pending', 'processing', 'processed', 'needs_review', 'failed', 'skipped']).optional(),
      subject_type: S.subjectType.optional(),
      subject_id: S.uuid.optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'get', path: '/context/sources/{id}',
  tags: ['Context'],
  summary: 'Get a Source processing record',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/context/sources/{id}/reprocess',
  tags: ['Context'],
  summary: 'Reprocess a Source',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/context/ingest',
  tags: ['Context'],
  summary: 'Ingest a Source for a known record',
  security: bearer,
  request: {
    body: jsonBody(z.object({
      text: z.string().optional(),
      document: z.string().optional(),
      subject_type: S.subjectType,
      subject_id: S.uuid,
      source_label: z.string().optional(),
      source: z.string().optional(),
    })),
  },
  responses: { 200: ok(GenericObject), 400: err400 },
});

registry.registerPath({
  method: 'post', path: '/context/ingest-auto',
  tags: ['Context'],
  summary: 'Ingest a Source and automatically resolve mentioned records',
  security: bearer,
  request: {
    body: jsonBody(z.object({
      text: z.string().optional(),
      document: z.string().optional(),
      source_label: z.string().optional(),
      source: z.string().optional(),
      context_type: z.string().optional(),
      confidence_threshold: z.number().min(0).max(1).optional(),
      subjects: z.array(z.object({
        type: S.subjectType,
        id: S.uuid,
        name: z.string().optional(),
      })).optional(),
      proposed_records: z.array(z.object({
        record_type: z.enum(['contact', 'account', 'opportunity', 'use_case']),
        name: z.string(),
        confidence: z.number().min(0).max(1).optional(),
        reason: z.string().optional(),
        fields: z.record(z.unknown()).optional(),
        duplicate_candidates: z.array(z.object({
          record_type: z.string(),
          id: z.string(),
          name: z.string(),
          confidence: z.string().optional(),
          reason: z.string().optional(),
        })).optional(),
      })).optional(),
    })),
  },
  responses: { 200: ok(GenericObject), 400: err400 },
});

registry.registerPath({
  method: 'post', path: '/subjects/resolve',
  tags: ['Context'],
  summary: 'Resolve customer records mentioned by query, hint, or free text using the Subject Graph resolver',
  security: bearer,
  request: {
    body: jsonBody(z.object({
      query: z.string().optional(),
      text: z.string().optional(),
      subject_type: z.union([S.subjectType, z.literal('any')]).optional(),
      account_hint: z.string().optional(),
      confidence_threshold: z.number().min(0).max(1).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    })),
  },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/knowledge/retrieve',
  tags: ['Knowledge'],
  summary: 'Retrieve Trusted Facts for a customer action (optional, non-blocking)',
  security: bearer,
  request: { body: jsonBody(S.knowledgeRetrieve) },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/knowledge/claims/list',
  tags: ['Knowledge'],
  summary: 'List Trusted Facts for the admin review queue (governance)',
  security: bearer,
  request: { body: jsonBody(S.knowledgeClaimList) },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/knowledge/claims/review',
  tags: ['Knowledge'],
  summary: 'Apply a governance review decision to a Trusted Fact (approve/reject/deprecate/mark_stale/reactivate)',
  security: bearer,
  request: { body: jsonBody(S.knowledgeClaimReview) },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/knowledge/conflicts/detect',
  tags: ['Knowledge'],
  summary: 'Detect competing Trusted Facts with source-priority resolution (governance)',
  security: bearer,
  request: { body: jsonBody(S.knowledgeConflictsDetect) },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403 },
});

const knowledgeSourceCreate = z.object({
  name: z.string().min(1).max(200),
  endpoint_url: z.string().min(1).max(2048),
  transport: z.literal('streamable_http').optional(),
  auth_type: z.enum(['none', 'bearer_token']).optional(),
  token: z.string().optional().openapi({ description: 'Write-only credential for the external MCP source. Never returned by list/detail responses.' }),
  description: z.string().max(1000).nullable().optional(),
});

const knowledgeSourcePatch = z.object({
  name: z.string().min(1).max(200).optional(),
  endpoint_url: z.string().min(1).max(2048).optional(),
  transport: z.literal('streamable_http').optional(),
  auth_type: z.enum(['none', 'bearer_token']).optional(),
  token: z.string().nullable().optional().openapi({ description: 'Write-only replacement credential. Omit to keep the existing credential.' }),
  description: z.string().max(1000).nullable().optional(),
  status: z.enum(['configured', 'syncing', 'error', 'disabled']).optional(),
});

registry.registerPath({
  method: 'get', path: '/knowledge/source-connections',
  tags: ['Knowledge'],
  summary: 'List MCP Knowledge Source connectors',
  security: bearer,
  responses: { 200: ok(GenericList), 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/knowledge/source-connections',
  tags: ['Knowledge'],
  summary: 'Create an MCP Knowledge Source connector with write-only external credentials',
  security: bearer,
  request: { body: jsonBody(knowledgeSourceCreate) },
  responses: { 201: created(GenericObject), 400: err400, 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'patch', path: '/knowledge/source-connections/{id}',
  tags: ['Knowledge'],
  summary: 'Update an MCP Knowledge Source connector',
  security: bearer,
  request: { params: idParam, body: jsonBody(knowledgeSourcePatch) },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'delete', path: '/knowledge/source-connections/{id}',
  tags: ['Knowledge'],
  summary: 'Delete an MCP Knowledge Source connector',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(z.object({ deleted: z.boolean() })), 401: err401, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/knowledge/source-connections/{id}/test',
  tags: ['Knowledge'],
  summary: 'Test an MCP Knowledge Source connector',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/knowledge/source-connections/{id}/sync',
  tags: ['Knowledge'],
  summary: 'Sync Trusted Facts from an MCP Knowledge Source connector into governance',
  security: bearer,
  request: { params: idParam, body: jsonBody(z.object({ limit: z.number().int().min(1).max(100).optional() }), false) },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/context/detect-subjects',
  tags: ['Context'],
  summary: 'Detect customer records mentioned in free text',
  security: bearer,
  request: { body: jsonBody(z.object({ text: z.string() })) },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/context/ingest-file',
  tags: ['Context'],
  summary: 'Extract text from a base64 file upload and detect mentioned customer records',
  description: 'Requires context write access. The full extracted text is omitted by default and returned only when include_text is true.',
  security: bearer,
  request: {
    body: jsonBody(z.object({
      filename: z.string().min(1),
      data: z.string().min(1).openapi({ description: 'Base64-encoded file contents' }),
      source_label: z.string().optional(),
      include_text: z.boolean().optional().openapi({ description: 'Return full extracted text for follow-on ingestion. Defaults to false.' }),
    })),
  },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'get', path: '/context/search',
  tags: ['Context'],
  summary: 'Full-text search across Memory and Signals',
  security: bearer,
  request: { query: Req.ContextSearch },
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'get', path: '/context/semantic-search',
  tags: ['Context'],
  summary: 'Semantic search across Memory and Signals when embeddings are available',
  security: bearer,
  request: { query: Req.ContextSearch },
  responses: { 200: ok(GenericList), 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'get', path: '/context/stale',
  tags: ['Context'],
  summary: 'List Current Memory that needs review',
  security: bearer,
  request: { query: Req.ContextStaleList },
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'get', path: '/context/contradictions',
  tags: ['Context'],
  summary: 'Detect contradictions among Memory and Signals',
  security: bearer,
  request: {
    query: z.object({
      subject_type: S.subjectType.optional(),
      subject_id: S.uuid.optional(),
      context_type: z.string().optional(),
    }),
  },
  responses: { 200: ok(GenericObject), 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'get', path: '/context/signal-groups',
  tags: ['Context'],
  summary: 'List grouped Signals with readiness state',
  security: bearer,
  request: {
    query: z.object({
      status: z.enum(['gathering', 'ready', 'promoted', 'blocked', 'dismissed', 'conflicting', 'merged']).optional(),
      subject_type: S.subjectType.optional(),
      subject_id: S.uuid.optional(),
      context_type: z.string().optional(),
      attention_only: z.coerce.boolean().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'get', path: '/context/lineage',
  tags: ['Context'],
  summary: 'Trace Sources through Signals, Memory, Handoffs, writebacks, and audit',
  security: bearer,
  request: {
    query: z.object({
      subject_type: S.subjectType.optional(),
      subject_id: S.uuid.optional(),
      context_entry_id: S.uuid.optional(),
      signal_group_id: S.uuid.optional(),
      source_id: S.uuid.optional(),
    }),
  },
  responses: { 200: ok(ContextLineageResponse), 401: err401 },
});

registry.registerPath({
  method: 'get', path: '/context/signal-groups/{id}',
  tags: ['Context'],
  summary: 'Get a grouped Signal with evidence and readiness details',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/context/signal-groups/{id}/promote',
  tags: ['Context'],
  summary: 'Confirm a grouped Signal as Current Memory',
  security: bearer,
  request: { params: idParam, body: jsonBody(z.object({ idempotency_key: z.string().optional() }), false) },
  responses: { 200: ok(GenericObject), 400: err400, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/context/signal-groups/{id}/complete-details',
  tags: ['Context'],
  summary: 'Add missing typed Signal details and recompute readiness',
  security: bearer,
  request: { params: idParam, body: jsonBody(Req.ContextSignalGroupCompleteDetails) },
  responses: { 200: ok(GenericObject), 400: err400, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/context/signal-groups/{id}/handoff',
  tags: ['Context'],
  summary: 'Send a grouped Signal to an explicit Handoff reviewer',
  security: bearer,
  request: { params: idParam, body: jsonBody(Req.ContextSignalGroupHandoff, false) },
  responses: { 200: ok(GenericObject), 400: err400, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/context/signal-groups/{id}/reject',
  tags: ['Context'],
  summary: 'Dismiss a grouped Signal while preserving evidence',
  security: bearer,
  request: {
    params: idParam,
    body: jsonBody(z.object({
      reason: z.string().optional(),
      idempotency_key: z.string().optional(),
    }), false),
  },
  responses: { 200: ok(GenericObject), 400: err400, 404: err404 },
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
  method: 'post', path: '/context/{id}/promote',
  tags: ['Context'],
  summary: 'Promote an evidence-backed Signal into Current Memory',
  security: bearer,
  request: {
    params: idParam,
    body: jsonBody(z.object({
      body: z.string().optional(),
      title: z.string().optional(),
      structured_data: z.record(z.unknown()).optional(),
      confidence: z.number().min(0).max(1).optional(),
      tags: z.array(z.string()).optional(),
      idempotency_key: z.string().optional(),
    }), false),
  },
  responses: { 200: ok(ContextEntryRecord), 400: err400, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/context/{id}/reject',
  tags: ['Context'],
  summary: 'Reject a Signal while preserving evidence for audit',
  security: bearer,
  request: {
    params: idParam,
    body: jsonBody(z.object({
      reason: z.string().optional(),
      idempotency_key: z.string().optional(),
    }), false),
  },
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

registry.registerPath({
  method: 'post', path: '/context/review-batch',
  tags: ['Context'],
  summary: 'Review multiple stale Memory entries in one request',
  security: bearer,
  request: { body: jsonBody(GenericObject) },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/context/mark-stale',
  tags: ['Context'],
  summary: 'Mark matching Memory entries stale in bulk',
  security: bearer,
  request: { body: jsonBody(GenericObject) },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/context/consolidate',
  tags: ['Context'],
  summary: 'Consolidate related Signals or Memory candidates',
  security: bearer,
  request: { body: jsonBody(GenericObject) },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/context/contradictions/assign',
  tags: ['Context'],
  summary: 'Assign a contradiction for human review',
  security: bearer,
  request: { body: jsonBody(GenericObject) },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/context/contradictions/resolve',
  tags: ['Context'],
  summary: 'Resolve a contradiction and update affected Memory or Signals',
  security: bearer,
  request: { body: jsonBody(GenericObject) },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403 },
});

// -- Briefing --

registry.registerPath({
  method: 'post', path: '/action-context',
  tags: ['Briefing'],
  summary: 'Assemble action-aware customer context, warnings, policy checks, and review requirements',
  security: bearer,
  request: { body: jsonBody(Req.ActionContextGet) },
  responses: { 200: ok(ActionContextResponse), 400: err400, 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/action-context/human-unblock',
  tags: ['Briefing'],
  summary: 'Create a human approval or assignment from Action Context unblock guidance',
  security: bearer,
  request: { body: jsonBody(Req.ActionContextHumanUnblock) },
  responses: { 201: created(ActionContextHumanUnblockResponse), 400: err400, 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'get', path: '/briefing/{subject_type}/{subject_id}',
  tags: ['Briefing'],
  summary: 'Get a full briefing for a customer record — record + activities + assignments + context + stale warnings',
  security: bearer,
  request: {
    params: z.object({ subject_type: S.subjectType, subject_id: S.uuid }),
    query: Req.BriefingGet,
  },
  responses: { 200: ok(BriefingResponse), 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/briefing/{subject_type}/{subject_id}/summary',
  tags: ['Briefing'],
  summary: 'Generate a briefing summary for a customer record',
  security: bearer,
  request: {
    params: z.object({ subject_type: S.subjectType, subject_id: S.uuid }),
    body: jsonBody(z.object({
      objective: z.string().optional(),
      format: z.string().optional(),
    }), false),
  },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403, 404: err404 },
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
  summary: 'Get a webhook endpoint with masked signing-secret state',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/webhooks/{id}/secret/reveal',
  tags: ['Webhooks'],
  summary: 'Reveal the full signing secret for a webhook endpoint',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/webhooks/{id}/secret/rotate',
  tags: ['Webhooks'],
  summary: 'Rotate the signing secret for a webhook endpoint',
  security: bearer,
  request: { params: idParam, body: jsonBody(Req.WebhookRotateSecret) },
  responses: { 200: ok(GenericObject), 400: err400, 404: err404 },
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
  summary: 'Create/draft an email; delivered sends become CRMy-authored account activity and context',
  security: bearer,
  request: { body: jsonBody(Req.EmailCreate) },
  responses: { 201: created(GenericObject), 400: err400 },
});

registry.registerPath({
  method: 'get', path: '/emails/sender',
  tags: ['Emails'],
  summary: 'Resolve the current actor sender identity for outbound email drafts and sends',
  security: bearer,
  responses: { 200: ok(z.object({
    sender: z.object({
      sender_type: z.enum(['actor_mailbox', 'tenant_provider', 'unknown']),
      from_email: z.string().email().nullable().optional(),
      from_name: z.string().nullable().optional(),
      mailbox_connection_id: z.string().uuid().nullable().optional(),
      provider: z.string().nullable().optional(),
      can_send: z.boolean(),
      can_provider_draft: z.boolean(),
      reason: z.string(),
      reply_handling: z.string(),
    }),
  })), 401: err401 },
});

registry.registerPath({
  method: 'post', path: '/emails/draft-preview',
  tags: ['Emails'],
  summary: 'Generate an agentic customer email draft preview from Memory, Signals, and linked customer context',
  security: bearer,
  request: { body: jsonBody(z.object({
    source_email_message_id: z.string().uuid().optional(),
    subject_type: z.enum(['account', 'contact', 'opportunity', 'use_case', 'use-case']).optional(),
    subject_id: z.string().uuid().optional(),
    contact_id: z.string().uuid().optional(),
    account_id: z.string().uuid().optional(),
    opportunity_id: z.string().uuid().optional(),
    use_case_id: z.string().uuid().optional(),
    to_address: z.string().email().optional(),
    to_name: z.string().optional(),
    intent: z.enum(['reply', 'follow_up', 'recap_next_steps', 'nudge_stalled_deal', 'custom']).optional(),
    instruction: z.string().optional(),
    tone: z.string().optional(),
    target: z.enum(['crmy', 'provider_draft']).optional(),
  })) },
  responses: { 200: ok(GenericObject), 400: err400 },
});

registry.registerPath({
  method: 'post', path: '/emails/drafts',
  tags: ['Emails'],
  summary: 'Persist, approve, provider-draft, or send customer email with CRMy-authored context after delivery',
  security: bearer,
  request: { body: jsonBody(z.object({
    source_email_message_id: z.string().uuid().optional(),
    subject_type: z.enum(['account', 'contact', 'opportunity', 'use_case', 'use-case']).optional(),
    subject_id: z.string().uuid().optional(),
    contact_id: z.string().uuid().optional(),
    account_id: z.string().uuid().optional(),
    opportunity_id: z.string().uuid().optional(),
    use_case_id: z.string().uuid().optional(),
    to_address: z.string().email(),
    to_name: z.string().optional(),
    subject: z.string(),
    body_text: z.string(),
    body_html: z.string().optional(),
    draft_origin: z.enum(['manual', 'agent_generated']).optional(),
    draft_target: z.enum(['crmy', 'provider_draft']).optional(),
    delivery_action: z.enum(['save_draft', 'request_approval', 'send_now']).optional(),
    generation_metadata: z.record(z.unknown()).optional(),
  })) },
  responses: { 201: created(GenericObject), 400: err400 },
});

registry.registerPath({
  method: 'get', path: '/source-filters',
  tags: ['Source Filters'],
  summary: 'Get email and activity source-filter settings',
  security: bearer,
  responses: { 200: ok(GenericObject), 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'put', path: '/source-filters',
  tags: ['Source Filters'],
  summary: 'Update email and activity source-filter settings',
  security: bearer,
  request: {
    body: jsonBody(z.object({
      internal_domains: z.array(z.string()).optional(),
      excluded_domains: z.array(z.string()).optional(),
      excluded_senders: z.array(z.string()).optional(),
      excluded_local_parts: z.array(z.string()).optional(),
      included_mailbox_labels: z.array(z.string()).optional(),
      excluded_mailbox_labels: z.array(z.string()).optional(),
      skip_spam_trash: z.boolean().optional(),
      skip_promotions: z.boolean().optional(),
      skip_newsletters: z.boolean().optional(),
      include_internal_calendar: z.boolean().optional(),
      email_initial_backfill_days: z.number().int().optional(),
      calendar_initial_past_days: z.number().int().optional(),
      calendar_initial_future_days: z.number().int().optional(),
    })),
  },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'get', path: '/calendar/connections',
  tags: ['Calendar'],
  summary: 'List calendar connections and customer-meeting processing summary',
  security: bearer,
  responses: { 200: ok(CalendarConnectionListResponse), 401: err401 },
});

registry.registerPath({
  method: 'post', path: '/calendar/connections/{provider}/start',
  tags: ['Calendar'],
  summary: 'Start a Google or Microsoft calendar connection',
  security: bearer,
  request: {
    params: providerParam,
    body: jsonBody(z.object({
      email_address: z.string().email().optional(),
      display_name: z.string().optional(),
      meeting_ingest_scope: z.enum(['owned_accounts', 'accessible_accounts', 'all_meetings']).optional(),
    }), false),
  },
  responses: { 202: ok(OAuthConnectionStartResponse), 400: err400, 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'delete', path: '/calendar/connections/{id}',
  tags: ['Calendar'],
  summary: 'Delete a calendar connection',
  security: bearer,
  request: { params: idParam },
  responses: { 204: { description: 'Deleted' }, 401: err401, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'patch', path: '/calendar/connections/{id}/status',
  tags: ['Calendar'],
  summary: 'Activate or deactivate a calendar connection',
  description: 'Deactivation pauses CRMy calendar use while preserving OAuth credentials. Disconnecting is handled by DELETE and removes the connection.',
  security: bearer,
  request: {
    params: idParam,
    body: jsonBody(z.object({
      active: z.boolean(),
      meeting_ingest_scope: z.enum(['owned_accounts', 'accessible_accounts', 'all_meetings']).optional(),
    })),
  },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/calendar/connections/{id}/sync',
  tags: ['Calendar'],
  summary: 'Queue a calendar sync job',
  security: bearer,
  request: { params: idParam },
  responses: { 202: ok(GenericObject), 401: err401, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'get', path: '/calendar-events',
  tags: ['Calendar'],
  summary: 'List customer meeting events with validation and processing state',
  security: bearer,
  request: {
    query: z.object({
      q: z.string().optional(),
      tab: z.string().optional(),
      classification: z.string().optional(),
      validation_status: z.string().optional(),
      processing_status: z.string().optional(),
      contact_id: S.uuid.optional(),
      account_id: S.uuid.optional(),
      opportunity_id: S.uuid.optional(),
      use_case_id: S.uuid.optional(),
      include_internal: z.coerce.boolean().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'get', path: '/calendar-events/{id}',
  tags: ['Calendar'],
  summary: 'Get a calendar event and its meeting artifacts',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'patch', path: '/calendar-events/{id}',
  tags: ['Calendar'],
  summary: 'Update calendar event classification, status, or customer links',
  security: bearer,
  request: { params: idParam, body: jsonBody(GenericObject) },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/calendar-events/{id}/process',
  tags: ['Calendar'],
  summary: 'Process a calendar event as a Source',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/calendar-events/{id}/artifacts',
  tags: ['Calendar'],
  summary: 'Attach meeting notes, transcript, summary, recording, or other artifact to a calendar event',
  security: bearer,
  request: {
    params: idParam,
    body: jsonBody(z.object({
      artifact_type: z.enum(['transcript', 'notes', 'summary', 'recording', 'other']).optional(),
      source: z.string().optional(),
      source_label: z.string().optional(),
      text_content: z.string().optional(),
      process: z.boolean().optional(),
    })),
  },
  responses: { 201: created(GenericObject), 400: err400, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/calendar-events/{id}/ignore',
  tags: ['Calendar'],
  summary: 'Ignore a calendar event and skip Source processing',
  security: bearer,
  request: { params: idParam, body: jsonBody(z.object({ reason: z.string().optional() }), false) },
  responses: { 200: ok(GenericObject), 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'get', path: '/context-source-connections',
  tags: ['Calendar'],
  summary: 'List admin-managed transcript and notes storage drops',
  security: bearer,
  responses: { 200: ok(GenericList), 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/context-source-connections',
  tags: ['Calendar'],
  summary: 'Create an S3-compatible or local-folder transcript/notes drop',
  security: bearer,
  request: { body: jsonBody(z.object({
    name: z.string().min(1),
    provider: z.enum(['s3', 'local_folder']),
    config: z.record(z.unknown()),
    credentials: z.record(z.unknown()).optional(),
  })) },
  responses: { 201: created(GenericObject), 400: err400, 403: err403 },
});

registry.registerPath({
  method: 'patch', path: '/context-source-connections/{id}',
  tags: ['Calendar'],
  summary: 'Update transcript/notes drop configuration or credentials',
  security: bearer,
  request: { params: idParam, body: jsonBody(GenericObject) },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'delete', path: '/context-source-connections/{id}',
  tags: ['Calendar'],
  summary: 'Delete a transcript/notes source drop',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(SuccessResult), 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/context-source-connections/{id}/sync',
  tags: ['Calendar'],
  summary: 'Queue sync for a transcript/notes source drop',
  security: bearer,
  request: { params: idParam },
  responses: { 202: ok(GenericObject), 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'get', path: '/context-source-objects',
  tags: ['Calendar'],
  summary: 'List transcript/notes source objects with matching and processing state',
  security: bearer,
  request: { query: z.object({
    connection_id: S.uuid.optional(),
    match_status: z.enum(['unmatched', 'matched', 'ambiguous', 'needs_review', 'ignored', 'all']).optional(),
    processing_status: z.enum(['discovered', 'queued', 'processing', 'processed', 'needs_review', 'failed', 'ignored', 'all']).optional(),
    q: z.string().optional(),
    account_id: S.uuid.optional(),
    contact_id: S.uuid.optional(),
    opportunity_id: S.uuid.optional(),
    use_case_id: S.uuid.optional(),
    calendar_event_id: S.uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().optional(),
  }) },
  responses: { 200: ok(GenericList), 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'get', path: '/context-source-objects/{id}',
  tags: ['Calendar'],
  summary: 'Get one transcript/notes source object and lineage links',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/context-source-objects/{id}/resolve',
  tags: ['Calendar'],
  summary: 'Resolve a transcript/notes source object to a meeting or customer record',
  security: bearer,
  request: { params: idParam, body: jsonBody(z.object({
    calendar_event_id: S.uuid.optional(),
    account_id: S.uuid.optional(),
    contact_id: S.uuid.optional(),
    opportunity_id: S.uuid.optional(),
    use_case_id: S.uuid.optional(),
    note: z.string().optional(),
  })) },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/context-source-objects/{id}/reprocess',
  tags: ['Calendar'],
  summary: 'Queue transcript/notes source object reprocessing',
  security: bearer,
  request: { params: idParam },
  responses: { 202: ok(GenericObject), 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/context-source-objects/{id}/ignore',
  tags: ['Calendar'],
  summary: 'Ignore a transcript/notes source object',
  security: bearer,
  request: { params: idParam, body: jsonBody(z.object({ reason: z.string().optional() }), false) },
  responses: { 200: ok(GenericObject), 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/availability/suggest-times',
  tags: ['Calendar'],
  summary: 'Suggest meeting times from connected internal calendar free/busy and customer timing preferences',
  security: bearer,
  request: {
    body: jsonBody(z.object({
      subject_type: z.enum(['account', 'contact', 'opportunity', 'use_case']).optional(),
      subject_id: S.uuid.optional(),
      account_id: S.uuid.optional(),
      contact_id: S.uuid.optional(),
      opportunity_id: S.uuid.optional(),
      use_case_id: S.uuid.optional(),
      actor_ids: z.array(S.uuid).max(10).optional(),
      duration_minutes: z.number().int().min(15).max(480).optional(),
      date_start: z.string().datetime().optional(),
      date_end: z.string().datetime().optional(),
      timezone: z.string().optional(),
      business_hours_start: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/).optional(),
      business_hours_end: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/).optional(),
      business_days_only: z.boolean().optional(),
      increment_minutes: z.number().int().min(5).max(120).optional(),
      limit: z.number().int().min(1).max(10).optional(),
    }), false),
  },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403, 422: err400 },
});

registry.registerPath({
  method: 'get', path: '/emails/{id}',
  tags: ['Emails'],
  summary: 'Get an email by ID',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 404: err404 },
});

registry.registerPath({
  method: 'patch', path: '/emails/{id}',
  tags: ['Emails'],
  summary: 'Edit a draft, failed, or rejected outbound email',
  security: bearer,
  request: {
    params: idParam,
    body: jsonBody(z.object({
      to_email: z.string().email().optional(),
      to_name: z.string().nullable().optional(),
      subject: z.string().min(1).optional(),
      body_text: z.string().min(1).optional(),
      body_html: z.string().nullable().optional(),
    })),
  },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/emails/{id}/request-approval',
  tags: ['Emails'],
  summary: 'Request approval for a governed outbound email draft',
  security: bearer,
  request: { params: idParam, body: jsonBody(z.object({ reason: z.string().optional(), idempotency_key: z.string().optional() }), false) },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/emails/{id}/send',
  tags: ['Emails'],
  summary: 'Send an approved or explicitly allowed outbound email draft',
  security: bearer,
  request: { params: idParam, body: jsonBody(z.object({ idempotency_key: z.string().optional() }), false) },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/emails/{id}/provider-draft/retry',
  tags: ['Emails'],
  summary: 'Retry provider draft creation for an editable outbound email',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/emails/{id}/delivery-resolution',
  tags: ['Emails'],
  summary: 'Retry or manually reconcile failed or delivery-uncertain outbound email',
  security: bearer,
  request: {
    params: idParam,
    body: jsonBody(z.object({
      action: z.enum(['retry', 'mark_sent', 'mark_failed']),
      note: z.string().max(1000).optional(),
    })),
  },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'get', path: '/mailbox/connections',
  tags: ['Emails'],
  summary: 'List mailbox connections and customer-email processing summary',
  security: bearer,
  responses: { 200: ok(MailboxConnectionListResponse), 401: err401 },
});

registry.registerPath({
  method: 'post', path: '/mailbox/connections/{provider}/start',
  tags: ['Emails'],
  summary: 'Start a Gmail or Outlook mailbox connection',
  security: bearer,
  request: {
    params: z.object({ provider: z.enum(['google', 'microsoft']) }),
    body: jsonBody(z.object({
      email_address: z.string().email().optional(),
      display_name: z.string().optional(),
      context_sync_enabled: z.boolean().optional(),
      send_enabled: z.boolean().optional(),
      provider_draft_enabled: z.boolean().optional(),
      is_default_sender: z.boolean().optional(),
      account_ingest_scope: z.enum(['owned_accounts', 'accessible_accounts']).optional(),
    }), false),
  },
  responses: { 202: ok(OAuthConnectionStartResponse), 400: err400 },
});

registry.registerPath({
  method: 'post', path: '/mailbox/connections/{id}/sync',
  tags: ['Emails'],
  summary: 'Queue a mailbox sync job',
  security: bearer,
  request: { params: idParam },
  responses: { 202: ok(GenericObject), 404: err404 },
});

registry.registerPath({
  method: 'delete', path: '/mailbox/connections/{id}',
  tags: ['Emails'],
  summary: 'Delete a mailbox connection',
  security: bearer,
  request: { params: idParam },
  responses: { 204: { description: 'Deleted' }, 401: err401, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'patch', path: '/mailbox/connections/{id}/status',
  tags: ['Emails'],
  summary: 'Activate or deactivate a mailbox connection',
  description: 'Deactivation pauses mailbox context sync and sender use while preserving OAuth credentials. Disconnecting is handled by DELETE and removes the connection.',
  security: bearer,
  request: {
    params: idParam,
    body: jsonBody(z.object({
      active: z.boolean(),
      context_sync_enabled: z.boolean().optional(),
      send_enabled: z.boolean().optional(),
      provider_draft_enabled: z.boolean().optional(),
      is_default_sender: z.boolean().optional(),
      account_ingest_scope: z.enum(['owned_accounts', 'accessible_accounts']).optional(),
    })),
  },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/mailbox/connections/{id}/aliases/refresh',
  tags: ['Emails'],
  summary: 'Refresh verified send-as aliases for a Gmail or Outlook mailbox connection',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'patch', path: '/mailbox/connections/{id}/sender',
  tags: ['Emails'],
  summary: 'Choose the verified send-as identity used for outbound drafts from this mailbox',
  security: bearer,
  request: {
    params: idParam,
    body: jsonBody(z.object({
      selected_send_as_email: z.string().email(),
    })),
  },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'get', path: '/email-messages',
  tags: ['Emails'],
  summary: 'List customer email messages with classification and processing state',
  security: bearer,
  request: {
    query: z.object({
      view: z.enum(['customer', 'review', 'all']).optional(),
      q: z.string().optional(),
      direction: z.enum(['inbound', 'outbound']).optional(),
      classification: z.string().optional(),
      processing_status: z.string().optional(),
      contact_id: z.string().optional(),
      account_id: z.string().optional(),
      opportunity_id: z.string().optional(),
      use_case_id: z.string().optional(),
      include_internal: z.boolean().optional(),
      limit: z.number().optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'get', path: '/email-messages/subject-summary',
  tags: ['Emails'],
  summary: 'Summarize linked customer email activity for contact or account records',
  security: bearer,
  request: {
    query: z.object({
      subject_type: z.enum(['contact', 'account']),
      ids: z.string(),
    }),
  },
  responses: { 200: ok(GenericList), 400: err400, 401: err401 },
});

registry.registerPath({
  method: 'get', path: '/email-messages/{id}',
  tags: ['Emails'],
  summary: 'Get a customer email message, linked records, and processing receipt',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 404: err404 },
});

registry.registerPath({
  method: 'patch', path: '/email-messages/{id}',
  tags: ['Emails'],
  summary: 'Update customer email classification or customer-record links',
  security: bearer,
  request: { params: idParam, body: jsonBody(GenericObject) },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'patch', path: '/email-messages/{id}/classification',
  tags: ['Emails'],
  summary: 'Update customer email classification',
  security: bearer,
  request: {
    params: idParam,
    body: jsonBody(z.object({
      classification: z.enum(['customer', 'mixed', 'internal', 'automated', 'unknown']),
    })),
  },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/email-messages/{id}/process',
  tags: ['Emails'],
  summary: 'Process a customer email message as a Source',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/email-messages/{id}/ignore',
  tags: ['Emails'],
  summary: 'Ignore a customer email and skip Source processing',
  security: bearer,
  request: { params: idParam, body: jsonBody(z.object({ reason: z.string().optional() }), false) },
  responses: { 200: ok(GenericObject), 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'get', path: '/email-provider',
  tags: ['Emails'],
  summary: 'Get outbound email provider configuration status',
  security: bearer,
  responses: { 200: ok(GenericObject), 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'put', path: '/email-provider',
  tags: ['Emails'],
  summary: 'Configure the outbound email provider',
  security: bearer,
  request: { body: jsonBody(GenericObject) },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'get', path: '/email-provider/inbound',
  tags: ['Emails'],
  summary: 'Get inbound email webhook status',
  security: bearer,
  responses: { 200: ok(GenericObject), 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/email-provider/inbound/secret',
  tags: ['Emails'],
  summary: 'Generate or rotate the inbound email webhook secret',
  security: bearer,
  responses: { 200: ok(GenericObject), 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'get', path: '/handoff-snapshots/{id}',
  tags: ['HITL'],
  summary: 'Get a persisted handoff snapshot',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 403: err403, 404: err404 },
});

// -- Messaging Channels --

registry.registerPath({
  method: 'get', path: '/messaging-channels',
  tags: ['Messaging'],
  summary: 'List configured messaging channels',
  security: bearer,
  request: { query: Req.MessagingChannelList },
  responses: { 200: ok(z.object({ data: z.array(MessagingChannelRecord), next_cursor: z.string().nullable().optional(), total: z.number().optional() })), 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/messaging-channels',
  tags: ['Messaging'],
  summary: 'Create a messaging channel',
  security: bearer,
  request: { body: jsonBody(Req.MessagingChannelCreate) },
  responses: { 201: created(MessagingChannelRecord), 400: err400, 403: err403 },
});

registry.registerPath({
  method: 'get', path: '/messaging-channels/{id}',
  tags: ['Messaging'],
  summary: 'Get a messaging channel',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(MessagingChannelRecord), 404: err404 },
});

registry.registerPath({
  method: 'patch', path: '/messaging-channels/{id}',
  tags: ['Messaging'],
  summary: 'Update a messaging channel',
  security: bearer,
  request: { params: idParam, body: jsonBody(Req.MessagingChannelUpdate) },
  responses: { 200: ok(MessagingChannelRecord), 400: err400, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'delete', path: '/messaging-channels/{id}',
  tags: ['Messaging'],
  summary: 'Delete a messaging channel',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(SuccessResult), 403: err403, 404: err404 },
});

// -- Sequences --

registry.registerPath({
  method: 'get', path: '/sequences',
  tags: ['Sequences'],
  summary: 'List customer engagement sequences',
  security: bearer,
  request: {
    query: z.object({
      is_active: z.boolean().optional(),
      tags: z.string().optional().openapi({ description: 'Comma-separated tag filter' }),
      limit: z.number().int().min(1).optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: { 200: ok(z.object({ data: z.array(SequenceRecord), next_cursor: z.string().nullable().optional(), total: z.number().optional() })), 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/sequences',
  tags: ['Sequences'],
  summary: 'Create a sequence',
  security: bearer,
  request: { body: jsonBody(Req.SequenceCreate) },
  responses: { 201: created(SequenceRecord), 400: err400, 403: err403 },
});

registry.registerPath({
  method: 'get', path: '/sequences/enrollments',
  tags: ['Sequences'],
  summary: 'List sequence enrollments',
  security: bearer,
  request: { query: Req.SequenceEnrollmentList },
  responses: { 200: ok(z.object({ data: z.array(SequenceEnrollmentRecord), next_cursor: z.string().nullable().optional(), total: z.number().optional() })), 401: err401, 403: err403 },
});

for (const [action, summary] of [
  ['unenroll', 'Cancel an active sequence enrollment'] as const,
  ['pause', 'Pause an active sequence enrollment'] as const,
  ['resume', 'Resume a paused sequence enrollment'] as const,
] as const) {
  registry.registerPath({
    method: 'post', path: `/sequences/enrollments/{id}/${action}`,
    tags: ['Sequences'],
    summary,
    security: bearer,
    request: {
      params: idParam,
      body: jsonBody(z.object({ idempotency_key: z.string().optional() }), false),
    },
    responses: { 200: ok(SequenceEnrollmentRecord), 400: err400, 403: err403, 404: err404 },
  });
}

registry.registerPath({
  method: 'get', path: '/sequences/{id}',
  tags: ['Sequences'],
  summary: 'Get sequence details',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(SequenceRecord), 404: err404 },
});

registry.registerPath({
  method: 'patch', path: '/sequences/{id}',
  tags: ['Sequences'],
  summary: 'Update sequence metadata, steps, settings, or active status',
  security: bearer,
  request: { params: idParam, body: jsonBody(Req.SequenceUpdate) },
  responses: { 200: ok(SequenceRecord), 400: err400, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'delete', path: '/sequences/{id}',
  tags: ['Sequences'],
  summary: 'Delete a sequence and cancel active enrollments',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(SuccessResult), 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/sequences/{id}/enroll',
  tags: ['Sequences'],
  summary: 'Enroll a contact in a sequence',
  security: bearer,
  request: { params: idParam, body: jsonBody(Req.SequenceEnroll) },
  responses: { 201: created(SequenceEnrollmentRecord), 400: err400, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'get', path: '/sequences/{id}/analytics',
  tags: ['Sequences'],
  summary: 'Sequence performance analytics',
  security: bearer,
  request: { params: idParam, query: Req.SequenceAnalytics },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/sequences/draft-preview',
  tags: ['Sequences'],
  summary: 'Generate an unsaved AI draft preview for a sequence email step',
  security: bearer,
  request: {
    body: jsonBody(z.object({
      subject: z.string().optional(),
      body_text: z.string().optional(),
      ai_prompt: z.string().optional(),
      ai_persona: z.string().optional(),
    })),
  },
  responses: { 200: ok(z.object({ subject: z.string(), body_text: z.string() })), 400: err400, 403: err403 },
});

registry.registerPath({
  method: 'get', path: '/sequences/enrollments/{enrollmentId}/activities',
  tags: ['Sequences'],
  summary: 'List activities created by a sequence enrollment',
  security: bearer,
  request: { params: enrollmentIdParam },
  responses: { 200: ok(GenericList), 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'get', path: '/sequences/enrollments/{enrollmentId}/context',
  tags: ['Sequences'],
  summary: 'List context generated by a sequence enrollment',
  security: bearer,
  request: { params: enrollmentIdParam },
  responses: { 200: ok(GenericList), 403: err403, 404: err404 },
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
  method: 'post', path: '/workflows/test-draft',
  tags: ['Workflows'],
  summary: 'Test an unsaved workflow draft against a sample payload',
  security: bearer,
  request: { body: jsonBody(GenericObject) },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/workflows/draft-content-preview',
  tags: ['Workflows'],
  summary: 'Preview generated content for an unsaved workflow draft',
  security: bearer,
  request: { body: jsonBody(GenericObject) },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403 },
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

registry.registerPath({
  method: 'post', path: '/workflows/{id}/test',
  tags: ['Workflows'],
  summary: 'Test a saved workflow against a sample payload',
  security: bearer,
  request: {
    params: idParam,
    body: jsonBody(z.object({ sample_payload: z.record(z.unknown()).optional() }), false),
  },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/workflows/{id}/clone',
  tags: ['Workflows'],
  summary: 'Clone a workflow',
  security: bearer,
  request: {
    params: idParam,
    body: jsonBody(z.object({ name: z.string().optional() }), false),
  },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/workflows/{id}/trigger',
  tags: ['Workflows'],
  summary: 'Manually trigger a workflow',
  security: bearer,
  request: {
    params: idParam,
    body: jsonBody(z.object({
      subject_type: S.subjectType.optional(),
      subject_id: S.uuid.optional(),
      objective: z.string().max(500).optional(),
      variables: z.record(z.unknown()).optional(),
      idempotency_key: z.string().max(128).optional(),
    }).passthrough(), false),
  },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403, 404: err404 },
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
  method: 'get', path: '/meeting-classifications',
  tags: ['Registries'],
  summary: 'List meeting classification rules',
  security: bearer,
  responses: { 200: ok(GenericList), 401: err401 },
});

registry.registerPath({
  method: 'post', path: '/meeting-classifications',
  tags: ['Registries'],
  summary: 'Create a meeting classification rule',
  security: bearer,
  request: { body: jsonBody(GenericObject) },
  responses: { 201: created(GenericObject), 400: err400, 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'patch', path: '/meeting-classifications/{type_name}',
  tags: ['Registries'],
  summary: 'Update a meeting classification rule',
  security: bearer,
  request: { params: z.object({ type_name: z.string() }), body: jsonBody(GenericObject) },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'delete', path: '/meeting-classifications/{type_name}',
  tags: ['Registries'],
  summary: 'Delete a meeting classification rule',
  security: bearer,
  request: { params: z.object({ type_name: z.string() }) },
  responses: { 200: ok(SuccessResult), 401: err401, 403: err403, 404: err404 },
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

// -- Systems of Record --

registry.registerPath({
  method: 'get', path: '/systems-of-record',
  tags: ['Systems of Record'],
  summary: 'List configured systems of record',
  security: bearer,
  request: { query: S.sorSystemList },
  responses: { 200: ok(GenericList), 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/systems-of-record',
  tags: ['Systems of Record'],
  summary: 'Create a governed system connection with encrypted credentials',
  security: bearer,
  request: { body: jsonBody(S.sorSystemCreate) },
  responses: { 201: created(GenericObject), 400: err400, 403: err403 },
});

registry.registerPath({
  method: 'get', path: '/systems-of-record/{id}',
  tags: ['Systems of Record'],
  summary: 'Get one system of record',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 404: err404 },
});

registry.registerPath({
  method: 'patch', path: '/systems-of-record/{id}',
  tags: ['Systems of Record'],
  summary: 'Update a system connection or encrypted credentials',
  security: bearer,
  request: { params: idParam, body: jsonBody(S.sorSystemUpdate.shape.patch) },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'delete', path: '/systems-of-record/{id}',
  tags: ['Systems of Record'],
  summary: 'Delete a system connection and related sync metadata',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(SuccessResult), 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/systems-of-record/{id}/test',
  tags: ['Systems of Record'],
  summary: 'Test a system connection',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'get', path: '/systems-of-record/{id}/discover',
  tags: ['Systems of Record'],
  summary: 'Discover external objects or fields',
  security: bearer,
  request: { params: idParam, query: z.object({ object_name: z.string().optional() }) },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'get', path: '/systems-of-record/mappings/list',
  tags: ['Systems of Record'],
  summary: 'List object mappings',
  security: bearer,
  request: { query: S.sorMappingList },
  responses: { 200: ok(GenericList), 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/systems-of-record/mappings',
  tags: ['Systems of Record'],
  summary: 'Create or update an object mapping',
  security: bearer,
  request: { body: jsonBody(S.sorMappingUpsert) },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403 },
});

registry.registerPath({
  method: 'delete', path: '/systems-of-record/mappings/{id}',
  tags: ['Systems of Record'],
  summary: 'Delete an object mapping',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(SuccessResult), 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/systems-of-record/{id}/sync',
  tags: ['Systems of Record'],
  summary: 'Run a system sync that emits normal CRMy events',
  security: bearer,
  request: { params: idParam, body: jsonBody(S.sorSyncRun.omit({ system_id: true })) },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'get', path: '/systems-of-record/sync-runs/list',
  tags: ['Systems of Record'],
  summary: 'List sync runs',
  security: bearer,
  request: { query: S.sorSyncStatus },
  responses: { 200: ok(GenericList), 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'get', path: '/systems-of-record/conflicts/list',
  tags: ['Systems of Record'],
  summary: 'List sync conflicts',
  security: bearer,
  request: { query: S.sorConflictList },
  responses: { 200: ok(GenericList), 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/systems-of-record/conflicts/{id}/resolve',
  tags: ['Systems of Record'],
  summary: 'Resolve a sync conflict',
  security: bearer,
  request: { params: idParam, body: jsonBody(S.sorConflictResolve.omit({ id: true })) },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/systems-of-record/writebacks/preview',
  tags: ['Systems of Record'],
  summary: 'Preview a governed external writeback',
  security: bearer,
  request: { body: jsonBody(S.sorWritebackPreview) },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/systems-of-record/writebacks',
  tags: ['Systems of Record'],
  summary: 'Request a governed external writeback',
  security: bearer,
  request: { body: jsonBody(S.sorWritebackRequest) },
  responses: { 201: created(GenericObject), 400: err400, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/systems-of-record/writebacks/{id}/review',
  tags: ['Systems of Record'],
  summary: 'Approve or reject a governed external writeback',
  security: bearer,
  request: { params: idParam, body: jsonBody(S.sorWritebackReview.omit({ id: true })) },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/systems-of-record/writebacks/{id}/execute',
  tags: ['Systems of Record'],
  summary: 'Execute an approved external writeback',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 400: err400, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'get', path: '/systems-of-record/writebacks/list',
  tags: ['Systems of Record'],
  summary: 'List external writeback requests',
  security: bearer,
  request: { query: S.sorWritebackStatus },
  responses: { 200: ok(GenericList), 401: err401, 403: err403 },
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

// -- Admin --

registry.registerPath({
  method: 'get', path: '/admin/db-config',
  tags: ['Admin'],
  summary: 'Inspect database and semantic-search setup status',
  security: bearer,
  responses: { 200: ok(GenericObject), 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/admin/db-config/test',
  tags: ['Admin'],
  summary: 'Test a PostgreSQL connection string in local setup mode',
  security: bearer,
  request: { body: jsonBody(z.object({ connection_string: z.string().min(1) })) },
  responses: { 200: ok(SuccessResult), 400: err400, 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'patch', path: '/admin/db-config',
  tags: ['Admin'],
  summary: 'Save a PostgreSQL connection string to local .env.db in local setup mode',
  security: bearer,
  request: { body: jsonBody(z.object({ connection_string: z.string().min(1) })) },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/admin/sample-data',
  tags: ['Admin'],
  summary: 'Seed or refresh sample data for the current tenant',
  security: bearer,
  request: { body: jsonBody(z.object({ confirm: z.boolean().optional() }), false) },
  responses: { 200: ok(GenericObject), 401: err401, 403: err403, 409: err409 },
});

registry.registerPath({
  method: 'get', path: '/admin/oauth-readiness',
  tags: ['Admin'],
  summary: 'Inspect Google and Microsoft mailbox/calendar OAuth readiness without exposing secrets',
  security: bearer,
  responses: { 200: ok(OAuthReadinessResponse), 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'get', path: '/admin/oauth-apps',
  tags: ['Admin'],
  summary: 'List tenant-owned Google and Microsoft OAuth app overrides without secret values',
  security: bearer,
  responses: {
    200: ok(z.object({ data: z.array(TenantOAuthAppRecord), total: z.number().int() })),
    401: err401,
    403: err403,
  },
});

registry.registerPath({
  method: 'put', path: '/admin/oauth-apps/{provider}',
  tags: ['Admin'],
  summary: 'Create or update a tenant-owned OAuth app override for Google or Microsoft',
  security: bearer,
  request: {
    params: oauthProviderParam,
    body: jsonBody(tenantOAuthAppUpsert.extend({
      client_secret: z.string().min(1).optional().openapi({
        description: 'Write-only. Omit on update to preserve the existing encrypted secret.',
      }),
    })),
  },
  responses: { 200: ok(z.object({ oauth_app: TenantOAuthAppRecord })), 400: err400, 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'delete', path: '/admin/oauth-apps/{provider}',
  tags: ['Admin'],
  summary: 'Remove a tenant-owned OAuth app override so the tenant uses CRMy-managed or self-hosted defaults',
  security: bearer,
  request: { params: oauthProviderParam },
  responses: { 200: ok(z.object({ deleted: z.boolean() })), 400: err400, 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'get', path: '/admin/actors',
  tags: ['Admin'],
  summary: 'List actors with user, API key, registration, and activity metadata',
  security: bearer,
  request: { query: z.object({ limit: z.coerce.number().int().min(1).max(500).optional(), cursor: z.string().optional() }) },
  responses: { 200: ok(GenericList), 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'get', path: '/admin/actor-connections',
  tags: ['Admin'],
  summary: 'List human actor mailbox sender and calendar connection coverage',
  security: bearer,
  responses: { 200: ok(ActorConnectionSummary), 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/admin/actors/{id}/approve',
  tags: ['Admin'],
  summary: 'Approve a pending actor registration',
  security: bearer,
  request: {
    params: idParam,
    body: jsonBody(z.object({
      display_name: z.string().optional(),
      agent_identifier: z.string().optional(),
      agent_model: z.string().optional(),
      scopes: z.array(z.string()).optional(),
      metadata: z.record(z.unknown()).optional(),
      is_active: z.boolean().optional(),
    }), false),
  },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/admin/actors/{id}/reject',
  tags: ['Admin'],
  summary: 'Reject a pending actor registration',
  security: bearer,
  request: { params: idParam, body: jsonBody(z.object({ reason: z.string().optional() }), false) },
  responses: { 200: ok(GenericObject), 401: err401, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'get', path: '/admin/users',
  tags: ['Admin'],
  summary: 'List workspace users',
  security: bearer,
  request: { query: z.object({ limit: z.coerce.number().int().min(1).max(500).optional(), cursor: z.string().optional() }) },
  responses: { 200: ok(GenericList), 401: err401, 403: err403 },
});

registry.registerPath({
  method: 'post', path: '/admin/users',
  tags: ['Admin'],
  summary: 'Create a workspace user or invite',
  security: bearer,
  request: {
    body: jsonBody(z.object({
      name: z.string().min(1),
      email: z.string().email(),
      phone: z.string().optional(),
      password: z.string().min(12).optional(),
      role: z.enum(['member', 'manager', 'admin', 'owner']),
      manager_id: S.uuid.nullable().optional(),
      send_invite: z.boolean().optional(),
      metadata: z.record(z.unknown()).optional(),
    })),
  },
  responses: { 201: created(GenericObject), 400: err400, 401: err401, 403: err403, 409: err409 },
});

registry.registerPath({
  method: 'patch', path: '/admin/users/{id}',
  tags: ['Admin'],
  summary: 'Update a workspace user',
  security: bearer,
  request: {
    params: idParam,
    body: jsonBody(z.object({
      name: z.string().optional(),
      email: z.string().email().optional(),
      role: z.enum(['member', 'manager', 'admin', 'owner']).optional(),
      manager_id: S.uuid.nullable().optional(),
      password: z.string().min(12).optional(),
      is_active: z.boolean().optional(),
    })),
  },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403, 404: err404, 409: err409 },
});

registry.registerPath({
  method: 'delete', path: '/admin/users/{id}',
  tags: ['Admin'],
  summary: 'Delete a workspace user and deactivate the linked actor',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(z.object({ deleted: z.boolean() })), 400: err400, 401: err401, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/admin/users/{id}/invite',
  tags: ['Admin'],
  summary: 'Issue or resend an invite setup link for a user',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 401: err401, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/admin/users/{id}/password-reset',
  tags: ['Admin'],
  summary: 'Issue a password-reset setup link for a user',
  security: bearer,
  request: { params: idParam },
  responses: { 200: ok(GenericObject), 401: err401, 403: err403, 404: err404 },
});

registry.registerPath({
  method: 'post', path: '/resolve',
  tags: ['Search'],
  summary: 'Resolve contacts or accounts by natural-language query',
  security: bearer,
  request: {
    body: jsonBody(z.object({
      query: z.string().min(1),
      entity_type: z.enum(['contact', 'account', 'any']).optional(),
      context_hints: z.record(z.string()).optional(),
      limit: z.number().int().min(1).max(10).optional(),
    })),
  },
  responses: { 200: ok(GenericObject), 400: err400, 401: err401, 403: err403 },
});

// -- Search --

registry.registerPath({
  method: 'get', path: '/search',
  tags: ['Search'],
  summary: 'Cross-entity full-text search across customer records, context, and handoffs',
  security: bearer,
  request: { query: z.object({ q: z.string().min(1), limit: z.number().int().optional() }) },
  responses: { 200: ok(GenericList), 400: err400 },
});
