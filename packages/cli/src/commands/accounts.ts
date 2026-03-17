// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';

export function accountsCommand(): Command {
  const cmd = new Command('accounts').description('Manage accounts');

  cmd.command('list')
    .option('-q, --query <query>', 'Search query')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('account_search', { query: opts.query, limit: 20 });
      const data = JSON.parse(result);
      if (data.accounts?.length === 0) {
        console.log('No accounts found.');
        return;
      }
      console.table(data.accounts?.map((a: Record<string, unknown>) => ({
        id: (a.id as string).slice(0, 8),
        name: a.name,
        industry: a.industry ?? '',
        health: a.health_score ?? '',
      })));
      await client.close();
    });

  cmd.command('get <id>')
    .description('Get account details including contacts and open opportunities')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('account_get', { id });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('create')
    .description('Create a new account')
    .action(async () => {
      const { default: inquirer } = await import('inquirer');
      const answers = await inquirer.prompt([
        { type: 'input', name: 'name', message: 'Account name:' },
        { type: 'input', name: 'domain', message: 'Domain (optional):' },
        { type: 'input', name: 'industry', message: 'Industry (optional):' },
        { type: 'input', name: 'website', message: 'Website (optional):' },
      ]);

      const client = await getClient();
      const result = await client.call('account_create', {
        name: answers.name,
        domain: answers.domain || undefined,
        industry: answers.industry || undefined,
        website: answers.website || undefined,
      });
      const data = JSON.parse(result);
      console.log(`\n  Created account: ${data.account.id}\n`);
      await client.close();
    });

  cmd.command('delete <id>')
    .description('Permanently delete an account (admin/owner only)')
    .action(async (id) => {
      const { default: inquirer } = await import('inquirer');
      const { confirm } = await inquirer.prompt([
        { type: 'confirm', name: 'confirm', message: `Delete account ${id}? This cannot be undone.`, default: false },
      ]);
      if (!confirm) { console.log('  Cancelled.'); return; }

      const client = await getClient();
      const result = await client.call('account_delete', { id });
      const data = JSON.parse(result);
      if (data.deleted) console.log(`  Deleted.`);
      await client.close();
    });

  return cmd;
}
