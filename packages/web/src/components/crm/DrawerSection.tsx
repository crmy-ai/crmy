// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface DrawerSectionProps {
  title: string;
  children: ReactNode;
  count?: number;
  defaultOpen?: boolean;
  className?: string;
  contentClassName?: string;
}

export function DrawerSection({
  title,
  children,
  count,
  defaultOpen = true,
  className = '',
  contentClassName = 'space-y-3',
}: DrawerSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`p-4 mx-4 mt-2 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="mb-2 flex w-full items-center gap-1.5 text-left"
        aria-expanded={open}
      >
        <h3 className="flex-1 text-xs font-display font-bold text-muted-foreground uppercase tracking-wide">
          {title}
          {typeof count === 'number' && (
            <span className="ml-1.5 font-mono font-normal text-muted-foreground/50">({count})</span>
          )}
        </h3>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
      {open && <div className={contentClassName}>{children}</div>}
    </section>
  );
}
