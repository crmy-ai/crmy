// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';

export function customFieldsCommand(): Command {
  const cmd = new Command('custom-fields').description('Manage custom field definitions');

  cmd.command('list <object_type>')
    .description('List custom fields for an object type (contact, account, opportunity, activity, use_case)')
    .action(async (objectType) => {
      const client = await getClient();
      const result = await client.call('custom_field_list', { object_type: objectType });
      const data = JSON.parse(result);
      if (data.fields?.length === 0) {
        console.log(`No custom fields defined for ${objectType}.`);
        return;
      }
      console.table(data.fields?.map((f: Record<string, unknown>) => ({
        id: (f.id as string).slice(0, 8),
        key: f.field_key,
        label: f.label,
        type: f.field_type,
        required: f.is_required,
      })));
      await client.close();
    });

  cmd.command('create')
    .action(async () => {
      const { default: inquirer } = await import('inquirer');
      const answers = await inquirer.prompt([
        {
          type: 'list', name: 'object_type', message: 'Object type:',
          choices: ['contact', 'account', 'opportunity', 'activity', 'use_case'],
        },
        { type: 'input', name: 'field_name', message: 'Field key (snake_case):' },
        { type: 'input', name: 'label', message: 'Display label:' },
        {
          type: 'list', name: 'field_type', message: 'Field type:',
          choices: ['text', 'number', 'boolean', 'date', 'select', 'multi_select'],
        },
        { type: 'confirm', name: 'required', message: 'Required?', default: false },
      ]);

      const client = await getClient();
      const result = await client.call('custom_field_create', answers);
      const data = JSON.parse(result);
      console.log(`\n  Created custom field: ${data.field.id}\n`);
      await client.close();
    });

  cmd.command('delete <id>')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('custom_field_delete', { id });
      console.log(JSON.parse(result));
      await client.close();
    });

  return cmd;
}
