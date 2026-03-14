import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContactAvatar } from '@/components/crm/ContactAvatar';
import { TopBar } from '@/components/layout/TopBar';
import { accounts, accountStageConfig } from '@/lib/mockData';
import { useAppStore } from '@/store/appStore';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';
import { motion } from 'framer-motion';
import { LayoutGrid, List, ChevronUp, ChevronDown, Sparkles, Globe, Users, DollarSign } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

type ViewMode = 'table' | 'cards';

const industries = [...new Set(accounts.map(a => a.industry))];

const filterConfigs: FilterConfig[] = [
  {
    key: 'stage', label: 'Stage',
    options: Object.entries(accountStageConfig).map(([k, v]) => ({ value: k, label: v.label })),
  },
  {
    key: 'industry', label: 'Industry',
    options: industries.map(i => ({ value: i, label: i })),
  },
];

const sortOptions: SortOption[] = [
  { key: 'name', label: 'Name' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'healthScore', label: 'Health' },
  { key: 'employeeCount', label: 'Employees' },
];

function HealthBadge({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-green-500/15 text-green-400' : score >= 50 ? 'bg-yellow-500/15 text-yellow-400' : 'bg-red-500/15 text-red-400';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>
      {score}
    </span>
  );
}

function AccountStageBadge({ stage }: { stage: string }) {
  const config = accountStageConfig[stage as keyof typeof accountStageConfig];
  if (!config) return null;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border"
      style={{ borderColor: config.color, color: config.color, backgroundColor: `${config.color}15` }}
    >
      {config.label}
    </span>
  );
}

function formatRevenue(revenue: number) {
  if (revenue >= 1000000) return `$${(revenue / 1000000).toFixed(1)}M`;
  if (revenue >= 1000) return `$${(revenue / 1000).toFixed(0)}K`;
  return `$${revenue}`;
}

export default function Accounts() {
  const isMobile = useIsMobile();
  const [view, setView] = useState<ViewMode>('table');
  const effectiveView = isMobile ? 'cards' : view;
  const { openDrawer, openQuickAdd, openAIWithContext } = useAppStore();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  const handleFilterChange = (key: string, values: string[]) => {
    setActiveFilters(prev => {
      const next = { ...prev };
      if (values.length === 0) delete next[key]; else next[key] = values;
      return next;
    });
  };

  const handleSortChange = (key: string) => {
    setSort(prev => prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };

  const filtered = useMemo(() => {
    let result = [...accounts];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(a => a.name.toLowerCase().includes(q) || a.industry.toLowerCase().includes(q) || a.website.toLowerCase().includes(q));
    }
    if (activeFilters.stage?.length) result = result.filter(a => activeFilters.stage.includes(a.stage));
    if (activeFilters.industry?.length) result = result.filter(a => activeFilters.industry.includes(a.industry));
    if (sort) {
      result.sort((a, b) => {
        let aVal: string | number = '', bVal: string | number = '';
        if (sort.key === 'name') { aVal = a.name; bVal = b.name; }
        else if (sort.key === 'revenue') { aVal = a.revenue; bVal = b.revenue; }
        else if (sort.key === 'healthScore') { aVal = a.healthScore; bVal = b.healthScore; }
        else if (sort.key === 'employeeCount') { aVal = a.employeeCount; bVal = b.employeeCount; }
        if (typeof aVal === 'number' && typeof bVal === 'number') return sort.dir === 'asc' ? aVal - bVal : bVal - aVal;
        return sort.dir === 'asc' ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
      });
    }
    return result;
  }, [search, activeFilters, sort]);

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
      <TopBar title="Accounts">
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
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <p className="text-sm">No accounts match your filters.</p>
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
                    <SortHeader label="Revenue" sortKey="revenue" />
                    <SortHeader label="Employees" sortKey="employeeCount" />
                    <SortHeader label="Health" sortKey="healthScore" />
                    <th className="text-left px-4 py-3 text-xs font-display font-semibold text-muted-foreground">Stage</th>
                    <th className="px-2 py-3 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a, i) => (
                    <tr key={a.id} onClick={() => openDrawer('account', a.id)}
                      className={`border-b border-border last:border-0 hover:bg-primary/5 cursor-pointer group transition-colors ${i % 2 === 1 ? 'bg-surface-sunken/30' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <ContactAvatar name={a.name} className="w-8 h-8" textClassName="text-xs" />
                          <div>
                            <span className="font-semibold text-foreground">{a.name}</span>
                            <p className="text-xs text-muted-foreground">{a.website}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{a.industry}</td>
                      <td className="px-4 py-3 text-foreground font-medium">{formatRevenue(a.revenue)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{a.employeeCount}</td>
                      <td className="px-4 py-3"><HealthBadge score={a.healthScore} /></td>
                      <td className="px-4 py-3"><AccountStageBadge stage={a.stage} /></td>
                      <td className="px-2 py-3">
                        <button onClick={(e) => { e.stopPropagation(); openAIWithContext({ type: 'account', id: a.id, name: a.name, detail: a.industry }); navigate('/agent'); }}
                          className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-accent/10 transition-all">
                          <Sparkles className="w-3.5 h-3.5 text-accent" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.map((a, i) => (
              <motion.div key={a.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                onClick={() => openDrawer('account', a.id)}
                className="bg-card border border-border rounded-2xl p-4 cursor-pointer hover:shadow-lg hover:border-primary/20 transition-all press-scale group relative">
                <div className="flex items-center gap-3 mb-3">
                  <ContactAvatar name={a.name} className="w-11 h-11" textClassName="text-sm" />
                  <div className="min-w-0">
                    <p className="font-display font-bold text-foreground truncate">{a.name}</p>
                    <p className="text-xs text-muted-foreground">{a.industry}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <AccountStageBadge stage={a.stage} />
                  <HealthBadge score={a.healthScore} />
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><DollarSign className="w-3 h-3" />{formatRevenue(a.revenue)}</span>
                  <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" />{a.contactIds.length} contacts</span>
                  <span className="inline-flex items-center gap-1"><Globe className="w-3 h-3" />{a.website}</span>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
