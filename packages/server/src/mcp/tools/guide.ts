// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { guideSearch } from '@crmy/shared';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ActorContext } from '@crmy/shared';
import type { ToolDef } from '../server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve guide path relative to the server package root → repo root → docs/guide.md
const GUIDE_PATH = resolve(__dirname, '../../../../..', 'docs/guide.md');

interface GuideSection {
  title: string;
  content: string;
}

let cachedSections: GuideSection[] | null = null;

/**
 * Parse the user guide into H2 sections on first call, then cache.
 */
function getSections(): GuideSection[] {
  if (cachedSections) return cachedSections;

  let raw: string;
  try {
    raw = readFileSync(GUIDE_PATH, 'utf-8');
  } catch {
    return [];
  }

  const sections: GuideSection[] = [];
  const lines = raw.split('\n');
  let currentTitle = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentTitle) {
        sections.push({ title: currentTitle, content: currentLines.join('\n').trim() });
      }
      currentTitle = line.slice(3).trim();
      currentLines = [];
    } else if (currentTitle) {
      currentLines.push(line);
    }
  }
  // Push last section
  if (currentTitle) {
    sections.push({ title: currentTitle, content: currentLines.join('\n').trim() });
  }

  cachedSections = sections;
  return sections;
}

/**
 * Score a section against a search query using simple keyword matching.
 * Returns 0 if no match.
 */
function scoreSection(section: GuideSection, query: string): number {
  const q = query.toLowerCase();
  const title = section.title.toLowerCase();
  const body = section.content.toLowerCase();

  // Exact title match is highest priority
  if (title === q) return 100;

  let score = 0;

  // Title contains query
  if (title.includes(q)) score += 50;

  // Split query into words and match individually
  const words = q.split(/\s+/).filter(w => w.length > 2);
  for (const word of words) {
    if (title.includes(word)) score += 20;
    // Count body occurrences (capped)
    const bodyMatches = (body.match(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
    score += Math.min(bodyMatches, 10) * 2;
  }

  return score;
}

const MAX_RESULT_LENGTH = 6000;

const workflowGuideInput = z.object({
  workflow: z.enum([
    'first_steps',
    'record_lookup',
    'brief_before_action',
    'ingest_raw_context',
    'review_signals',
    'promote_memory',
    'customer_outreach',
    'record_update',
    'systems_writeback',
    'ops_recovery',
  ]).default('first_steps').describe('The customer workflow you are trying to perform. Use first_steps when unsure.'),
});

const WORKFLOW_GUIDES: Record<z.infer<typeof workflowGuideInput>['workflow'], {
  summary: string;
  recommended_tools: string[];
  avoid_tools?: string[];
  next_step: string;
}> = {
  first_steps: {
    summary: 'Start with identity, record resolution, and a briefing before choosing specialized tools.',
    recommended_tools: ['actor_whoami', 'customer_record_resolve', 'action_context_get', 'briefing_get', 'context_find', 'guide_search'],
    avoid_tools: ['context_add for raw notes', 'direct record writes before fetching the record and relevant Action Context', 'admin/ops tools unless doing incident response'],
    next_step: 'If you have a customer name or text, call customer_record_resolve. If you already have a subject_id, call briefing_get or action_context_get.',
  },
  record_lookup: {
    summary: 'Resolve customer references account-first across accounts, contacts, opportunities, and use cases.',
    recommended_tools: ['customer_record_resolve', 'action_context_get', 'briefing_get', 'context_find'],
    avoid_tools: ['entity_resolve unless you only need simple account/contact compatibility lookup'],
    next_step: 'Call customer_record_resolve with query or text, then use the resolved subject with briefing_get.',
  },
  brief_before_action: {
    summary: 'Load current Memory, Signals, stale warnings, source authority, policy checks, and retrieval proof before acting.',
    recommended_tools: ['action_context_get', 'briefing_get', 'context_find', 'context_get'],
    avoid_tools: ['customer-facing actions that ignore Action Context warnings', 'record_update/writeback tools without policy/source checks'],
    next_step: 'Call action_context_get with proposed_action when you need the operating mode: inform, warn, or require_review.',
  },
  ingest_raw_context: {
    summary: 'Send transcripts, emails, meeting notes, research, and other messy source text through Raw Context ingestion.',
    recommended_tools: ['context_ingest_auto', 'context_ingest', 'context_raw_source_get', 'context_signal_group_list'],
    avoid_tools: ['context_add for messy source text', 'manually splitting transcripts into Memory entries'],
    next_step: 'Use context_ingest_auto when subject IDs are unknown; use context_ingest when you already know subject_type and subject_id.',
  },
  review_signals: {
    summary: 'Inspect unconfirmed evidence-backed Signals and decide whether they need details, handoff, rejection, or confirmation.',
    recommended_tools: ['context_find', 'context_signal_group_get', 'context_signal_group_complete_details', 'context_signal_handoff', 'context_signal_group_reject'],
    avoid_tools: ['context_signal_group_promote when readiness is blocked and no human/policy approval exists'],
    next_step: 'Call context_signal_group_list with attention_only=true, then inspect one group with context_signal_group_get.',
  },
  promote_memory: {
    summary: 'Turn reviewed or policy-approved Signals into Current Memory.',
    recommended_tools: ['context_find', 'context_signal_group_get', 'context_signal_group_promote', 'briefing_get'],
    avoid_tools: ['context_add memory_status=active unless the user gave reviewed Current Memory directly'],
    next_step: 'Use context_find mode="signals" or context_signal_group_get to confirm evidence/readiness first, then promote the Signal group.',
  },
  customer_outreach: {
    summary: 'Prepare customer communication from confirmed context, visible warnings, and policy checks.',
    recommended_tools: ['action_context_get', 'briefing_get', 'email_draft_preview', 'activity_create', 'contact_outreach'],
    avoid_tools: ['message_send or email_draft_save before user approval unless your policy explicitly allows it'],
    next_step: 'Call action_context_get with proposed_action="customer_outreach"; draft freely when mode is inform/warn, and route execution to review when mode is require_review.',
  },
  record_update: {
    summary: 'Preview governed record changes before mutating CRM objects.',
    recommended_tools: ['action_context_get', 'record_draft_preview', 'contact_update', 'account_update', 'opportunity_update'],
    avoid_tools: ['direct updates based only on unconfirmed Signals', 'allow_duplicates without presenting candidates'],
    next_step: 'Call action_context_get with proposed_action="record_update", then preview changes; execute only when the operating mode and policy permit it.',
  },
  systems_writeback: {
    summary: 'External system writes require systems scopes, object write scopes, source authority checks, and review.',
    recommended_tools: ['sor_mapping_list', 'sor_writeback_preview', 'sor_writeback_request', 'sor_writeback_review', 'sor_writeback_execute'],
    avoid_tools: ['sor_writeback_execute without approved request/review', 'systems tools in ordinary customer-reasoning agents'],
    next_step: 'Start with sor_mapping_list and sor_writeback_preview; request/review/execute only when authorized.',
  },
  ops_recovery: {
    summary: 'Operator-only durability and data-quality workflows for stuck jobs, Raw Context retries, audit, privacy, and retention.',
    recommended_tools: ['ops_status_get', 'ops_data_quality_get', 'ops_data_quality_repair', 'ops_job_recover', 'ops_audit_get'],
    avoid_tools: ['ops repair tools outside admin/owner incident response', 'dry_run=false before reviewing counts'],
    next_step: 'Call ops_status_get or ops_data_quality_get first. For repairs, keep dry_run=true until an operator confirms.',
  },
};

export function guideTools(): ToolDef[] {
  return [
    {
      name: 'tool_guide',
      tier: 'core',
      description:
        'Start here when you are unsure which CRMy MCP tool to use. Returns the recommended tools, tools to avoid, and next step for common workflows such as record lookup, briefing, Raw Context ingestion, Signal review, Memory promotion, customer outreach, record updates, systems writeback, and ops recovery. This tool does not mutate data.',
      inputSchema: workflowGuideInput,
      handler: async (input: z.infer<typeof workflowGuideInput>, _actor: ActorContext) => {
        const workflow = input.workflow ?? 'first_steps';
        return {
          workflow,
          ...WORKFLOW_GUIDES[workflow],
          reminder: 'Use scoped agent credentials so the model only sees tools needed for its job. Avoid admin/full manifests for ordinary customer workflows.',
        };
      },
    },
    {
      name: 'guide_search',
      tier: 'core',
      description:
        'Search the CRMy user guide for documentation about a feature, concept, or workflow. ' +
        'Use this tool when the user asks "how does X work?", "what is X?", or needs help understanding any CRMy feature. ' +
        'Returns the most relevant guide sections. Available topics include: contacts, accounts, opportunities, activities, ' +
        'actors, assignments, context engine, briefings, identity resolution, type registries, scope enforcement, ' +
        'use cases, notes, workflows, webhooks, email, custom fields, HITL, analytics, plugins, MCP tools, REST API, ' +
        'configuration, authentication, and more.',
      inputSchema: guideSearch,
      handler: async (input: z.infer<typeof guideSearch>, _actor: ActorContext) => {
        const sections = getSections();
        if (!sections.length) {
          return { error: 'User guide not found' };
        }

        // If an exact section is requested, return it directly
        if (input.section) {
          const exact = sections.find(
            s => s.title.toLowerCase() === input.section!.toLowerCase(),
          );
          if (exact) {
            return {
              sections: [{ title: exact.title, content: exact.content.slice(0, MAX_RESULT_LENGTH) }],
              available_sections: sections.map(s => s.title),
            };
          }
        }

        // Score and rank sections
        const scored = sections
          .map(s => ({ ...s, score: scoreSection(s, input.query) }))
          .filter(s => s.score > 0)
          .sort((a, b) => b.score - a.score);

        if (!scored.length) {
          return {
            message: `No guide sections matched "${input.query}". Try a different query or browse available sections.`,
            available_sections: sections.map(s => s.title),
          };
        }

        // Return top 3 matches, truncating if needed
        const results = scored.slice(0, 3).map(s => ({
          title: s.title,
          content: s.content.slice(0, MAX_RESULT_LENGTH),
        }));

        return {
          sections: results,
          available_sections: sections.map(s => s.title),
        };
      },
    },
  ];
}
