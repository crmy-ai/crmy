// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';
import { resolveSubjectRef } from './subject-ref.js';

export function knowledgeCommand(): Command {
  const cmd = new Command('knowledge')
    .description('Governed product knowledge retrieval (optional capability)');

  cmd.command('retrieve <query>')
    .description('Retrieve approved, source-grounded, cited product/competitive claims for a customer action')
    .option('--subject <ref>', 'Customer subject as type:name or type:id to tailor relevance (e.g. account:Northstar Labs)')
    .option('--audience <audience>', 'customer_facing (strict) or internal (labeled)', 'customer_facing')
    .option('--competitor <name>', 'Competitor to focus on')
    .option('--persona <name>', 'Buyer persona')
    .option('--industry <name>', 'Customer industry')
    .option('--product-scope <list>', 'Comma-separated product/edition scopes')
    .option('--include-stale', 'Include stale claims (internal audience only)')
    .option('--limit <n>', 'Maximum claims to return', '8')
    .option('--json', 'Print raw JSON')
    .action(async (query, opts) => {
      const client = await getClient();
      let subject_type: string | undefined;
      let subject_id: string | undefined;
      if (opts.subject) {
        const resolved = await resolveSubjectRef(client, opts.subject);
        subject_type = resolved.subject_type;
        subject_id = resolved.subject_id;
      }
      const result = await client.call('knowledge_retrieve', {
        query,
        subject_type,
        subject_id,
        audience: opts.audience,
        competitor: opts.competitor,
        persona: opts.persona,
        industry: opts.industry,
        product_scope: opts.productScope ? String(opts.productScope).split(',').map((s: string) => s.trim()).filter(Boolean) : undefined,
        include_stale: opts.includeStale ?? false,
        limit: Number(opts.limit) || 8,
      });
      const data = JSON.parse(result);

      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        await client.close();
        return;
      }

      console.log(`Status: ${data.status}`);
      if (data.message) console.log(data.message);
      for (const claim of data.claims ?? []) {
        const cite = claim.citations?.[0];
        console.log(`\n• [${claim.category}] ${claim.title}`);
        console.log(`  ${claim.body}`);
        if (cite) console.log(`  Source: ${cite.source_label}${cite.source_url ? ` (${cite.source_url})` : ''}`);
      }
      if ((data.excluded_claims ?? []).length > 0) {
        console.log(`\n${data.excluded_claims.length} claim(s) excluded (not customer-safe): ${data.excluded_claims.map((e: { reason: string }) => e.reason).join(', ')}`);
      }
      for (const warning of data.warnings ?? []) console.log(`⚠ ${warning}`);
      if (data.retrieval_receipt) {
        console.log(`\nReceipt: ${data.retrieval_receipt.id} (policy: ${data.retrieval_receipt.policy})`);
      }
      await client.close();
    });

  return cmd;
}
