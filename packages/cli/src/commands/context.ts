// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { getClient } from '../client.js';
import { resolveSubjectRef } from './subject-ref.js';
import { resolveShortId } from './id-ref.js';

function printEntries(entries: Record<string, unknown>[], total?: number, limit = 20): void {
  if (entries.length === 0) {
    console.log('No context entries found.');
    return;
  }
  console.table(entries.map((c) => ({
    id: (c.id as string).slice(0, 8),
    status: c.memory_status ?? 'active',
    type: c.context_type,
    title: ((c.title as string) ?? '').slice(0, 40),
    subject: `${c.subject_type}:${((c.subject_id as string) ?? '').slice(0, 8)}`,
    confidence: c.confidence ?? '—',
    current: c.is_current ? 'yes' : 'no',
  })));
  if (total && total > limit) console.log(`\n  Showing ${limit} of ${total} entries`);
}

function printProcessingReceipt(data: Record<string, unknown>): void {
  const receipt = data.processing_receipt as Record<string, unknown> | undefined;
  console.log('\n  Context processed');
  console.log(`  Memory created:  ${data.memory_created ?? 0}`);
  console.log(`  Signals created: ${data.signals_created ?? 0}`);
  console.log(`  Skipped:         ${data.skipped ?? 0}`);
  if (receipt?.raw_context_source_id) console.log(`  Raw Context:     ${receipt.raw_context_source_id}`);
  if (receipt?.status) console.log(`  Status:          ${receipt.status}`);
  if (receipt?.next_action) console.log(`  Next:            ${receipt.next_action}`);
  console.log('');
}

function printSignalGroups(groups: Record<string, unknown>[], total?: number, limit = 20): void {
  if (groups.length === 0) {
    console.log('No Signals found.');
    return;
  }
  console.table(groups.map((g) => ({
    id: (g.id as string).slice(0, 8),
    status: g.status,
    type: g.context_type,
    claim: String(g.title ?? g.normalized_claim ?? '').slice(0, 44),
    confidence: `${Math.round(Number(g.aggregate_confidence ?? 0) * 100)}%`,
    signals: g.support_count ?? 0,
    sources: g.independent_source_count ?? 0,
    conflicts: g.conflict_count ?? 0,
  })));
  if (total && total > limit) console.log(`\n  Showing ${limit} of ${total} Signals`);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function resolveSignalGroupRef(client: Awaited<ReturnType<typeof getClient>>, ref: string): Promise<string> {
  if (isUuid(ref)) return ref;

  const result = await client.call('context_signal_group_list', {
    attention_only: false,
    limit: 100,
  });
  const data = JSON.parse(result);
  const groups = (data.signal_groups ?? data.data ?? []) as Record<string, unknown>[];
  const matches = groups.filter((group) => String(group.id ?? '').startsWith(ref));

  if (matches.length === 1) {
    return String(matches[0].id);
  }
  if (matches.length > 1) {
    throw new Error(`Signal ID "${ref}" is ambiguous. Use more characters from the ID.`);
  }
  throw new Error(`No Signal found with ID prefix "${ref}". Run \`crmy context signal-groups --all\`.`);
}

async function resolveContextEntryRef(client: Awaited<ReturnType<typeof getClient>>, ref: string): Promise<string> {
  return resolveShortId(client, ref, {
    label: 'context entry',
    listTool: 'context_list',
    listInput: { limit: 100, is_current: undefined },
    responseKeys: ['context_entries', 'data'],
    helpCommand: 'crmy context list --include-superseded',
  });
}

async function resolveRawSourceRef(client: Awaited<ReturnType<typeof getClient>>, ref: string): Promise<string> {
  return resolveShortId(client, ref, {
    label: 'Raw Context source',
    listTool: 'context_raw_source_list',
    listInput: { limit: 100 },
    responseKeys: ['raw_context_sources', 'data'],
    helpCommand: 'crmy context raw-sources',
  });
}

export function contextCommand(): Command {
  const cmd = new Command('context').description('Manage Raw Context, Signals, and Memory');

  cmd.command('list')
    .description('List confirmed Memory and reviewable Signals')
    .option('--subject <type:name|type:id>', 'Filter by subject, e.g. account:Northstar Labs')
    .option('--type <contextType>', 'Filter by context type (note, research, objection, etc.)')
    .option('--status <status>', 'Filter by lifecycle status (active, signal, rejected, superseded)')
    .option('--include-superseded', 'Include non-current entries')
    .option('--limit <n>', 'Max results', '20')
    .action(async (opts) => {
      const client = await getClient();
      const subject = opts.subject ? await resolveSubjectRef(client, opts.subject) : {};
      const limit = parseInt(opts.limit, 10);
      const result = await client.call('context_list', {
        subject_type: subject.subject_type,
        subject_id: subject.subject_id,
        context_type: opts.type,
        memory_status: opts.status,
        is_current: opts.includeSuperseded ? undefined : true,
        limit,
      });
      const data = JSON.parse(result);
      printEntries(data.context_entries ?? data.data ?? [], data.total, limit);
      await client.close();
    });

  cmd.command('add')
    .description('Advanced: write confirmed Memory or an evidence-backed Signal directly')
    .action(async () => {
      const { default: inquirer } = await import('inquirer');
      console.log('\n  For transcripts, emails, notes, or research, use `crmy context ingest` so CRMy creates Raw Context, extracts Signals, and promotes high-confidence Memory.\n');
      const answers = await inquirer.prompt([
        { type: 'input', name: 'subject_ref', message: 'Subject (type:name or type:id):', default: 'account:' },
        { type: 'list', name: 'context_type', message: 'Context type:', choices: ['note', 'transcript', 'summary', 'research', 'preference', 'objection', 'competitive_intel', 'relationship_map', 'meeting_notes', 'agent_reasoning'] },
        { type: 'list', name: 'memory_status', message: 'Lifecycle:', choices: [{ name: 'Confirmed Memory', value: 'active' }, { name: 'Signal needing review', value: 'signal' }] },
        { type: 'input', name: 'title', message: 'Title (optional):' },
        { type: 'editor', name: 'body', message: 'Body:' },
        { type: 'input', name: 'confidence', message: 'Confidence (0.0–1.0, optional):' },
        { type: 'input', name: 'source', message: 'Source (e.g. manual, call_transcript, agent_research):' },
        { type: 'input', name: 'evidence_snippet', message: 'Evidence snippet (required for Signals):', when: (a) => a.memory_status === 'signal' },
      ]);

      const client = await getClient();
      const subject = await resolveSubjectRef(client, answers.subject_ref);
      const result = await client.call('context_add', {
        subject_type: subject.subject_type,
        subject_id: subject.subject_id,
        context_type: answers.context_type,
        title: answers.title || undefined,
        body: answers.body,
        memory_status: answers.memory_status,
        confidence: answers.confidence ? parseFloat(answers.confidence) : undefined,
        source: answers.source || undefined,
        evidence: answers.memory_status === 'signal'
          ? [{ source: answers.source || 'manual', snippet: answers.evidence_snippet || answers.body.slice(0, 500) }]
          : undefined,
      });
      const data = JSON.parse(result);
      console.log(`\n  Added ${data.context_entry.memory_status === 'signal' ? 'Signal' : 'Memory'}: ${data.context_entry.id}\n`);
      await client.close();
    });

  cmd.command('ingest')
    .description('Add messy Raw Context and let CRMy extract Signals and Memory')
    .option('-f, --file <path>', 'Read source text from a file')
    .option('--subject <type:name|type:id>', 'Known subject to attach to, such as account:Northstar Labs')
    .option('--source <label>', 'Human-readable source label')
    .option('--auto', 'Resolve mentioned contacts/accounts automatically')
    .option('--threshold <n>', 'Auto subject resolution confidence threshold for --auto', '0.6')
    .action(async (opts) => {
      const { default: inquirer } = await import('inquirer');
      let document = '';
      if (opts.file) {
        document = await readFile(opts.file, 'utf8');
      } else {
        const answers = await inquirer.prompt([
          { type: 'editor', name: 'document', message: 'Paste transcripts, emails, meeting notes, support updates, or research:' },
        ]);
        document = answers.document;
      }
      const client = await getClient();
      const subject = opts.subject ? await resolveSubjectRef(client, opts.subject) : {};
      const result = await client.call(opts.auto || !subject.subject_type ? 'context_ingest_auto' : 'context_ingest', {
        document,
        text: document,
        subject_type: subject.subject_type,
        subject_id: subject.subject_id,
        source_label: opts.source,
        source: opts.source,
        confidence_threshold: parseFloat(opts.threshold),
      });
      const data = JSON.parse(result);
      if (data.subjects_resolved) {
        console.log(`\n  Resolved subjects: ${data.subjects_resolved.length}`);
        console.table(data.subjects_resolved.map((s: Record<string, unknown>) => ({
          subject: `${s.entity_type}:${((s.id as string) ?? '').slice(0, 8)}`,
          name: s.name,
          memory: s.memory_created ?? 0,
          signals: s.signals_created ?? 0,
          status: (s.processing_receipt as Record<string, unknown> | undefined)?.status ?? '—',
        })));
      }
      printProcessingReceipt(data);
      await client.close();
    });

  cmd.command('signals')
    .description('List Signals that need review')
    .option('--subject <type:name|type:id>', 'Filter by subject')
    .option('--limit <n>', 'Max results', '20')
    .action(async (opts) => {
      const client = await getClient();
      const subject = opts.subject ? await resolveSubjectRef(client, opts.subject) : {};
      const limit = parseInt(opts.limit, 10);
      const result = await client.call('context_list', {
        subject_type: subject.subject_type,
        subject_id: subject.subject_id,
        memory_status: 'signal',
        is_current: true,
        limit,
      });
      const data = JSON.parse(result);
      printEntries(data.context_entries ?? data.data ?? [], data.total, limit);
      await client.close();
    });

  cmd.command('signal-groups')
    .description('List evidence-backed Signals with combined source support')
    .option('--subject <type:name|type:id>', 'Filter by subject')
    .option('--status <status>', 'Filter by status (gathering, ready, blocked, conflicting, promoted, dismissed)')
    .option('--all', 'Include groups that do not need attention')
    .option('--limit <n>', 'Max results', '20')
    .action(async (opts) => {
      const client = await getClient();
      const subject = opts.subject ? await resolveSubjectRef(client, opts.subject) : {};
      const limit = parseInt(opts.limit, 10);
      const result = await client.call('context_signal_group_list', {
        subject_type: subject.subject_type,
        subject_id: subject.subject_id,
        status: opts.status,
        attention_only: !opts.all,
        limit,
      });
      const data = JSON.parse(result);
      printSignalGroups(data.signal_groups ?? data.data ?? [], data.total, limit);
      await client.close();
    });

  cmd.command('promote-group <id>')
    .description('Promote a trusted Signal into confirmed Memory')
    .action(async (id) => {
      const client = await getClient();
      const signalGroupId = await resolveSignalGroupRef(client, id);
      const result = await client.call('context_signal_group_promote', { id: signalGroupId });
      const data = JSON.parse(result);
      console.log(`\n  Promoted Signal to Memory: ${data.context_entry?.id ?? signalGroupId}\n`);
      await client.close();
    });

  cmd.command('reject-group <id>')
    .description('Dismiss a Signal while preserving evidence for audit')
    .option('-r, --reason <reason>', 'Reason for rejection')
    .action(async (id, opts) => {
      const client = await getClient();
      const signalGroupId = await resolveSignalGroupRef(client, id);
      await client.call('context_signal_group_reject', { id: signalGroupId, reason: opts.reason });
      console.log(`\n  Rejected Signal: ${signalGroupId}\n`);
      await client.close();
    });

  cmd.command('handoff-group <id>')
    .description('Send a Signal to Handoff for human review')
    .action(async (id) => {
      const client = await getClient();
      const signalGroupId = await resolveSignalGroupRef(client, id);
      const result = await client.call('context_signal_handoff', { id: signalGroupId });
      const data = JSON.parse(result);
      console.log(`\n  Created Handoff for Signal: ${data.hitl_request?.id ?? signalGroupId}\n`);
      await client.close();
    });

  cmd.command('promote <id>')
    .description('Promote a reviewed Signal into confirmed Memory')
    .option('-b, --body <body>', 'Edited Memory body')
    .option('-t, --title <title>', 'Edited title')
    .option('-c, --confidence <n>', 'Updated confidence')
    .action(async (id, opts) => {
      const client = await getClient();
      const entryId = await resolveContextEntryRef(client, id);
      const result = await client.call('context_signal_promote', {
        id: entryId,
        body: opts.body,
        title: opts.title,
        confidence: opts.confidence ? parseFloat(opts.confidence) : undefined,
      });
      const data = JSON.parse(result);
      console.log(`\n  Promoted Signal to Memory: ${data.context_entry.id}\n`);
      await client.close();
    });

  cmd.command('reject <id>')
    .description('Reject a Signal while preserving evidence for audit')
    .option('-r, --reason <reason>', 'Reason for rejection')
    .action(async (id, opts) => {
      const client = await getClient();
      const entryId = await resolveContextEntryRef(client, id);
      const result = await client.call('context_signal_reject', { id: entryId, reason: opts.reason });
      const data = JSON.parse(result);
      console.log(`\n  Rejected Signal: ${data.context_entry.id}\n`);
      await client.close();
    });

  cmd.command('raw-sources')
    .description('List Raw Context processing records')
    .option('--source-type <type>', 'Filter by source type, such as activity, add_context, mcp, context_api')
    .option('--status <status>', 'Filter by status (processed, needs_review, failed, skipped)')
    .option('--subject <type:name|type:id>', 'Filter by subject')
    .option('--limit <n>', 'Max results', '50')
    .action(async (opts) => {
      const client = await getClient();
      const subject = opts.subject ? await resolveSubjectRef(client, opts.subject) : {};
      const limit = parseInt(opts.limit, 10);
      const result = await client.call('context_raw_source_list', {
        source_type: opts.sourceType,
        status: opts.status,
        subject_type: subject.subject_type,
        subject_id: subject.subject_id,
        limit,
      });
      const data = JSON.parse(result);
      const sources = data.raw_context_sources ?? data.data ?? [];
      if (sources.length === 0) {
        console.log('No Raw Context sources found.');
      } else {
        console.table(sources.map((s: Record<string, unknown>) => ({
          id: (s.id as string).slice(0, 8),
          source: s.source_type,
          label: ((s.source_label as string) ?? '').slice(0, 34),
          status: s.status,
          stage: s.stage,
          memory: s.memory_created ?? 0,
          signals: s.signals_created ?? 0,
          skipped: s.skipped ?? 0,
        })));
      }
      if (data.total > limit) console.log(`\n  Showing ${limit} of ${data.total} sources`);
      await client.close();
    });

  cmd.command('raw-source <id>')
    .description('Show one Raw Context processing record')
    .action(async (id) => {
      const client = await getClient();
      const sourceId = await resolveRawSourceRef(client, id);
      const result = await client.call('context_raw_source_get', { id: sourceId });
      console.log(JSON.parse(result));
      await client.close();
    });

  cmd.command('reprocess-source <id>')
    .description('Reprocess a Raw Context source')
    .action(async (id) => {
      const client = await getClient();
      const sourceId = await resolveRawSourceRef(client, id);
      const result = await client.call('context_raw_source_reprocess', { id: sourceId });
      const data = JSON.parse(result);
      printProcessingReceipt(data);
      await client.close();
    });

  cmd.command('lineage')
    .description('Trace Raw Context to Signals, Memory, Handoffs, writebacks, and audit')
    .option('--subject <type:name|type:id>', 'Subject such as account:Northstar Labs')
    .option('--entry <id>', 'Context entry / Memory ID')
    .option('--signal <id>', 'Signal ID')
    .option('--raw-source <id>', 'Raw Context source ID')
    .action(async (opts) => {
      const client = await getClient();
      const entryId = opts.entry ? await resolveContextEntryRef(client, opts.entry) : undefined;
      const signalGroupId = opts.signal ? await resolveSignalGroupRef(client, opts.signal) : undefined;
      const rawSourceId = opts.rawSource ? await resolveRawSourceRef(client, opts.rawSource) : undefined;
      const subject = opts.subject ? await resolveSubjectRef(client, opts.subject) : {};
      const result = await client.call('context_lineage_get', {
        subject_type: subject.subject_type,
        subject_id: subject.subject_id,
        context_entry_id: entryId,
        signal_group_id: signalGroupId,
        raw_context_source_id: rawSourceId,
      });
      const data = JSON.parse(result);
      const lineage = data.lineage ?? data;
      console.log(lineage.summary ?? {});
      console.table((lineage.nodes ?? []).map((node: Record<string, unknown>) => ({
        id: String(node.id ?? '').slice(0, 8),
        type: node.type,
        title: String(node.title ?? node.label ?? '').slice(0, 48),
        stage: node.stage ?? '',
      })));
      console.log(`Edges: ${(lineage.edges ?? []).length}`);
      await client.close();
    });

  cmd.command('get <id>')
    .action(async (id) => {
      const client = await getClient();
      const entryId = await resolveContextEntryRef(client, id);
      const result = await client.call('context_get', { id: entryId });
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
      const entryId = await resolveContextEntryRef(client, id);
      const result = await client.call('context_supersede', {
        id: entryId,
        body,
        title: opts.title || undefined,
      });
      const data = JSON.parse(result);
      console.log(`\n  Superseded with new entry: ${data.context_entry.id}\n`);
      await client.close();
    });

  cmd.command('search <query>')
    .description('Full-text search across Memory and Signals')
    .option('--subject <subject>', 'Filter by subject (type:name or type:id)')
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
      if (opts.type) input.context_type = opts.type;
      if (opts.tag) input.tag = opts.tag;

      const client = await getClient();
      if (opts.subject) Object.assign(input, await resolveSubjectRef(client, opts.subject));
      const result = await client.call('context_search', input);
      const data = JSON.parse(result);
      if (data.context_entries?.length === 0) {
        console.log('No results found.');
        await client.close();
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

  cmd.command('semantic-search <query>')
    .description('Semantic search across Memory and Signals when embeddings are available')
    .option('--subject <subject>', 'Filter by subject (type:name or type:id)')
    .option('--limit <n>', 'Max results', '10')
    .action(async (query, opts) => {
      const client = await getClient();
      const subject = opts.subject ? await resolveSubjectRef(client, opts.subject) : {};
      const result = await client.call('context_semantic_search', {
        query,
        subject_type: subject.subject_type,
        subject_id: subject.subject_id,
        limit: parseInt(opts.limit, 10),
      });
      const data = JSON.parse(result);
      const rows = data.results ?? data.context_entries ?? [];
      if (rows.length === 0) console.log('No semantic results found.');
      else {
        console.table(rows.map((item: Record<string, unknown>) => ({
          id: String(item.id ?? '').slice(0, 8),
          type: item.context_type ?? item.type,
          title: String(item.title ?? item.body ?? '').slice(0, 48),
          score: item.similarity ?? item.score ?? '',
        })));
      }
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
    .option('--subject <subject>', 'Filter by subject (type:name or type:id)')
    .option('--limit <n>', 'Max results', '20')
    .action(async (opts) => {
      const input: Record<string, unknown> = { limit: parseInt(opts.limit, 10) };
      const client = await getClient();
      if (opts.subject) Object.assign(input, await resolveSubjectRef(client, opts.subject));
      const result = await client.call('context_stale', input);
      const data = JSON.parse(result);
      if (data.stale_entries?.length === 0) {
        console.log('No stale entries found.');
        await client.close();
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
