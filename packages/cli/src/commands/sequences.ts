// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';

export function sequencesCommand(): Command {
  const cmd = new Command('sequences').description('Manage customer engagement sequences');

  cmd.command('list')
    .option('--active', 'Only active sequences')
    .option('--limit <n>', 'Max results', '20')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('sequence_list', {
        is_active: opts.active ? true : undefined,
        limit: parseInt(opts.limit, 10),
      });
      const data = JSON.parse(result);
      const rows = data.sequences ?? data.data ?? [];
      if (rows.length === 0) console.log('No sequences found.');
      else {
        console.table(rows.map((sequence: Record<string, unknown>) => ({
          id: String(sequence.id ?? '').slice(0, 8),
          name: sequence.name,
          active: sequence.is_active,
          steps: sequence.steps_count ?? sequence.step_count ?? '',
          enrollments: sequence.enrollment_count ?? '',
        })));
      }
      await client.close();
    });

  cmd.command('get <id>')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('sequence_get', { id });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('enrollments')
    .option('--sequence <id>', 'Sequence ID')
    .option('--contact <id>', 'Contact ID')
    .option('--status <status>', 'Enrollment status')
    .option('--limit <n>', 'Max results', '50')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('sequence_enrollment_list', {
        sequence_id: opts.sequence,
        contact_id: opts.contact,
        status: opts.status,
        limit: parseInt(opts.limit, 10),
      });
      const data = JSON.parse(result);
      console.table((data.enrollments ?? data.data ?? []).map((enrollment: Record<string, unknown>) => ({
        id: String(enrollment.id ?? '').slice(0, 8),
        sequence: String(enrollment.sequence_id ?? '').slice(0, 8),
        contact: String(enrollment.contact_id ?? '').slice(0, 8),
        status: enrollment.status,
        step: enrollment.current_step_index ?? '',
      })));
      await client.close();
    });

  cmd.command('enroll <sequence_id>')
    .requiredOption('--contact <id>', 'Contact ID')
    .option('--account <id>', 'Account ID')
    .option('--opportunity <id>', 'Opportunity ID')
    .action(async (sequenceId, opts) => {
      const client = await getClient();
      const result = await client.call('sequence_enroll', {
        sequence_id: sequenceId,
        contact_id: opts.contact,
        account_id: opts.account,
        opportunity_id: opts.opportunity,
      });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('unenroll <sequence_id>')
    .requiredOption('--contact <id>', 'Contact ID')
    .option('--reason <reason>', 'Reason')
    .action(async (sequenceId, opts) => {
      const client = await getClient();
      const result = await client.call('sequence_unenroll', {
        sequence_id: sequenceId,
        contact_id: opts.contact,
        reason: opts.reason,
      });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('pause <id>')
    .action(async (id) => {
      const client = await getClient();
      console.log(JSON.parse(await client.call('sequence_pause', { id })));
      await client.close();
    });

  cmd.command('resume <id>')
    .action(async (id) => {
      const client = await getClient();
      console.log(JSON.parse(await client.call('sequence_resume', { id })));
      await client.close();
    });

  cmd.command('analytics <id>')
    .option('--period <period>', 'day, week, or month', 'day')
    .option('--limit <n>', 'Max periods', '30')
    .action(async (id, opts) => {
      const client = await getClient();
      const result = await client.call('sequence_analytics', {
        sequence_id: id,
        period_type: opts.period,
        limit: parseInt(opts.limit, 10),
      });
      console.log(JSON.parse(result));
      await client.close();
    });

  return cmd;
}
