// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient, type CliClient } from '../client.js';

interface SmokeCheck {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

interface AgentSmokeResult {
  ok: boolean;
  account: {
    name: string;
    id?: string;
  };
  briefing: {
    memory_count: number;
    activity_count: number;
    assignment_count: number;
    signal_group_count: number;
  };
  signals: {
    count: number;
    examples: Array<{
      id?: string;
      title: string;
      status?: string;
      trust_score?: number;
    }>;
  };
  model_extraction?: {
    attempted: boolean;
    extracted_count: number;
    raw_context_source_id?: string;
    duplicate?: boolean;
  };
  checks: SmokeCheck[];
  prompt: string;
}

function pass(msg: string): void {
  console.log(`  \x1b[32m✓\x1b[0m  ${msg}`);
}

function fail(msg: string, fix?: string): void {
  console.log(`  \x1b[31m✗\x1b[0m  ${msg}`);
  if (fix) console.log(`     \x1b[2m→ ${fix}\x1b[0m`);
}

function info(msg: string): void {
  console.log(`  \x1b[36mℹ\x1b[0m  ${msg}`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') as Record<string, unknown>[] : [];
}

function candidateId(candidate: Record<string, unknown>): string | undefined {
  return typeof candidate.id === 'string'
    ? candidate.id
    : typeof candidate.entity_id === 'string'
      ? candidate.entity_id
      : undefined;
}

function candidateName(candidate: Record<string, unknown>): string {
  return String(candidate.name ?? candidate.label ?? candidate.title ?? candidate.email ?? candidate.id ?? 'unknown');
}

function countGroupedEntries(grouped: unknown): number {
  return Object.values(asRecord(grouped)).reduce<number>((sum, entries) => sum + asArray(entries).length, 0);
}

function parseToolResult(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (parsed.error) {
    throw new Error(String(parsed.error));
  }
  return parsed;
}

async function runTool(client: CliClient, toolName: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  return parseToolResult(await client.call(toolName, input));
}

export async function runAgentSmoke(options: {
  account?: string;
  signalLimit?: number;
  withModel?: boolean;
  json?: boolean;
  config?: string;
} = {}): Promise<AgentSmokeResult> {
  const accountName = options.account?.trim() || 'Northstar Labs';
  const signalLimit = options.signalLimit ?? 5;
  const checks: SmokeCheck[] = [];
  const prompt = `Use the CRMy MCP tools to resolve the customer record "${accountName}", get a briefing, list Signals that need attention, and tell me the safest next action with the evidence you used.`;
  let client: CliClient | undefined;
  let accountId: string | undefined;
  let memoryCount = 0;
  let activityCount = 0;
  let assignmentCount = 0;
  let briefingSignalGroupCount = 0;
  let signals: AgentSmokeResult['signals']['examples'] = [];
  let modelExtraction: AgentSmokeResult['model_extraction'] | undefined;

  try {
    client = await getClient(options.config);

    const resolved = await runTool(client, 'customer_record_resolve', {
      query: accountName,
      subject_type: 'account',
      limit: 5,
    });
    const resolvedSubjects = asArray(resolved.subjects);
    const resolvedRecord = resolvedSubjects.find(subject => subject.type === 'account') ?? {};
    accountId = candidateId(resolvedRecord);
    if (!accountId) {
      const candidates = asArray(resolved.skipped).flatMap(item => asArray(item.candidate_records));
      const candidateList = candidates.slice(0, 3).map(candidateName).join(', ');
      checks.push({
        name: 'customer_record_resolve',
        ok: false,
        detail: `Could not resolve account "${accountName}".${candidateList ? ` Candidates: ${candidateList}.` : ''}`,
        fix: 'Run `crmy seed-demo` or pass --account with an existing account name.',
      });
    } else {
      checks.push({
        name: 'customer_record_resolve',
        ok: true,
        detail: `Resolved account "${candidateName(resolvedRecord)}" (${accountId.slice(0, 8)}).`,
      });
    }

    if (accountId) {
      const briefingResult = await runTool(client, 'briefing_get', {
        subject_type: 'account',
        subject_id: accountId,
        format: 'json',
        context_radius: 'account_wide',
        token_budget: 4000,
      });
      const briefing = asRecord(briefingResult.briefing);
      memoryCount = countGroupedEntries(briefing.context_entries);
      activityCount = asArray(briefing.activities).length;
      assignmentCount = asArray(briefing.open_assignments).length;
      briefingSignalGroupCount = asArray(briefing.signal_groups).length;
      const hasBriefingContent = memoryCount + activityCount + assignmentCount + briefingSignalGroupCount > 0;
      checks.push({
        name: 'briefing_get',
        ok: hasBriefingContent,
        detail: hasBriefingContent
          ? `Briefing returned ${memoryCount} Memory item(s), ${activityCount} activity item(s), ${assignmentCount} open assignment(s), and ${briefingSignalGroupCount} Signal group(s).`
          : `Briefing resolved but contains no demo context for "${accountName}".`,
        fix: hasBriefingContent ? undefined : 'Run `crmy seed-demo` to load the Northstar Labs source-to-action demo.',
      });

      if (options.withModel) {
        const ingestResult = await runTool(client, 'context_ingest_auto', {
          source_label: 'Agent smoke model-backed extraction demo',
          source_occurred_at: '2026-01-15T17:00:00.000Z',
          idempotency_key: `agent-smoke-model:${accountId}`,
          confidence_threshold: 0.6,
          subjects: [{ type: 'account', id: accountId, name: accountName }],
          document:
            `${accountName} customer call note: Maya Patel may be the evaluation sponsor. ` +
            'The team wants a security review before expanding the rollout, and the next step is to schedule a technical validation session next Friday.',
        });
        const rawSource = asRecord(ingestResult.raw_context_source);
        const extractedCount = Number(
          ingestResult.extracted_count
          ?? ingestResult.entries_created
          ?? ingestResult.signals_created
          ?? 0,
        );
        const duplicate = Boolean(ingestResult.duplicate_of_raw_context_source_id);
        modelExtraction = {
          attempted: true,
          extracted_count: extractedCount,
          raw_context_source_id: typeof rawSource.id === 'string' ? rawSource.id : undefined,
          duplicate,
        };
        checks.push({
          name: 'context_ingest_auto',
          ok: extractedCount > 0 || duplicate,
          detail: duplicate
            ? 'Model-backed Raw Context extraction returned an existing idempotent receipt.'
            : `Model-backed Raw Context extraction produced ${extractedCount} context item(s).`,
          fix: extractedCount > 0 || duplicate
            ? undefined
            : 'Check Workspace Agent model settings, then try a shorter source or run `crmy doctor`.',
        });
      }
    }

    const signalResult = await runTool(client, 'context_signal_group_list', {
      attention_only: true,
      limit: signalLimit,
    });
    const signalGroups = asArray(signalResult.signal_groups ?? signalResult.data);
    signals = signalGroups.map(group => ({
      id: typeof group.id === 'string' ? group.id : undefined,
      title: String(group.title ?? group.normalized_claim ?? 'Untitled Signal'),
      status: typeof group.status === 'string' ? group.status : undefined,
      trust_score: typeof group.aggregate_confidence === 'number' ? Math.round(group.aggregate_confidence * 100) : undefined,
    }));
    checks.push({
      name: 'context_signal_group_list',
      ok: signals.length > 0,
      detail: signals.length > 0
        ? `Found ${signals.length} Signal(s) needing attention.`
        : 'No Signals needing attention found.',
      fix: signals.length > 0 ? undefined : 'Run `crmy seed-demo`, or ingest Raw Context that produces reviewable Signals.',
    });
  } catch (err) {
    checks.push({
      name: 'agent_smoke',
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      fix: 'Run `crmy doctor`, confirm DATABASE_URL/CRMY_API_KEY, then run `crmy seed-demo` if demo data is missing.',
    });
  } finally {
    await client?.close();
  }

  const result: AgentSmokeResult = {
    ok: checks.every(check => check.ok),
    account: { name: accountName, id: accountId },
    briefing: {
      memory_count: memoryCount,
      activity_count: activityCount,
      assignment_count: assignmentCount,
      signal_group_count: briefingSignalGroupCount,
    },
    signals: {
      count: signals.length,
      examples: signals,
    },
    model_extraction: modelExtraction,
    checks,
    prompt,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return result;
  }

  console.log('\n  CRMy Agent Smoke Test\n  ══════════════════════════════════════\n');
  for (const check of checks) {
    if (check.ok) pass(check.detail);
    else fail(check.detail, check.fix);
  }

  if (signals.length > 0) {
    console.log('\n  Signals needing attention:');
    for (const signal of signals.slice(0, 3)) {
      const score = signal.trust_score === undefined ? '' : ` · ${signal.trust_score}% trust`;
      const status = signal.status ? ` · ${signal.status}` : '';
      console.log(`  - ${signal.title}${status}${score}`);
    }
  }

  if (modelExtraction?.attempted) {
    const duplicate = modelExtraction.duplicate ? ' · existing receipt' : '';
    console.log(`\n  Model-backed extraction: ${modelExtraction.extracted_count} item(s)${duplicate}`);
  }

  console.log('\n  One-minute agent prompt:');
  console.log(`  \x1b[1m${prompt}\x1b[0m\n`);

  if (result.ok) {
    pass('Agent-facing CRMy tools are ready for the seeded demo path.');
  } else {
    info('This check expects seeded demo data. Run `crmy seed-demo` if Northstar Labs is missing.');
    process.exitCode = 1;
  }

  return result;
}

export function agentSmokeCommand(): Command {
  return new Command('agent-smoke')
    .description('Verify the one-minute agent demo path: resolve account, get briefing, list Signals')
    .option('--account <name>', 'Demo account name to resolve', 'Northstar Labs')
    .option('--signal-limit <n>', 'Signals to request from context_signal_group_list', '5')
    .option('--with-model', 'Also ingest a small Raw Context source through the configured Workspace Agent model')
    .option('--config <path>', 'Explicit path to a .crmy.json config file')
    .option('--json', 'Print machine-readable JSON')
    .action(async (opts) => {
      const signalLimit = Number.parseInt(opts.signalLimit, 10);
      await runAgentSmoke({
        account: opts.account,
        signalLimit: Number.isFinite(signalLimit) ? signalLimit : 5,
        withModel: Boolean(opts.withModel),
        config: opts.config,
        json: Boolean(opts.json),
      });
    });
}
