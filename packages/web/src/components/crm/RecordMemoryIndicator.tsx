// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Brain } from 'lucide-react';
import { cn } from '@/lib/utils';

type RecordMemoryIndicatorProps = {
  count?: number;
  className?: string;
};

export function RecordMemoryIndicator({ count = 0, className }: RecordMemoryIndicatorProps) {
  if (count <= 0) return null;

  const label = `${count} confirmed Memory ${count === 1 ? 'entry' : 'entries'}`;

  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-1.5 text-[11px] font-semibold text-emerald-500 dark:text-emerald-300',
        className,
      )}
    >
      <Brain className="h-3 w-3" />
      {count > 1 && <span>{count}</span>}
    </span>
  );
}
