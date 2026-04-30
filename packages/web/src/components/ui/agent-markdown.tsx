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
    return (
      <a
        href={href}
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
      {content}
    </ReactMarkdown>
  );
}
