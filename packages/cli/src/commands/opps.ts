// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';

export function oppsCommand(): Command {
  const cmd = new Command('opps').description('Manage opportunities');

  cmd.command('list')
    .option('--stage <stage>', 'Filter by stage')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('opportunity_search', { stage: opts.stage, limit: 20 });
      const data = JSON.parse(result);
      if (data.opportunities?.length === 0) {
        console.log('No opportunities found.');
        return;
      }
      console.table(data.opportunities?.map((o: Record<string, unknown>) => ({
        id: (o.id as string).slice(0, 8),
        name: o.name,
        stage: o.stage,
        amount: o.amount ?? 0,
        close_date: o.close_date ?? '',
      })));
      await client.close();
    });

  cmd.command('advance <id> <stage>')
    .action(async (id, stage) => {
      const client = await getClient();
      const result = await client.call('opportunity_advance_stage', { id, stage });
      const data = JSON.parse(result);
      console.log(`  Stage updated to: ${data.opportunity.stage}`);
      await client.close();
    });

  return cmd;
}
