// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';

export function contextCommand(): Command {
  const cmd = new Command('context').description('Manage context entries (knowledge & memory)');

  cmd.command('list')
    .option('--subject-type <type>', 'Filter by subject type (contact, account, opportunity, use_case)')
    .option('--subject-id <id>', 'Filter by subject ID')
    .option('--type <contextType>', 'Filter by context type (note, research, objection, etc.)')
    .option('--current-only', 'Only show current entries (default behavior)')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('context_list', {
        subject_type: opts.subjectType,
        subject_id: opts.subjectId,
        context_type: opts.type,
        is_current: opts.currentOnly ? true : undefined,
        limit: 20,
      });
      const data = JSON.parse(result);
      if (data.context_entries?.length === 0) {
        console.log('No context entries found.');
        return;
      }
      console.table(data.context_entries?.map((c: Record<string, unknown>) => ({
        id: (c.id as string).slice(0, 8),
        type: c.context_type,
        title: ((c.title as string) ?? '').slice(0, 40),
        subject: `${c.subject_type}:${(c.subject_id as string).slice(0, 8)}`,
        confidence: c.confidence ?? '—',
        current: c.is_current ? '✓' : '✗',
      })));
      if (data.total > 20) console.log(`\n  Showing 20 of ${data.total} entries`);
      await client.close();
    });

  cmd.command('add')
    .description('Add context about a CRM object')
    .action(async () => {
      const { default: inquirer } = await import('inquirer');
      const answers = await inquirer.prompt([
        { type: 'list', name: 'subject_type', message: 'Subject type:', choices: ['contact', 'account', 'opportunity', 'use_case'] },
        { type: 'input', name: 'subject_id', message: 'Subject ID (UUID):' },
        { type: 'list', name: 'context_type', message: 'Context type:', choices: ['note', 'transcript', 'summary', 'research', 'preference', 'objection', 'competitive_intel', 'relationship_map', 'meeting_notes', 'agent_reasoning'] },
        { type: 'input', name: 'title', message: 'Title (optional):' },
        { type: 'editor', name: 'body', message: 'Body:' },
        { type: 'input', name: 'confidence', message: 'Confidence (0.0–1.0, optional):' },
        { type: 'input', name: 'source', message: 'Source (e.g. manual, call_transcript, agent_research):' },
      ]);

      const client = await getClient();
      const result = await client.call('context_add', {
        subject_type: answers.subject_type,
        subject_id: answers.subject_id,
        context_type: answers.context_type,
        title: answers.title || undefined,
        body: answers.body,
        confidence: answers.confidence ? parseFloat(answers.confidence) : undefined,
        source: answers.source || undefined,
      });
      const data = JSON.parse(result);
      console.log(`\n  Added context: ${data.context_entry.id}\n`);
      await client.close();
    });

  cmd.command('get <id>')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('context_get', { id });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('supersede <id>')
    .option('-b, --body <body>', 'New body text')
    .option('-t, --title <title>', 'New title')
    .description('Supersede an existing context entry with updated content')
    .action(async (id, opts) => {
      let body = opts.body;
      if (!body) {
        const { default: inquirer } = await import('inquirer');
        const answers = await inquirer.prompt([
          { type: 'editor', name: 'body', message: 'Updated body:' },
        ]);
        body = answers.body;
      }

      const client = await getClient();
      const result = await client.call('context_supersede', {
        id,
        body,
        title: opts.title || undefined,
      });
      const data = JSON.parse(result);
      console.log(`\n  Superseded with new entry: ${data.context_entry.id}\n`);
      await client.close();
    });

  cmd.command('search <query>')
    .description('Full-text search across context entries')
    .option('--subject <subject>', 'Filter by subject (type:UUID)')
    .option('--type <contextType>', 'Filter by context type')
    .option('--tag <tag>', 'Filter by tag')
    .option('--include-superseded', 'Include non-current entries')
    .option('--limit <n>', 'Max results', '20')
    .action(async (query, opts) => {
      const input: Record<string, unknown> = {
        query,
        limit: parseInt(opts.limit, 10),
        current_only: !opts.includeSuperseded,
      };
      if (opts.subject) {
        const [st, si] = opts.subject.split(':');
        input.subject_type = st;
        input.subject_id = si;
      }
      if (opts.type) input.context_type = opts.type;
      if (opts.tag) input.tag = opts.tag;

      const client = await getClient();
      const result = await client.call('context_search', input);
      const data = JSON.parse(result);
      if (data.context_entries?.length === 0) {
        console.log('No results found.');
        return;
      }
      console.table(data.context_entries?.map((c: Record<string, unknown>) => ({
        id: (c.id as string).slice(0, 8),
        type: c.context_type,
        title: ((c.title as string) ?? '').slice(0, 40),
        subject: `${c.subject_type}:${(c.subject_id as string).slice(0, 8)}`,
        confidence: c.confidence ?? '—',
      })));
      await client.close();
    });

  cmd.command('review <id>')
    .description('Mark a context entry as reviewed (still accurate)')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('context_review', { id });
      const data = JSON.parse(result);
      console.log(`\n  Reviewed context entry: ${data.context_entry.id} (reviewed_at: ${data.context_entry.reviewed_at})\n`);
      await client.close();
    });

  cmd.command('stale')
    .description('List stale context entries that need review')
    .option('--subject <subject>', 'Filter by subject (type:UUID)')
    .option('--limit <n>', 'Max results', '20')
    .action(async (opts) => {
      const input: Record<string, unknown> = { limit: parseInt(opts.limit, 10) };
      if (opts.subject) {
        const [st, si] = opts.subject.split(':');
        input.subject_type = st;
        input.subject_id = si;
      }

      const client = await getClient();
      const result = await client.call('context_stale', input);
      const data = JSON.parse(result);
      if (data.stale_entries?.length === 0) {
        console.log('No stale entries found.');
        return;
      }
      console.table(data.stale_entries?.map((c: Record<string, unknown>) => ({
        id: (c.id as string).slice(0, 8),
        type: c.context_type,
        title: ((c.title as string) ?? '').slice(0, 40),
        expired: c.valid_until,
        subject: `${c.subject_type}:${(c.subject_id as string).slice(0, 8)}`,
      })));
      await client.close();
    });

  return cmd;
}
