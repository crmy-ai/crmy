import { Command } from 'commander';
import { getClient } from '../client.js';

export function searchCommand(): Command {
  return new Command('search')
    .description('Cross-entity search')
    .argument('<query>', 'Search query')
    .action(async (query) => {
      const client = await getClient();
      const result = await client.call('crm_search', { query, limit: 10 });
      const data = JSON.parse(result);

      if (data.contacts?.length > 0) {
        console.log('\n  Contacts:');
        console.table(data.contacts.map((c: Record<string, unknown>) => ({
          id: (c.id as string).slice(0, 8),
          name: `${c.first_name} ${c.last_name}`,
          email: c.email ?? '',
        })));
      }
      if (data.accounts?.length > 0) {
        console.log('\n  Accounts:');
        console.table(data.accounts.map((a: Record<string, unknown>) => ({
          id: (a.id as string).slice(0, 8),
          name: a.name,
        })));
      }
      if (data.opportunities?.length > 0) {
        console.log('\n  Opportunities:');
        console.table(data.opportunities.map((o: Record<string, unknown>) => ({
          id: (o.id as string).slice(0, 8),
          name: o.name,
          stage: o.stage,
        })));
      }

      const total = (data.contacts?.length ?? 0) + (data.accounts?.length ?? 0) + (data.opportunities?.length ?? 0);
      if (total === 0) console.log('  No results found.');

      await client.close();
    });
}
