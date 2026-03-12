// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';

export function hitlCommand(): Command {
  const cmd = new Command('hitl').description('Manage HITL approval requests');

  cmd.command('list')
    .action(async () => {
      const client = await getClient();
      const result = await client.call('hitl_list_pending', { limit: 20 });
      const data = JSON.parse(result);
      if (data.requests?.length === 0) {
        console.log('No pending HITL requests.');
        return;
      }
      console.table(data.requests.map((r: Record<string, unknown>) => ({
        id: (r.id as string).slice(0, 8),
        type: r.action_type,
        summary: r.action_summary,
        created: r.created_at,
      })));
      await client.close();
    });

  cmd.command('approve <id>')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('hitl_resolve', { request_id: id, decision: 'approved' });
      console.log('Approved:', JSON.parse(result).request.id);
      await client.close();
    });

  cmd.command('reject <id>')
    .option('--note <note>', 'Rejection note')
    .action(async (id, opts) => {
      const client = await getClient();
      const result = await client.call('hitl_resolve', {
        request_id: id,
        decision: 'rejected',
        note: opts.note,
      });
      console.log('Rejected:', JSON.parse(result).request.id);
      await client.close();
    });

  return cmd;
}
