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

function printTranscriptSources(rows: Record<string, unknown>[]): void {
  if (rows.length === 0) {
    console.log('No transcript or notes drops configured.');
    return;
  }
  console.table(rows.map((source) => ({
    id: String(source.id ?? '').slice(0, 8),
    name: source.name,
    provider: source.provider,
    status: source.status,
    last_sync: source.last_sync_at ?? '',
    last_error: source.last_error ?? '',
  })));
}

function printTranscriptObjects(rows: Record<string, unknown>[]): void {
  if (rows.length === 0) {
    console.log('No transcript source objects found.');
    return;
  }
  console.table(rows.map((object) => ({
    id: String(object.id ?? '').slice(0, 8),
    file: String(object.source_label ?? object.object_key ?? '').slice(0, 36),
    match: object.match_status,
    processing: object.processing_status,
    account: object.account_name ?? '',
    meeting: String(object.calendar_title ?? '').slice(0, 32),
    reason: String(object.match_reason ?? object.failure_reason ?? '').slice(0, 44),
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

  cmd.command('transcript-sources')
    .description('List transcript and raw-note storage drops')
    .action(async () => {
      const client = await getClient();
      const result = await client.call('context_source_connection_list', {});
      const data = JSON.parse(result);
      printTranscriptSources(data.data ?? []);
      await client.close();
    });

  const transcriptSource = cmd.command('transcript-source').description('Manage transcript and raw-note storage drops');

  transcriptSource.command('create-s3')
    .description('Create an S3-compatible transcript/raw-note drop')
    .requiredOption('--name <name>', 'Source name')
    .requiredOption('--bucket <bucket>', 'S3 bucket')
    .option('--prefix <prefix>', 'Object prefix', '')
    .option('--region <region>', 'AWS/S3 region', 'us-east-1')
    .option('--endpoint <url>', 'S3-compatible endpoint URL')
    .option('--path-style', 'Use path-style S3 URLs')
    .requiredOption('--access-key-id <id>', 'S3 access key id')
    .requiredOption('--secret-access-key <secret>', 'S3 secret access key')
    .option('--session-token <token>', 'Optional S3 session token')
    .option('--include <glob...>', 'Include glob(s), e.g. transcripts/**/*.vtt')
    .option('--exclude <glob...>', 'Exclude glob(s)')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('context_source_connection_create', {
        name: opts.name,
        provider: 's3',
        config: {
          bucket: opts.bucket,
          prefix: opts.prefix,
          region: opts.region,
          endpoint: opts.endpoint,
          force_path_style: Boolean(opts.pathStyle),
          include_globs: opts.include ?? [],
          exclude_globs: opts.exclude ?? [],
        },
        credentials: {
          access_key_id: opts.accessKeyId,
          secret_access_key: opts.secretAccessKey,
          session_token: opts.sessionToken,
        },
      });
      console.log(JSON.parse(result));
      await client.close();
    });

  transcriptSource.command('create-local')
    .description('Create a local-folder transcript/raw-note drop for self-hosted/local installs')
    .requiredOption('--name <name>', 'Source name')
    .requiredOption('--path <path>', 'Local folder path under CRMY_LOCAL_SOURCE_ROOTS')
    .option('--include <glob...>', 'Include glob(s), e.g. **/*.vtt')
    .option('--exclude <glob...>', 'Exclude glob(s)')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('context_source_connection_create', {
        name: opts.name,
        provider: 'local_folder',
        config: {
          path: opts.path,
          include_globs: opts.include ?? [],
          exclude_globs: opts.exclude ?? [],
        },
      });
      console.log(JSON.parse(result));
      await client.close();
    });

  transcriptSource.command('sync <id>')
    .description('Queue sync for a transcript/raw-note source')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('context_source_connection_sync', { id });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('transcripts')
    .description('List transcript/raw-note source objects')
    .option('--status <status>', 'needs_review, ambiguous, matched, ignored, or all', 'all')
    .option('--processing <status>', 'queued, processing, processed, failed, needs_review, ignored, or all')
    .option('--q <query>', 'Search file name or excerpt')
    .option('--limit <n>', 'Max results', '50')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('context_source_object_list', {
        match_status: opts.status,
        processing_status: opts.processing,
        q: opts.q,
        limit: parseInt(opts.limit, 10),
      });
      const data = JSON.parse(result);
      printTranscriptObjects(data.data ?? []);
      if (data.next_cursor) console.log(`Next cursor: ${data.next_cursor}`);
      await client.close();
    });

  const transcriptObject = cmd.command('transcript').description('Inspect, resolve, or ignore transcript/raw-note source objects');

  transcriptObject.command('get <id>')
    .description('Inspect one transcript/raw-note source object')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('context_source_object_get', { id });
      console.log(JSON.parse(result));
      await client.close();
    });

  transcriptObject.command('resolve <id>')
    .description('Link a transcript/raw-note source object to a meeting or customer record and queue processing')
    .option('--meeting <id>', 'Calendar event id')
    .option('--account <id>', 'Account id')
    .option('--contact <id>', 'Contact id')
    .option('--opportunity <id>', 'Opportunity id')
    .option('--use-case <id>', 'Use case id')
    .option('--note <note>', 'Review note')
    .action(async (id, opts) => {
      const client = await getClient();
      const result = await client.call('context_source_object_resolve', {
        id,
        calendar_event_id: opts.meeting,
        account_id: opts.account,
        contact_id: opts.contact,
        opportunity_id: opts.opportunity,
        use_case_id: opts.useCase,
        note: opts.note,
      });
      console.log(JSON.parse(result));
      await client.close();
    });

  transcriptObject.command('reprocess <id>')
    .description('Queue reprocessing for a transcript/raw-note source object')
    .action(async (id) => {
      const client = await getClient();
      const result = await client.call('context_source_object_reprocess', { id });
      console.log(JSON.parse(result));
      await client.close();
    });

  transcriptObject.command('ignore <id>')
    .description('Ignore a transcript/raw-note source object that should not become customer context')
    .option('--reason <reason>', 'Reason for ignoring')
    .action(async (id, opts) => {
      const client = await getClient();
      const result = await client.call('context_source_object_ignore', { id, reason: opts.reason });
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
