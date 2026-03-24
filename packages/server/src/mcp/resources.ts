// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * MCP Resources — exposes CRM entities as subscribable MCP resources.
 *
 * Resource URIs:
 *   crmy://entities                 — list of supported entity types
 *   crmy://contact/{id}             — full briefing for a contact
 *   crmy://account/{id}             — full briefing for an account
 *   crmy://opportunity/{id}         — full briefing for an opportunity
 *   crmy://use_case/{id}            — full briefing for a use case
 *
 * Each entity resource returns the same payload as briefing_get (JSON format).
 * Clients that subscribe will receive notifications/resources/updated whenever
 * the entity changes (handled by session-registry.ts + event bus).
 */

import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ActorContext, SubjectType, UUID } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import { assembleBriefing } from '../services/briefing.js';

const ENTITY_TYPES: { type: SubjectType; label: string; description: string }[] = [
  { type: 'contact', label: 'Contact', description: 'Individual person — stakeholder, prospect, or champion' },
  { type: 'account', label: 'Account', description: 'Organisation — company or team' },
  { type: 'opportunity', label: 'Opportunity', description: 'Deal or sales opportunity' },
  { type: 'use_case', label: 'Use Case', description: 'Identified use case or business requirement' },
];

async function readEntityBriefing(
  db: DbPool,
  tenantId: string,
  subjectType: SubjectType,
  subjectId: string,
  uri: string,
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const briefing = await assembleBriefing(db, tenantId as UUID, subjectType, subjectId as UUID);
  return {
    contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(briefing, null, 2) }],
  };
}

export function registerResources(server: McpServer, db: DbPool, getActor: () => ActorContext): void {
  // Static resource: list of available entity types
  server.resource(
    'crmy-entities',
    'crmy://entities',
    { description: 'List of CRM entity types accessible as resources' },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              entity_types: ENTITY_TYPES.map((e) => ({
                ...e,
                uri_template: `crmy://${e.type}/{id}`,
              })),
              description: 'Subscribe to any entity resource to receive real-time change notifications.',
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  // Dynamic resource templates for each entity type
  for (const { type } of ENTITY_TYPES) {
    server.resource(
      `crmy-${type}`,
      new ResourceTemplate(`crmy://${type}/{id}`, {
        list: undefined, // listing not supported — entities are fetched by ID
      }),
      { description: `Full CRM briefing for a ${type}: subject record, relations, activity timeline, assignments, and context entries.` },
      async (uri, variables) => {
        const actor = getActor();
        const id = Array.isArray(variables.id) ? variables.id[0] : variables.id;
        return readEntityBriefing(db, actor.tenant_id, type, id as string, uri.href);
      },
    );
  }
}
