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
      tier: 'core',
      description: 'Search across all CRM entities — contacts, accounts, and opportunities — with a single query string. Returns results grouped by entity type, ranked by relevance. Use this for broad discovery when you do not know which entity type holds the information you need.',
      inputSchema: crmSearch,
      handler: async (input: z.infer<typeof crmSearch>, actor: ActorContext) => {
        return searchRepo.crmSearch(db, actor.tenant_id, input.query, input.limit ?? 10);
      },
    },
    {
      name: 'pipeline_forecast',
      tier: 'analytics',
      description: 'Get a weighted pipeline forecast showing projected ARR by stage across all open opportunities, along with historical win rates, average deal size, and sales cycle time. Use this for weekly pipeline reviews, board reporting, and identifying gaps in pipeline coverage. Returns both raw totals and probability-weighted values.',
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
      tier: 'analytics',
      description: 'Get a comprehensive health report for an account showing open opportunities, recent activity metrics, contact count, health score trend, and engagement indicators. Use this to surface accounts with declining health scores that need proactive attention or to prepare for account reviews.',
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
