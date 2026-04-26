// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * VarField — input / textarea with inline {{ variable autocomplete.
 *
 * When the user types "{{" the component shows a filtered dropdown of variable
 * suggestions.  Selecting a suggestion inserts the full "{{path}}" token and
 * moves the cursor after it.  Keyboard nav: ↑ / ↓ to move, Enter / Tab to
 * confirm, Escape to dismiss.
 */

import { useRef, useState, useCallback } from 'react';
import { type VariableSuggestion } from '@/lib/workflowConstants';
import { Badge } from '@/components/ui/badge';

// ── Types ─────────────────────────────────────────────────────────────────────

interface VarFieldBase {
  value:       string;
  onChange:    (val: string) => void;
  placeholder?: string;
  className?:  string;
  suggestions: VariableSuggestion[];
  disabled?:   boolean;
  id?:         string;
}

export interface VarInputProps extends VarFieldBase {
  multiline?: false;
}

export interface VarTextareaProps extends VarFieldBase {
  multiline: true;
  rows?:     number;
}

export type VarFieldProps = VarInputProps | VarTextareaProps;

// ── Hook ──────────────────────────────────────────────────────────────────────

function useVarAutocomplete(
  value:       string,
  onChange:    (v: string) => void,
  suggestions: VariableSuggestion[],
) {
  const elRef       = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [open,      setOpen]      = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [partial,   setPartial]   = useState('');

  /** Variables whose path or label contains the partial text typed after {{ */
  const filtered = suggestions.filter(s =>
    partial === '' ||
    s.path.toLowerCase().includes(partial.toLowerCase()) ||
    s.label.toLowerCase().includes(partial.toLowerCase()),
  );

  /** Called on every keystroke — detects an open {{ before cursor */
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const v      = e.target.value;
      const cursor = e.target.selectionStart ?? v.length;
      onChange(v);

      const beforeCursor = v.slice(0, cursor);
      const match        = beforeCursor.match(/\{\{([^}\s]*)$/);
      if (match) {
        setPartial(match[1]);
        setOpen(true);
        setActiveIdx(0);
      } else {
        setOpen(false);
      }
    },
    [onChange],
  );

  /** Splice the chosen suggestion into the current value */
  const insert = useCallback(
    (s: VariableSuggestion) => {
      const el = elRef.current;
      if (!el) return;

      const cursor       = el.selectionStart ?? value.length;
      const beforeCursor = value.slice(0, cursor);
      const match        = beforeCursor.match(/\{\{([^}\s]*)$/);
      if (!match) return;

      const start     = cursor - match[0].length;
      const token     = `{{${s.path}}}`;
      const newValue  = value.slice(0, start) + token + value.slice(cursor);
      onChange(newValue);
      setOpen(false);

      const newCursor = start + token.length;
      requestAnimationFrame(() => {
        el.setSelectionRange(newCursor, newCursor);
        el.focus();
      });
    },
    [value, onChange],
  );

  /** Arrow keys, Enter/Tab to confirm, Escape to dismiss */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!open || filtered.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(i => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (filtered[activeIdx]) {
          e.preventDefault();
          insert(filtered[activeIdx]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    },
    [open, filtered, activeIdx, insert],
  );

  return { elRef, open, filtered, activeIdx, handleChange, handleKeyDown, insert, setOpen };
}

// ── Dropdown ──────────────────────────────────────────────────────────────────

function VarDropdown({
  open,
  items,
  activeIdx,
  onSelect,
}: {
  open:      boolean;
  items:     VariableSuggestion[];
  activeIdx: number;
  onSelect:  (s: VariableSuggestion) => void;
}) {
  if (!open || items.length === 0) return null;

  return (
    <div className="absolute left-0 right-0 z-[120] mt-0.5 bg-popover border border-border rounded-lg shadow-xl max-h-44 overflow-y-auto">
      {items.map((s, i) => (
        <button
          key={s.path}
          type="button"
          onMouseDown={e => { e.preventDefault(); onSelect(s); }}
          className={`w-full text-left px-3 py-2 flex items-center gap-2 text-xs transition-colors ${
            i === activeIdx ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60'
          }`}
        >
          <code className={`font-mono shrink-0 ${i === activeIdx ? 'text-primary' : 'text-primary/70'}`}>
            {'{{' + s.path + '}}'}
          </code>
          <span className="text-muted-foreground truncate">{s.label}</span>
          <Badge variant="outline" className="ml-auto shrink-0 text-xs px-1 py-0">
            {s.group}
          </Badge>
        </button>
      ))}
    </div>
  );
}

// ── VarField ──────────────────────────────────────────────────────────────────

export function VarField(props: VarFieldProps) {
  const { value, onChange, placeholder, className, suggestions, disabled, id } = props;
  const { elRef, open, filtered, activeIdx, handleChange, handleKeyDown, insert, setOpen } =
    useVarAutocomplete(value, onChange, suggestions);

  const shared = {
    ref: elRef,
    id,
    value,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    onBlur: () => setTimeout(() => setOpen(false), 150),
    placeholder,
    disabled,
    className,
    autoComplete: 'off' as const,
    spellCheck: false,
  };

  return (
    <div className="relative">
      {props.multiline ? (
        <textarea {...shared} rows={(props as VarTextareaProps).rows ?? 3} />
      ) : (
        <input {...shared} type="text" />
      )}
      <VarDropdown
        open={open}
        items={filtered}
        activeIdx={activeIdx}
        onSelect={insert}
      />
    </div>
  );
}
