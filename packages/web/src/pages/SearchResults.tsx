// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useSearchParams, useNavigate } from 'react-router-dom';
import type React from 'react';
import { Search, Users, Building2, Briefcase, FolderKanban, Activity, ClipboardList, FileText } from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { useSearch } from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { ENTITY_COLORS } from '@/lib/entityColors';
import { headerDescription } from '@/lib/headerCopy';
import { cn } from '@/lib/utils';

type Bucket = {
  key: string;
  label: string;
  icon: React.ElementType;
  color: string;
  items: any[];
  open: (item: any) => void;
  title: (item: any) => string;
  detail: (item: any) => string;
};

function contactName(c: any) {
  return (c.name ?? [c.first_name, c.last_name].filter(Boolean).join(' ') ?? c.email ?? 'Unnamed contact') as string;
}

export function SearchResultsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { openDrawer } = useAppStore();
  const q = searchParams.get('q') ?? '';
  const { data, isLoading } = useSearch(q) as any;

  const buckets: Bucket[] = [
    {
      key: 'contacts',
      label: 'Contacts',
      icon: Users,
      color: ENTITY_COLORS.contacts.text,
      items: data?.contacts ?? [],
      open: item => { navigate('/contacts'); openDrawer('contact', item.id); },
      title: contactName,
      detail: item => item.email ?? item.company_name ?? item.company ?? '',
    },
    {
      key: 'accounts',
      label: 'Companies',
      icon: Building2,
      color: ENTITY_COLORS.accounts.text,
      items: data?.accounts ?? [],
      open: item => { navigate('/companies'); openDrawer('account', item.id); },
      title: item => item.name ?? item.domain ?? 'Unnamed company',
      detail: item => item.domain ?? item.industry ?? '',
    },
    {
      key: 'opportunities',
      label: 'Opportunities',
      icon: Briefcase,
      color: ENTITY_COLORS.opportunities.text,
      items: data?.opportunities ?? [],
      open: item => { navigate('/opportunities'); openDrawer('opportunity', item.id); },
      title: item => item.name ?? 'Unnamed opportunity',
      detail: item => [item.stage, item.amount ? `$${(Number(item.amount) / 1000).toFixed(0)}K` : null].filter(Boolean).join(' · '),
    },
    {
      key: 'useCases',
      label: 'Use Cases',
      icon: FolderKanban,
      color: ENTITY_COLORS.useCases.text,
      items: data?.useCases ?? [],
      open: item => { navigate('/use-cases'); openDrawer('use-case', item.id); },
      title: item => item.name ?? 'Unnamed use case',
      detail: item => item.stage ?? item.description ?? '',
    },
    {
      key: 'activities',
      label: 'Activities',
      icon: Activity,
      color: ENTITY_COLORS.activities.text,
      items: data?.activities ?? [],
      open: () => navigate('/activities'),
      title: item => item.subject ?? item.body ?? 'Activity',
      detail: item => item.activity_type ?? item.type ?? '',
    },
    {
      key: 'assignments',
      label: 'Assignments',
      icon: ClipboardList,
      color: ENTITY_COLORS.assignments.text,
      items: data?.assignments ?? [],
      open: item => { navigate('/handoffs'); openDrawer('assignment', item.id); },
      title: item => item.title ?? 'Assignment',
      detail: item => [item.status, item.priority].filter(Boolean).join(' · '),
    },
    {
      key: 'contextEntries',
      label: 'Memory',
      icon: FileText,
      color: ENTITY_COLORS.context.text,
      items: data?.contextEntries ?? [],
      open: () => navigate('/context'),
      title: item => item.title ?? item.body ?? 'Context entry',
      detail: item => item.context_type ?? item.subject_type ?? '',
    },
  ];

  const total = buckets.reduce((sum, bucket) => sum + bucket.items.length, 0);

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Search"
        icon={Search}
        iconClassName="text-primary"
        description={q
          ? headerDescription(`Results for "${q}"`, total, 'result')
          : headerDescription('Search records and customer context', total, 'result')}
      />
      <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-24 md:pb-6 pt-2">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-16 rounded-xl bg-muted/50 animate-pulse" />)}
          </div>
        ) : total === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Search className="w-8 h-8 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-semibold text-foreground">No results found</p>
            <p className="text-sm text-muted-foreground mt-1">Try a customer name, company domain, email, deal, context phrase, or assignment title.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {buckets.filter(bucket => bucket.items.length > 0).map(bucket => {
              const Icon = bucket.icon;
              return (
                <section key={bucket.key} className="space-y-2">
                  <h2 className="text-xs font-display font-semibold uppercase tracking-wide text-muted-foreground">{bucket.label}</h2>
                  <div className="rounded-xl border border-border bg-card overflow-hidden">
                    {bucket.items.map(item => (
                      <button
                        key={item.id}
                        onClick={() => bucket.open(item)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                      >
                        <Icon className={cn('w-4 h-4 flex-shrink-0', bucket.color)} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-foreground truncate">{bucket.title(item)}</p>
                          {bucket.detail(item) && <p className="text-xs text-muted-foreground truncate">{bucket.detail(item)}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
