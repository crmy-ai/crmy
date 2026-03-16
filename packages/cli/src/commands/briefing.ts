// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';

export function briefingCommand(): Command {
  const cmd = new Command('briefing')
    .description('Get a unified briefing for any CRM object — everything you need before taking action')
    .argument('<subject>', 'Subject as type:UUID (e.g. contact:550e8400-...)')
    .option('--format <fmt>', 'Output format (json or text)', 'text')
    .option('--since <duration>', 'Filter activities by duration (e.g. 7d, 24h)')
    .option('--context-types <types>', 'Comma-separated context types to include')
    .option('--include-stale', 'Include superseded context entries')
    .action(async (subject, opts) => {
      const [subjectType, subjectId] = subject.split(':');
      if (!subjectType || !subjectId) {
        console.error('Subject must be in format type:UUID (e.g. contact:550e8400-...)');
        process.exit(1);
      }

      const client = await getClient();
      const result = await client.call('briefing_get', {
        subject_type: subjectType,
        subject_id: subjectId,
        format: opts.format,
        since: opts.since,
        context_types: opts.contextTypes ? opts.contextTypes.split(',') : undefined,
        include_stale: opts.includeStale ?? false,
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
