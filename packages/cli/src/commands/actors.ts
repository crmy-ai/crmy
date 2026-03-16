// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';

export function actorsCommand(): Command {
  const cmd = new Command('actors').description('Manage actors (humans & agents)');

  cmd.command('list')
    .option('--type <type>', 'Filter by actor_type (human or agent)')
    .option('-q, --query <query>', 'Search query')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('actor_list', {
        actor_type: opts.type,
        query: opts.query,
        limit: 20,
      });
      const data = JSON.parse(result);
      if (data.actors?.length === 0) {
        console.log('No actors found.');
        return;
      }
      console.table(data.actors?.map((a: Record<string, unknown>) => ({
        id: (a.id as string).slice(0, 8),
        type: a.actor_type,
        name: a.display_name,
        email: a.email ?? '',
        agent_id: a.agent_identifier ?? '',
        active: a.is_active ? '✓' : '✗',
      })));
      if (data.total > 20) console.log(`\n  Showing 20 of ${data.total} actors`);
      await client.close();
    });

  cmd.command('register')
    .description('Register a new actor')
    .action(async () => {
      const { default: inquirer } = await import('inquirer');
      const answers = await inquirer.prompt([
        { type: 'list', name: 'actor_type', message: 'Actor type:', choices: ['human', 'agent'] },
        { type: 'input', name: 'display_name', message: 'Display name:' },
        { type: 'input', name: 'email', message: 'Email (for humans):' },
        { type: 'input', name: 'agent_identifier', message: 'Agent identifier (for agents):' },
        { type: 'input', name: 'agent_model', message: 'Agent model (e.g. claude-sonnet-4-20250514):' },
      ]);

      const client = await getClient();
      const result = await client.call('actor_register', {
        actor_type: answers.actor_type,
        display_name: answers.display_name,
        email: answers.email || undefined,
        agent_identifier: answers.agent_identifier || undefined,
        agent_model: answers.agent_model || undefined,
      });
      const data = JSON.parse(result);
      console.log(`\n  Registered actor: ${data.actor.id}\n`);
      await client.close();
    });

  cmd.command('get <id>')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('actor_get', { id });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('whoami')
    .description('Show current actor identity')
    .action(async () => {
      const client = await getClient();
      const result = await client.call('actor_whoami', {});
      console.log(JSON.parse(result));
      await client.close();
    });

  return cmd;
}
