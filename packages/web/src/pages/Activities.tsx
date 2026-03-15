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

type TimeRangePreset = 'today' | 'this_week' | 'this_month' | 'this_quarter' | 'custom';

const TIME_RANGE_OPTIONS: { value: TimeRangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'custom', label: 'Custom' },
];

function getPresetDates(preset: TimeRangePreset): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (preset === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }
  if (preset === 'this_week') {
    const start = new Date(now);
    const day = start.getDay(); // 0=Sun, 1=Mon...
    const diff = day === 0 ? -6 : 1 - day; // adjust to Monday
    start.setDate(start.getDate() + diff);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }
  if (preset === 'this_month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return { start, end };
  }
  if (preset === 'this_quarter') {
    const quarter = Math.floor(now.getMonth() / 3);
    const start = new Date(now.getFullYear(), quarter * 3, 1, 0, 0, 0, 0);
    return { start, end };
  }
  // custom — caller provides dates
  return { start: new Date(0), end };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Activity = any;

export default function Activities() {
  const { openQuickAdd } = useAppStore();
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRangePreset>('this_week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

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

    // Date range filtering
    let start: Date;
    let end: Date;
    if (timeRange === 'custom') {
      start = customFrom ? new Date(customFrom + 'T00:00:00') : new Date(0);
      end = customTo ? new Date(customTo + 'T23:59:59') : new Date(8640000000000000);
    } else {
      ({ start, end } = getPresetDates(timeRange));
    }
    result = result.filter(a => {
      const d = new Date(a.created_at);
      return d >= start && d <= end;
    });

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
  }, [allActivities, search, activeFilters, sort, timeRange, customFrom, customTo]);

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Activities" />

      {/* Time range selector */}
      <div className="px-4 md:px-6 pt-3 pb-1 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-border bg-muted/40 p-0.5 gap-0.5">
          {TIME_RANGE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setTimeRange(opt.value)}
              className={[
                'px-3 py-1.5 text-xs font-medium rounded-lg transition-all',
                timeRange === opt.value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {timeRange === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="h-8 px-2 text-xs rounded-lg border border-border bg-background text-foreground"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="h-8 px-2 text-xs rounded-lg border border-border bg-background text-foreground"
            />
          </div>
        )}
      </div>

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
