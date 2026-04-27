// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContactAvatar } from '@/components/crm/ContactAvatar';
import { TopBar } from '@/components/layout/TopBar';
import { useContacts } from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import { StageBadge, LeadScoreBadge } from '@/components/crm/CrmWidgets';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';
import { motion } from 'framer-motion';
import { LayoutGrid, List, Sparkles, ChevronUp, ChevronDown, Users, FileText, Plus } from 'lucide-react';
import { PaginationBar } from '@/components/crm/PaginationBar';
import { useIsMobile } from '@/hooks/use-mobile';
import { stageConfig } from '@/lib/stageConfig';

type ViewMode = 'table' | 'cards';

const filterConfigs: FilterConfig[] = [
  { key: 'lifecycle_stage', label: 'Stage', options: Object.entries(stageConfig).map(([k, v]) => ({ value: k, label: v.label })) },
];

const sortOptions: SortOption[] = [
  { key: 'name', label: 'Name' },
  { key: 'company', label: 'Company' },
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
        const aVal = (a[sort.key] ?? '') as string | number;
        const bVal = (b[sort.key] ?? '') as string | number;
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
        description="People and leads across your CRM."
      >
        <div className="hidden md:flex items-center gap-1 bg-muted rounded-xl p-0.5">
          <button onClick={() => setView('table')} className={`p-1.5 rounded-lg text-sm transition-all ${view === 'table' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}>
            <List className="w-4 h-4" />
          </button>
          <button onClick={() => setView('cards')} className={`p-1.5 rounded-lg text-sm transition-all ${view === 'cards' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}>
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
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <p className="text-sm">No contacts found.</p>
            <button onClick={() => { setSearch(''); setActiveFilters({}); }} className="mt-2 text-xs text-primary font-semibold hover:underline">
              Clear all filters
            </button>
          </div>
        ) : effectiveView === 'table' ? (
          <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-sunken/50">
                    <SortHeader label="Name" sortKey="name" />
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
                          <p className="font-display font-bold text-foreground">{displayName(c)}</p>
                          {c.company_name && <p className="text-xs text-muted-foreground">{c.company_name as string}</p>}
                        </div>
                      </td>
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
                            <button onClick={(e) => { e.stopPropagation(); openAIWithContext({ type: 'contact', id: c.id as string, name: displayName(c), detail: c.company_name as string }); navigate('/agent'); }}
                              className="p-1.5 rounded-lg hover:bg-accent/10 transition-colors">
                              <Sparkles className="w-3.5 h-3.5 text-accent" />
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
                    <button onClick={(e) => { e.stopPropagation(); openAIWithContext({ type: 'contact', id: c.id as string, name: displayName(c), detail: c.company_name as string }); navigate('/agent'); }}
                      className="p-1.5 rounded-lg hover:bg-accent/10 transition-colors">
                      <Sparkles className="w-3.5 h-3.5 text-accent" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3 mb-3">
                  <ContactAvatar name={displayName(c)} className="w-11 h-11 rounded-2xl text-sm" />
                  <div>
                    <p className="font-display font-bold text-foreground">{displayName(c)}</p>
                    <p className="text-xs text-muted-foreground">{(c.company_name as string) || 'Individual'}</p>
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
