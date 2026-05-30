// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function resolveHitlRef(client: Awaited<ReturnType<typeof getClient>>, ref: string): Promise<string> {
  if (isUuid(ref)) return ref;
  const result = await client.call('hitl_list_pending', { limit: 100 });
  const data = JSON.parse(result);
  const requests = (data.requests ?? data.data ?? (Array.isArray(data) ? data : [])) as Record<string, unknown>[];
  const matches = requests.filter((request) => String(request.id ?? '').startsWith(ref));
  if (matches.length === 1) return String(matches[0].id);
  if (matches.length > 1) throw new Error(`Handoff ID "${ref}" is ambiguous. Use more characters from the ID.`);
  throw new Error(`No pending Handoff found with ID prefix "${ref}". Run \`crmy hitl list\`.`);
}

export function hitlCommand(): Command {
  const cmd = new Command('hitl').description('Manage HITL approval requests');

  cmd.command('list')
    .action(async () => {
      const client = await getClient();
      const result = await client.call('hitl_list_pending', { limit: 20 });
      const data = JSON.parse(result);
      const requests = data.requests ?? data.data ?? (Array.isArray(data) ? data : []);
      if (requests.length === 0) {
        console.log('No pending HITL requests.');
        await client.close();
        return;
      }
      console.table(requests.map((r: Record<string, unknown>) => ({
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
      const requestId = await resolveHitlRef(client, id);
      const result = await client.call('hitl_resolve', { request_id: requestId, decision: 'approved' });
      const data = JSON.parse(result);
      console.log('Approved:', data.request.id);
      if (data.completed_action) console.log('Completed action:', data.completed_action);
      await client.close();
    });

  cmd.command('reject <id>')
    .option('--note <note>', 'Rejection note')
    .action(async (id, opts) => {
      const client = await getClient();
      const requestId = await resolveHitlRef(client, id);
      const result = await client.call('hitl_resolve', {
        request_id: requestId,
        decision: 'rejected',
        note: opts.note,
      });
      console.log('Rejected:', JSON.parse(result).request.id);
      await client.close();
    });

  return cmd;
}
