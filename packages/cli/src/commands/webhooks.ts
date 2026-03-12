// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';

export function webhooksCommand(): Command {
  const cmd = new Command('webhooks').description('Manage webhook endpoints');

  cmd.command('list')
    .option('--active', 'Show only active webhooks')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('webhook_list', {
        active: opts.active ?? undefined,
        limit: 20,
      });
      const data = JSON.parse(result);
      if (data.webhooks?.length === 0) {
        console.log('No webhooks found.');
        return;
      }
      console.table(data.webhooks?.map((w: Record<string, unknown>) => ({
        id: (w.id as string).slice(0, 8),
        url: w.url,
        events: (w.event_types as string[])?.join(', '),
        active: w.is_active,
      })));
      await client.close();
    });

  cmd.command('get <id>')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('webhook_get', { id });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('create')
    .action(async () => {
      const { default: inquirer } = await import('inquirer');
      const answers = await inquirer.prompt([
        { type: 'input', name: 'url', message: 'Webhook URL:' },
        { type: 'input', name: 'events', message: 'Events (comma-separated):' },
        { type: 'input', name: 'description', message: 'Description:' },
      ]);

      const client = await getClient();
      const result = await client.call('webhook_create', {
        url: answers.url,
        events: answers.events.split(',').map((e: string) => e.trim()),
        description: answers.description || undefined,
      });
      const data = JSON.parse(result);
      console.log(`\n  Created webhook: ${data.webhook.id}\n`);
      console.log(`  Secret: ${data.webhook.secret}\n`);
      await client.close();
    });

  cmd.command('delete <id>')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('webhook_delete', { id });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('deliveries')
    .option('--endpoint <id>', 'Filter by endpoint ID')
    .option('--status <status>', 'Filter by status (pending, success, failed)')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('webhook_list_deliveries', {
        endpoint_id: opts.endpoint,
        status: opts.status,
        limit: 20,
      });
      const data = JSON.parse(result);
      if (data.deliveries?.length === 0) {
        console.log('No deliveries found.');
        return;
      }
      console.table(data.deliveries?.map((d: Record<string, unknown>) => ({
        id: (d.id as string).slice(0, 8),
        event_type: d.event_type,
        status: d.status,
        attempts: d.attempt_count,
        created: d.created_at,
      })));
      await client.close();
    });

  return cmd;
}
