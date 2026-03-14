// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useOpportunity } from '@/api/hooks';
import { ContactAvatar } from './ContactAvatar';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
import { StageBadge } from './CrmWidgets';
import { Sparkles, TrendingUp, Calendar, User } from 'lucide-react';

export function DealDrawer() {
  const { drawerEntityId, openAIWithContext, closeDrawer } = useAppStore();
  const navigate = useNavigate();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: deal, isLoading } = useOpportunity(drawerEntityId ?? '') as any;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-6 animate-pulse">
        <div className="h-6 bg-muted rounded w-3/4" />
        <div className="h-4 bg-muted rounded w-1/2" />
      </div>
    );
  }

  if (!deal) {
    return <div className="p-4 text-muted-foreground">Deal not found</div>;
  }

  const name: string = deal.name ?? '';
  const amount: number = deal.amount ?? 0;
  const stage: string = deal.stage ?? '';
  const probability: number = deal.probability ?? 0;
  const contactName: string = deal.contact_name ?? deal.contactName ?? '';
  const contactId: string = deal.contact_id ?? deal.contactId ?? '';
  const daysInStage: number = deal.days_in_stage ?? deal.daysInStage ?? 0;

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <h2 className="font-display font-extrabold text-xl text-foreground">{name}</h2>
        <p className="text-3xl font-display font-extrabold text-foreground mt-2">
          ${amount >= 1000 ? `${(amount / 1000).toFixed(0)}K` : amount}
        </p>
        <div className="flex items-center gap-2 mt-3">
          {stage && <StageBadge stage={stage} />}
          {probability > 0 && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-accent/10 text-accent">
              {probability}% probability
            </span>
          )}
        </div>
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => {
              openAIWithContext({ type: 'deal', id: deal.id, name, detail: `$${(amount / 1000).toFixed(0)}K` });
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
          { icon: TrendingUp, label: 'Probability', value: `${probability}%` },
          { icon: Calendar, label: 'Days in Stage', value: `${daysInStage}d` },
          { icon: User, label: 'Contact', value: contactName || '—' },
        ].map((stat) => (
          <div key={stat.label} className="bg-muted/50 rounded-xl p-3 text-center">
            <stat.icon className="w-4 h-4 text-muted-foreground mx-auto mb-1" />
            <p className="text-sm font-display font-bold text-foreground truncate">{stat.value}</p>
            <p className="text-[10px] text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Contact link */}
      {contactName && (
        <div className="p-4 mx-4 mt-2">
          <h3 className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide mb-3">Contact</h3>
          <button
            onClick={() => {
              closeDrawer();
              if (contactId) {
                setTimeout(() => useAppStore.getState().openDrawer('contact', contactId), 200);
              }
            }}
            className="flex items-center gap-3 w-full p-3 rounded-xl bg-muted/50 hover:bg-muted transition-colors text-left press-scale"
          >
            <ContactAvatar name={contactName} className="w-8 h-8 rounded-full text-xs" />
            <span className="text-sm font-semibold text-foreground">{contactName}</span>
          </button>
        </div>
      )}

      {/* Details */}
      <div className="p-4 mx-4 mt-2 mb-6 space-y-3">
        <h3 className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide">Details</h3>
        {[
          { label: 'Stage', value: stage },
          { label: 'Close Date', value: deal.close_date ? new Date(deal.close_date as string).toLocaleDateString() : undefined },
          { label: 'Owner', value: deal.owner_name as string | undefined },
          { label: 'Created', value: deal.created_at ? new Date(deal.created_at as string).toLocaleDateString() : undefined },
        ]
          .filter((f) => f.value)
          .map((field) => (
            <div key={field.label} className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{field.label}</span>
              <span className="text-sm text-foreground">{field.value}</span>
            </div>
          ))}
        {deal.notes && (
          <div>
            <p className="text-xs text-muted-foreground mb-1">Notes</p>
            <p className="text-sm text-foreground leading-relaxed">{deal.notes as string}</p>
          </div>
        )}
      </div>
    </div>
  );
}
