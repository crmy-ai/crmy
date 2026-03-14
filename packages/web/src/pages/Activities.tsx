// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useMemo } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { useActivities } from '@/api/hooks';
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
  { key: 'created_at', label: 'Date' },
  { key: 'type', label: 'Type' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Activity = any;

export default function Activities() {
  const { openQuickAdd } = useAppStore();
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, isLoading } = useActivities({ limit: 200 }) as any;
  const allActivities: Activity[] = data?.data ?? [];

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
    let result = [...allActivities];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(a => {
        const desc = ((a.description ?? a.body ?? '') as string).toLowerCase();
        const name = ((a.contact_name ?? '') as string).toLowerCase();
        return desc.includes(q) || name.includes(q);
      });
    }
    if (activeFilters.type?.length) {
      result = result.filter(a => activeFilters.type.includes(a.type as string));
    }
    if (sort) {
      result.sort((a, b) => {
        const aVal = (a[sort.key] ?? '') as string;
        const bVal = (b[sort.key] ?? '') as string;
        return sort.dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      });
    }
    return result;
  }, [allActivities, search, activeFilters, sort]);

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
        {isLoading ? (
          <div className="space-y-3 pt-2">
            {[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-muted/50 rounded-xl animate-pulse" />)}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
            <ActivityFeed activities={filtered} />
          </div>
        )}
      </div>
    </div>
  );
}
