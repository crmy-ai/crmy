// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { getClient } from '../client.js';
import { resolveSubjectRef } from './subject-ref.js';
import { resolveShortId } from './id-ref.js';

async function resolveEmailId(client: Awaited<ReturnType<typeof getClient>>, id: string): Promise<string> {
  return resolveShortId(client, id, {
    label: 'email',
    listTool: 'email_search',
    listInput: { limit: 100 },
    responseKeys: ['emails', 'data'],
    helpCommand: 'crmy emails list',
  });
}

async function resolveEmailMessageId(client: Awaited<ReturnType<typeof getClient>>, id: string): Promise<string> {
  return resolveShortId(client, id, {
    label: 'email message',
    listTool: 'email_message_search',
    listInput: { view: 'all', limit: 100 },
    responseKeys: ['email_messages', 'data'],
    helpCommand: 'crmy emails messages --view all',
  });
}

export function emailsCommand(): Command {
  const cmd = new Command('emails').description('Manage Customer Email and outbound follow-ups');

  cmd.command('list')
    .description('List governed outbound emails')
    .option('--contact <id>', 'Filter by contact ID')
    .option('--account <id>', 'Filter by account ID')
    .option('--opportunity <id>', 'Filter by opportunity ID')
    .option('--use-case <id>', 'Filter by use case ID')
    .option('--q <query>', 'Search subject, body, participants, or linked account')
    .option('--status <status>', 'Filter by status')
    .option('--limit <n>', 'Maximum rows to return', '20')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('email_search', {
        contact_id: opts.contact,
        account_id: opts.account,
        opportunity_id: opts.opportunity,
        use_case_id: opts.useCase,
        q: opts.q,
        status: opts.status,
        limit: Number(opts.limit) || 20,
      });
      const data = JSON.parse(result);
      const emails = data.emails ?? data.data ?? (Array.isArray(data) ? data : []);
      if (emails.length === 0) {
        console.log('No emails found.');
        await client.close();
        return;
      }
      console.table(emails.map((e: Record<string, unknown>) => ({
        id: (e.id as string).slice(0, 8),
        to: e.to_email,
        subject: e.subject,
        status: e.status,
        created: e.created_at,
      })));
      await client.close();
    });

  cmd.command('messages')
    .description('List customer email messages captured from mailboxes or inbound webhooks')
    .option('--view <view>', 'customer, review, or all', 'customer')
    .option('--q <query>', 'Search subject, body, participants, or linked records')
    .option('--include-internal', 'Include internal and automated email')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('email_message_search', {
        view: opts.view,
        q: opts.q,
        include_internal: Boolean(opts.includeInternal),
        limit: 20,
      });
      const data = JSON.parse(result);
      const rows = data.email_messages ?? [];
      if (rows.length === 0) {
        console.log('No customer email messages found.');
        await client.close();
        return;
      }
      console.table(rows.map((e: Record<string, unknown>) => ({
        id: (e.id as string).slice(0, 8),
        from: e.from_email,
        subject: e.subject,
        class: e.classification,
        status: e.processing_status,
        account: e.account_name ?? '',
      })));
      await client.close();
    });

  cmd.command('message <id>')
    .description('Get a customer email message with linked records and processing receipt')
    .action(async (id) => {
      const client = await getClient();
      const messageId = await resolveEmailMessageId(client, id);
      const result = await client.call('email_message_get', { id: messageId });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('process <id>')
    .description('Process a customer email message as a Source')
    .action(async (id) => {
      const client = await getClient();
      const messageId = await resolveEmailMessageId(client, id);
      const result = await client.call('email_message_process', { id: messageId });
      const data = JSON.parse(result);
      console.log(`Processed email message ${data.message?.id ?? id}: ${data.processing_status}`);
      if (data.extraction) {
        console.log(`Signals: ${data.extraction.signals_created ?? 0}  Memory: ${data.extraction.memory_created ?? 0}  Skipped: ${data.extraction.skipped ?? 0}`);
      }
      await client.close();
    });

  cmd.command('ignore-message <id>')
    .description('Ignore a customer email message')
    .option('--reason <reason>', 'Reason')
    .action(async (id, opts) => {
      const client = await getClient();
      const messageId = await resolveEmailMessageId(client, id);
      const result = await client.call('email_message_ignore', { id: messageId, reason: opts.reason });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('connections')
    .description('List mailbox connections and processing summary')
    .action(async () => {
      const client = await getClient();
      const result = await client.call('mailbox_connection_list', {});
      const data = JSON.parse(result);
      const rows = data.mailbox_connections ?? [];
      if (rows.length === 0) {
        console.log('No mailbox connections found.');
      } else {
        console.table(rows.map((c: Record<string, unknown>) => ({
          id: (c.id as string).slice(0, 8),
          provider: c.provider,
          mailbox: c.email_address,
          status: c.status,
          last_sync: c.last_sync_at ?? '',
        })));
      }
      if (data.summary) console.log(data.summary);
      await client.close();
    });

  cmd.command('connect <provider>')
    .description('Start Gmail or Outlook mailbox OAuth and print the browser consent URL')
    .option('--email <email>', 'Mailbox address. Defaults to your CRMy user email.')
    .option('--name <name>', 'Display name for the mailbox connection')
    .option('--scope <scope>', 'owned_accounts or accessible_accounts', 'owned_accounts')
    .option('--no-context', 'Do not use this mailbox for customer context')
    .option('--no-send', 'Do not request send permission')
    .option('--no-provider-drafts', 'Do not request provider draft creation permission')
    .option('--no-default-sender', 'Do not make this the default sender')
    .action(async (provider, opts) => {
      if (!['google', 'microsoft'].includes(provider)) {
        throw new Error('Provider must be google or microsoft.');
      }
      const client = await getClient();
      const result = await client.call('mailbox_connection_start', {
        provider,
        email_address: opts.email,
        display_name: opts.name,
        account_ingest_scope: opts.scope === 'accessible_accounts' ? 'accessible_accounts' : 'owned_accounts',
        context_sync_enabled: opts.context !== false,
        send_enabled: opts.send !== false,
        provider_draft_enabled: opts.providerDrafts !== false,
        is_default_sender: opts.defaultSender !== false,
      });
      const data = JSON.parse(result);
      console.log(`Mailbox connection status: ${data.status}`);
      console.log(data.message);
      if (data.auth_url) {
        console.log('\nOpen this URL in a browser to finish provider consent:\n');
        console.log(data.auth_url);
        console.log('\nAfter consent completes, run: crmy emails connections');
      } else if (data.setup_check?.setup_blockers?.length) {
        console.log('\nSetup blockers:');
        for (const blocker of data.setup_check.setup_blockers) console.log(`- ${blocker}`);
      }
      await client.close();
    });

  cmd.command('get <id>')
    .action(async (id) => {
      const client = await getClient();
      const emailId = await resolveEmailId(client, id);
      const result = await client.call('email_get', { id: emailId });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('create')
    .description('Create a governed outbound email through the same Action Context and sender-resolution path as save-draft')
    .action(async () => {
      const { default: inquirer } = await import('inquirer');
      const answers = await inquirer.prompt([
        { type: 'input', name: 'to_address', message: 'To (email):' },
        { type: 'input', name: 'subject', message: 'Subject:' },
        { type: 'input', name: 'body_text', message: 'Body:' },
        { type: 'input', name: 'contact_id', message: 'Contact ID (optional):' },
        { type: 'confirm', name: 'require_approval', message: 'Require HITL approval?', default: true },
      ]);

      const client = await getClient();
      const result = await client.call('email_create', {
        to_address: answers.to_address,
        subject: answers.subject,
        body_text: answers.body_text,
        contact_id: answers.contact_id || undefined,
        require_approval: answers.require_approval,
      });
      const data = JSON.parse(result);
      console.log(`\n  Created email: ${data.email.id}  status: ${data.email.status ?? data.status}\n`);
      if (data.hitl_request_id) {
        console.log(`  HITL approval required: ${data.hitl_request_id}\n`);
      }
      if (data.sender) console.log(`  From: ${data.sender.from_name ?? ''} <${data.sender.from_email ?? 'not configured'}>\n`);
      await client.close();
    });

  cmd.command('draft-preview')
    .description('Generate an agentic customer email draft preview')
    .option('--source-email <id>', 'Source customer email message ID')
    .option('--subject <type:name|type:id>', 'Linked subject such as account:Northstar Labs')
    .option('--contact <id>', 'Contact ID')
    .option('--account <id>', 'Account ID')
    .option('--opportunity <id>', 'Opportunity ID')
    .option('--use-case <id>', 'Use Case ID')
    .option('--to <email>', 'Recipient email override')
    .option('--intent <intent>', 'reply, follow_up, recap_next_steps, nudge_stalled_deal, or custom', 'follow_up')
    .option('--instruction <text>', 'Drafting instruction')
    .action(async (opts) => {
      const client = await getClient();
      const subject = opts.subject ? await resolveSubjectRef(client, opts.subject) : {};
      const result = await client.call('email_draft_preview', {
        source_email_message_id: opts.sourceEmail,
        subject_type: subject.subject_type,
        subject_id: subject.subject_id,
        contact_id: opts.contact,
        account_id: opts.account,
        opportunity_id: opts.opportunity,
        use_case_id: opts.useCase,
        to_address: opts.to,
        intent: opts.intent,
        instruction: opts.instruction,
      });
      const data = JSON.parse(result);
      console.log(`\nSubject: ${data.subject}\n`);
      console.log(data.body_text);
      if (data.warnings?.length) console.log(`\nWarnings: ${data.warnings.join('; ')}`);
      if (data.context_used) console.log('\nContext used:', data.context_used);
      await client.close();
    });

  cmd.command('save-draft')
    .description('Save an edited customer email draft or route it for approval')
    .option('--subject-line <subject>', 'Email subject')
    .option('--body <body>', 'Email body text')
    .option('--body-file <path>', 'Read email body from file')
    .option('--source-email <id>', 'Source customer email message ID')
    .option('--subject <type:name|type:id>', 'Linked subject such as account:Northstar Labs')
    .option('--contact <id>', 'Contact ID')
    .option('--account <id>', 'Account ID')
    .option('--opportunity <id>', 'Opportunity ID')
    .option('--use-case <id>', 'Use Case ID')
    .option('--to <email>', 'Recipient email')
    .option('--origin <origin>', 'manual or agent_generated', 'manual')
    .option('--action <action>', 'save_draft, request_approval, or send_now', 'save_draft')
    .action(async (opts) => {
      const { default: inquirer } = await import('inquirer');
      let subject = opts.subjectLine as string | undefined;
      let body = opts.body as string | undefined;
      if (!body && opts.bodyFile) body = await readFile(opts.bodyFile, 'utf8');
      if (!subject || !body) {
        const answers = await inquirer.prompt([
          { type: 'input', name: 'subject', message: 'Subject:', when: () => !subject },
          { type: 'editor', name: 'body', message: 'Body:', when: () => !body },
        ]);
        subject ??= answers.subject;
        body ??= answers.body;
      }
      const client = await getClient();
      const subjectRef = opts.subject ? await resolveSubjectRef(client, opts.subject) : {};
      const result = await client.call('email_draft_save', {
        source_email_message_id: opts.sourceEmail,
        subject_type: subjectRef.subject_type,
        subject_id: subjectRef.subject_id,
        contact_id: opts.contact,
        account_id: opts.account,
        opportunity_id: opts.opportunity,
        use_case_id: opts.useCase,
        to_address: opts.to,
        subject,
        body_text: body,
        draft_origin: opts.origin,
        delivery_action: opts.action,
      });
      console.log(JSON.parse(result));
      await client.close();
    });

  return cmd;
}
