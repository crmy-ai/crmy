// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';

export function useCasesCommand(): Command {
  const cmd = new Command('use-cases').description('Manage use cases');

  cmd.command('list')
    .option('--account <id>', 'Filter by account ID')
    .option('--stage <stage>', 'Filter by stage')
    .option('-q, --query <query>', 'Search query')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('use_case_search', {
        account_id: opts.account,
        stage: opts.stage,
        query: opts.query,
        limit: 20,
      });
      const data = JSON.parse(result);
      if (data.use_cases?.length === 0) {
        console.log('No use cases found.');
        return;
      }
      console.table(data.use_cases?.map((uc: Record<string, unknown>) => ({
        id: (uc.id as string).slice(0, 8),
        name: uc.name,
        stage: uc.stage,
        arr: uc.attributed_arr ?? '',
        health: uc.health_score ?? '',
      })));
      if (data.total > 20) console.log(`\n  Showing 20 of ${data.total} use cases`);
      await client.close();
    });

  cmd.command('get <id>')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('use_case_get', { id });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('create')
    .action(async () => {
      const { default: inquirer } = await import('inquirer');
      const answers = await inquirer.prompt([
        { type: 'input', name: 'account_id', message: 'Account ID:' },
        { type: 'input', name: 'name', message: 'Use case name:' },
        { type: 'input', name: 'description', message: 'Description:' },
      ]);

      const client = await getClient();
      const result = await client.call('use_case_create', {
        account_id: answers.account_id,
        name: answers.name,
        description: answers.description || undefined,
      });
      const data = JSON.parse(result);
      console.log(`\n  Created use case: ${data.use_case.id}\n`);
      await client.close();
    });

  cmd.command('summary')
    .option('--account <id>', 'Filter by account ID')
    .option('--group-by <field>', 'Group by: stage, product_line, owner', 'stage')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('use_case_summary', {
        account_id: opts.account,
        group_by: opts.groupBy,
      });
      const data = JSON.parse(result);
      console.table(data.summary);
      await client.close();
    });

  return cmd;
}
