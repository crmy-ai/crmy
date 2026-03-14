// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { useUseCases } from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';
import { motion } from 'framer-motion';
import { Sparkles, ChevronUp, ChevronDown } from 'lucide-react';
import { useCaseStageConfig } from '@/lib/stageConfig';

const filterConfigs: FilterConfig[] = [
  { key: 'stage', label: 'Stage', options: Object.entries(useCaseStageConfig).map(([k, v]) => ({ value: k, label: v.label })) },
];
const sortOptions: SortOption[] = [
  { key: 'name', label: 'Name' }, { key: 'stage', label: 'Stage' },
  { key: 'attributed_arr', label: 'ARR' }, { key: 'days_active', label: 'Days Active' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UseCase = any;

export default function UseCases() {
  const { openDrawer, openQuickAdd, openAIWithContext } = useAppStore();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

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
    if (sort) {
      result.sort((a, b) => {
        const aVal = (a[sort.key] ?? '') as string | number;
        const bVal = (b[sort.key] ?? '') as string | number;
        if (typeof aVal === 'number' && typeof bVal === 'number') return sort.dir === 'asc' ? aVal - bVal : bVal - aVal;
        return sort.dir === 'asc' ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
      });
    }
    return result;
  }, [allUseCases, activeFilters, sort]);

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
      <TopBar title="Use Cases" />
      <ListToolbar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Search use cases..."
        filters={filterConfigs} activeFilters={activeFilters} onFilterChange={handleFilterChange}
        onClearFilters={() => setActiveFilters({})} sortOptions={sortOptions} currentSort={sort}
        onSortChange={handleSortChange} onAdd={() => openQuickAdd('use-case')} addLabel="New Use Case" entityType="use cases" />

      <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-24 md:pb-6">
        {isLoading ? (
          <div className="space-y-2 pt-2">
            {[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-muted/50 rounded-xl animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <p className="text-sm">No use cases found.</p>
            <button onClick={() => { setSearch(''); setActiveFilters({}); }} className="mt-2 text-xs text-primary font-semibold hover:underline">Clear all filters</button>
          </div>
        ) : (
          <>
            <div className="hidden md:block bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-sunken/50">
                      <SortHeader label="Use Case" sortKey="name" />
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Client</th>
                      <SortHeader label="Stage" sortKey="stage" />
                      <SortHeader label="ARR" sortKey="attributed_arr" />
                      <SortHeader label="Days Active" sortKey="days_active" />
                      <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Agent</th>
                      <th className="px-2 py-3 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((uc, i) => {
                      const stage = (uc.stage ?? '') as string;
                      const config = useCaseStageConfig[stage] ?? { label: stage, color: '#94a3b8' };
                      const arr = (uc.attributed_arr ?? uc.attributedARR ?? 0) as number;
                      const daysActive = (uc.days_active ?? uc.daysActive ?? 0) as number;
                      const client = (uc.client ?? uc.account_name ?? '') as string;
                      const agent = (uc.assigned_agent ?? uc.assignedAgent ?? '') as string;
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
                          <td className="px-4 py-3 text-muted-foreground">{daysActive > 0 ? `${daysActive}d` : '—'}</td>
                          <td className="px-4 py-3 text-muted-foreground">{agent || '—'}</td>
                          <td className="px-2 py-3">
                            <button onClick={(e) => { e.stopPropagation(); openAIWithContext({ type: 'use-case', id: uc.id as string, name: uc.name as string, detail: client }); navigate('/agent'); }}
                              className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-accent/10 transition-all">
                              <Sparkles className="w-3.5 h-3.5 text-accent" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="md:hidden space-y-2">
              {filtered.map((uc, i) => {
                const stage = (uc.stage ?? '') as string;
                const config = useCaseStageConfig[stage] ?? { label: stage, color: '#94a3b8' };
                const arr = (uc.attributed_arr ?? uc.attributedARR ?? 0) as number;
                const daysActive = (uc.days_active ?? uc.daysActive ?? 0) as number;
                const client = (uc.client ?? uc.account_name ?? '') as string;
                return (
                  <motion.div key={uc.id as string} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                    onClick={() => openDrawer('use-case', uc.id as string)}
                    className="bg-card border border-border rounded-2xl p-3.5 cursor-pointer transition-all press-scale">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-display font-bold text-foreground text-sm truncate">{uc.name as string}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{client}</p>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); openAIWithContext({ type: 'use-case', id: uc.id as string, name: uc.name as string, detail: client }); navigate('/agent'); }}
                        className="p-1.5 rounded-lg hover:bg-accent/10 flex-shrink-0">
                        <Sparkles className="w-3.5 h-3.5 text-accent" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mt-2.5">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold"
                        style={{ backgroundColor: config.color + '18', color: config.color }}>
                        {config.label}
                      </span>
                      {arr > 0 && <span className="text-xs font-display font-bold text-foreground">${(arr / 1000).toFixed(0)}K</span>}
                      {daysActive > 0 && <span className="text-xs text-muted-foreground ml-auto">{daysActive}d</span>}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
