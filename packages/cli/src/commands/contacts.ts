// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';
import { resolveRecordRef } from './subject-ref.js';

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
        account: c.account_name ?? c.company_name ?? '',
      })));
      if (data.total > 20) console.log(`\n  Showing 20 of ${data.total} contacts`);
      await client.close();
    });

  cmd.command('get <contact>')
    .description('Get contact details by name, email, or ID')
    .action(async (contact) => {
      const client = await getClient();
      const id = await resolveRecordRef(client, 'contact', contact);
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
        { type: 'input', name: 'company_name', message: 'Account name:' },
      ]);

      const client = await getClient();
      let account_id: string | undefined;
      if (answers.company_name) {
        try {
          account_id = await resolveRecordRef(client, 'account', answers.company_name);
        } catch {
          // Keep the free-text company name when no matching account exists.
        }
      }
      const result = await client.call('contact_create', {
        first_name: answers.first_name,
        last_name: answers.last_name || undefined,
        email: answers.email || undefined,
        company_name: answers.company_name || undefined,
        account_id,
      });
      const data = JSON.parse(result);
      console.log(`\n  Created contact: ${data.contact.id}\n`);
      await client.close();
    });

  cmd.command('delete <contact>')
    .description('Permanently delete a contact (admin/owner only)')
    .action(async (contact) => {
      const { default: inquirer } = await import('inquirer');
      const client = await getClient();
      const id = await resolveRecordRef(client, 'contact', contact);
      const { confirm } = await inquirer.prompt([
        { type: 'confirm', name: 'confirm', message: `Delete contact ${contact}? This cannot be undone.`, default: false },
      ]);
      if (!confirm) { console.log('  Cancelled.'); await client.close(); return; }

      const result = await client.call('contact_delete', { id });
      const data = JSON.parse(result);
      if (data.deleted) console.log(`  Deleted.`);
      await client.close();
    });

  return cmd;
}
