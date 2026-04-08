// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { schemaGet, tenantGetStats } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as searchRepo from '../../db/repos/search.js';
import type { ToolDef } from '../server.js';

const FIELD_SCHEMAS: Record<string, { name: string; type: string; required: boolean }[]> = {
  contact: [
    { name: 'first_name', type: 'string', required: true },
    { name: 'last_name', type: 'string', required: false },
    { name: 'email', type: 'string', required: false },
    { name: 'phone', type: 'string', required: false },
    { name: 'title', type: 'string', required: false },
    { name: 'company_name', type: 'string', required: false },
    { name: 'account_id', type: 'uuid', required: false },
    { name: 'owner_id', type: 'uuid', required: false },
    { name: 'lifecycle_stage', type: 'enum(lead,prospect,customer,churned)', required: true },
    { name: 'source', type: 'string', required: false },
    { name: 'tags', type: 'string[]', required: false },
    { name: 'custom_fields', type: 'json', required: false },
  ],
  account: [
    { name: 'name', type: 'string', required: true },
    { name: 'domain', type: 'string', required: false },
    { name: 'industry', type: 'string', required: false },
    { name: 'employee_count', type: 'integer', required: false },
    { name: 'annual_revenue', type: 'integer', required: false },
    { name: 'currency_code', type: 'string', required: false },
    { name: 'website', type: 'url', required: false },
    { name: 'parent_id', type: 'uuid', required: false },
    { name: 'owner_id', type: 'uuid', required: false },
    { name: 'health_score', type: 'integer(0-100)', required: false },
    { name: 'tags', type: 'string[]', required: false },
    { name: 'custom_fields', type: 'json', required: false },
  ],
  opportunity: [
    { name: 'name', type: 'string', required: true },
    { name: 'account_id', type: 'uuid', required: false },
    { name: 'contact_id', type: 'uuid', required: false },
    { name: 'owner_id', type: 'uuid', required: false },
    { name: 'stage', type: 'enum(prospecting,qualification,proposal,negotiation,closed_won,closed_lost)', required: true },
    { name: 'amount', type: 'integer', required: false },
    { name: 'currency_code', type: 'string', required: false },
    { name: 'close_date', type: 'date', required: false },
    { name: 'probability', type: 'integer(0-100)', required: false },
    { name: 'forecast_cat', type: 'enum(pipeline,best_case,commit,closed)', required: true },
    { name: 'description', type: 'string', required: false },
    { name: 'custom_fields', type: 'json', required: false },
  ],
  activity: [
    { name: 'type', type: 'enum(call,email,meeting,note,task)', required: true },
    { name: 'subject', type: 'string', required: true },
    { name: 'body', type: 'string', required: false },
    { name: 'status', type: 'string', required: false },
    { name: 'direction', type: 'enum(inbound,outbound)', required: false },
    { name: 'due_at', type: 'datetime', required: false },
    { name: 'completed_at', type: 'datetime', required: false },
    { name: 'contact_id', type: 'uuid', required: false },
    { name: 'account_id', type: 'uuid', required: false },
    { name: 'opportunity_id', type: 'uuid', required: false },
    { name: 'custom_fields', type: 'json', required: false },
  ],
};

export function metaTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'schema_get',
      tier: 'admin',
      description: 'Get the full schema for a CRM object type including standard fields and any custom fields defined by the tenant. Agents should call this on first connect to understand the data model — it returns field names, types, required constraints, and available options for enum fields. Pass object_type as "contact", "account", "opportunity", "activity", or "use_case".',
      inputSchema: schemaGet,
      handler: async (input: z.infer<typeof schemaGet>, _actor: ActorContext) => {
        return {
          standard_fields: FIELD_SCHEMAS[input.object_type] ?? [],
          custom_fields_schema: {},
        };
      },
    },
    {
      name: 'tenant_get_stats',
      tier: 'analytics',
      description: 'Get high-level statistics for the current tenant including total counts of contacts, accounts, opportunities, activities, and pipeline value. Useful for quick health checks and dashboard summaries.',
      inputSchema: tenantGetStats,
      handler: async (_input: z.infer<typeof tenantGetStats>, actor: ActorContext) => {
        return searchRepo.getTenantStats(db, actor.tenant_id);
      },
    },
  ];
}
