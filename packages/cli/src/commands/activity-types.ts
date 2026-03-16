// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';

export function activityTypesCommand(): Command {
  const cmd = new Command('activity-types').description('Manage activity type registry');

  cmd.command('list')
    .option('--category <cat>', 'Filter by category (outreach, meeting, proposal, contract, internal, lifecycle, handoff)')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('activity_type_list', { category: opts.category });
      const data = JSON.parse(result);
      if (data.activity_types?.length === 0) {
        console.log('No activity types found.');
        return;
      }
      console.table(data.activity_types?.map((t: Record<string, unknown>) => ({
        type_name: t.type_name,
        label: t.label,
        category: t.category,
        default: t.is_default ? '✓' : '',
      })));
      await client.close();
    });

  cmd.command('add <type_name>')
    .requiredOption('--label <label>', 'Display label')
    .requiredOption('--category <category>', 'Category')
    .option('--description <desc>', 'Description')
    .action(async (typeName, opts) => {
      const client = await getClient();
      const result = await client.call('activity_type_add', {
        type_name: typeName,
        label: opts.label,
        category: opts.category,
        description: opts.description,
      });
      const data = JSON.parse(result);
      console.log(`\n  Added activity type: ${data.activity_type.type_name}\n`);
      await client.close();
    });

  cmd.command('remove <type_name>')
    .description('Remove a custom activity type (cannot remove defaults)')
    .action(async (typeName) => {
      const client = await getClient();
      try {
        await client.call('activity_type_remove', { type_name: typeName });
        console.log(`\n  Removed activity type: ${typeName}\n`);
      } catch (err) {
        console.error(`\n  Error: ${err instanceof Error ? err.message : err}\n`);
      }
      await client.close();
    });

  return cmd;
}
