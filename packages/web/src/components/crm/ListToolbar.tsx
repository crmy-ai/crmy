import { useState, useRef, useEffect } from 'react';
import { Search, Filter, X, ChevronDown, Plus, ArrowUpDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';

export type FilterConfig = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
};

export type SortOption = {
  key: string;
  label: string;
};

interface ListToolbarProps {
  searchValue: string;
  onSearchChange: (val: string) => void;
  searchPlaceholder?: string;
  filters: FilterConfig[];
  activeFilters: Record<string, string[]>;
  onFilterChange: (key: string, values: string[]) => void;
  onClearFilters: () => void;
  sortOptions: SortOption[];
  currentSort: { key: string; dir: 'asc' | 'desc' } | null;
  onSortChange: (key: string) => void;
  onAdd: () => void;
  addLabel: string;
  entityType: string;
}

const ENTITY_GRADIENTS: Record<string, string> = {
  contacts:      'from-primary to-primary/80',
  accounts:      'from-[#8b5cf6] to-[#8b5cf6]/80',
  opportunities: 'from-accent to-accent/80',
  'use cases':   'from-success to-success/80',
  activities:    'from-warning to-warning/80',
  assignments:   'from-destructive to-destructive/80',
};

export function ListToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search...',
  filters,
  activeFilters,
  onFilterChange,
  onClearFilters,
  sortOptions,
  currentSort,
  onSortChange,
  onAdd,
  addLabel,
  entityType,
}: ListToolbarProps) {
  const gradientClasses = ENTITY_GRADIENTS[entityType] ?? 'from-primary to-primary/80';
  const searchRef = useRef<HTMLInputElement>(null);
  const activeFilterCount = Object.values(activeFilters).reduce((sum, arr) => sum + arr.length, 0);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (e.key === '/' && !isInput) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex flex-col gap-2 px-4 md:px-6 py-2 md:py-3">
      {/* Single row: search + filter + sort + add */}
      <div className="flex items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-0 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            ref={searchRef}
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full h-9 pl-9 pr-8 rounded-xl border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/30 transition-all"
          />
          {searchValue && (
            <button onClick={() => onSearchChange('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1">
              <X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
            </button>
          )}
          {!searchValue && (
            <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden md:inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-mono text-muted-foreground/50 bg-muted border border-border">
              /
            </kbd>
          )}
        </div>

        {/* Filter */}
        <Popover>
          <PopoverTrigger asChild>
            <button className="h-9 px-3 flex items-center gap-1.5 rounded-xl border border-border bg-card text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all flex-shrink-0 press-scale">
              <Filter className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Filter</span>
              {activeFilterCount > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0 rounded-xl" align="start">
            <div className="p-3 border-b border-border flex items-center justify-between">
              <span className="text-sm font-display font-bold text-foreground">Filters</span>
              {activeFilterCount > 0 && (
                <button onClick={onClearFilters} className="text-xs text-muted-foreground hover:text-foreground">
                  Clear all
                </button>
              )}
            </div>
            <div className="p-2 max-h-80 overflow-y-auto space-y-1">
              {filters.map((filter) => (
                <FilterSection
                  key={filter.key}
                  filter={filter}
                  selected={activeFilters[filter.key] || []}
                  onChange={(values) => onFilterChange(filter.key, values)}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Sort */}
        <Popover>
          <PopoverTrigger asChild>
            <button className="h-9 px-3 flex items-center gap-1.5 rounded-xl border border-border bg-card text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all flex-shrink-0 press-scale">
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">
                {currentSort ? sortOptions.find(s => s.key === currentSort.key)?.label || 'Sort' : 'Sort'}
              </span>
              {currentSort && (
                <span className="text-[10px] font-mono">{currentSort.dir === 'asc' ? '↑' : '↓'}</span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1 rounded-xl" align="start">
            {sortOptions.map((opt) => (
              <button
                key={opt.key}
                onClick={() => onSortChange(opt.key)}
                className={`w-full text-left px-3 py-2.5 text-sm rounded-lg transition-colors ${
                  currentSort?.key === opt.key ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }`}
              >
                {opt.label}
                {currentSort?.key === opt.key && (
                  <span className="ml-auto float-right text-[10px] font-mono">{currentSort.dir === 'asc' ? '↑' : '↓'}</span>
                )}
              </button>
            ))}
          </PopoverContent>
        </Popover>

        {/* Add New */}
        <button
          onClick={onAdd}
          className={`h-9 px-4 flex items-center gap-1.5 rounded-xl bg-gradient-to-r ${gradientClasses} text-primary-foreground text-sm font-semibold hover:shadow-md transition-all flex-shrink-0 press-scale`}
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">{addLabel}</span>
        </button>
      </div>

      {/* Active filter pills */}
      {activeFilterCount > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {Object.entries(activeFilters).map(([key, values]) =>
            values.map((val) => {
              const filterConfig = filters.find(f => f.key === key);
              const optionLabel = filterConfig?.options.find(o => o.value === val)?.label || val;
              return (
                <span
                  key={`${key}-${val}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-muted text-xs text-foreground"
                >
                  <span className="text-muted-foreground">{filterConfig?.label}:</span> {optionLabel}
                  <button
                    onClick={() => onFilterChange(key, values.filter(v => v !== val))}
                    className="ml-0.5 hover:text-destructive p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function FilterSection({
  filter,
  selected,
  onChange,
}: {
  filter: FilterConfig;
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-lg">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-2 py-2 text-xs font-display font-semibold text-muted-foreground hover:text-foreground"
      >
        {filter.label}
        {selected.length > 0 && (
          <span className="text-primary font-sans">{selected.length}</span>
        )}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <div className="space-y-0.5 pl-1 pb-1">
          {filter.options.map((opt) => {
            const checked = selected.includes(opt.value);
            return (
              <label
                key={opt.value}
                className="flex items-center gap-2 px-2 py-2 text-sm text-foreground hover:bg-muted/50 rounded-lg cursor-pointer min-h-[40px]"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => {
                    onChange(checked ? selected.filter(v => v !== opt.value) : [...selected, opt.value]);
                  }}
                  className="w-4 h-4"
                />
                {opt.label}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
