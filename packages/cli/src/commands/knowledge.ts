// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { getClient } from '../client.js';
import { resolveSubjectRef } from './subject-ref.js';

export function knowledgeCommand(): Command {
  const cmd = new Command('knowledge')
    .description('Trusted Fact retrieval (optional governed capability)');

  cmd.command('retrieve <query>')
    .description('Retrieve approved, source-grounded Trusted Facts for a customer action')
    .option('--subject <ref>', 'Customer subject as type:name or type:id to tailor relevance (e.g. account:Northstar Labs)')
    .option('--audience <audience>', 'customer_facing (strict) or internal (labeled)', 'customer_facing')
    .option('--competitor <name>', 'Competitor to focus on')
    .option('--persona <name>', 'Buyer persona')
    .option('--industry <name>', 'Customer industry')
    .option('--product-scope <list>', 'Comma-separated product/edition scopes')
    .option('--include-stale', 'Include stale facts (internal audience only)')
    .option('--limit <n>', 'Maximum facts to return', '8')
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
        console.log(`\n${data.excluded_claims.length} fact(s) excluded (not customer-safe): ${data.excluded_claims.map((e: { reason: string }) => e.reason).join(', ')}`);
      }
      for (const warning of data.warnings ?? []) console.log(`⚠ ${warning}`);
      if (data.retrieval_receipt) {
        console.log(`\nReceipt: ${data.retrieval_receipt.id} (policy: ${data.retrieval_receipt.policy})`);
      }
      await client.close();
    });

  // --- Governance (Phase 7) ---

  cmd.command('list')
    .description('List Trusted Facts for the admin review queue')
    .option('--status <status>', 'active | stale | deprecated | conflicting | rejected')
    .option('--approval <status>', 'approved | pending | unapproved | rejected')
    .option('--needs-review', 'Only facts that are stale, conflicting, or pending approval')
    .option('--query <text>', 'Full-text filter over title/body/summary')
    .option('--limit <n>', 'Maximum facts to return', '25')
    .option('--json', 'Print raw JSON')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('knowledge_claim_list', {
        status: opts.status,
        approval_status: opts.approval,
        needs_review: opts.needsReview ?? undefined,
        query: opts.query,
        limit: Number(opts.limit) || 25,
      });
      const data = JSON.parse(result);
      if (opts.json) { console.log(JSON.stringify(data, null, 2)); await client.close(); return; }
      console.log(`${data.count ?? 0} fact(s):`);
      for (const c of data.claims ?? []) {
        const ext = c.approved_for_external_use ? 'external-ok' : 'internal-only';
        console.log(`\n• ${c.id}`);
        console.log(`  [${c.category}] ${c.title}`);
        console.log(`  status=${c.status} approval=${c.approval_status} ${ext} priority=${c.source_priority}`);
        if (c.valid_until) console.log(`  valid_until=${c.valid_until}`);
      }
      await client.close();
    });

  cmd.command('review <claimId>')
    .description('Apply a governance decision to a Trusted Fact')
    .requiredOption('--decision <decision>', 'approve | reject | deprecate | mark_stale | reactivate')
    .option('--external-use <bool>', 'Set customer-facing eligibility (true/false); honored with approve')
    .option('--owner <actorId>', 'Assign or transfer the review owner')
    .option('--json', 'Print raw JSON')
    .action(async (claimId, opts) => {
      const client = await getClient();
      const externalUse = opts.externalUse === undefined ? undefined : /^(true|1|yes)$/i.test(String(opts.externalUse));
      const result = await client.call('knowledge_claim_review', {
        id: claimId,
        decision: opts.decision,
        approved_for_external_use: externalUse,
        review_owner_id: opts.owner,
      });
      const data = JSON.parse(result);
      if (opts.json) { console.log(JSON.stringify(data, null, 2)); await client.close(); return; }
      if (data.error) { console.log(data.message ?? data.error); await client.close(); return; }
      console.log(`✓ ${data.id}: status=${data.status} approval=${data.approval_status} external=${data.approved_for_external_use}`);
      await client.close();
    });

  cmd.command('conflicts')
    .description('Detect competing Trusted Facts and recommend source-priority resolution')
    .option('--category <name>', 'Limit to one fact category')
    .option('--competitor <name>', 'Limit to facts about one competitor')
    .option('--apply', 'Mark the lower-priority fact of each resolvable conflict as conflicting')
    .option('--limit <n>', 'Maximum facts to scan', '50')
    .option('--json', 'Print raw JSON')
    .action(async (opts) => {
      const client = await getClient();
      const result = await client.call('knowledge_conflicts_detect', {
        category: opts.category,
        competitor: opts.competitor,
        apply: opts.apply ?? false,
        limit: Number(opts.limit) || 50,
      });
      const data = JSON.parse(result);
      if (opts.json) { console.log(JSON.stringify(data, null, 2)); await client.close(); return; }
      const conflicts = data.conflicts ?? [];
      console.log(`${conflicts.length} conflict(s)${data.applied ? `, ${data.applied} marked conflicting` : ''}:`);
      for (const c of conflicts) {
        console.log(`\n• [${c.category}] ${c.suggested_action} (by ${c.basis}: ${(c.shared ?? []).join(', ')})`);
        console.log(`  ${c.detail}`);
      }
      await client.close();
    });

  return cmd;
}
