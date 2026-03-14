// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useUseCase, useUseCaseTimeline } from '@/api/hooks';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
import { Sparkles, Calendar, Bot, DollarSign } from 'lucide-react';
import { useCaseStageConfig } from '@/lib/stageConfig';

function UseCaseStageBadge({ stage }: { stage: string }) {
  const config = useCaseStageConfig[stage] ?? { label: stage, color: '#94a3b8' };
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold"
      style={{ backgroundColor: config.color + '18', color: config.color }}
    >
      {config.label}
    </span>
  );
}

export function UseCaseDrawer() {
  const { drawerEntityId, openAIWithContext, closeDrawer } = useAppStore();
  const navigate = useNavigate();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: useCase, isLoading } = useUseCase(drawerEntityId ?? '') as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: timelineData } = useUseCaseTimeline(drawerEntityId ?? '') as any;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-6 animate-pulse">
        <div className="h-6 bg-muted rounded w-3/4" />
        <div className="h-4 bg-muted rounded w-1/2" />
      </div>
    );
  }

  if (!useCase) {
    return <div className="p-4 text-muted-foreground">Use case not found</div>;
  }

  const name: string = useCase.name ?? '';
  const client: string = useCase.client ?? useCase.account_name ?? '';
  const stage: string = useCase.stage ?? '';
  const arr: number = useCase.attributed_arr ?? useCase.attributedARR ?? 0;
  const daysActive: number = useCase.days_active ?? useCase.daysActive ?? 0;
  const assignedAgent: string = useCase.assigned_agent ?? useCase.assignedAgent ?? '';

  const timeline: Array<Record<string, unknown>> = timelineData?.data ?? timelineData ?? [];

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <h2 className="font-display font-extrabold text-xl text-foreground">{name}</h2>
        {client && <p className="text-sm text-muted-foreground mt-1">{client}</p>}
        <div className="flex items-center gap-2 mt-3">
          {stage && <UseCaseStageBadge stage={stage} />}
        </div>
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => {
              openAIWithContext({ type: 'use-case', id: useCase.id, name, detail: client });
              closeDrawer();
              navigate('/agent');
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-accent/30 bg-accent/5 text-accent text-sm font-semibold hover:bg-accent/10 transition-all press-scale"
          >
            <Sparkles className="w-3.5 h-3.5" /> Ask AI
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 p-4 mx-4 mt-4">
        {[
          { icon: DollarSign, label: 'Attributed ARR', value: arr ? `$${(arr / 1000).toFixed(0)}K` : '—' },
          { icon: Calendar, label: 'Days Active', value: `${daysActive}d` },
          { icon: Bot, label: 'Agent', value: assignedAgent || '—' },
        ].map((stat) => (
          <div key={stat.label} className="bg-muted/50 rounded-xl p-3 text-center">
            <stat.icon className="w-4 h-4 text-muted-foreground mx-auto mb-1" />
            <p className="text-sm font-display font-bold text-foreground truncate">{stat.value}</p>
            <p className="text-[10px] text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Details */}
      <div className="p-4 mx-4 mt-2 space-y-3">
        <h3 className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide">Details</h3>
        {[
          { label: 'Stage', value: stage },
          { label: 'Client', value: client },
          { label: 'Agent', value: assignedAgent },
          { label: 'Created', value: useCase.created_at ? new Date(useCase.created_at as string).toLocaleDateString() : undefined },
        ]
          .filter((f) => f.value)
          .map((field) => (
            <div key={field.label} className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{field.label}</span>
              <span className="text-sm text-foreground">{field.value}</span>
            </div>
          ))}
      </div>

      {/* Timeline */}
      {timeline.length > 0 && (
        <div className="p-4 mx-4 mt-2 mb-6">
          <h3 className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide mb-3">Timeline</h3>
          <div className="space-y-3">
            {timeline.map((event, i) => (
              <div key={(event.id as string) ?? i} className="flex gap-3">
                <div className="w-7 h-7 rounded-xl bg-muted flex items-center justify-center text-xs flex-shrink-0">
                  {event.type === 'stage_change' ? '🔄' : event.type === 'health_update' ? '💚' : '📝'}
                </div>
                <div>
                  <p className="text-sm text-foreground">{(event.description ?? event.note ?? event.type) as string}</p>
                  <p className="text-xs text-muted-foreground">
                    {event.created_at ? new Date(event.created_at as string).toLocaleDateString() : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
