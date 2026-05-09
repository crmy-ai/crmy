// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function CompactList({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-2xl border border-border bg-card p-3 shadow-sm', className)}
      {...props}
    />
  );
}

export function CompactListRow({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-xl transition-colors hover:bg-muted/40', className)}
      {...props}
    />
  );
}
