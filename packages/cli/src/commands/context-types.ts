// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';

function numericOption(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

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
        freshness_days: t.default_freshness_days,
        claim_tier: t.claim_tier,
        default: t.is_default ? '✓' : '',
      })));
      await client.close();
    });

  cmd.command('add <type_name>')
    .requiredOption('--label <label>', 'Display label')
    .option('--description <desc>', 'Description')
    .option('--freshness-days <days>', 'Default review window in days')
    .option('--claim-tier <tier>', 'Promotion risk tier: 0, 1, or 2')
    .action(async (typeName, opts) => {
      const client = await getClient();
      const freshnessDays = numericOption(opts.freshnessDays);
      const claimTier = numericOption(opts.claimTier);
      const result = await client.call('context_type_add', {
        type_name: typeName,
        label: opts.label,
        description: opts.description,
        ...(freshnessDays !== undefined ? { default_freshness_days: Math.round(freshnessDays) } : {}),
        ...(claimTier === 0 || claimTier === 1 || claimTier === 2 ? { claim_tier: claimTier } : {}),
      });
      const data = JSON.parse(result);
      console.log(`\n  Added context type: ${data.context_type.type_name}\n`);
      await client.close();
    });

  cmd.command('update <type_name>')
    .description('Update governed context type trust settings')
    .option('--label <label>', 'Display label')
    .option('--description <desc>', 'Description')
    .option('--freshness-days <days>', 'Default review window in days')
    .option('--claim-tier <tier>', 'Promotion risk tier: 0, 1, or 2')
    .option('--priority-weight <weight>', 'Briefing priority weight')
    .option('--confidence-half-life-days <days>', 'Confidence decay half-life in days')
    .action(async (typeName, opts) => {
      const client = await getClient();
      const patch: Record<string, unknown> = { type_name: typeName };
      if (opts.label !== undefined) patch.label = opts.label;
      if (opts.description !== undefined) patch.description = opts.description;
      const freshnessDays = numericOption(opts.freshnessDays);
      if (freshnessDays !== undefined) patch.default_freshness_days = Math.round(freshnessDays);
      const claimTier = numericOption(opts.claimTier);
      if (claimTier === 0 || claimTier === 1 || claimTier === 2) patch.claim_tier = claimTier;
      const priorityWeight = numericOption(opts.priorityWeight);
      if (priorityWeight !== undefined) patch.priority_weight = priorityWeight;
      const halfLife = numericOption(opts.confidenceHalfLifeDays);
      if (halfLife !== undefined) patch.confidence_half_life_days = Math.round(halfLife);
      const result = await client.call('context_type_update', patch);
      const data = JSON.parse(result);
      console.log(`\n  Updated context type: ${data.context_type.type_name}\n`);
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
