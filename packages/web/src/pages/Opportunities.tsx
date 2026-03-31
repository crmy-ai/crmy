// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { useOpportunities } from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import { StageBadge } from '@/components/crm/CrmWidgets';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';
import { DatePicker } from '@/components/ui/date-picker';
import { motion } from 'framer-motion';
import { Columns3, List, BarChart3, Plus, Sparkles, ChevronUp, ChevronDown, Briefcase } from 'lucide-react';
import { PaginationBar } from '@/components/crm/PaginationBar';
import { ContactAvatar } from '@/components/crm/ContactAvatar';
import { stageConfig } from '@/lib/stageConfig';

type ViewMode = 'kanban' | 'table' | 'forecast';
const kanbanStages = ['prospecting', 'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost'];

type CloseDatePreset = 'all' | 'today' | 'this_week' | 'this_month' | 'this_quarter' | 'custom';

const CLOSE_DATE_OPTIONS: { value: CloseDatePreset; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'custom', label: 'Custom' },
];

function getCloseDateRange(preset: CloseDatePreset): { start: Date; end: Date } | null {
  if (preset === 'all') return null;
  const now = new Date();
  if (preset === 'today') {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(now); end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  if (preset === 'this_week') {
    const start = new Date(now);
    const day = start.getDay();
    start.setDate(start.getDate() + (day === 0 ? -6 : 1 - day));
    start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  if (preset === 'this_month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }
  if (preset === 'this_quarter') {
    const q = Math.floor(now.getMonth() / 3);
    const start = new Date(now.getFullYear(), q * 3, 1);
    const end = new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59, 999);
    return { start, end };
  }
  return null; // custom — handled separately
}

const filterConfigs: FilterConfig[] = [
  { key: 'stage', label: 'Stage', options: kanbanStages.map(k => ({ value: k, label: stageConfig[k]?.label ?? k })) },
];
const sortOptions: SortOption[] = [
  { key: 'name', label: 'Opportunity Name' }, { key: 'amount', label: 'Amount' },
  { key: 'stage', label: 'Stage' }, { key: 'probability', label: 'Probability' },
  { key: 'created_at', label: 'Created' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Opportunity = any;

export default function Opportunities() {
  const navigate = useNavigate();
  const [view, setView] = useState<ViewMode>('table');
  const { openDrawer, openQuickAdd, openAIWithContext } = useAppStore();
  const { enabled: agentEnabled } = useAgentSettings();
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [closeDate, setCloseDate] = useState<CloseDatePreset>('this_quarter');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, isLoading } = useOpportunities({ q: search || undefined, limit: 200 }) as any;
  const allOpportunities: Opportunity[] = data?.data ?? [];

  const handleFilterChange = (key: string, values: string[]) => {
    setActiveFilters(prev => { const next = { ...prev }; if (values.length === 0) delete next[key]; else next[key] = values; return next; });
  };
  const handleSortChange = (key: string) => {
    setSort(prev => prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };

  const filtered = useMemo(() => {
    let result = [...allOpportunities];
    if (activeFilters.stage?.length) result = result.filter(d => activeFilters.stage.includes(d.stage as string));

    // Close date filtering
    if (closeDate !== 'all') {
      let start: Date, end: Date;
      if (closeDate === 'custom') {
        start = customFrom ? new Date(customFrom + 'T00:00:00') : new Date(0);
        end = customTo ? new Date(customTo + 'T23:59:59') : new Date(8640000000000000);
      } else {
        const range = getCloseDateRange(closeDate);
        if (range) { start = range.start; end = range.end; }
        else { start = new Date(0); end = new Date(8640000000000000); }
      }
      result = result.filter(d => {
        if (!d.close_date) return false;
        const cd = new Date(d.close_date);
        return cd >= start && cd <= end;
      });
    }

    if (sort) {
      result.sort((a, b) => {
        const aVal = (a[sort.key] ?? '') as string | number;
        const bVal = (b[sort.key] ?? '') as string | number;
        if (typeof aVal === 'number' && typeof bVal === 'number') return sort.dir === 'asc' ? aVal - bVal : bVal - aVal;
        return sort.dir === 'asc' ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
      });
    }
    return result;
  }, [allOpportunities, activeFilters, sort]);

  useEffect(() => { setPage(1); }, [search, activeFilters, sort, closeDate, customFrom, customTo]);
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const SortHeader = ({ label, sortKey }: { label: string; sortKey: string }) => (
    <th onClick={() => handleSortChange(sortKey)} className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none">
      <span className="inline-flex items-center gap-1">
        {label}
        {sort?.key === sortKey && (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </span>
    </th>
  );

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Opportunities"
        icon={Briefcase}
        iconClassName="text-accent"
        description="Deals and revenue pipeline."
      >
        <div className="hidden md:flex items-center gap-1 bg-muted rounded-xl p-0.5">
          {[
            { mode: 'kanban', icon: Columns3 },
            { mode: 'table', icon: List },
            { mode: 'forecast', icon: BarChart3 },
          ].map(({ mode, icon: Icon }) => (
            <button key={mode} onClick={() => setView(mode as ViewMode)}
              className={`p-1.5 rounded-lg text-sm transition-all ${view === mode ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}>
              <Icon className="w-4 h-4" />
            </button>
          ))}
        </div>
      </TopBar>

      {/* Close date selector */}
      <div className="px-4 md:px-6 pt-3 pb-1 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground font-semibold">Close Date:</span>
        <div className="inline-flex rounded-xl border border-border bg-muted/40 p-0.5 gap-0.5">
          {CLOSE_DATE_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => setCloseDate(opt.value)}
              className={['px-3 py-1.5 text-xs font-medium rounded-lg transition-all',
                closeDate === opt.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}>
              {opt.label}
            </button>
          ))}
        </div>
        {closeDate === 'custom' && (
          <div className="flex items-center gap-2">
            <DatePicker
              value={customFrom}
              onChange={setCustomFrom}
              size="sm"
              placeholder="From"
              className="w-36"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <DatePicker
              value={customTo}
              onChange={setCustomTo}
              size="sm"
              placeholder="To"
              className="w-36"
            />
          </div>
        )}
      </div>

      <ListToolbar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Search opportunities..."
        filters={filterConfigs} activeFilters={activeFilters} onFilterChange={handleFilterChange}
        onClearFilters={() => setActiveFilters({})} sortOptions={sortOptions} currentSort={sort}
        onSortChange={handleSortChange} onAdd={() => openQuickAdd('opportunity')} addLabel="New Opportunity" entityType="opportunities" />

      <div className="flex-1 overflow-y-auto pb-24 md:pb-6">
        {isLoading ? (
          <div className="flex gap-4 px-4 md:px-6 pt-2">
            {[...Array(4)].map((_, i) => <div key={i} className="flex-shrink-0 w-72 h-64 bg-muted/50 rounded-2xl animate-pulse" />)}
          </div>
        ) : view === 'kanban' ? (
          <>
            <div className="border-t border-border mb-4" />
          <div className="flex gap-3 md:gap-4 px-4 md:px-6 pb-4 overflow-x-auto min-h-full snap-x snap-mandatory md:snap-none no-scrollbar">
            {kanbanStages.map((stage) => {
              const config = stageConfig[stage] ?? { label: stage, color: '#94a3b8' };
              const stageOpps = filtered.filter((d) => d.stage === stage);
              const total = stageOpps.reduce((sum, d) => sum + ((d.amount as number) || 0), 0);
              return (
                <div key={stage} className="flex-shrink-0 w-[280px] md:w-72 flex flex-col snap-center">
                  <div className="flex items-center justify-between mb-3 px-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-lg text-xs font-semibold" style={{ backgroundColor: config.color + '20', color: config.color }}>
                        {config.label}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">{stageOpps.length}</span>
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">${(total / 1000).toFixed(0)}K</span>
                  </div>
                  <div className="flex-1 space-y-2">
                    {stageOpps.map((opp, i) => {
                      const contactName = (opp.contact_name ?? opp.contactName ?? '') as string;
                      const amount = (opp.amount as number) ?? 0;
                      const daysInStage = (opp.days_in_stage ?? opp.daysInStage ?? 0) as number;
                      return (
                        <motion.div key={opp.id as string} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                          onClick={() => openDrawer('opportunity', opp.id as string)}
                          className="bg-card border border-border rounded-2xl p-3.5 cursor-pointer hover:border-primary/30 hover:shadow-md transition-all press-scale group">
                          <div className="flex items-start justify-between">
                            <p className="text-sm font-display font-bold text-foreground">{opp.name as string}</p>
                            {agentEnabled && (
                              <button onClick={(e) => { e.stopPropagation(); openAIWithContext({ type: 'opportunity', id: opp.id as string, name: opp.name as string, detail: `$${(amount / 1000).toFixed(0)}K` }); navigate('/agent'); }}
                                className="p-0.5 rounded-lg md:opacity-0 md:group-hover:opacity-100 hover:bg-accent/10 transition-all">
                                <Sparkles className="w-3.5 h-3.5 text-accent" />
                              </button>
                            )}
                          </div>
                          {contactName && (
                            <div className="flex items-center gap-2 mt-2">
                              <ContactAvatar name={contactName} className="w-5 h-5 rounded-full text-[8px]" />
                              <span className="text-xs text-muted-foreground">{contactName}</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between mt-2.5">
                            <span className="text-sm font-display font-extrabold text-foreground">
                              ${amount >= 1000 ? `${(amount / 1000).toFixed(0)}K` : amount}
                            </span>
                            {daysInStage > 0 && (
                              daysInStage > 14 ? (
                                <span className="px-2 py-0.5 rounded-lg text-xs bg-destructive/15 text-destructive font-semibold">{daysInStage}d</span>
                              ) : (
                                <span className="text-xs text-muted-foreground">{daysInStage}d</span>
                              )
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                    <button onClick={() => openQuickAdd('opportunity')}
                      className="w-full flex items-center justify-center gap-1 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-xl transition-colors press-scale">
                      <Plus className="w-3.5 h-3.5" /> Add Opportunity
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          </>
        ) : view === 'table' ? (
          <div className="px-4 md:px-6">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <p className="text-sm">No opportunities match your filters.</p>
                <button onClick={() => { setSearch(''); setActiveFilters({}); setCloseDate('all'); }} className="mt-2 text-xs text-primary font-semibold hover:underline">Clear all filters</button>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface-sunken/50">
                        <SortHeader label="Opportunity" sortKey="name" />
                        <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Contact</th>
                        <SortHeader label="Amount" sortKey="amount" />
                        <SortHeader label="Stage" sortKey="stage" />
                        <SortHeader label="Probability" sortKey="probability" />
                        <SortHeader label="Created" sortKey="created_at" />
                        {agentEnabled && <th className="px-2 py-3 w-8"></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map((d, i) => {
                        const contactName = (d.contact_name ?? d.contactName ?? '') as string;
                        const amount = (d.amount as number) ?? 0;
                        return (
                          <tr key={d.id as string} onClick={() => openDrawer('opportunity', d.id as string)}
                            className={`border-b border-border last:border-0 hover:bg-primary/5 cursor-pointer transition-colors group ${i % 2 === 1 ? 'bg-surface-sunken/30' : ''}`}>
                            <td className="px-4 py-3 font-display font-bold text-foreground">{d.name as string}</td>
                            <td className="px-4 py-3">
                              {contactName && (
                                <div className="flex items-center gap-2">
                                  <ContactAvatar name={contactName} className="w-5 h-5 rounded-full text-[8px]" />
                                  <span className="text-muted-foreground">{contactName}</span>
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 font-display font-bold text-foreground">
                              ${amount >= 1000 ? `${(amount / 1000).toFixed(0)}K` : amount}
                            </td>
                            <td className="px-4 py-3">{d.stage && <StageBadge stage={d.stage as string} />}</td>
                            <td className="px-4 py-3 text-muted-foreground">{d.probability ? `${d.probability}%` : '—'}</td>
                            <td className="px-4 py-3 text-muted-foreground text-xs">
                              {d.created_at ? new Date(d.created_at as string).toLocaleDateString() : '—'}
                            </td>
                            {agentEnabled && (
                              <td className="px-2 py-3">
                                <button onClick={(e) => { e.stopPropagation(); openAIWithContext({ type: 'opportunity', id: d.id as string, name: d.name as string, detail: `$${(amount / 1000).toFixed(0)}K` }); navigate('/agent'); }}
                                  className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-accent/10 transition-all">
                                  <Sparkles className="w-3.5 h-3.5 text-accent" />
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="px-4">
                  <PaginationBar page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="px-4 md:px-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
              {[
                { label: 'Weighted Pipeline', value: filtered.filter(d => d.stage !== 'closed_won' && d.stage !== 'closed_lost').reduce((s, d) => s + ((d.amount as number) || 0) * ((d.probability as number) || 0) / 100, 0) },
                { label: 'Best Case', value: filtered.filter(d => d.stage !== 'closed_lost').reduce((s, d) => s + ((d.amount as number) || 0), 0) },
                { label: 'Closed Won', value: filtered.filter(d => d.stage === 'closed_won').reduce((s, d) => s + ((d.amount as number) || 0), 0) },
              ].map((card) => (
                <div key={card.label} className="bg-card border border-border rounded-2xl p-5 shadow-sm">
                  <p className="text-xs text-muted-foreground font-display font-semibold">{card.label}</p>
                  <p className="text-2xl font-display font-extrabold text-foreground mt-1">
                    ${card.value >= 1_000_000 ? `${(card.value / 1_000_000).toFixed(2)}M` : `${(card.value / 1000).toFixed(0)}K`}
                  </p>
                </div>
              ))}
            </div>
            <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
              <h3 className="font-display font-bold text-foreground mb-4">Pipeline by stage</h3>
              <div className="space-y-4">
                {kanbanStages.filter(s => s !== 'closed_lost').map((stage) => {
                  const config = stageConfig[stage] ?? { label: stage, color: '#94a3b8' };
                  const total = filtered.filter(d => d.stage === stage).reduce((s, d) => s + ((d.amount as number) || 0), 0);
                  const max = Math.max(...kanbanStages.map(s => filtered.filter(d => d.stage === s).reduce((sum, d) => sum + ((d.amount as number) || 0), 0)), 1);
                  return (
                    <div key={stage} className="flex items-center gap-3">
                      <span className="text-xs w-28 truncate font-semibold" style={{ color: config.color }}>{config.label}</span>
                      <div className="flex-1 h-8 bg-muted rounded-xl overflow-hidden">
                        <motion.div initial={{ width: 0 }} animate={{ width: `${(total / max) * 100}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                          className="h-full rounded-xl flex items-center px-3"
                          style={{ backgroundColor: config.color + '30' }}>
                          <span className="text-xs font-display font-bold" style={{ color: config.color }}>
                            ${(total / 1000).toFixed(0)}K
                          </span>
                        </motion.div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
