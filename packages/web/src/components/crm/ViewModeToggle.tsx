// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { LayoutGrid, List } from 'lucide-react';

export type ViewMode = 'cards' | 'table';

export function ViewModeToggle({
  value,
  onChange,
  className = '',
}: {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  className?: string;
}) {
  return (
    <div className={`hidden h-9 rounded-xl border border-border bg-muted p-0.5 md:inline-flex ${className}`}>
      <button
        type="button"
        onClick={() => onChange('cards')}
        className={`rounded-lg p-1.5 transition-all ${value === 'cards' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        aria-label="Card view"
        title="Card view"
      >
        <LayoutGrid className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onChange('table')}
        className={`rounded-lg p-1.5 transition-all ${value === 'table' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        aria-label="Table view"
        title="Table view"
      >
        <List className="h-4 w-4" />
      </button>
    </div>
  );
}
