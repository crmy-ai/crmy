// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContactAvatar } from '@/components/crm/ContactAvatar';
import { TopBar } from '@/components/layout/TopBar';
import { OnboardingEmptyState } from '@/components/crm/OnboardingEmptyState';
import { useContacts } from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import { StageBadge, LeadScoreBadge } from '@/components/crm/CrmWidgets';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';
import { RecordMemoryIndicator } from '@/components/crm/RecordMemoryIndicator';
import { motion } from 'framer-motion';
import { LayoutGrid, List, Bot, ChevronUp, ChevronDown, Users, FileText } from 'lucide-react';
import { PaginationBar } from '@/components/crm/PaginationBar';
import { useIsMobile } from '@/hooks/use-mobile';
import { useRecordMemoryCounts } from '@/hooks/useRecordMemoryCounts';
import { stageConfig } from '@/lib/stageConfig';
import { headerDescription } from '@/lib/headerCopy';

type ViewMode = 'table' | 'cards';

const filterConfigs: FilterConfig[] = [
  { key: 'lifecycle_stage', label: 'Stage', options: Object.entries(stageConfig).map(([k, v]) => ({ value: k, label: v.label })) },
];

const sortOptions: SortOption[] = [
  { key: 'name', label: 'Name' },
  { key: 'company', label: 'Account' },
  { key: 'created_at', label: 'Created' },
  { key: 'lifecycle_stage', label: 'Stage' },
  { key: 'lead_score', label: 'Score' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Contact = any;

function displayName(c: Contact): string {
  const parts = [c.first_name, c.last_name].filter(Boolean);
  if (parts.length > 0) return parts.join(' ');
  return c.email || c.company_name || 'Unknown';
}

function companyName(c: Contact): string {
  return (c.account_name ?? c.company_name ?? c.company ?? '') as string;
}

export default function Contacts() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [view, setView] = useState<ViewMode>('table');
  const effectiveView = isMobile ? 'cards' : view;
  const { openDrawer, openQuickAdd, openAIWithContext, openDrawerBriefing } = useAppStore();
  const { enabled: agentEnabled } = useAgentSettings();
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, isLoading } = useContacts({ q: search || undefined, limit: 200 }) as any;
  const allContacts: Contact[] = data?.data ?? [];
  const memoryCounts = useRecordMemoryCounts('contact');

  const handleFilterChange = (key: string, values: string[]) => {
    setActiveFilters(prev => { const next = { ...prev }; if (values.length === 0) delete next[key]; else next[key] = values; return next; });
  };
  const handleSortChange = (key: string) => {
    setSort(prev => prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };

  const filtered = useMemo(() => {
    let result = [...allContacts];
    if (activeFilters.lifecycle_stage?.length) result = result.filter(c => activeFilters.lifecycle_stage.includes(c.lifecycle_stage as string));
    if (sort) {
      result.sort((a, b) => {
        const aVal = (sort.key === 'name' ? displayName(a) : sort.key === 'company' ? companyName(a) : a[sort.key] ?? '') as string | number;
        const bVal = (sort.key === 'name' ? displayName(b) : sort.key === 'company' ? companyName(b) : b[sort.key] ?? '') as string | number;
        if (typeof aVal === 'number' && typeof bVal === 'number') return sort.dir === 'asc' ? aVal - bVal : bVal - aVal;
        return sort.dir === 'asc' ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
      });
    }
    return result;
  }, [allContacts, activeFilters, sort]);

  useEffect(() => { setPage(1); }, [search, activeFilters, sort]);
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const SortHeader = ({ label, sortKey }: { label: string; sortKey: string }) => (
    <th onClick={() => handleSortChange(sortKey)}
      className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none">
      <span className="inline-flex items-center gap-1">
        {label}
        {sort?.key === sortKey ? (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : null}
      </span>
    </th>
  );

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Contacts"
        icon={Users}
        iconClassName="text-primary"
        description={headerDescription('Manage people and lifecycle stages', filtered.length, 'contact')}
      >
        <div className="hidden h-9 rounded-xl border border-border bg-muted p-0.5 md:inline-flex md:mr-2">
          <button onClick={() => setView('table')} className={`p-1.5 rounded-lg text-sm transition-all ${view === 'table' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            <List className="w-4 h-4" />
          </button>
          <button onClick={() => setView('cards')} className={`p-1.5 rounded-lg text-sm transition-all ${view === 'cards' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            <LayoutGrid className="w-4 h-4" />
          </button>
        </div>
      </TopBar>

      <ListToolbar
        searchValue={search} onSearchChange={setSearch} searchPlaceholder="Search contacts..."
        filters={filterConfigs} activeFilters={activeFilters} onFilterChange={handleFilterChange}
        onClearFilters={() => setActiveFilters({})} sortOptions={sortOptions} currentSort={sort}
        onSortChange={handleSortChange} entityType="contacts"
        onAdd={() => openQuickAdd('contact')} addLabel="New Contact"
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-24 md:pb-6">
        {isLoading ? (
          <div className="space-y-2 pt-2">
            {[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-muted/50 rounded-xl animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          allContacts.length === 0 && !search && Object.keys(activeFilters).length === 0 ? (
            <OnboardingEmptyState
              icon={Users}
              title="No contacts yet"
              description="Contacts store people, preferences, handoffs, and follow-up history."
              showSampleData={false}
              iconClassName="text-primary"
              iconBgClassName="bg-primary/10"
            />
          ) : (
            <OnboardingEmptyState
              icon={Users}
              title="No contacts match"
              description="Adjust the search or filters to find the person you need."
              primary={{ label: 'Clear filters', onClick: () => { setSearch(''); setActiveFilters({}); } }}
              showSampleData={false}
              iconClassName="text-primary"
              iconBgClassName="bg-primary/10"
            />
          )
        ) : effectiveView === 'table' ? (
          <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-sunken/50">
                    <SortHeader label="Contact" sortKey="name" />
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Account</th>
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Email</th>
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Phone</th>
                    <SortHeader label="Stage" sortKey="lifecycle_stage" />
                    <SortHeader label="Score" sortKey="lead_score" />
                    <th className="px-2 py-3 w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((c, i) => (
                    <tr key={c.id as string} onClick={() => openDrawer('contact', c.id as string)}
                      className={`border-b border-border last:border-0 hover:bg-primary/5 cursor-pointer group transition-colors ${i % 2 === 1 ? 'bg-surface-sunken/30' : ''}`}>
                      <td className="px-4 py-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-display font-bold text-foreground">{displayName(c)}</p>
                            <RecordMemoryIndicator count={memoryCounts.get(c.id as string)} />
                          </div>
                          {c.title && <p className="text-xs text-muted-foreground">{c.title as string}</p>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{companyName(c) || '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{(c.email as string) || '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{(c.phone as string) || '—'}</td>
                      <td className="px-4 py-3">{c.lifecycle_stage ? <StageBadge stage={c.lifecycle_stage as string} /> : '—'}</td>
                      <td className="px-4 py-3">
                        {c.lead_score != null ? <LeadScoreBadge score={c.lead_score as number} /> : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                          <button onClick={(e) => { e.stopPropagation(); openDrawerBriefing('contact', c.id as string); }}
                            className="p-1.5 rounded-lg hover:bg-primary/10 transition-colors" title="View briefing">
                            <FileText className="w-3.5 h-3.5 text-primary" />
                          </button>
                          {agentEnabled && (
                            <button onClick={(e) => { e.stopPropagation(); openAIWithContext({ type: 'contact', id: c.id as string, name: displayName(c), detail: companyName(c) }); navigate('/agent'); }}
                              className="p-1.5 rounded-lg hover:bg-violet-500/10 transition-colors">
                              <Bot className="w-3.5 h-3.5 text-violet-500" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4">
              <PaginationBar page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
            </div>
          </div>
        ) : (
          <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {paginated.map((c, i) => (
              <motion.div key={c.id as string} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                onClick={() => openDrawer('contact', c.id as string)}
                className="bg-card border border-border rounded-2xl p-4 cursor-pointer hover:shadow-lg hover:border-primary/20 transition-all press-scale group relative">
                <div className="absolute top-3 right-3 flex items-center gap-0.5 md:opacity-0 md:group-hover:opacity-100 transition-all">
                  <button onClick={(e) => { e.stopPropagation(); openDrawerBriefing('contact', c.id as string); }}
                    className="p-1.5 rounded-lg hover:bg-primary/10 transition-colors" title="View briefing">
                    <FileText className="w-3.5 h-3.5 text-primary" />
                  </button>
                  {agentEnabled && (
                    <button onClick={(e) => { e.stopPropagation(); openAIWithContext({ type: 'contact', id: c.id as string, name: displayName(c), detail: companyName(c) }); navigate('/agent'); }}
                      className="p-1.5 rounded-lg hover:bg-violet-500/10 transition-colors">
                      <Bot className="w-3.5 h-3.5 text-violet-500" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3 mb-3">
                  <ContactAvatar name={displayName(c)} className="w-11 h-11 rounded-2xl text-sm" />
                  <div>
                    <div className="flex items-center gap-2 pr-16">
                      <p className="font-display font-bold text-foreground truncate">{displayName(c)}</p>
                      <RecordMemoryIndicator count={memoryCounts.get(c.id as string)} className="shrink-0" />
                    </div>
                    <p className="text-xs text-muted-foreground">{companyName(c) || 'Individual'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  {c.lifecycle_stage && <StageBadge stage={c.lifecycle_stage as string} />}
                  {c.lead_score != null && <LeadScoreBadge score={c.lead_score as number} />}
                </div>
                {c.email && <p className="text-xs text-muted-foreground">{c.email as string}</p>}
              </motion.div>
            ))}
          </div>
          <PaginationBar page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </>
        )}
      </div>
    </div>
  );
}
