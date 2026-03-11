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
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('account_get', { id });
      console.log(JSON.parse(result));
      await client.close();
    });

  return cmd;
}
