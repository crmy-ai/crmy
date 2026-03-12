// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';

export function notesCommand(): Command {
  const cmd = new Command('notes').description('Manage notes and comments on CRM objects');

  cmd.command('list <object_type> <object_id>')
    .description('List notes for an object (contact, account, opportunity, use_case)')
    .option('--visibility <vis>', 'Filter: internal or external')
    .option('--pinned', 'Show only pinned notes')
    .action(async (objectType, objectId, opts) => {
      const client = await getClient();
      const result = await client.call('note_list', {
        object_type: objectType,
        object_id: objectId,
        visibility: opts.visibility,
        pinned: opts.pinned ?? undefined,
        limit: 20,
      });
      const data = JSON.parse(result);
      if (data.notes?.length === 0) {
        console.log('No notes found.');
        return;
      }
      for (const n of data.notes ?? []) {
        const pin = n.pinned ? ' 📌' : '';
        const vis = n.visibility === 'external' ? ' [external]' : '';
        console.log(`  [${(n.id as string).slice(0, 8)}]${pin}${vis} ${n.author_type}/${n.author_id ?? 'anon'}`);
        console.log(`    ${n.body.slice(0, 120)}`);
        console.log(`    ${n.created_at}\n`);
      }
      if (data.total > 20) console.log(`  Showing 20 of ${data.total} notes`);
      await client.close();
    });

  cmd.command('add <object_type> <object_id>')
    .description('Add a note to an object')
    .option('--parent <id>', 'Reply to a note (thread)')
    .option('--external', 'Make note visible externally')
    .option('--pin', 'Pin this note')
    .action(async (objectType, objectId, opts) => {
      const { default: inquirer } = await import('inquirer');
      const answers = await inquirer.prompt([
        { type: 'input', name: 'body', message: 'Note:' },
      ]);

      const client = await getClient();
      const result = await client.call('note_create', {
        object_type: objectType,
        object_id: objectId,
        body: answers.body,
        parent_id: opts.parent,
        visibility: opts.external ? 'external' : 'internal',
        pinned: opts.pin ?? false,
      });
      const data = JSON.parse(result);
      console.log(`\n  Note created: ${data.note.id}\n`);
      await client.close();
    });

  cmd.command('get <id>')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('note_get', { id });
      const data = JSON.parse(result);
      console.log(`\n  ${data.note.body}\n`);
      if (data.replies?.length > 0) {
        console.log(`  ${data.replies.length} replies:`);
        for (const r of data.replies) {
          console.log(`    [${(r.id as string).slice(0, 8)}] ${r.body.slice(0, 80)}`);
        }
      }
      await client.close();
    });

  cmd.command('delete <id>')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('note_delete', { id });
      console.log(JSON.parse(result));
      await client.close();
    });

  return cmd;
}
