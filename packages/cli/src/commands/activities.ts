// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { getClient } from '../client.js';
import { resolveSubjectRef } from './subject-ref.js';
import { resolveShortId } from './id-ref.js';

async function resolveMeetingId(client: Awaited<ReturnType<typeof getClient>>, id: string): Promise<string> {
  return resolveShortId(client, id, {
    label: 'meeting',
    listTool: 'calendar_event_search',
    listInput: { tab: 'all', include_internal: true, limit: 100 },
    responseKeys: ['calendar_events', 'data'],
    helpCommand: 'crmy activities meetings --tab all',
  });
}

function printMeetings(events: Record<string, unknown>[]): void {
  if (events.length === 0) {
    console.log('No meetings found.');
    return;
  }
  console.table(events.map((event) => ({
    id: String(event.id ?? '').slice(0, 8),
    title: String(event.title ?? '').slice(0, 36),
    type: event.classification ?? 'unknown',
    status: event.processing_status ?? 'unprocessed',
    validation: event.validation_status ?? 'needs_review',
    account: event.account_name ?? '',
    start: event.start_time ?? event.starts_at ?? '',
  })));
}

export function activitiesCommand(): Command {
  const cmd = new Command('activities').description('Review Customer Activity, meetings, transcripts, and notes');

  cmd.command('list')
    .description('List logged activities')
    .option('--subject <type:name|type:id>', 'Filter by subject, e.g. account:Northstar Labs')
    .option('--limit <n>', 'Max results', '20')
    .action(async (opts) => {
      const client = await getClient();
      const subject = opts.subject ? await resolveSubjectRef(client, opts.subject) : {};
      const result = await client.call('activity_search', {
        subject_type: subject.subject_type,
        subject_id: subject.subject_id,
        limit: parseInt(opts.limit, 10),
      });
      const data = JSON.parse(result);
      const rows = data.activities ?? data.data ?? [];
      if (rows.length === 0) {
        console.log('No activities found.');
      } else {
        console.table(rows.map((activity: Record<string, unknown>) => ({
          id: String(activity.id ?? '').slice(0, 8),
          type: activity.type,
          subject: String(activity.subject ?? '').slice(0, 40),
          outcome: activity.outcome ?? '',
          occurred: activity.occurred_at ?? activity.created_at ?? '',
        })));
      }
      await client.close();
    });

  cmd.command('meetings')
    .description('List customer meetings captured from calendar sync')
    .option('--q <query>', 'Search meeting title, participants, or linked records')
    .option('--tab <tab>', 'meetings, needs_context, calls_notes, or all')
    .option('--include-internal', 'Include internal meetings')
    .option('--limit <n>', 'Max results', '20')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('calendar_event_search', {
        q: opts.q,
        tab: opts.tab,
        include_internal: Boolean(opts.includeInternal),
        limit: parseInt(opts.limit, 10),
      });
      const data = JSON.parse(result);
      printMeetings(data.data ?? data.calendar_events ?? []);
      if (data.summary) console.log(data.summary);
      await client.close();
    });

  cmd.command('meeting <id>')
    .description('Show one calendar meeting and linked artifacts')
    .action(async (id) => {
      const client = await getClient();
      const meetingId = await resolveMeetingId(client, id);
      const result = await client.call('calendar_event_get', { id: meetingId });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('process <id>')
    .description('Process meeting artifacts as Raw Context')
    .action(async (id) => {
      const client = await getClient();
      const meetingId = await resolveMeetingId(client, id);
      const result = await client.call('calendar_event_process', { id: meetingId });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('add-context <id>')
    .description('Attach transcript, notes, or summary text to a meeting and optionally process it')
    .option('-f, --file <path>', 'Text file to attach')
    .option('-t, --text <text>', 'Text content to attach')
    .option('--type <type>', 'notes, transcript, summary, recording, or other', 'notes')
    .option('--source <label>', 'Source label')
    .option('--no-process', 'Attach without processing as Raw Context')
    .action(async (id, opts) => {
      let text = opts.text as string | undefined;
      if (!text && opts.file) text = await readFile(opts.file, 'utf8');
      if (!text) {
        const { default: inquirer } = await import('inquirer');
        const answers = await inquirer.prompt([
          { type: 'editor', name: 'text', message: 'Paste meeting notes or transcript:' },
        ]);
        text = answers.text;
      }
      const client = await getClient();
      const meetingId = await resolveMeetingId(client, id);
      const result = await client.call('calendar_event_add_context', {
        id: meetingId,
        artifact_type: opts.type,
        text_content: text,
        source_label: opts.source,
        process: opts.process,
      });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('connections')
    .description('List calendar connections')
    .action(async () => {
      const client = await getClient();
      const result = await client.call('calendar_connection_list', {});
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('connect-calendar <provider>')
    .description('Start Google or Microsoft calendar OAuth and print the browser consent URL')
    .option('--email <email>', 'Calendar account email. Defaults to your CRMy user email.')
    .option('--name <name>', 'Display name for the calendar connection')
    .option('--scope <scope>', 'owned_accounts, accessible_accounts, or all_meetings', 'owned_accounts')
    .action(async (provider, opts) => {
      if (!['google', 'microsoft'].includes(provider)) {
        throw new Error('Provider must be google or microsoft.');
      }
      const scope = ['owned_accounts', 'accessible_accounts', 'all_meetings'].includes(opts.scope)
        ? opts.scope
        : 'owned_accounts';
      const client = await getClient();
      const result = await client.call('calendar_connection_start', {
        provider,
        email_address: opts.email,
        display_name: opts.name,
        meeting_ingest_scope: scope,
      });
      const data = JSON.parse(result);
      console.log(`Calendar connection status: ${data.status}`);
      console.log(data.message);
      if (data.auth_url) {
        console.log('\nOpen this URL in a browser to finish provider consent:\n');
        console.log(data.auth_url);
        console.log('\nAfter consent completes, run: crmy activities connections');
      } else if (data.setup_check?.setup_blockers?.length) {
        console.log('\nSetup blockers:');
        for (const blocker of data.setup_check.setup_blockers) console.log(`- ${blocker}`);
      }
      await client.close();
    });

  cmd.command('classifications')
    .description('List meeting classifications and validation rules')
    .option('--include-disabled', 'Include disabled classifications')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('meeting_classification_list', { include_disabled: Boolean(opts.includeDisabled) });
      const data = JSON.parse(result);
      console.table((data.data ?? []).map((item: Record<string, unknown>) => ({
        type: item.type_name,
        label: item.label,
        customer: item.is_customer_facing ? 'yes' : 'no',
        auto: item.auto_process_raw_context ? 'yes' : 'no',
        enabled: item.is_enabled ? 'yes' : 'no',
      })));
      await client.close();
    });

  return cmd;
}
