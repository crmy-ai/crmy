// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';

export function contactsCommand(): Command {
  const cmd = new Command('contacts').description('Manage contacts');

  cmd.command('list')
    .option('-q, --query <query>', 'Search query')
    .option('--stage <stage>', 'Filter by lifecycle stage')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('contact_search', {
        query: opts.query,
        lifecycle_stage: opts.stage,
        limit: 20,
      });
      const data = JSON.parse(result);
      if (data.contacts?.length === 0) {
        console.log('No contacts found.');
        return;
      }
      console.table(data.contacts?.map((c: Record<string, unknown>) => ({
        id: (c.id as string).slice(0, 8),
        name: `${c.first_name} ${c.last_name}`,
        email: c.email ?? '',
        stage: c.lifecycle_stage,
        company: c.company_name ?? '',
      })));
      if (data.total > 20) console.log(`\n  Showing 20 of ${data.total} contacts`);
      await client.close();
    });

  cmd.command('get <id>')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('contact_get', { id });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('create')
    .action(async () => {
      const { default: inquirer } = await import('inquirer');
      const answers = await inquirer.prompt([
        { type: 'input', name: 'first_name', message: 'First name:' },
        { type: 'input', name: 'last_name', message: 'Last name:' },
        { type: 'input', name: 'email', message: 'Email:' },
        { type: 'input', name: 'company_name', message: 'Company:' },
      ]);

      const client = await getClient();
      const result = await client.call('contact_create', {
        first_name: answers.first_name,
        last_name: answers.last_name || undefined,
        email: answers.email || undefined,
        company_name: answers.company_name || undefined,
      });
      const data = JSON.parse(result);
      console.log(`\n  Created contact: ${data.contact.id}\n`);
      await client.close();
    });

  return cmd;
}
