// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Copy } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';

export function CopyIconButton({
  value,
  label,
  className = '',
}: {
  value?: string | null;
  label: string;
  className?: string;
}) {
  const copyValue = value?.trim();
  if (!copyValue) return null;

  return (
    <button
      type="button"
      title={`Copy ${label.toLowerCase()}`}
      aria-label={`Copy ${label.toLowerCase()}`}
      onClick={(event) => {
        event.stopPropagation();
        navigator.clipboard.writeText(copyValue)
          .then(() => toast({ title: `${label} copied` }))
          .catch(() => toast({
            title: `Could not copy ${label.toLowerCase()}`,
            description: 'Your browser blocked clipboard access.',
            variant: 'destructive',
          }));
      }}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${className}`}
    >
      <Copy className="h-3.5 w-3.5" />
    </button>
  );
}
