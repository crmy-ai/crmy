// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ElementType } from 'react';

export type StatusChipTone = 'ready' | 'action' | 'watch';

export function StatusChip({
  icon: Icon,
  label,
  value,
  tone,
  className = '',
}: {
  icon: ElementType;
  label: string;
  value: string | number;
  tone: StatusChipTone;
  className?: string;
}) {
  const color = tone === 'ready'
    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    : tone === 'watch'
      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
      : 'bg-primary/10 text-primary';

  return (
    <div className={`inline-flex min-w-0 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 ${className}`}>
      <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${color}`}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="block truncate text-sm font-semibold text-foreground">{value}</span>
      </span>
    </div>
  );
}
