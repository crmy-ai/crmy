// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';

export function contextTypesCommand(): Command {
  const cmd = new Command('context-types').description('Manage context type registry');

  cmd.command('list')
    .action(async () => {
      const client = await getClient();
      const result = await client.call('context_type_list', {});
      const data = JSON.parse(result);
      if (data.context_types?.length === 0) {
        console.log('No context types found.');
        return;
      }
      console.table(data.context_types?.map((t: Record<string, unknown>) => ({
        type_name: t.type_name,
        label: t.label,
        description: ((t.description as string) ?? '').slice(0, 60),
        default: t.is_default ? '✓' : '',
      })));
      await client.close();
    });

  cmd.command('add <type_name>')
    .requiredOption('--label <label>', 'Display label')
    .option('--description <desc>', 'Description')
    .action(async (typeName, opts) => {
      const client = await getClient();
      const result = await client.call('context_type_add', {
        type_name: typeName,
        label: opts.label,
        description: opts.description,
      });
      const data = JSON.parse(result);
      console.log(`\n  Added context type: ${data.context_type.type_name}\n`);
      await client.close();
    });

  cmd.command('remove <type_name>')
    .description('Remove a custom context type (cannot remove defaults)')
    .action(async (typeName) => {
      const client = await getClient();
      try {
        await client.call('context_type_remove', { type_name: typeName });
        console.log(`\n  Removed context type: ${typeName}\n`);
      } catch (err) {
        console.error(`\n  Error: ${err instanceof Error ? err.message : err}\n`);
      }
      await client.close();
    });

  return cmd;
}
