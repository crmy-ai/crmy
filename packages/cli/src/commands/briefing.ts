// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';
import { resolveSubjectRef } from './subject-ref.js';

export function briefingCommand(): Command {
  const cmd = new Command('briefing')
    .description('Get a unified briefing for any customer record before taking action')
    .argument('<subject>', 'Subject as type:name or type:id, e.g. account:Northstar Labs')
    .option('--format <fmt>', 'Output format (json or text)', 'text')
    .option('--since <duration>', 'Filter activities by duration (e.g. 7d, 24h)')
    .option('--context-types <types>', 'Comma-separated context types to include')
    .option('--include-stale', 'Include superseded context entries')
    .option('--token-budget <tokens>', 'Approximate context token budget')
    .option('--token-profile <profile>', 'Token budget profile: tiny, standard, deep, or evidence_heavy')
    .option('--evidence-mode <mode>', 'Evidence detail: summary, full, or none', 'summary')
    .action(async (subject, opts) => {
      const client = await getClient();
      const resolved = await resolveSubjectRef(client, subject);
      if (!resolved.subject_type || !resolved.subject_id) {
        console.error('Subject must be type:name or type:id, for example account:Northstar Labs.');
        process.exit(1);
      }
      const result = await client.call('briefing_get', {
        subject_type: resolved.subject_type,
        subject_id: resolved.subject_id,
        format: opts.format,
        since: opts.since,
        context_types: opts.contextTypes ? opts.contextTypes.split(',') : undefined,
        include_stale: opts.includeStale ?? false,
        token_budget: opts.tokenBudget ? Number(opts.tokenBudget) : undefined,
        token_budget_profile: opts.tokenProfile,
        evidence_mode: opts.evidenceMode,
      });

      const data = JSON.parse(result);
      if (opts.format === 'text' && data.briefing_text) {
        console.log(data.briefing_text);
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
      await client.close();
    });

  return cmd;
}
