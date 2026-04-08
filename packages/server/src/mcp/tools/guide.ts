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

export function guideTools(): ToolDef[] {
  return [
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
