import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { deals, stageConfig } from '@/lib/mockData';
import { useAppStore } from '@/store/appStore';
import { StageBadge } from '@/components/crm/CrmWidgets';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';
import { motion } from 'framer-motion';
import { Columns3, List, BarChart3, Plus, GripVertical, Sparkles, ChevronUp, ChevronDown } from 'lucide-react';
import { ContactAvatar } from '@/components/crm/ContactAvatar';

type ViewMode = 'kanban' | 'table' | 'forecast';
const kanbanStages = ['prospecting', 'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost'] as const;

const filterConfigs: FilterConfig[] = [
  { key: 'stage', label: 'Stage', options: Object.entries(stageConfig).map(([k, v]) => ({ value: k, label: v.label })) },
  { key: 'probability', label: 'Probability', options: [{ value: 'high', label: 'High (>60%)' }, { value: 'medium', label: 'Medium (30–60%)' }, { value: 'low', label: 'Low (<30%)' }] },
  { key: 'stale', label: 'Status', options: [{ value: 'stale', label: 'Stale (>14 days)' }, { value: 'active', label: 'Active (≤14 days)' }] },
];
const sortOptions: SortOption[] = [
  { key: 'name', label: 'Deal Name' }, { key: 'contactName', label: 'Contact' }, { key: 'amount', label: 'Amount' },
  { key: 'stage', label: 'Stage' }, { key: 'probability', label: 'Probability' }, { key: 'daysInStage', label: 'Days in Stage' },
];

export default function Deals() {
  const navigate = useNavigate();
  const [view, setView] = useState<ViewMode>('kanban');
  const { openDrawer, openQuickAdd, openAIWithContext } = useAppStore();
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  const handleFilterChange = (key: string, values: string[]) => {
    setActiveFilters(prev => { const next = { ...prev }; if (values.length === 0) delete next[key]; else next[key] = values; return next; });
  };
  const handleSortChange = (key: string) => {
    setSort(prev => prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };

  const filtered = useMemo(() => {
    let result = [...deals];
    if (search) { const q = search.toLowerCase(); result = result.filter(d => d.name.toLowerCase().includes(q) || d.contactName.toLowerCase().includes(q)); }
    if (activeFilters.stage?.length) result = result.filter(d => activeFilters.stage.includes(d.stage));
    if (activeFilters.probability?.length) {
      result = result.filter(d => {
        if (activeFilters.probability.includes('high') && d.probability > 60) return true;
        if (activeFilters.probability.includes('medium') && d.probability >= 30 && d.probability <= 60) return true;
        if (activeFilters.probability.includes('low') && d.probability < 30) return true;
        return false;
      });
    }
    if (activeFilters.stale?.length) {
      result = result.filter(d => {
        if (activeFilters.stale.includes('stale') && d.daysInStage > 14) return true;
        if (activeFilters.stale.includes('active') && d.daysInStage <= 14) return true;
        return false;
      });
    }
    if (sort) {
      result.sort((a, b) => {
        let aVal: string | number = '', bVal: string | number = '';
        if (sort.key === 'name') { aVal = a.name; bVal = b.name; }
        else if (sort.key === 'contactName') { aVal = a.contactName; bVal = b.contactName; }
        else if (sort.key === 'amount') { aVal = a.amount; bVal = b.amount; }
        else if (sort.key === 'probability') { aVal = a.probability; bVal = b.probability; }
        else if (sort.key === 'daysInStage') { aVal = a.daysInStage; bVal = b.daysInStage; }
        else if (sort.key === 'stage') { aVal = a.stage; bVal = b.stage; }
        if (typeof aVal === 'number' && typeof bVal === 'number') return sort.dir === 'asc' ? aVal - bVal : bVal - aVal;
        return sort.dir === 'asc' ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
      });
    }
    return result;
  }, [search, activeFilters, sort]);

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
      <TopBar title="Deals">
        <div className="hidden md:flex items-center gap-1 bg-muted rounded-xl p-0.5">
          <button onClick={() => setView('kanban')} className={`p-1.5 rounded-lg text-sm transition-all ${view === 'kanban' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}>
            <Columns3 className="w-4 h-4" />
          </button>
          <button onClick={() => setView('table')} className={`p-1.5 rounded-lg text-sm transition-all ${view === 'table' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}>
            <List className="w-4 h-4" />
          </button>
          <button onClick={() => setView('forecast')} className={`p-1.5 rounded-lg text-sm transition-all ${view === 'forecast' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}>
            <BarChart3 className="w-4 h-4" />
          </button>
        </div>
      </TopBar>

      <ListToolbar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Search deals..."
        filters={filterConfigs} activeFilters={activeFilters} onFilterChange={handleFilterChange}
        onClearFilters={() => setActiveFilters({})} sortOptions={sortOptions} currentSort={sort}
        onSortChange={handleSortChange} onAdd={() => openQuickAdd('deal')} addLabel="New Deal" entityType="deals" />

      <div className="flex-1 overflow-y-auto pb-24 md:pb-6">
        {view === 'kanban' && (
          <div className="flex gap-3 md:gap-4 px-4 md:px-6 pb-4 overflow-x-auto min-h-full snap-x snap-mandatory md:snap-none no-scrollbar">
            {kanbanStages.map((stage) => {
              const config = stageConfig[stage];
              const stageDeals = filtered.filter((d) => d.stage === stage);
              const total = stageDeals.reduce((sum, d) => sum + d.amount, 0);
              return (
                <div key={stage} className="flex-shrink-0 w-[280px] md:w-72 flex flex-col snap-center">
                  <div className="flex items-center justify-between mb-3 px-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-lg text-xs font-semibold" style={{ backgroundColor: config.color + '20', color: config.color }}>
                        {config.label}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">{stageDeals.length}</span>
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">${(total / 1000).toFixed(0)}K</span>
                  </div>
                  <div className="flex-1 space-y-2">
                    {stageDeals.map((deal, i) => (
                      <motion.div key={deal.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                        onClick={() => openDrawer('deal', deal.id)}
                        className="bg-card border border-border rounded-2xl p-3.5 cursor-pointer hover:border-primary/30 hover:shadow-md transition-all press-scale group">
                        <div className="flex items-start justify-between">
                          <p className="text-sm font-display font-bold text-foreground">{deal.name}</p>
                          <button onClick={(e) => { e.stopPropagation(); openAIWithContext({ type: 'deal', id: deal.id, name: deal.name, detail: `$${(deal.amount / 1000).toFixed(0)}K` }); navigate('/agent'); }}
                            className="p-0.5 rounded-lg md:opacity-0 md:group-hover:opacity-100 hover:bg-accent/10 transition-all">
                            <Sparkles className="w-3.5 h-3.5 text-accent" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <ContactAvatar name={deal.contactName} className="w-5 h-5 rounded-full text-[8px]" />
                          <span className="text-xs text-muted-foreground">{deal.contactName}</span>
                        </div>
                        <div className="flex items-center justify-between mt-2.5">
                          <span className="text-sm font-display font-extrabold text-foreground">${(deal.amount / 1000).toFixed(0)}K</span>
                          {deal.daysInStage > 14 ? (
                            <span className="px-2 py-0.5 rounded-lg text-xs bg-destructive/15 text-destructive font-semibold">{deal.daysInStage}d</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">{deal.daysInStage}d</span>
                          )}
                        </div>
                      </motion.div>
                    ))}
                    <button onClick={() => openQuickAdd('deal')}
                      className="w-full flex items-center justify-center gap-1 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-xl transition-colors press-scale">
                      <Plus className="w-3.5 h-3.5" /> Add Deal
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {view === 'table' && (
          <div className="px-4 md:px-6">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <p className="text-sm">No deals match your filters.</p>
                <button onClick={() => { setSearch(''); setActiveFilters({}); }} className="mt-2 text-xs text-primary font-semibold hover:underline">Clear all filters</button>
              </div>
            ) : (
              <>
                <div className="hidden md:block bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-surface-sunken/50">
                          <SortHeader label="Deal" sortKey="name" />
                          <SortHeader label="Contact" sortKey="contactName" />
                          <SortHeader label="Amount" sortKey="amount" />
                          <SortHeader label="Stage" sortKey="stage" />
                          <SortHeader label="Probability" sortKey="probability" />
                          <SortHeader label="Days" sortKey="daysInStage" />
                          <th className="px-2 py-3 w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((d, i) => (
                          <tr key={d.id} onClick={() => openDrawer('deal', d.id)}
                            className={`border-b border-border last:border-0 hover:bg-primary/5 cursor-pointer transition-colors group ${i % 2 === 1 ? 'bg-surface-sunken/30' : ''}`}>
                            <td className="px-4 py-3 font-display font-bold text-foreground">{d.name}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <ContactAvatar name={d.contactName} className="w-5 h-5 rounded-full text-[8px]" />
                                <span className="text-muted-foreground">{d.contactName}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 font-display font-bold text-foreground">${(d.amount / 1000).toFixed(0)}K</td>
                            <td className="px-4 py-3"><StageBadge stage={d.stage} /></td>
                            <td className="px-4 py-3 text-muted-foreground">{d.probability}%</td>
                            <td className="px-4 py-3">
                              <span className={`text-xs font-semibold ${d.daysInStage > 14 ? 'text-destructive' : 'text-muted-foreground'}`}>{d.daysInStage}d</span>
                            </td>
                            <td className="px-2 py-3">
                              <button onClick={(e) => { e.stopPropagation(); openAIWithContext({ type: 'deal', id: d.id, name: d.name, detail: `$${(d.amount / 1000).toFixed(0)}K` }); navigate('/agent'); }}
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

                {/* Mobile cards */}
                <div className="md:hidden space-y-2">
                  {filtered.map((d) => (
                    <div key={d.id} onClick={() => openDrawer('deal', d.id)}
                      className="bg-card border border-border rounded-2xl p-3.5 cursor-pointer transition-all press-scale">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-display font-bold text-foreground text-sm truncate">{d.name}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <ContactAvatar name={d.contactName} className="w-5 h-5 rounded-full text-[8px]" />
                            <span className="text-xs text-muted-foreground truncate">{d.contactName}</span>
                          </div>
                        </div>
                        <span className="text-sm font-display font-extrabold text-foreground flex-shrink-0">${(d.amount / 1000).toFixed(0)}K</span>
                      </div>
                      <div className="flex items-center gap-2 mt-2.5">
                        <StageBadge stage={d.stage} />
                        <span className="text-xs text-muted-foreground">{d.probability}%</span>
                        <span className={`text-xs font-semibold ml-auto ${d.daysInStage > 14 ? 'text-destructive' : 'text-muted-foreground'}`}>{d.daysInStage}d</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {view === 'forecast' && (
          <div className="px-4 md:px-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
              {[
                { label: 'Weighted Pipeline', value: filtered.filter(d => d.stage !== 'closed_won' && d.stage !== 'closed_lost').reduce((s, d) => s + d.amount * d.probability / 100, 0) },
                { label: 'Best Case', value: filtered.filter(d => d.stage !== 'closed_lost').reduce((s, d) => s + d.amount, 0) },
                { label: 'Closed Won', value: filtered.filter(d => d.stage === 'closed_won').reduce((s, d) => s + d.amount, 0) },
              ].map((card) => (
                <div key={card.label} className="bg-card border border-border rounded-2xl p-5 shadow-sm">
                  <p className="text-xs text-muted-foreground font-display font-semibold">{card.label}</p>
                  <p className="text-2xl font-display font-extrabold text-foreground mt-1">${(card.value / 1000000).toFixed(2)}M</p>
                </div>
              ))}
            </div>
            <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
              <h3 className="font-display font-bold text-foreground mb-4">Pipeline by stage</h3>
              <div className="space-y-4">
                {kanbanStages.filter(s => s !== 'closed_lost').map((stage) => {
                  const config = stageConfig[stage];
                  const total = filtered.filter(d => d.stage === stage).reduce((s, d) => s + d.amount, 0);
                  const max = Math.max(...kanbanStages.map(s => filtered.filter(d => d.stage === s).reduce((sum, d) => sum + d.amount, 0)), 1);
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
