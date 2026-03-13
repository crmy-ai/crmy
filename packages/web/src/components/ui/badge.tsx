// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { HTMLAttributes } from 'react';
import { cn } from './utils';

const variantStyles: Record<string, string> = {
  default: 'bg-primary text-primary-foreground',
  secondary: 'bg-secondary text-secondary-foreground',
  destructive: 'bg-destructive text-destructive-foreground',
  outline: 'border text-foreground',
  success: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-800',
};

interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof variantStyles;
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full border-transparent px-2.5 py-0.5 font-mono text-xs font-semibold transition-colors',
        variantStyles[variant] || variantStyles.default,
        className,
      )}
      {...props}
    />
  );
}
