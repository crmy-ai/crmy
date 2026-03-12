// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';

export function workflowsCommand(): Command {
  const cmd = new Command('workflows').description('Manage automation workflows');

  cmd.command('list')
    .option('--trigger <event>', 'Filter by trigger event')
    .option('--active', 'Show only active workflows')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('workflow_list', {
        trigger_event: opts.trigger,
        is_active: opts.active ?? undefined,
        limit: 20,
      });
      const data = JSON.parse(result);
      if (data.workflows?.length === 0) {
        console.log('No workflows found.');
        return;
      }
      console.table(data.workflows?.map((w: Record<string, unknown>) => ({
        id: (w.id as string).slice(0, 8),
        name: w.name,
        trigger: w.trigger_event,
        active: w.is_active,
        runs: w.run_count,
      })));
      await client.close();
    });

  cmd.command('get <id>')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('workflow_get', { id });
      const data = JSON.parse(result);
      console.log('\nWorkflow:', data.workflow.name);
      console.log('Trigger:', data.workflow.trigger_event);
      console.log('Active:', data.workflow.is_active);
      console.log('Actions:', JSON.stringify(data.workflow.actions, null, 2));
      if (data.recent_runs?.length > 0) {
        console.log('\nRecent runs:');
        console.table(data.recent_runs.map((r: Record<string, unknown>) => ({
          id: (r.id as string).slice(0, 8),
          status: r.status,
          actions: `${r.actions_run}/${r.actions_total}`,
          started: r.started_at,
        })));
      }
      await client.close();
    });

  cmd.command('create')
    .action(async () => {
      const { default: inquirer } = await import('inquirer');
      const answers = await inquirer.prompt([
        { type: 'input', name: 'name', message: 'Workflow name:' },
        { type: 'input', name: 'trigger_event', message: 'Trigger event (e.g. contact.created):' },
        { type: 'input', name: 'description', message: 'Description:' },
      ]);

      // Simple single-action workflow via interactive prompt
      const actionAnswers = await inquirer.prompt([
        {
          type: 'list', name: 'type', message: 'Action type:',
          choices: ['send_notification', 'create_activity', 'create_note', 'add_tag', 'webhook'],
        },
        { type: 'input', name: 'message', message: 'Action message/body:' },
      ]);

      const client = await getClient();
      const result = await client.call('workflow_create', {
        name: answers.name,
        description: answers.description || undefined,
        trigger_event: answers.trigger_event,
        actions: [{ type: actionAnswers.type, config: { message: actionAnswers.message } }],
      });
      const data = JSON.parse(result);
      console.log(`\n  Created workflow: ${data.workflow.id}\n`);
      await client.close();
    });

  cmd.command('delete <id>')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('workflow_delete', { id });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('runs <workflow_id>')
    .option('--status <status>', 'Filter: running, completed, failed')
    .action(async (workflowId, opts) => {
      const client = await getClient();
      const result = await client.call('workflow_run_list', {
        workflow_id: workflowId,
        status: opts.status,
        limit: 20,
      });
      const data = JSON.parse(result);
      if (data.runs?.length === 0) {
        console.log('No runs found.');
        return;
      }
      console.table(data.runs?.map((r: Record<string, unknown>) => ({
        id: (r.id as string).slice(0, 8),
        status: r.status,
        actions: `${r.actions_run}/${r.actions_total}`,
        error: r.error ?? '',
        started: r.started_at,
      })));
      await client.close();
    });

  return cmd;
}
