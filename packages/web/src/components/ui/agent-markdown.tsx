// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * AgentMarkdown
 *
 * Renders agent response text as styled markdown using react-markdown + remark-gfm.
 * GFM adds: tables, strikethrough, task lists, autolinks.
 *
 * Design constraints:
 * - All colours use CSS variables (design tokens) so dark mode works automatically.
 * - Typography is sized relative to the parent `text-sm` context set by MessageBubble.
 * - No external stylesheet — styles are applied via Tailwind className props.
 * - Tables are horizontally scrollable so wide tables don't break the chat layout.
 * - Code blocks use a monospace font and a slightly inset background.
 * - Headings are toned down (no huge h1/h2) because agent responses are conversational,
 *   not full documents.
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

const INTERNAL_LABELS: Record<string, string> = {
  'context.signal_promote': 'Signal confirmation approval',
  'context.signal_review': 'Signal review',
  'external.writeback': 'System-of-record writeback',
  context_signal_group_promote: 'Confirm Signal',
  context_signal_promote: 'Confirm Signal',
  context_signal_group_get: 'Review Signal details',
  context_signal_group_list: 'Review Signals',
  context_signal_handoff: 'Send Signal for review',
  context_signal_group_reject: 'Dismiss Signal',
  context_signal_group_complete_details: 'Add Signal details',
  context_ingest_auto: 'Add Context',
  action_context_get: 'Action Context',
  briefing_get: 'Briefing',
  hitl_submit_request: 'Request approval',
  hitl_check_status: 'Check approval status',
  hitl_list_pending: 'Pending approvals',
  deal_risk: 'Deal risk',
  stakeholder: 'Stakeholder',
  stakeholder_role: 'Stakeholder role',
  key_fact: 'Key fact',
  commitment: 'Commitment',
  next_step: 'Next step',
  objection: 'Objection',
  competitive_intel: 'Competitive intel',
  methodology_gap: 'Methodology gap',
  success_criteria: 'Success criteria',
  buying_process: 'Buying process',
  forecast_signal: 'Forecast signal',
  ready_to_confirm: 'Ready for Memory',
  subject_type: 'Record type',
  subject_id: 'Record',
  context_entries: 'Memory entries',
  evaluation_criteria: 'Evaluation criteria',
  readiness_status: 'Readiness',
  readiness_score: 'Readiness score',
  missing_details: 'Missing details',
  readiness_blockers: 'Readiness blockers',
  unmapped_details: 'Unmapped details',
  extraction_completeness: 'Extraction completeness',
  confidence: 'Confidence',
  owner: 'Owner',
  summary: 'Summary',
  evidence: 'Evidence',
};

const INTERNAL_IDENTIFIER_PREFIXES = [
  'account_',
  'action_',
  'activity_',
  'assignment_',
  'briefing_',
  'calendar_',
  'contact_',
  'context_',
  'customer_record_',
  'email_',
  'entity_',
  'hitl_',
  'opportunity_',
  'pipeline_',
  'record_draft_',
  'sequence_',
  'sor_',
  'use_case_',
  'workflow_',
];

function safeHref(href?: string): string | undefined {
  if (!href) return undefined;
  if (href.startsWith('/') || href.startsWith('#')) return href;
  try {
    const parsed = new URL(href);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? href : undefined;
  } catch {
    return undefined;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function internalLabelPattern(): string {
  return Object.keys(INTERNAL_LABELS)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
}

function isLikelyInternalIdentifier(value: string): boolean {
  if (INTERNAL_LABELS[value]) return true;
  if (!/^[a-z][a-z0-9]*(?:[_.][a-z0-9]+){1,}$/.test(value)) return false;
  return INTERNAL_IDENTIFIER_PREFIXES.some(prefix => value.startsWith(prefix))
    || value.includes('.') && /^(context|external|action)\./.test(value);
}

function humanizeIdentifier(value: string): string {
  return INTERNAL_LABELS[value]
    ?? value
      .replace(/[_.]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, letter => letter.toUpperCase());
}

function isLikelyInternalSchemaFragment(value: string): boolean {
  const normalized = value.trim().replace(/^`+|`+$/g, '').trim();
  if (!normalized || normalized.length > 160) return false;
  const lines = normalized.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length > 3) return false;
  return lines.every(line => {
    if (INTERNAL_LABELS[line]) return true;
    const keyValue = line.match(/^([a-z][a-z0-9_]*(?:[_.][a-z0-9]+)*):\s*([A-Za-z0-9 _.-]+)$/);
    if (keyValue) return Boolean(INTERNAL_LABELS[keyValue[1]]) || isLikelyInternalIdentifier(keyValue[1]);
    return isLikelyInternalIdentifier(line);
  });
}

function humanizeSchemaFragment(value: string): string {
  const normalized = value.trim().replace(/^`+|`+$/g, '').trim();
  const keyValue = normalized.match(/^([a-z][a-z0-9_]*(?:[_.][a-z0-9]+)*):\s*([A-Za-z0-9 _.-]+)$/);
  if (keyValue) {
    const [, key, rawValue] = keyValue;
    const label = humanizeIdentifier(key);
    const displayValue = rawValue.replace(/_/g, ' ').trim();
    if (key === 'subject_type') return `${displayValue.replace(/\b\w/g, char => char.toUpperCase())} record`;
    return `${label}: ${displayValue}`;
  }
  return humanizeIdentifier(normalized);
}

function normalizeSanitizedPunctuation(value: string): string {
  return value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\(\s*\)/g, '')
    .replace(/\(\s*\n+\s*\)/g, '')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/([(\[])\s+/g, '$1')
    .replace(/\s+([)\]])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeAgentDisplay(content: string): string {
  const pattern = internalLabelPattern();
  let sanitized = content;
  const internalIdPattern = String.raw`(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{6,}\.{3,}[0-9a-f]{2,})`;

  // Keep leaked internal record IDs from becoming visually heavy code blocks in agent prose.
  sanitized = sanitized.replace(new RegExp(String.raw`\s*\(\s*` + internalIdPattern + String.raw`\s*\)`, 'gi'), '');
  sanitized = sanitized.replace(new RegExp(String.raw`\s*\(\s*` + '`' + internalIdPattern + '`' + String.raw`\s*\)`, 'gi'), '');
  sanitized = sanitized.replace(new RegExp('\\s*\\(\\s*```\\s*' + internalIdPattern + '\\s*```\\s*\\)', 'gi'), '');
  sanitized = sanitized.replace(new RegExp('```\\s*' + internalIdPattern + '\\s*```', 'gi'), '');
  sanitized = sanitized.replace(new RegExp('`(' + internalIdPattern + ')`', 'gi'), 'record reference');

  sanitized = sanitized.replace(/\s*\(\s*```\s*([\s\S]{1,220}?)\s*```\s*\)/g, (match, fragment: string) =>
    isLikelyInternalSchemaFragment(fragment) ? '' : match,
  );
  sanitized = sanitized.replace(/```\s*([\s\S]{1,220}?)\s*```/g, (match, fragment: string) =>
    isLikelyInternalSchemaFragment(fragment) ? humanizeSchemaFragment(fragment) : match,
  );
  sanitized = sanitized.replace(/\s*\(\s*`([^`\n]{1,160})`\s*\)/g, (match, fragment: string) =>
    isLikelyInternalSchemaFragment(fragment) ? '' : match,
  );
  sanitized = sanitized.replace(/`([^`\n]{1,160})`/g, (match, fragment: string) =>
    isLikelyInternalSchemaFragment(fragment) ? humanizeSchemaFragment(fragment) : match,
  );

  if (!pattern) return normalizeSanitizedPunctuation(sanitized);
  sanitized = sanitized.replace(
    new RegExp('```\\s*(' + pattern + ')\\s*```', 'g'),
    (_match, identifier: string) => humanizeIdentifier(identifier),
  );
  sanitized = sanitized.replace(/```\s*([a-z][a-z0-9]*(?:[_.][a-z0-9]+){1,})\s*```/g, (match, identifier: string) =>
    isLikelyInternalIdentifier(identifier) ? humanizeIdentifier(identifier) : match,
  );
  sanitized = sanitized.replace(
    new RegExp('`(' + pattern + ')`', 'g'),
    (_match, identifier: string) => humanizeIdentifier(identifier),
  );
  sanitized = sanitized.replace(/`([a-z][a-z0-9]*(?:[_.][a-z0-9]+){1,})`/g, (match, identifier: string) =>
    isLikelyInternalIdentifier(identifier) ? humanizeIdentifier(identifier) : match,
  );
  sanitized = sanitized.replace(
    new RegExp('(^|[^A-Za-z0-9_.-])(' + pattern + ')(?=$|[^A-Za-z0-9_.-])', 'g'),
    (_match, prefix: string, identifier: string) => `${prefix}${humanizeIdentifier(identifier)}`,
  );
  return normalizeSanitizedPunctuation(sanitized);
}

// Prose component map — each key maps to a styled wrapper for that HTML element.
const components: Components = {
  // ── Block elements ───────────────────────────────────────────────────────────

  p({ children }) {
    return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>;
  },

  h1({ children }) {
    return <h1 className="text-base font-semibold text-foreground mt-4 mb-2 first:mt-0">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="text-sm font-semibold text-foreground mt-3 mb-1.5 first:mt-0">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="text-sm font-semibold text-foreground/80 mt-3 mb-1 first:mt-0">{children}</h3>;
  },
  h4({ children }) {
    return <h4 className="text-sm font-medium text-foreground/70 mt-2 mb-1 first:mt-0">{children}</h4>;
  },
  h5({ children }) {
    return <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-2 mb-1 first:mt-0">{children}</h5>;
  },
  h6({ children }) {
    return <h6 className="text-xs font-semibold text-muted-foreground mt-2 mb-1 first:mt-0">{children}</h6>;
  },

  ul({ children }) {
    return <ul className="mb-2 last:mb-0 pl-5 space-y-0.5 list-disc marker:text-muted-foreground/60">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="mb-2 last:mb-0 pl-5 space-y-0.5 list-decimal marker:text-muted-foreground/60">{children}</ol>;
  },
  li({ children }) {
    return <li className="leading-relaxed">{children}</li>;
  },

  blockquote({ children }) {
    return (
      <blockquote className="border-l-2 border-primary/30 pl-3 my-2 text-muted-foreground italic">
        {children}
      </blockquote>
    );
  },

  hr() {
    return <hr className="my-3 border-border" />;
  },

  // ── Code ─────────────────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  code({ inline, className, children, ...props }: any) {
    // react-markdown passes `inline` for backtick spans vs fenced blocks
    if (inline) {
      return (
        <code
          className="font-mono text-[0.82em] bg-muted/70 text-foreground/90 px-1 py-0.5 rounded border border-border/50"
          {...props}
        >
          {children}
        </code>
      );
    }
    // Extract language hint from "language-xxx" class if present
    const lang = className?.replace('language-', '') ?? '';
    return (
      <div className="my-2 last:mb-0 rounded-lg border border-border overflow-hidden">
        {lang && (
          <div className="px-3 py-1 bg-muted/60 border-b border-border text-[10px] font-mono text-muted-foreground uppercase tracking-wider select-none">
            {lang}
          </div>
        )}
        <pre className="overflow-x-auto bg-muted/30 p-3 text-[0.82em] leading-relaxed">
          <code className="font-mono text-foreground/90" {...props}>
            {children}
          </code>
        </pre>
      </div>
    );
  },

  // ── Tables ───────────────────────────────────────────────────────────────────

  table({ children }) {
    return (
      <div className="my-2 last:mb-0 w-full overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs border-collapse">{children}</table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="bg-muted/50">{children}</thead>;
  },
  tbody({ children }) {
    return <tbody className="divide-y divide-border">{children}</tbody>;
  },
  tr({ children }) {
    return <tr className="hover:bg-muted/20 transition-colors">{children}</tr>;
  },
  th({ children }) {
    return (
      <th className="px-3 py-2 text-left font-semibold text-foreground/80 whitespace-nowrap border-b border-border">
        {children}
      </th>
    );
  },
  td({ children }) {
    return <td className="px-3 py-2 text-foreground/80 align-top">{children}</td>;
  },

  // ── Inline ───────────────────────────────────────────────────────────────────

  strong({ children }) {
    return <strong className="font-semibold text-foreground">{children}</strong>;
  },
  em({ children }) {
    return <em className="italic text-foreground/80">{children}</em>;
  },
  del({ children }) {
    return <del className="line-through text-muted-foreground">{children}</del>;
  },

  a({ href, children }) {
    const safe = safeHref(href);
    if (!safe) return <span className="text-foreground/80">{children}</span>;
    return (
      <a
        href={safe}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
      >
        {children}
      </a>
    );
  },
};

interface AgentMarkdownProps {
  content: string;
}

export function AgentMarkdown({ content }: AgentMarkdownProps) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {sanitizeAgentDisplay(content)}
    </ReactMarkdown>
  );
}
