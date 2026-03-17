// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';

export function oppsCommand(): Command {
  const cmd = new Command('opps').description('Manage opportunities');

  cmd.command('list')
    .option('--stage <stage>', 'Filter by stage')
    .option('-q, --query <query>', 'Search query')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('opportunity_search', { query: opts.query, stage: opts.stage, limit: 20 });
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
      if (data.total > 20) console.log(`\n  Showing 20 of ${data.total} opportunities`);
      await client.close();
    });

  cmd.command('get <id>')
    .description('Get opportunity details')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('opportunity_get', { id });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('create')
    .description('Create a new opportunity')
    .action(async () => {
      const { default: inquirer } = await import('inquirer');
      const answers = await inquirer.prompt([
        { type: 'input', name: 'name', message: 'Opportunity name:' },
        { type: 'input', name: 'account_id', message: 'Account ID (optional):' },
        { type: 'input', name: 'amount', message: 'Amount (optional):' },
        {
          type: 'list',
          name: 'stage',
          message: 'Stage:',
          choices: ['prospecting', 'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost'],
          default: 'prospecting',
        },
        { type: 'input', name: 'close_date', message: 'Close date YYYY-MM-DD (optional):' },
      ]);

      const client = await getClient();
      const result = await client.call('opportunity_create', {
        name: answers.name,
        account_id: answers.account_id || undefined,
        amount: answers.amount ? parseFloat(answers.amount) : undefined,
        stage: answers.stage,
        close_date: answers.close_date || undefined,
      });
      const data = JSON.parse(result);
      console.log(`\n  Created opportunity: ${data.opportunity.id}\n`);
      await client.close();
    });

  cmd.command('advance <id> <stage>')
    .description('Advance opportunity to a new stage')
    .option('--note <note>', 'Optional note')
    .option('--lost-reason <reason>', 'Required when stage is closed_lost')
    .action(async (id, stage, opts) => {
      const client = await getClient();
      const result = await client.call('opportunity_advance_stage', {
        id,
        stage,
        note: opts.note,
        lost_reason: opts.lostReason,
      });
      const data = JSON.parse(result);
      console.log(`  Stage updated to: ${data.opportunity.stage}`);
      await client.close();
    });

  cmd.command('delete <id>')
    .description('Permanently delete an opportunity (admin/owner only)')
    .action(async (id) => {
      const { default: inquirer } = await import('inquirer');
      const { confirm } = await inquirer.prompt([
        { type: 'confirm', name: 'confirm', message: `Delete opportunity ${id}? This cannot be undone.`, default: false },
      ]);
      if (!confirm) { console.log('  Cancelled.'); return; }

      const client = await getClient();
      const result = await client.call('opportunity_delete', { id });
      const data = JSON.parse(result);
      if (data.deleted) console.log(`  Deleted.`);
      await client.close();
    });

  return cmd;
}
