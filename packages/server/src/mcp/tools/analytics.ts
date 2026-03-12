// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { crmSearch, pipelineForecast, accountHealthReport } from '@crmy/shared';
import type { DbPool } from '../../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import * as searchRepo from '../../db/repos/search.js';
import * as oppRepo from '../../db/repos/opportunities.js';
import { notFound } from '@crmy/shared';
import type { ToolDef } from '../server.js';
import type { z } from 'zod';

export function analyticsTools(db: DbPool): ToolDef[] {
  return [
    {
      name: 'crm_search',
      description: 'Search across all CRM entities (contacts, accounts, opportunities) with a single query',
      inputSchema: crmSearch,
      handler: async (input: z.infer<typeof crmSearch>, actor: ActorContext) => {
        return searchRepo.crmSearch(db, actor.tenant_id, input.query, input.limit ?? 10);
      },
    },
    {
      name: 'pipeline_forecast',
      description: 'Get pipeline forecast with win rate, average deal size, and cycle time',
      inputSchema: pipelineForecast,
      handler: async (input: z.infer<typeof pipelineForecast>, actor: ActorContext) => {
        return oppRepo.getPipelineForecast(db, actor.tenant_id, {
          period: input.period ?? 'quarter',
          owner_id: input.owner_id,
        });
      },
    },
    {
      name: 'account_health_report',
      description: 'Get a health report for an account including open opportunities, activity metrics, and contact count',
      inputSchema: accountHealthReport,
      handler: async (input: z.infer<typeof accountHealthReport>, actor: ActorContext) => {
        const report = await searchRepo.getAccountHealthReport(db, actor.tenant_id, input.account_id);
        if (report.health_score === 0 && report.contact_count === 0 && report.open_opps === 0) {
          // Check if account even exists
          const { getAccount } = await import('../../db/repos/accounts.js');
          const account = await getAccount(db, actor.tenant_id, input.account_id);
          if (!account) throw notFound('Account', input.account_id);
        }
        return report;
      },
    },
  ];
}
