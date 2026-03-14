// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useContact, useActivities } from '@/api/hooks';
import { ContactAvatar } from './ContactAvatar';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
import { StageBadge, LeadScoreBadge } from './CrmWidgets';
import { Phone, Mail, StickyNote, Sparkles } from 'lucide-react';

export function ContactDrawer() {
  const { drawerEntityId, openAIWithContext, closeDrawer } = useAppStore();
  const navigate = useNavigate();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: contact, isLoading } = useContact(drawerEntityId ?? '') as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: activitiesData } = useActivities({ contact_id: drawerEntityId ?? undefined, limit: 20 }) as any;
  const activities: any[] = activitiesData?.data ?? [];

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

  if (!contact) {
    return <div className="p-4 text-muted-foreground">Contact not found</div>;
  }

  const name: string = contact.name ?? '';
  const company: string = contact.company ?? '';
  const stage: string = contact.stage ?? '';
  const leadScore: number = contact.lead_score ?? contact.leadScore ?? 0;

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-start gap-4">
          <ContactAvatar name={name} className="w-14 h-14 rounded-2xl text-lg" />
          <div className="flex-1">
            <h2 className="font-display font-extrabold text-xl text-foreground">{name}</h2>
            {company && <p className="text-sm text-muted-foreground">{company}</p>}
            <div className="flex items-center gap-2 mt-2">
              {stage && <StageBadge stage={stage} />}
              {leadScore > 0 && <LeadScoreBadge score={leadScore} />}
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          {contact.phone && (
            <a
              href={`tel:${contact.phone}`}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-all press-scale"
            >
              <Phone className="w-3.5 h-3.5" /> Call
            </a>
          )}
          {contact.email && (
            <a
              href={`mailto:${contact.email}`}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-all press-scale"
            >
              <Mail className="w-3.5 h-3.5" /> Email
            </a>
          )}
          <button className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-all press-scale">
            <StickyNote className="w-3.5 h-3.5" /> Note
          </button>
          <button
            onClick={() => {
              openAIWithContext({ type: 'contact', id: contact.id, name, detail: company });
              closeDrawer();
              navigate('/agent');
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-accent/30 bg-accent/5 text-accent text-sm font-semibold hover:bg-accent/10 transition-all ml-auto press-scale"
          >
            <Sparkles className="w-3.5 h-3.5" /> Ask AI
          </button>
        </div>
      </div>

      {/* Details */}
      <div className="p-4 mx-4 mt-4 space-y-3">
        <h3 className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide">Details</h3>
        {[
          { label: 'Email', value: contact.email },
          { label: 'Phone', value: contact.phone },
          { label: 'Company', value: company },
          { label: 'Source', value: contact.source },
          { label: 'Last Contacted', value: contact.last_contacted_at ? new Date(contact.last_contacted_at).toLocaleDateString() : undefined },
          { label: 'Created', value: contact.created_at ? new Date(contact.created_at).toLocaleDateString() : undefined },
        ]
          .filter((f) => f.value)
          .map((field) => (
            <div key={field.label} className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{field.label}</span>
              <span className="text-sm text-foreground">{field.value}</span>
            </div>
          ))}
        {contact.tags && contact.tags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            {(contact.tags as string[]).map((tag: string) => (
              <span key={tag} className="px-2.5 py-1 rounded-lg bg-muted text-xs text-muted-foreground font-medium">{tag}</span>
            ))}
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="p-4 mx-4 mt-4 mb-6">
        <h3 className="text-xs font-display font-bold text-muted-foreground uppercase tracking-wide mb-3">Timeline</h3>
        <div className="space-y-3">
          {activities.map((a: any) => (
            <div key={a.id as string} className="flex gap-3">
              <div className="w-7 h-7 rounded-xl bg-muted flex items-center justify-center text-xs flex-shrink-0">
                {a.type === 'call' ? '📞' : a.type === 'email' ? '✉️' : a.type === 'meeting' ? '🤝' : a.type === 'task' ? '✅' : '📝'}
              </div>
              <div>
                <p className="text-sm text-foreground">{(a.description ?? a.body ?? a.type) as string}</p>
                <p className="text-xs text-muted-foreground">
                  {a.created_at ? new Date(a.created_at as string).toLocaleDateString() : ''}
                </p>
              </div>
            </div>
          ))}
          {activities.length === 0 && (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
