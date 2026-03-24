// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { ZodRawShape, ZodObject } from 'zod';

const _require = createRequire(import.meta.url);
function getServerVersion(): string {
  try {
    const pkg = _require(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json'),
    ) as { version: string };
    return pkg.version;
  } catch {
    return '0.5.9';
  }
}
import type { ActorContext } from '@crmy/shared';
import { CrmyError } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';
import { enforceToolScopes } from '../auth/scopes.js';
import { registerResources } from './resources.js';
import { contactTools } from './tools/contacts.js';
import { accountTools } from './tools/accounts.js';
import { opportunityTools } from './tools/opportunities.js';
import { activityTools } from './tools/activities.js';
import { analyticsTools } from './tools/analytics.js';
import { hitlTools } from './tools/hitl.js';
import { metaTools } from './tools/meta.js';
import { useCaseTools } from './tools/use-cases.js';
import { webhookTools } from './tools/webhooks.js';
import { emailTools } from './tools/email.js';
import { customFieldTools } from './tools/custom-fields.js';
import { noteTools } from './tools/notes.js';
import { workflowTools } from './tools/workflows.js';
import { actorTools } from './tools/actors.js';
import { assignmentTools } from './tools/assignments.js';
import { contextEntryTools } from './tools/context-entries.js';
import { registryTools } from './tools/registries.js';
import { entityResolveTools } from './tools/entity-resolve.js';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: ZodObject<ZodRawShape>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (input: any, actor: ActorContext) => Promise<unknown>;
}

export function getAllTools(db: DbPool): ToolDef[] {
  return [
    ...contactTools(db),
    ...accountTools(db),
    ...opportunityTools(db),
    ...activityTools(db),
    ...analyticsTools(db),
    ...hitlTools(db),
    ...useCaseTools(db),
    ...webhookTools(db),
    ...emailTools(db),
    ...customFieldTools(db),
    ...noteTools(db),
    ...workflowTools(db),
    ...actorTools(db),
    ...assignmentTools(db),
    ...contextEntryTools(db),
    ...registryTools(db),
    ...entityResolveTools(db),
    ...metaTools(db),
  ];
}

export function createMcpServer(db: DbPool, getActor: () => ActorContext): McpServer {
  const server = new McpServer({
    name: 'CRMy',
    version: getServerVersion(),
  });

  const tools = getAllTools(db);

  registerResources(server, db, getActor);

  for (const tool of tools) {
    server.tool(
      tool.name,
      tool.description,
      tool.inputSchema.shape,
      async (input) => {
        try {
          const actor = getActor();
          enforceToolScopes(tool.name, actor);
          const result = await tool.handler(input, actor);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          if (err instanceof CrmyError) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(err.toJSON()) }],
              isError: true,
            };
          }
          const message = err instanceof Error ? err.message : 'Internal error';
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
            isError: true,
          };
        }
      },
    );
  }

  return server;
}
