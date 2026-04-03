// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { useUseCases } from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';
import { DatePicker } from '@/components/ui/date-picker';
import { motion } from 'framer-motion';
import { Columns3, List, BarChart3, Plus, Sparkles, ChevronUp, ChevronDown, FolderKanban } from 'lucide-react';
import { PaginationBar } from '@/components/crm/PaginationBar';
import { useCaseStageConfig } from '@/lib/stageConfig';

type ViewMode = 'kanban' | 'table' | 'dashboard';
const kanbanStages = ['discovery', 'poc', 'production', 'scaling', 'sunset'];

type ProdDatePreset = 'all' | 'today' | 'this_week' | 'this_month' | 'this_quarter' | 'custom';

const PROD_DATE_OPTIONS: { value: ProdDatePreset; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'custom', label: 'Custom' },
];

function getProdDateRange(preset: ProdDatePreset): { start: Date; end: Date } | null {
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
  return null;
}

const filterConfigs: FilterConfig[] = [
  { key: 'stage', label: 'Stage', options: kanbanStages.map(k => ({ value: k, label: useCaseStageConfig[k]?.label ?? k })) },
];
const sortOptions: SortOption[] = [
  { key: 'name', label: 'Name' }, { key: 'stage', label: 'Stage' },
  { key: 'attributed_arr', label: 'ARR' }, { key: 'health_score', label: 'Health' },
  { key: 'target_prod_date', label: 'Prod Date' }, { key: 'created_at', label: 'Created' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UseCase = any;

export default function UseCases() {
  const { openDrawer, openQuickAdd, openAIWithContext } = useAppStore();
  const { enabled: agentEnabled } = useAgentSettings();
  const navigate = useNavigate();
  const [view, setView] = useState<ViewMode>('table');
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [prodDate, setProdDate] = useState<ProdDatePreset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, isLoading } = useUseCases({ q: search || undefined, limit: 200 }) as any;
  const allUseCases: UseCase[] = data?.data ?? [];

  const handleFilterChange = (key: string, values: string[]) => {
    setActiveFilters(prev => { const next = { ...prev }; if (values.length === 0) delete next[key]; else next[key] = values; return next; });
  };
  const handleSortChange = (key: string) => {
    setSort(prev => prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };

  const filtered = useMemo(() => {
    let result = [...allUseCases];
    if (activeFilters.stage?.length) result = result.filter(u => activeFilters.stage.includes(u.stage as string));

    // Production date filtering
    if (prodDate !== 'all') {
      let start: Date, end: Date;
      if (prodDate === 'custom') {
        start = customFrom ? new Date(customFrom + 'T00:00:00') : new Date(0);
        end = customTo ? new Date(customTo + 'T23:59:59') : new Date(8640000000000000);
      } else {
        const range = getProdDateRange(prodDate);
        if (range) { start = range.start; end = range.end; }
        else { start = new Date(0); end = new Date(8640000000000000); }
      }
      result = result.filter(d => {
        if (!d.target_prod_date) return true; // unscheduled use cases always visible
        const pd = new Date(d.target_prod_date);
        return pd >= start && pd <= end;
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
  }, [allUseCases, activeFilters, sort, prodDate, customFrom, customTo]);

  useEffect(() => { setPage(1); }, [search, activeFilters, sort, prodDate, customFrom, customTo]);
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
        title="Use Cases"
        icon={FolderKanban}
        iconClassName="text-success"
        description="Customer use cases and deployment tracking."
      >
        <div className="hidden md:flex items-center gap-1 bg-muted rounded-xl p-0.5">
          {[
            { mode: 'kanban', icon: Columns3 },
            { mode: 'table', icon: List },
            { mode: 'dashboard', icon: BarChart3 },
          ].map(({ mode, icon: Icon }) => (
            <button key={mode} onClick={() => setView(mode as ViewMode)}
              className={`p-1.5 rounded-lg text-sm transition-all ${view === mode ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}>
              <Icon className="w-4 h-4" />
            </button>
          ))}
        </div>
      </TopBar>

      {/* Production date selector */}
      <div className="px-4 md:px-6 pt-3 pb-1 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground font-semibold">Prod Date:</span>
        <div className="inline-flex rounded-xl border border-border bg-muted/40 p-0.5 gap-0.5">
          {PROD_DATE_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => setProdDate(opt.value)}
              className={['px-3 py-1.5 text-xs font-medium rounded-lg transition-all',
                prodDate === opt.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}>
              {opt.label}
            </button>
          ))}
        </div>
        {prodDate === 'custom' && (
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

      <ListToolbar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Search use cases..."
        filters={filterConfigs} activeFilters={activeFilters} onFilterChange={handleFilterChange}
        onClearFilters={() => { setActiveFilters({}); setProdDate('all'); }} sortOptions={sortOptions} currentSort={sort}
        onSortChange={handleSortChange} onAdd={() => openQuickAdd('use-case')} addLabel="New Use Case" entityType="use cases" />

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
                const config = useCaseStageConfig[stage] ?? { label: stage, color: '#94a3b8' };
                const stageUCs = filtered.filter((u) => u.stage === stage);
                const totalArr = stageUCs.reduce((sum, u) => sum + ((u.attributed_arr as number) || 0), 0);
                return (
                  <div key={stage} className="flex-shrink-0 w-[280px] md:w-72 flex flex-col snap-center">
                    <div className="flex items-center justify-between mb-3 px-1">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 rounded-lg text-xs font-semibold" style={{ backgroundColor: config.color + '20', color: config.color }}>
                          {config.label}
                        </span>
                        <span className="text-xs text-muted-foreground font-mono">{stageUCs.length}</span>
                      </div>
                      {totalArr > 0 && <span className="text-xs text-muted-foreground font-mono">${(totalArr / 1000).toFixed(0)}K ARR</span>}
                    </div>
                    <div className="flex-1 space-y-2">
                      {stageUCs.map((uc, i) => {
                        const client = (uc.account_name ?? uc.client ?? '') as string;
                        const arr = (uc.attributed_arr as number) ?? 0;
                        const health = (uc.health_score as number) ?? 0;
                        return (
                          <motion.div key={uc.id as string} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                            onClick={() => openDrawer('use-case', uc.id as string)}
                            className="bg-card border border-border rounded-2xl p-3.5 cursor-pointer hover:border-primary/30 hover:shadow-md transition-all press-scale group">
                            <div className="flex items-start justify-between">
                              <p className="text-sm font-display font-bold text-foreground">{uc.name as string}</p>
                              {agentEnabled && (
                                <button onClick={(e) => { e.stopPropagation(); openAIWithContext({ type: 'use-case', id: uc.id as string, name: uc.name as string, detail: client }); navigate('/agent'); }}
                                  className="p-0.5 rounded-lg md:opacity-0 md:group-hover:opacity-100 hover:bg-accent/10 transition-all">
                                  <Sparkles className="w-3.5 h-3.5 text-accent" />
                                </button>
                              )}
                            </div>
                            {client && <p className="text-xs text-muted-foreground mt-1">{client}</p>}
                            <div className="flex items-center justify-between mt-2.5">
                              {arr > 0 ? (
                                <span className="text-sm font-display font-extrabold text-foreground">
                                  ${arr >= 1000 ? `${(arr / 1000).toFixed(0)}K` : arr}
                                </span>
                              ) : <span />}
                              {health > 0 && (
                                <span className={`px-2 py-0.5 rounded-lg text-xs font-semibold ${health >= 80 ? 'bg-green-500/15 text-green-400' : health >= 50 ? 'bg-yellow-500/15 text-yellow-400' : 'bg-red-500/15 text-red-400'}`}>
                                  {health}
                                </span>
                              )}
                            </div>
                          </motion.div>
                        );
                      })}
                      <button onClick={() => openQuickAdd('use-case')}
                        className="w-full flex items-center justify-center gap-1 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-xl transition-colors press-scale">
                        <Plus className="w-3.5 h-3.5" /> Add Use Case
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
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-20 text-center">
                <FolderKanban className="w-14 h-14 text-muted-foreground/30 mb-4" />
                <p className="text-base font-display font-semibold text-foreground mb-1">
                  {allUseCases.length === 0 ? 'No use cases yet' : 'No matches'}
                </p>
                <p className="text-sm text-muted-foreground max-w-sm">
                  {allUseCases.length === 0
                    ? 'Create a use case to track customer deployments and adoption.'
                    : 'Try adjusting your search, filters, or date range.'}
                </p>
                {(search || Object.keys(activeFilters).length > 0 || prodDate !== 'all') && (
                  <button onClick={() => { setSearch(''); setActiveFilters({}); setProdDate('all'); }} className="mt-3 text-xs text-primary font-semibold hover:underline">Clear all filters</button>
                )}
              </motion.div>
            ) : (
              <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface-sunken/50">
                        <SortHeader label="Use Case" sortKey="name" />
                        <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Client</th>
                        <SortHeader label="Stage" sortKey="stage" />
                        <SortHeader label="ARR" sortKey="attributed_arr" />
                        <SortHeader label="Health" sortKey="health_score" />
                        <SortHeader label="Prod Date" sortKey="target_prod_date" />
                        <SortHeader label="Created" sortKey="created_at" />
                        {agentEnabled && <th className="px-2 py-3 w-8"></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map((uc, i) => {
                        const stage = (uc.stage ?? '') as string;
                        const config = useCaseStageConfig[stage] ?? { label: stage, color: '#94a3b8' };
                        const arr = (uc.attributed_arr ?? 0) as number;
                        const health = (uc.health_score ?? 0) as number;
                        const client = (uc.account_name ?? uc.client ?? '') as string;
                        return (
                          <tr key={uc.id as string} onClick={() => openDrawer('use-case', uc.id as string)}
                            className={`border-b border-border last:border-0 hover:bg-primary/5 cursor-pointer transition-colors group ${i % 2 === 1 ? 'bg-surface-sunken/30' : ''}`}>
                            <td className="px-4 py-3 font-display font-bold text-foreground">{uc.name as string}</td>
                            <td className="px-4 py-3 text-muted-foreground">{client || '—'}</td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold"
                                style={{ backgroundColor: config.color + '18', color: config.color }}>
                                {config.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-display font-bold text-foreground">{arr > 0 ? `$${(arr / 1000).toFixed(0)}K` : '—'}</td>
                            <td className="px-4 py-3">
                              {health > 0 ? (
                                <span className={`px-2 py-0.5 rounded-lg text-xs font-semibold ${health >= 80 ? 'bg-green-500/15 text-green-400' : health >= 50 ? 'bg-yellow-500/15 text-yellow-400' : 'bg-red-500/15 text-red-400'}`}>
                                  {health}
                                </span>
                              ) : '—'}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground text-xs">
                              {uc.target_prod_date ? new Date(uc.target_prod_date as string).toLocaleDateString() : '—'}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground text-xs">
                              {uc.created_at ? new Date(uc.created_at as string).toLocaleDateString() : '—'}
                            </td>
                            {agentEnabled && (
                              <td className="px-2 py-3">
                                <button onClick={(e) => { e.stopPropagation(); openAIWithContext({ type: 'use-case', id: uc.id as string, name: uc.name as string, detail: client }); navigate('/agent'); }}
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
                { label: 'Total ARR', value: filtered.filter(u => u.stage !== 'sunset').reduce((s, u) => s + ((u.attributed_arr as number) || 0), 0), isCount: false },
                { label: 'Production ARR', value: filtered.filter(u => u.stage === 'production' || u.stage === 'scaling').reduce((s, u) => s + ((u.attributed_arr as number) || 0), 0), isCount: false },
                { label: 'Active Use Cases', value: filtered.filter(u => u.stage !== 'sunset').length, isCount: true },
              ].map((card) => (
                <div key={card.label} className="bg-card border border-border rounded-2xl p-5 shadow-sm">
                  <p className="text-xs text-muted-foreground font-display font-semibold">{card.label}</p>
                  <p className="text-2xl font-display font-extrabold text-foreground mt-1">
                    {card.isCount ? card.value : (
                      (card.value as number) >= 1_000_000
                        ? `$${((card.value as number) / 1_000_000).toFixed(2)}M`
                        : `$${((card.value as number) / 1000).toFixed(0)}K`
                    )}
                  </p>
                </div>
              ))}
            </div>
            <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
              <h3 className="font-display font-bold text-foreground mb-4">ARR by stage</h3>
              <div className="space-y-4">
                {kanbanStages.map((stage) => {
                  const config = useCaseStageConfig[stage] ?? { label: stage, color: '#94a3b8' };
                  const total = filtered.filter(u => u.stage === stage).reduce((s, u) => s + ((u.attributed_arr as number) || 0), 0);
                  const count = filtered.filter(u => u.stage === stage).length;
                  const max = Math.max(...kanbanStages.map(s => filtered.filter(u => u.stage === s).reduce((sum, u) => sum + ((u.attributed_arr as number) || 0), 0)), 1);
                  return (
                    <div key={stage} className="flex items-center gap-3">
                      <span className="text-xs w-24 truncate font-semibold" style={{ color: config.color }}>{config.label}</span>
                      <div className="flex-1 h-8 bg-muted rounded-xl overflow-hidden">
                        <motion.div initial={{ width: 0 }} animate={{ width: total > 0 ? `${(total / max) * 100}%` : '0%' }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                          className="h-full rounded-xl flex items-center px-3"
                          style={{ backgroundColor: config.color + '30' }}>
                          {total > 0 && (
                            <span className="text-xs font-display font-bold" style={{ color: config.color }}>
                              ${(total / 1000).toFixed(0)}K
                            </span>
                          )}
                        </motion.div>
                      </div>
                      <span className="text-xs text-muted-foreground font-mono w-6 text-right">{count}</span>
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
