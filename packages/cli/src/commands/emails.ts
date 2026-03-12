// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';

export function emailsCommand(): Command {
  const cmd = new Command('emails').description('Manage outbound emails');

  cmd.command('list')
    .option('--contact <id>', 'Filter by contact ID')
    .option('--status <status>', 'Filter by status')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('email_search', {
        contact_id: opts.contact,
        status: opts.status,
        limit: 20,
      });
      const data = JSON.parse(result);
      if (data.emails?.length === 0) {
        console.log('No emails found.');
        return;
      }
      console.table(data.emails?.map((e: Record<string, unknown>) => ({
        id: (e.id as string).slice(0, 8),
        to: e.to_email,
        subject: e.subject,
        status: e.status,
        created: e.created_at,
      })));
      await client.close();
    });

  cmd.command('get <id>')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('email_get', { id });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('create')
    .action(async () => {
      const { default: inquirer } = await import('inquirer');
      const answers = await inquirer.prompt([
        { type: 'input', name: 'to_address', message: 'To (email):' },
        { type: 'input', name: 'subject', message: 'Subject:' },
        { type: 'input', name: 'body_text', message: 'Body:' },
        { type: 'input', name: 'contact_id', message: 'Contact ID (optional):' },
        { type: 'confirm', name: 'require_approval', message: 'Require HITL approval?', default: true },
      ]);

      const client = await getClient();
      const result = await client.call('email_create', {
        to_address: answers.to_address,
        subject: answers.subject,
        body_text: answers.body_text,
        contact_id: answers.contact_id || undefined,
        require_approval: answers.require_approval,
      });
      const data = JSON.parse(result);
      console.log(`\n  Created email: ${data.email.id}  status: ${data.email.status}\n`);
      if (data.hitl_request_id) {
        console.log(`  HITL approval required: ${data.hitl_request_id}\n`);
      }
      await client.close();
    });

  return cmd;
}
