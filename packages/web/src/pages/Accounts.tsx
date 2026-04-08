// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContactAvatar } from '@/components/crm/ContactAvatar';
import { TopBar } from '@/components/layout/TopBar';
import { useAccounts } from '@/api/hooks';
import { useAppStore } from '@/store/appStore';
import { useAgentSettings } from '@/contexts/AgentSettingsContext';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';
import { motion } from 'framer-motion';
import { LayoutGrid, List, ChevronUp, ChevronDown, Sparkles, Globe, DollarSign, Heart, Building2, FileText } from 'lucide-react';
import { PaginationBar } from '@/components/crm/PaginationBar';
import { useIsMobile } from '@/hooks/use-mobile';

type ViewMode = 'table' | 'cards';

const HEALTH_FILTERS = [
  { value: 'healthy',  label: 'Healthy (≥ 80)'   },
  { value: 'at-risk',  label: 'At risk (50 – 79)' },
  { value: 'poor',     label: 'Poor (< 50)'        },
];

const EMP_SIZE_FILTERS = [
  { value: 'small',      label: 'Small (< 50)'       },
  { value: 'mid',        label: 'Mid-market (50–500)' },
  { value: 'enterprise', label: 'Enterprise (500+)'   },
];

const sortOptions: SortOption[] = [
  { key: 'name',           label: 'Name'      },
  { key: 'annual_revenue', label: 'Revenue'   },
  { key: 'health_score',   label: 'Health'    },
  { key: 'employee_count', label: 'Employees' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Account = any;

function HealthBadge({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-green-500/15 text-green-400' : score >= 50 ? 'bg-yellow-500/15 text-yellow-400' : 'bg-red-500/15 text-red-400';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>
      <Heart className="w-3 h-3" />{score}
    </span>
  );
}

function formatRevenue(revenue: number) {
  if (revenue >= 1_000_000) return `$${(revenue / 1_000_000).toFixed(1)}M`;
  if (revenue >= 1_000) return `$${(revenue / 1_000).toFixed(0)}K`;
  return `$${revenue}`;
}

export default function Accounts() {
  const isMobile = useIsMobile();
  const [view, setView] = useState<ViewMode>('table');
  const effectiveView = isMobile ? 'cards' : view;
  const { openDrawer, openQuickAdd, openAIWithContext, openDrawerBriefing } = useAppStore();
  const { enabled: agentEnabled } = useAgentSettings();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, isLoading } = useAccounts({ q: search || undefined, limit: 200 }) as any;
  const allAccounts: Account[] = data?.data ?? [];

  // Derive industry options from loaded data (stable reference via ref)
  const seenIndustriesRef = useRef<Set<string>>(new Set());
  const industryOptions = useMemo(() => {
    allAccounts.forEach(a => { if (a.industry) seenIndustriesRef.current.add(a.industry as string); });
    return Array.from(seenIndustriesRef.current).sort().map(i => ({ value: i, label: i }));
  }, [allAccounts]);

  const filterConfigs: FilterConfig[] = [
    { key: 'industry', label: 'Industry',      options: industryOptions  },
    { key: 'health',   label: 'Health',         options: HEALTH_FILTERS   },
    { key: 'emp_size', label: 'Employee size',  options: EMP_SIZE_FILTERS },
  ];

  const handleFilterChange = (key: string, values: string[]) => {
    setActiveFilters(prev => { const next = { ...prev }; if (values.length === 0) delete next[key]; else next[key] = values; return next; });
  };
  const handleSortChange = (key: string) => {
    setSort(prev => prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };

  const filtered = useMemo(() => {
    let result = [...allAccounts];

    if (activeFilters.industry?.length)
      result = result.filter(a => activeFilters.industry.includes(a.industry as string));

    if (activeFilters.health?.length) {
      result = result.filter(a => {
        const s = a.health_score as number | null;
        if (s == null) return false;
        return activeFilters.health.some(tier =>
          tier === 'healthy' ? s >= 80 :
          tier === 'at-risk' ? s >= 50 && s < 80 :
          /* poor */           s < 50,
        );
      });
    }

    if (activeFilters.emp_size?.length) {
      result = result.filter(a => {
        const n = a.employee_count as number | null;
        if (n == null) return false;
        return activeFilters.emp_size.some(bucket =>
          bucket === 'small'      ? n < 50 :
          bucket === 'mid'        ? n >= 50 && n < 500 :
          /* enterprise */          n >= 500,
        );
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
  }, [allAccounts, activeFilters, sort]);

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
        title="Accounts"
        icon={Building2}
        iconClassName="text-[#8b5cf6]"
        description="Companies and organizations."
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
        searchValue={search} onSearchChange={setSearch} searchPlaceholder="Search accounts..."
        filters={filterConfigs} activeFilters={activeFilters} onFilterChange={handleFilterChange}
        onClearFilters={() => setActiveFilters({})} sortOptions={sortOptions} currentSort={sort}
        onSortChange={handleSortChange} onAdd={() => openQuickAdd('account')} addLabel="New Account" entityType="accounts"
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-24 md:pb-6">
        {isLoading ? (
          <div className="space-y-2 pt-2">
            {[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-muted/50 rounded-xl animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <p className="text-sm">No accounts found.</p>
            <button onClick={() => { setSearch(''); setActiveFilters({}); }} className="mt-2 text-xs text-primary font-semibold hover:underline">Clear all filters</button>
          </div>
        ) : effectiveView === 'table' ? (
          <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-sunken/50">
                    <SortHeader label="Name" sortKey="name" />
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Industry</th>
                    <SortHeader label="Revenue" sortKey="annual_revenue" />
                    <SortHeader label="Employees" sortKey="employee_count" />
                    <SortHeader label="Health" sortKey="health_score" />
                    <th className="px-2 py-3 w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((a, i) => (
                    <tr key={a.id as string} onClick={() => openDrawer('account', a.id as string)}
                      className={`border-b border-border last:border-0 hover:bg-primary/5 cursor-pointer group transition-colors ${i % 2 === 1 ? 'bg-surface-sunken/30' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <ContactAvatar name={a.name as string} className="w-8 h-8 text-xs" />
                          <div>
                            <span className="font-semibold text-foreground">{a.name as string}</span>
                            {a.website && <p className="text-xs text-muted-foreground">{a.website as string}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{(a.industry as string) || '—'}</td>
                      <td className="px-4 py-3 text-foreground font-medium">{a.annual_revenue ? formatRevenue(a.annual_revenue as number) : '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{(a.employee_count as number) || '—'}</td>
                      <td className="px-4 py-3">{a.health_score ? <HealthBadge score={a.health_score as number} /> : '—'}</td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                          <button onClick={(e) => { e.stopPropagation(); openDrawerBriefing('account', a.id as string); }}
                            className="p-1.5 rounded-lg hover:bg-primary/10 transition-colors" title="View briefing">
                            <FileText className="w-3.5 h-3.5 text-primary" />
                          </button>
                          {agentEnabled && (
                            <button onClick={(e) => { e.stopPropagation(); openAIWithContext({ type: 'account', id: a.id as string, name: a.name as string, detail: a.industry as string }); navigate('/agent'); }}
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
            {paginated.map((a, i) => (
              <motion.div key={a.id as string} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                onClick={() => openDrawer('account', a.id as string)}
                className="bg-card border border-border rounded-2xl p-4 cursor-pointer hover:shadow-lg hover:border-primary/20 transition-all press-scale group relative">
                <div className="absolute top-3 right-3 flex items-center gap-0.5 md:opacity-0 md:group-hover:opacity-100 transition-all">
                  <button onClick={(e) => { e.stopPropagation(); openDrawerBriefing('account', a.id as string); }}
                    className="p-1.5 rounded-lg hover:bg-primary/10 transition-colors" title="View briefing">
                    <FileText className="w-3.5 h-3.5 text-primary" />
                  </button>
                  {agentEnabled && (
                    <button onClick={(e) => { e.stopPropagation(); openAIWithContext({ type: 'account', id: a.id as string, name: a.name as string, detail: a.industry as string }); navigate('/agent'); }}
                      className="p-1.5 rounded-lg hover:bg-accent/10 transition-colors">
                      <Sparkles className="w-3.5 h-3.5 text-accent" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3 mb-3">
                  <ContactAvatar name={a.name as string} className="w-11 h-11 rounded-2xl text-sm" />
                  <div className="min-w-0">
                    <p className="font-display font-bold text-foreground truncate">{a.name as string}</p>
                    <p className="text-xs text-muted-foreground">{(a.industry as string) || '—'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  {a.health_score && <HealthBadge score={a.health_score as number} />}
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  {a.annual_revenue && <span className="inline-flex items-center gap-1"><DollarSign className="w-3 h-3" />{formatRevenue(a.annual_revenue as number)}</span>}
                  {a.website && <span className="inline-flex items-center gap-1"><Globe className="w-3 h-3" />{a.website as string}</span>}
                </div>
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
