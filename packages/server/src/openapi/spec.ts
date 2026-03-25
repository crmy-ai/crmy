// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { registry } from './registry.js';
import './paths.js'; // side-effect: registers all route paths into the registry

export function buildSpec() {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  // generateDocument does not accept `components` in its config type; merge
  // security schemes into the generated document after the fact.
  const doc = generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'CRMy API',
      version: '0.5.10',
      description:
        'The context backend for sales agents. MCP-native, PostgreSQL-backed, open source. ' +
        'All endpoints require `Authorization: Bearer <jwt-or-api-key>` except `/auth/register` and `/auth/login`.',
      license: { name: 'Apache-2.0' },
    },
    servers: [
      { url: '/api/v1', description: 'Default (relative to server root)' },
    ],
    tags: [
      { name: 'Auth', description: 'Authentication and API key management' },
      { name: 'Contacts', description: 'Contact records and lifecycle management' },
      { name: 'Accounts', description: 'Account records and hierarchies' },
      { name: 'Opportunities', description: 'Pipeline and deal records' },
      { name: 'Activities', description: 'Logged interactions — calls, emails, meetings, tasks' },
      { name: 'Use Cases', description: 'Consumption-based workload tracking' },
      { name: 'Briefing', description: 'Single-call context assembly before any agent action' },
      { name: 'Context', description: 'Typed, versioned knowledge attached to any CRM object' },
      { name: 'Assignments', description: 'Structured handoffs between agents and humans' },
      { name: 'HITL', description: 'Human-in-the-loop approval workflows' },
      { name: 'Actors', description: 'First-class identity for humans and AI agents' },
      { name: 'Webhooks', description: 'Outbound event notifications with retry tracking' },
      { name: 'Emails', description: 'Email drafting with optional HITL approval' },
      { name: 'Custom Fields', description: 'Per-tenant field definitions for any object type' },
      { name: 'Notes', description: 'Threaded notes on any CRM entity' },
      { name: 'Workflows', description: 'Event-driven automation' },
      { name: 'Registries', description: 'Activity type and context type registries' },
      { name: 'Analytics', description: 'Pipeline summaries, forecasts, and use case reports' },
      { name: 'Events', description: 'Append-only audit log' },
      { name: 'Search', description: 'Cross-entity full-text search' },
    ],
  });

  // Merge BearerAuth security scheme into the generated components block
  doc.components ??= {};
  doc.components.securitySchemes ??= {};
  doc.components.securitySchemes['BearerAuth'] = {
    type: 'http',
    scheme: 'bearer',
    description: 'JWT from `/auth/login` or a `crmy_` prefixed API key from `/auth/api-keys`',
  };

  return doc;
}

let _cached: ReturnType<typeof buildSpec> | null = null;

/** Returns the OpenAPI document, building it once and caching for the process lifetime. */
export function getSpec(): ReturnType<typeof buildSpec> {
  return (_cached ??= buildSpec());
}
