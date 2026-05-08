// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { LucideIcon } from 'lucide-react';
import { Database, Loader2 } from 'lucide-react';
import { useSeedSampleData } from '@/api/hooks';
import { toast } from '@/components/ui/use-toast';

interface EmptyAction {
  label: string;
  onClick: () => void;
}

export function SeedSampleDataButton({
  variant = 'secondary',
  className = '',
}: {
  variant?: 'primary' | 'secondary';
  className?: string;
}) {
  const seedSample = useSeedSampleData();

  const handleSeed = async () => {
    const confirmed = window.confirm(
      'Add CRMy sample data to this workspace? This inserts demo companies, contacts, opportunities, and context entries. Use it only in local, demo, or evaluation workspaces.',
    );
    if (!confirmed) return;
    try {
      await seedSample.mutateAsync(true);
      toast({
        title: 'Sample data added',
        description: 'Demo records are ready. Next: open a company or contact and generate a briefing.',
      });
    } catch (err) {
      toast({
        title: 'Could not add sample data',
        description: err instanceof Error ? err.message : 'Check your database connection and try again.',
        variant: 'destructive',
      });
    }
  };

  const classes = variant === 'primary'
    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
    : 'border border-border text-foreground hover:bg-muted';

  return (
    <button
      onClick={handleSeed}
      disabled={seedSample.isPending}
      className={`inline-flex items-center justify-center gap-2 h-9 px-3 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 ${classes} ${className}`}
    >
      {seedSample.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
      {seedSample.isPending ? 'Adding...' : 'Load sample data'}
    </button>
  );
}

export function OnboardingEmptyState({
  icon: Icon,
  title,
  description,
  primary,
  secondary,
  showSampleData = true,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  primary?: EmptyAction;
  secondary?: EmptyAction;
  showSampleData?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
        <Icon className="w-7 h-7 text-primary" />
      </div>
      <h2 className="text-base font-display font-semibold text-foreground mb-1">{title}</h2>
      <p className="text-sm text-muted-foreground max-w-md">{description}</p>
      <div className="flex flex-wrap items-center justify-center gap-2 mt-5">
        {primary && (
          <button
            onClick={primary.onClick}
            className="inline-flex items-center justify-center h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            {primary.label}
          </button>
        )}
        {secondary && (
          <button
            onClick={secondary.onClick}
            className="inline-flex items-center justify-center h-9 px-3 rounded-lg border border-border text-sm font-semibold text-foreground hover:bg-muted transition-colors"
          >
            {secondary.label}
          </button>
        )}
        {showSampleData && <SeedSampleDataButton />}
      </div>
    </div>
  );
}
