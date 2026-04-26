// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useRef, useEffect } from 'react';
import { Braces } from 'lucide-react';
import { getSuggestionsForTrigger, type VariableSuggestion } from '@/lib/workflowConstants';

interface Props {
  triggerEvent: string;
  onInsert: (token: string) => void;
}

export function WorkflowVariablePicker({ triggerEvent, onInsert }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const suggestions = getSuggestionsForTrigger(triggerEvent);
  const groups = [...new Set(suggestions.map(s => s.group))];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Insert variable"
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-muted border border-border transition-colors"
      >
        <Braces className="w-3 h-3" />
        <span>&#123;&#123;&#125;&#125;</span>
      </button>

      {open && (
        <div className="absolute z-50 right-0 top-full mt-1 w-52 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
          <div className="px-2.5 py-1.5 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Insert variable
          </div>
          <div className="max-h-56 overflow-y-auto">
            {groups.map(group => {
              const items = suggestions.filter((s: VariableSuggestion) => s.group === group);
              return (
                <div key={group}>
                  <div className="px-2.5 py-1 text-xs font-semibold text-muted-foreground bg-muted/40">
                    {group}
                  </div>
                  {items.map((s: VariableSuggestion) => (
                    <button
                      key={s.path}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onInsert(`{{${s.path}}}`);
                        setOpen(false);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors flex items-center justify-between gap-2"
                    >
                      <span className="font-mono text-xs text-foreground">&#123;&#123;{s.path}&#125;&#125;</span>
                      <span className="text-muted-foreground shrink-0 text-xs">{s.label}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
