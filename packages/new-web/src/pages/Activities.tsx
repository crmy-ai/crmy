import { useState, useMemo } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { activities } from '@/lib/mockData';
import { ActivityFeed } from '@/components/crm/CrmWidgets';
import { useAppStore } from '@/store/appStore';
import { ListToolbar, type FilterConfig, type SortOption } from '@/components/crm/ListToolbar';

const filterConfigs: FilterConfig[] = [
  {
    key: 'type', label: 'Type',
    options: [
      { value: 'call', label: 'Call' },
      { value: 'email', label: 'Email' },
      { value: 'meeting', label: 'Meeting' },
      { value: 'note', label: 'Note' },
      { value: 'task', label: 'Task' },
    ],
  },
];

const sortOptions: SortOption[] = [
  { key: 'timestamp', label: 'Date' },
  { key: 'contactName', label: 'Contact' },
  { key: 'type', label: 'Type' },
];

export default function Activities() {
  const { openQuickAdd } = useAppStore();
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
    setSort(prev => prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' });
  };

  const filtered = useMemo(() => {
    let result = [...activities];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(a =>
        a.contactName.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
      );
    }
    if (activeFilters.type?.length) {
      result = result.filter(a => activeFilters.type.includes(a.type));
    }
    if (sort) {
      result.sort((a, b) => {
        let aVal: string = '', bVal: string = '';
        if (sort.key === 'timestamp') { aVal = a.timestamp; bVal = b.timestamp; }
        else if (sort.key === 'contactName') { aVal = a.contactName; bVal = b.contactName; }
        else if (sort.key === 'type') { aVal = a.type; bVal = b.type; }
        return sort.dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      });
    }
    return result;
  }, [search, activeFilters, sort]);

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Activities" />

      <ListToolbar
        searchValue={search} onSearchChange={setSearch} searchPlaceholder="Search activities..."
        filters={filterConfigs} activeFilters={activeFilters} onFilterChange={handleFilterChange}
        onClearFilters={() => setActiveFilters({})} sortOptions={sortOptions} currentSort={sort}
        onSortChange={handleSortChange} onAdd={() => openQuickAdd('activity')} addLabel="Log Activity" entityType="activities"
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-24 md:pb-6">
        <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
          <ActivityFeed activities={filtered} />
        </div>
      </div>
    </div>
  );
}
