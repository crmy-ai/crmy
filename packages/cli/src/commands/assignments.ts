// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';

export function assignmentsCommand(): Command {
  const cmd = new Command('assignments').description('Manage assignments (coordination & handoffs)');

  cmd.command('list')
    .option('--mine', 'Show assignments assigned to me')
    .option('--delegated', 'Show assignments I created')
    .option('--status <status>', 'Filter by status')
    .option('--priority <priority>', 'Filter by priority')
    .action(async (opts) => {
      const client = await getClient();
      const input: Record<string, unknown> = { limit: 20 };

      if (opts.mine) {
        const whoami = JSON.parse(await client.call('actor_whoami', {}));
        input.assigned_to = whoami.actor_id;
      }
      if (opts.delegated) {
        const whoami = JSON.parse(await client.call('actor_whoami', {}));
        input.assigned_by = whoami.actor_id;
      }
      if (opts.status) input.status = opts.status;
      if (opts.priority) input.priority = opts.priority;

      const result = await client.call('assignment_list', input);
      const data = JSON.parse(result);
      if (data.assignments?.length === 0) {
        console.log('No assignments found.');
        return;
      }
      console.table(data.assignments?.map((a: Record<string, unknown>) => ({
        id: (a.id as string).slice(0, 8),
        title: (a.title as string).slice(0, 40),
        type: a.assignment_type,
        status: a.status,
        priority: a.priority,
        subject: `${a.subject_type}:${(a.subject_id as string).slice(0, 8)}`,
      })));
      if (data.total > 20) console.log(`\n  Showing 20 of ${data.total} assignments`);
      await client.close();
    });

  cmd.command('create')
    .description('Create a new assignment')
    .action(async () => {
      const { default: inquirer } = await import('inquirer');
      const answers = await inquirer.prompt([
        { type: 'input', name: 'title', message: 'Title:' },
        { type: 'input', name: 'description', message: 'Description:' },
        { type: 'list', name: 'assignment_type', message: 'Type:', choices: ['follow_up', 'review', 'approve', 'send', 'call', 'meet', 'research', 'draft', 'custom'] },
        { type: 'input', name: 'assigned_to', message: 'Assign to (actor UUID):' },
        { type: 'list', name: 'subject_type', message: 'Subject type:', choices: ['contact', 'account', 'opportunity', 'use_case'] },
        { type: 'input', name: 'subject_id', message: 'Subject ID (UUID):' },
        { type: 'list', name: 'priority', message: 'Priority:', choices: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
        { type: 'input', name: 'context', message: 'Context / handoff notes:' },
      ]);

      const client = await getClient();
      const result = await client.call('assignment_create', {
        title: answers.title,
        description: answers.description || undefined,
        assignment_type: answers.assignment_type,
        assigned_to: answers.assigned_to,
        subject_type: answers.subject_type,
        subject_id: answers.subject_id,
        priority: answers.priority,
        context: answers.context || undefined,
      });
      const data = JSON.parse(result);
      console.log(`\n  Created assignment: ${data.assignment.id}\n`);
      await client.close();
    });

  cmd.command('get <id>')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('assignment_get', { id });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('accept <id>')
    .description('Accept a pending assignment')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('assignment_accept', { id });
      const data = JSON.parse(result);
      console.log(`\n  Accepted assignment: ${data.assignment.id} (status: ${data.assignment.status})\n`);
      await client.close();
    });

  cmd.command('complete <id>')
    .option('--activity <activityId>', 'Link the completing activity')
    .description('Complete an assignment')
    .action(async (id, opts) => {
      const client = await getClient();
      const result = await client.call('assignment_complete', {
        id,
        completed_by_activity_id: opts.activity || undefined,
      });
      const data = JSON.parse(result);
      console.log(`\n  Completed assignment: ${data.assignment.id}\n`);
      await client.close();
    });

  cmd.command('decline <id>')
    .option('-r, --reason <reason>', 'Reason for declining')
    .description('Decline an assignment')
    .action(async (id, opts) => {
      const client = await getClient();
      const result = await client.call('assignment_decline', {
        id,
        reason: opts.reason || undefined,
      });
      const data = JSON.parse(result);
      console.log(`\n  Declined assignment: ${data.assignment.id}\n`);
      await client.close();
    });

  return cmd;
}
