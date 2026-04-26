// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * VariableAwareField
 *
 * A drop-in replacement for <input> and <textarea> inside the sequence step
 * builder. Detects when the user types `{{` and shows an inline autocomplete
 * popover of available variable tokens positioned at the caret.
 *
 * Features:
 * - Triggers on `{{` keypress
 * - Filters suggestions by partially-typed token (e.g. `{{contact.fi`)
 * - Arrow + Enter/Tab navigation; Escape closes
 * - On select: replaces `{{[partial]` with full `{{token}}`, cursor placed after `}}`
 * - A small `{}` button in the label area acts as a visible affordance for
 *   mouse users (same pattern as WorkflowVariablePicker)
 *
 * Variable namespaces exposed:
 *   contact.*       contact.first_name, last_name, email, title, company_name, lifecycle_stage
 *   account.*       account.name, industry, website, annual_revenue
 *   opportunity.*   opportunity.name, stage, amount, close_date
 *   enrollment.*    enrollment.objective, step, sequence_name
 *   variables.*     any enrollment.variables keys (passed via extraVariables prop)
 */

import {
  useState, useRef, useEffect, useCallback,
  type ChangeEvent, type KeyboardEvent,
} from 'react';
import { Braces } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Variable catalogue ─────────────────────────────────────────────────────────

interface VariableToken {
  path: string;
  label: string;
  group: string;
}

const BASE_VARIABLES: VariableToken[] = [
  // Contact
  { path: 'contact.first_name',    label: 'First name',       group: 'Contact' },
  { path: 'contact.last_name',     label: 'Last name',        group: 'Contact' },
  { path: 'contact.email',         label: 'Email',            group: 'Contact' },
  { path: 'contact.title',         label: 'Job title',        group: 'Contact' },
  { path: 'contact.company_name',  label: 'Company',          group: 'Contact' },
  { path: 'contact.lifecycle_stage', label: 'Lifecycle stage', group: 'Contact' },
  // Account
  { path: 'account.name',          label: 'Account name',     group: 'Account' },
  { path: 'account.industry',      label: 'Industry',         group: 'Account' },
  { path: 'account.website',       label: 'Website',          group: 'Account' },
  { path: 'account.annual_revenue', label: 'Annual revenue',  group: 'Account' },
  // Opportunity
  { path: 'opportunity.name',      label: 'Opp. name',        group: 'Opportunity' },
  { path: 'opportunity.stage',     label: 'Stage',            group: 'Opportunity' },
  { path: 'opportunity.amount',    label: 'Amount',           group: 'Opportunity' },
  { path: 'opportunity.close_date', label: 'Close date',      group: 'Opportunity' },
  // Enrollment
  { path: 'enrollment.objective',  label: 'Objective',        group: 'Enrollment' },
  { path: 'enrollment.step',       label: 'Step #',           group: 'Enrollment' },
  { path: 'enrollment.sequence_name', label: 'Sequence name', group: 'Enrollment' },
];

// ── Component ──────────────────────────────────────────────────────────────────

type FieldAs = 'input' | 'textarea';

interface Props {
  as?: FieldAs;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
  /** Additional enrollment variable keys surfaced as completions under the "Variables" group. */
  extraVariables?: Record<string, unknown>;
  disabled?: boolean;
  label?: string;
}

export function VariableAwareField({
  as = 'input',
  value,
  onChange,
  placeholder,
  className,
  rows = 3,
  extraVariables,
  disabled,
  label,
}: Props) {
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({ position: 'fixed' });
  const [partial, setPartial] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);

  // Build full variable list including dynamic enrollment variables
  const allVars = useCallback((): VariableToken[] => {
    const extra: VariableToken[] = Object.keys(extraVariables ?? {}).map(k => ({
      path: `variables.${k}`,
      label: k,
      group: 'Variables',
    }));
    return [...BASE_VARIABLES, ...extra];
  }, [extraVariables]);

  // Filter suggestions based on partial text after `{{`
  const suggestions = allVars().filter(v =>
    partial === '' || v.path.toLowerCase().includes(partial.toLowerCase()),
  );

  // Reset active index when suggestions change
  useEffect(() => { setActiveIdx(0); }, [partial]);

  // Close popover on outside click or scroll (fixed-position popover can drift on scroll)
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        fieldRef.current && !fieldRef.current.contains(e.target as Node)
      ) {
        setPopoverOpen(false);
      }
    }
    function handleScroll() { setPopoverOpen(false); }
    if (popoverOpen) {
      document.addEventListener('mousedown', handleOutside);
      window.addEventListener('scroll', handleScroll, true); // capture phase catches nested scrollers
    }
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [popoverOpen]);

  /** Returns the text before the caret in the current field value */
  function getBeforeCaret(): string {
    const el = fieldRef.current;
    if (!el) return value;
    return value.slice(0, el.selectionStart ?? value.length);
  }

  /** Find the `{{` opener position in the text before the caret. Returns -1 if none. */
  function findOpenBrace(text: string): number {
    const idx = text.lastIndexOf('{{');
    if (idx === -1) return -1;
    // Only active if there's no closing `}}` after the opener
    if (text.indexOf('}}', idx) !== -1) return -1;
    return idx;
  }

  function handleChange(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const newVal = e.target.value;
    onChange(newVal);

    const before = newVal.slice(0, e.target.selectionStart ?? newVal.length);
    const braceIdx = findOpenBrace(before);
    if (braceIdx !== -1) {
      setPartial(before.slice(braceIdx + 2));
      openPopoverAtCaret(e.target as HTMLInputElement);
    } else {
      setPopoverOpen(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (!popoverOpen) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIdx(i => Math.min(i + 1, suggestions.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIdx(i => Math.max(i - 1, 0));
        break;
      case 'Tab':
      case 'Enter':
        if (suggestions[activeIdx]) {
          e.preventDefault();
          insertVariable(suggestions[activeIdx].path);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setPopoverOpen(false);
        break;
    }
  }

  function insertVariable(path: string) {
    const el = fieldRef.current;
    if (!el) return;

    const caretPos = el.selectionStart ?? value.length;
    const before = value.slice(0, caretPos);
    const after = value.slice(caretPos);
    const braceIdx = findOpenBrace(before);
    if (braceIdx === -1) return;

    const newVal = before.slice(0, braceIdx) + `{{${path}}}` + after;
    onChange(newVal);
    setPopoverOpen(false);

    // Restore cursor position after the inserted token
    const newCaret = braceIdx + path.length + 4; // `{{` + path + `}}`
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(newCaret, newCaret);
    });
  }

  function openPopoverAtCaret(el: HTMLInputElement | HTMLTextAreaElement) {
    // Use fixed positioning so the popover escapes overflow:hidden ancestors
    // (step cards use overflow-hidden to clip their rounded-corner header background).
    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const popoverHeight = 240; // max-h-52 ≈ 208px + header row

    // Flip above the field if there isn't enough space below
    const spaceBelow = viewportHeight - rect.bottom;
    const openAbove = spaceBelow < popoverHeight + 8 && rect.top > popoverHeight + 8;

    setPopoverStyle({
      position: 'fixed',
      left: rect.left,
      top: openAbove ? rect.top - popoverHeight - 4 : rect.bottom + 4,
      minWidth: rect.width,
      maxWidth: Math.min(rect.width, 320),
    });
    setPopoverOpen(true);
  }

  function handleButtonInsert() {
    const el = fieldRef.current;
    if (!el) return;
    // Insert `{{` at caret to trigger the popover
    const caretPos = el.selectionStart ?? value.length;
    const newVal = value.slice(0, caretPos) + '{{' + value.slice(caretPos);
    onChange(newVal);
    setPartial('');
    openPopoverAtCaret(el);

    requestAnimationFrame(() => {
      el.focus();
      const newCaret = caretPos + 2;
      el.setSelectionRange(newCaret, newCaret);
    });
  }

  const fieldClass = cn(
    'w-full bg-muted/40 border border-border rounded-md px-2.5 py-1.5 text-sm',
    'placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    className,
  );

  const groupOrder = [...new Set(suggestions.map(s => s.group))];

  return (
    <div data-vaf-container className="relative">
      {/* Label row with {} button affordance */}
      {label && (
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground font-medium">{label}</span>
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => { e.preventDefault(); handleButtonInsert(); }}
            title="Insert variable"
            className="flex items-center gap-0.5 px-1 py-0.5 rounded text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-muted border border-border/60 transition-colors"
          >
            <Braces className="w-3 h-3" />
            <span className="text-xs">{'{{}}'}</span>
          </button>
        </div>
      )}

      {/* The actual field */}
      {as === 'textarea' ? (
        <textarea
          ref={fieldRef as React.RefObject<HTMLTextAreaElement>}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          className={cn(fieldClass, 'resize-none')}
        />
      ) : (
        <input
          ref={fieldRef as React.RefObject<HTMLInputElement>}
          type="text"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className={fieldClass}
        />
      )}

      {/* Autocomplete popover */}
      {popoverOpen && suggestions.length > 0 && (
        <div
          ref={popoverRef}
          style={popoverStyle}
          className="z-[9999] bg-popover border border-border rounded-lg shadow-xl overflow-hidden"
        >
          <div className="px-2.5 py-1 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Insert variable
          </div>
          <div className="max-h-52 overflow-y-auto">
            {groupOrder.map(group => {
              const items = suggestions.filter(s => s.group === group);
              return (
                <div key={group}>
                  <div className="px-2.5 py-1 text-xs font-semibold text-muted-foreground bg-muted/40 sticky top-0">
                    {group}
                  </div>
                  {items.map((s) => {
                    const flatIdx = suggestions.indexOf(s);
                    return (
                      <button
                        key={s.path}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          insertVariable(s.path);
                        }}
                        onMouseEnter={() => setActiveIdx(flatIdx)}
                        className={cn(
                          'w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center justify-between gap-2',
                          flatIdx === activeIdx ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                        )}
                      >
                        <span className="font-mono text-xs">{`{{${s.path}}}`}</span>
                        <span className="text-muted-foreground shrink-0 text-xs">{s.label}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
