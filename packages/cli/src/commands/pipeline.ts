import { Command } from 'commander';
import { getClient } from '../client.js';

export function pipelineCommand(): Command {
  return new Command('pipeline')
    .description('Show pipeline summary by stage')
    .action(async () => {
      const client = await getClient();
      const result = await client.call('pipeline_summary', { group_by: 'stage' });
      const data = JSON.parse(result);

      console.log(`\n  Pipeline: $${(data.total_value / 100).toLocaleString()} across ${data.count} opportunities\n`);

      if (data.by_stage?.length > 0) {
        console.table(data.by_stage.map((s: Record<string, unknown>) => ({
          stage: s.stage,
          count: s.count,
          value: `$${((s.value as number) / 100).toLocaleString()}`,
        })));
      }
      await client.close();
    });
}
