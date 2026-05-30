// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';
import { resolveSubjectRef } from './subject-ref.js';
import { resolveShortId } from './id-ref.js';

async function resolveWorkflowId(client: Awaited<ReturnType<typeof getClient>>, id: string): Promise<string> {
  return resolveShortId(client, id, {
    label: 'workflow',
    listTool: 'workflow_list',
    listInput: { limit: 100 },
    responseKeys: ['workflows', 'data'],
    helpCommand: 'crmy workflows list',
  });
}

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
      const workflowId = await resolveWorkflowId(client, id);
      const result = await client.call('workflow_get', { id: workflowId });
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
          choices: ['send_notification', 'create_activity', 'create_context_entry', 'add_tag', 'webhook'],
        },
        { type: 'input', name: 'message', message: 'Action message/body:' },
      ]);

      const client = await getClient();
      const config = actionAnswers.type === 'create_context_entry'
        ? { body: actionAnswers.message, context_type: 'note' }
        : { message: actionAnswers.message };
      const result = await client.call('workflow_create', {
        name: answers.name,
        description: answers.description || undefined,
        trigger_event: answers.trigger_event,
        actions: [{ type: actionAnswers.type, config }],
      });
      const data = JSON.parse(result);
      console.log(`\n  Created workflow: ${data.workflow.id}\n`);
      await client.close();
    });

  cmd.command('delete <id>')
    .action(async (id) => {
      const client = await getClient();
      const workflowId = await resolveWorkflowId(client, id);
      const result = await client.call('workflow_delete', { id: workflowId });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('update <id>')
    .description('Update workflow metadata or active state')
    .option('--name <name>', 'Workflow name')
    .option('--description <description>', 'Workflow description')
    .option('--active', 'Mark active')
    .option('--inactive', 'Mark inactive')
    .action(async (id, opts) => {
      const patch: Record<string, unknown> = {};
      if (opts.name) patch.name = opts.name;
      if (opts.description) patch.description = opts.description;
      if (opts.active) patch.is_active = true;
      if (opts.inactive) patch.is_active = false;
      const client = await getClient();
      const workflowId = await resolveWorkflowId(client, id);
      const result = await client.call('workflow_update', { id: workflowId, patch });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('test <id>')
    .description('Dry-run a workflow with optional sample payload')
    .option('--payload <json>', 'Sample payload JSON', '{}')
    .action(async (id, opts) => {
      const sample_payload = JSON.parse(opts.payload);
      const client = await getClient();
      const workflowId = await resolveWorkflowId(client, id);
      const result = await client.call('workflow_test', { id: workflowId, sample_payload });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('clone <id>')
    .description('Clone a workflow')
    .option('--name <name>', 'Name for the clone')
    .action(async (id, opts) => {
      const client = await getClient();
      const workflowId = await resolveWorkflowId(client, id);
      const result = await client.call('workflow_clone', { id: workflowId, name: opts.name });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('trigger <id>')
    .description('Trigger a workflow manually')
    .option('--subject <type:name|type:id>', 'Subject record')
    .option('--objective <text>', 'Run objective')
    .option('--variables <json>', 'Variables JSON', '{}')
    .action(async (id, opts) => {
      const client = await getClient();
      const subject = opts.subject ? await resolveSubjectRef(client, opts.subject) : {};
      const workflowId = await resolveWorkflowId(client, id);
      const result = await client.call('workflow_trigger', {
        id: workflowId,
        subject_type: subject.subject_type,
        subject_id: subject.subject_id,
        objective: opts.objective,
        variables: JSON.parse(opts.variables),
      });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('runs <workflow_id>')
    .option('--status <status>', 'Filter: running, completed, failed')
    .action(async (workflowId, opts) => {
      const client = await getClient();
      const resolvedWorkflowId = await resolveWorkflowId(client, workflowId);
      const result = await client.call('workflow_run_list', {
        workflow_id: resolvedWorkflowId,
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
