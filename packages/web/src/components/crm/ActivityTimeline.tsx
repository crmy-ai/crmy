// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { activityIcon } from './CrmWidgets';
import { useAppStore } from '@/store/appStore';
import { Bot } from 'lucide-react';

const OUTCOME_COLORS: Record<string, string> = {
  connected: 'hsl(152, 55%, 42%)',
  positive: 'hsl(152, 55%, 42%)',
  voicemail: 'hsl(38, 92%, 50%)',
  neutral: 'hsl(38, 92%, 50%)',
  follow_up_needed: 'hsl(38, 92%, 50%)',
  negative: 'hsl(var(--destructive))',
  no_show: 'hsl(var(--destructive))',
};

type DrawerType = 'contact' | 'opportunity' | 'use-case' | 'account';
const SUBJECT_TYPE_DRAWER: Record<string, DrawerType> = {
  contact: 'contact',
  account: 'account',
  opportunity: 'opportunity',
  use_case: 'use-case',
};

export interface TimelineActivity {
  id: string;
  type: string;
  subject?: string;
  description?: string;
  body?: string;
  note?: string;
  created_at?: string;
  occurred_at?: string;
  outcome?: string;
  performed_by?: string;
  performer_name?: string;
  subject_type?: string;
  subject_id?: string;
  contact_id?: string;
}

interface ActivityTimelineProps {
  activities: TimelineActivity[];
  emptyMessage?: string;
}

export function ActivityTimeline({ activities, emptyMessage = 'No activity yet.' }: ActivityTimelineProps) {
  const { openDrawer } = useAppStore();

  if (activities.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="space-y-1">
      {activities.map((a, i) => {
        const desc = a.description ?? a.body ?? a.note ?? a.subject ?? '';
        const ts = a.occurred_at ?? a.created_at ?? '';
        const hasSubjectLink = a.subject_type && a.subject_id;
        const isClickable = hasSubjectLink || !!a.contact_id;

        const handleClick = () => {
          if (hasSubjectLink) {
            const drawerType = SUBJECT_TYPE_DRAWER[a.subject_type!];
            if (drawerType) openDrawer(drawerType, a.subject_id!);
          } else if (a.contact_id) {
            openDrawer('contact', a.contact_id);
          }
        };

        return (
          <div
            key={a.id ?? i}
            className={`flex gap-3 py-2 ${isClickable ? 'cursor-pointer hover:bg-muted/40 rounded-xl px-2 -mx-2 transition-colors' : ''}`}
            onClick={isClickable ? handleClick : undefined}
          >
            <div className="w-7 h-7 rounded-xl bg-muted flex items-center justify-center text-muted-foreground flex-shrink-0 mt-0.5">
              {activityIcon(a.type)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-2">
                <p className="text-sm text-foreground flex-1 min-w-0 truncate">
                  {desc || a.type}
                </p>
                {a.outcome && (
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 rounded-md text-xs font-medium capitalize flex-shrink-0"
                    style={{
                      backgroundColor: (OUTCOME_COLORS[a.outcome] ?? 'hsl(var(--muted-foreground))') + '18',
                      color: OUTCOME_COLORS[a.outcome] ?? 'hsl(var(--muted-foreground))',
                    }}
                  >
                    {a.outcome.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                {a.performer_name && (
                  <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                    <Bot className="w-2.5 h-2.5" />
                    {a.performer_name}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {ts ? new Date(ts).toLocaleDateString() : ''}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
