// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useAccount } from '@/api/hooks';
import { ContactAvatar } from './ContactAvatar';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
import { Sparkles, Globe, Users, DollarSign, Heart } from 'lucide-react';
import { accountStageConfig } from '@/lib/stageConfig';

function HealthBadge({ score }: { score: number }) {
  const color = score >= 80 ? 'text-green-400 bg-green-500/15' : score >= 50 ? 'text-yellow-400 bg-yellow-500/15' : 'text-red-400 bg-red-500/15';
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${color}`}>
      <Heart className="w-3 h-3" /> {score}
    </span>
  );
}

function StageBadge({ stage }: { stage: string }) {
  const config = accountStageConfig[stage] ?? { label: stage, color: '#94a3b8' };
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border"
      style={{ borderColor: config.color, color: config.color, backgroundColor: `${config.color}15` }}
    >
      {config.label}
    </span>
  );
}

function formatRevenue(revenue: number) {
  if (revenue >= 1_000_000) return `$${(revenue / 1_000_000).toFixed(1)}M`;
  if (revenue >= 1_000) return `$${(revenue / 1_000).toFixed(0)}K`;
  return `$${revenue}`;
}

export function AccountDrawer() {
  const { drawerEntityId, openAIWithContext, closeDrawer } = useAppStore();
  const navigate = useNavigate();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: account, isLoading } = useAccount(drawerEntityId ?? '') as any;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-6 animate-pulse">
        <div className="flex gap-4">
          <div className="w-14 h-14 rounded-2xl bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-muted rounded w-3/4" />
            <div className="h-3 bg-muted rounded w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  if (!account) {
    return <div className="p-4 text-muted-foreground">Account not found</div>;
  }

  const name: string = account.name ?? '';
  const industry: string = account.industry ?? '';
  const website: string = account.website ?? '';
  const revenue: number = account.revenue ?? 0;
  const employeeCount: number = account.employee_count ?? account.employeeCount ?? 0;
  const healthScore: number = account.health_score ?? account.healthScore ?? 0;
  const stage: string = account.stage ?? '';

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-start gap-4">
          <ContactAvatar name={name} className="w-14 h-14 rounded-2xl text-lg" />
          <div className="flex-1">
            <h2 className="font-display font-extrabold text-xl text-foreground">{name}</h2>
            {industry && <p className="text-sm text-muted-foreground">{industry}</p>}
            <div className="flex items-center gap-2 mt-2">
              {stage && <StageBadge stage={stage} />}
              {healthScore > 0 && <HealthBadge score={healthScore} />}
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          {website && (
            <a
              href={website.startsWith('http') ? website : `https://${website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-all press-scale"
            >
              <Globe className="w-3.5 h-3.5" /> Website
            </a>
          )}
          <button
            onClick={() => {
              openAIWithContext({ type: 'account', id: account.id, name, detail: industry });
              closeDrawer();
              navigate('/agent');
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-accent/30 bg-accent/5 text-accent text-sm font-semibold hover:bg-accent/10 transition-all ml-auto press-scale"
          >
            <Sparkles className="w-3.5 h-3.5" /> Ask AI
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 p-4 mx-4 mt-4">
        {[
          { icon: DollarSign, label: 'Revenue', value: revenue ? formatRevenue(revenue) : '—' },
          { icon: Users, label: 'Employees', value: employeeCount ? String(employeeCount) : '—' },
          { icon: Heart, label: 'Health', value: healthScore ? String(healthScore) : '—' },
        ].map((stat) => (
          <div key={stat.label} className="bg-muted/50 rounded-xl p-3 text-center">
            <stat.icon className="w-4 h-4 text-muted-foreground mx-auto mb-1" />
            <p className="text-sm font-display font-bold text-foreground">{stat.value}</p>
            <p className="text-[10px] text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Details */}
      <div className="p-4 mx-4 mt-2 space-y-3">
        <h3 className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide">Details</h3>
        {[
          { label: 'Industry', value: industry },
          { label: 'Website', value: website },
          { label: 'Created', value: account.created_at ? new Date(account.created_at as string).toLocaleDateString() : undefined },
        ]
          .filter((f) => f.value)
          .map((field) => (
            <div key={field.label} className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{field.label}</span>
              <span className="text-sm text-foreground">{field.value}</span>
            </div>
          ))}
      </div>

      {/* Description */}
      {account.description && (
        <div className="p-4 mx-4 mt-2 mb-6">
          <h3 className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide mb-2">About</h3>
          <p className="text-sm text-foreground leading-relaxed">{account.description as string}</p>
        </div>
      )}
    </div>
  );
}
